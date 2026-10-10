import * as THREE from 'three';
import { GameStateMachine, type GameStateId } from './GameState';
import { SceneManager } from './SceneManager';
import { CameraRig } from './CameraRig';
import { Input } from './Input';
import { loadModels } from '../flight/ModelCache';
import { loadPilotModels } from '../characters/PilotModels';
import { VoiceController } from '../voice/VoiceController';
import { PilotBar } from '../ui/PilotBar';
import type { Cmd } from '../voice/CommandParser';
import { loadDem } from '../world/Dem';
import { ACTIONS, bindings } from './Bindings';
import { FlightSession, LIVERY_COLORS } from './FlightSession';
import { HangarScene } from './HangarScene';
import { HUD } from '../avionics/HUD';
import { AudioEngine } from '../audio/AudioEngine';
import { DialogueSystem } from '../story/DialogueSystem';
import { HANGAR_SCRIPT, resolveRole, type OutcomeKind } from '../story/Script';
import { SaveManager, freshSave, type Grade, type Route, type StorageLike } from '../persistence/SaveManager';
import { Settings } from '../ui/Settings';
import { FIELD_ELEV } from '../world/Heightfield';
import { UI, type UIAction } from '../ui/UI';
import { MapView } from '../ui/MapView';
import { buildAircraft, type AircraftVisual } from '../flight/AircraftMesh';
import type { MissionResult } from '../missions/MissionDirector';
import type { MissionId } from '../missions/MissionDirector';

function safeStorage(): StorageLike | null {
  try { const s = window.localStorage; s.setItem('vz.test', '1'); s.removeItem('vz.test'); return s; } catch { return null; }
}
const SHOWCASE = new THREE.Vector3(-135, FIELD_ELEV + 3.2, 1372);

/** Top-level application: state machine, scenes, UI wiring, main loop, persistence. */
export class Game {
  readonly fsm = new GameStateMachine();
  readonly settings: Settings;
  readonly save: SaveManager;
  readonly audio = new AudioEngine();
  readonly dialogue: DialogueSystem;
  readonly input: Input;
  readonly ui: UI;
  readonly sm: SceneManager;
  readonly cam = new CameraRig();
  readonly hud: HUD;
  readonly map = new MapView();
  voice!: VoiceController;
  pilotBar!: PilotBar;
  session: FlightSession | null = null;
  hangar: HangarScene | null = null;
  route: Route = 'A_BOY_SU57';
  mission: MissionId = 'm01';
  lastResult: MissionResult | null = null;
  private launching = false;
  private last = 0;
  private raf = 0;
  private t = 0;
  private showcaseRoute: Route | null = null;
  private showcaseVisuals: Partial<Record<Route, AircraftVisual>> = {};
  private showcaseGroup = new THREE.Group();
  private pendingHangarKind: OutcomeKind | null = null;
  private ready = false;
  readonly errors: string[] = [];
  frameCount = 0;

  constructor(private host: HTMLElement) {
    const store = safeStorage();
    bindings.attach(store);
    this.settings = new Settings(store);
    this.save = new SaveManager(store);
    this.save.load();
    if (this.save.data.route) this.route = this.save.data.route;
    this.sm = new SceneManager(host);
    this.hud = new HUD(host);
    this.hud.setVisible(false);
    this.input = new Input(host);
    this.dialogue = new DialogueSystem(this.audio);
    this.ui = new UI(host, this.settings);
    this.dialogue.onSubtitle = l => this.ui.setSubtitle(l);
    this.dialogue.voiceEnabled = this.settings.data.voice;
    this.ui.onAction = (a, p) => this.onAction(a, p);
    this.ui.onRebind = id => this.startRebind(id);
    this.voice = new VoiceController(host, {
      settings: this.settings,
      handleGlobal: c => this.voiceGlobal(c),
      flightExec: c => (this.session && !this.session.paused && this.fsm.inFlight ? this.session.voiceExec(c) : (this.session && this.fsm.state === 'PAUSED' ? 'The game is paused – say "resume".' : null)),
      resetInput: () => this.input.reset(),
      click: () => this.audio.uiClick(),
    });
    this.pilotBar = new PilotBar(host);
    this.pilotBar.onCommand = c => {
      if (!this.session || this.session.paused || !this.fsm.inFlight) return;
      this.audio.uiClick();
      this.voice.say(this.session.voiceExec(c));
    };
    this.pilotBar.onDialOpen = () => { try { document.exitPointerLock?.(); } catch { /* not locked */ } };
    window.setInterval(() => {
      const on = !!this.session && this.fsm.inFlight && !this.session.paused;
      this.pilotBar.setVisible(on || (this.pilotBar.guideOpen && !!this.session));
      if (on) { const g = this.session!.guide(); this.pilotBar.update(g.step, g.buttons); this.pilotBar.placeSquad(this.session!.mfdMode === 'full' ? this.hud.commsRect : null); }
    }, 250);
    this.ui.onSetting = (k, v) => { this.settings.set(k, v); this.applySettings(); };
    this.settings.onChange(() => this.applySettings());
    this.input.onKeyDown = (code) => this.onKey(code);
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('blur', () => { if (this.fsm.inFlight) this.requestPause('pause'); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.fsm.inFlight) this.requestPause('pause'); });
    const unlock = () => { this.audio.unlock(); this.audio.applySettings(this.settings.data); };
    window.addEventListener('pointerdown', unlock, { once: false }); window.addEventListener('keydown', unlock, { once: false });
    window.addEventListener('error', e => this.errors.push(String(e.message)));
    this.fsm.subscribe((to, from) => this.onState(to, from));
    this.sm.flightScene.add(this.showcaseGroup);
    this.applySettings();
  }

  // ------------------------------------------------------------------------- lifecycle
  async start() {
    this.ui.setLoading(0, 'Generating the Kazbegi Reach…');
    const realTerrain = await loadDem();
    try {
      await this.sm.loadWorld(f => this.ui.setLoading(f * 0.9, 'Generating the Kazbegi Reach…'));
    } catch (e) {
      this.errors.push('terrain: ' + String(e));
      this.ui.setLoading(1, 'Terrain generation failed – continuing with a reduced world.');
    }
    this.ui.setLoading(0.92, 'Loading aircraft and pilot models…');
    await Promise.all([loadModels(f => this.ui.setLoading(0.92 + f * 0.08)), loadPilotModels()]);
    for (const r of ['A_BOY_SU57', 'B_GIRL_F35'] as Route[]) {
      const v = buildAircraft(r === 'A_BOY_SU57' ? 'SU57' : 'F35', { girlPilot: r === 'B_GIRL_F35' });
      v.group.position.copy(SHOWCASE); v.group.position.y += 2.4; v.group.rotation.y = 0.5; v.cockpit.visible = false; v.group.visible = false;
      this.showcaseVisuals[r] = v; this.showcaseGroup.add(v.group);
    }
    this.ui.setLoading(null);
    this.ready = true;
    this.fsm.go('MAIN_MENU');
    this.last = performance.now();
    this.raf = requestAnimationFrame(t => this.frame(t));
  }

  private applySettings() {
    const s = this.settings.data;
    this.audio.applySettings(s);
    this.dialogue.voiceEnabled = s.voice;
    this.sm.applyQuality(s.quality);
    this.ui.applySubtitleSize();
    if (this.session) { this.session.fc.invertPitch = s.invertPitch; this.session.debug = s.debug; }
  }

  private onResize() {
    this.sm.resize(); this.hud.resize(); this.cam.resize(window.innerWidth, window.innerHeight);
    this.hangar?.resize(window.innerWidth, window.innerHeight);
  }

  // ------------------------------------------------------------------------- showcase (menu background)
  private setShowcase(route: Route | null) {
    this.showcaseRoute = route;
    for (const [r, v] of Object.entries(this.showcaseVisuals)) if (v) v.group.visible = r === route;
  }

  // ------------------------------------------------------------------------- input
  private onKey(code: string): boolean {
    const st = this.fsm.state;
    if (this.rebinding) return false;
    if (this.voice?.focused) return false;
    if (code === bindings.code('voice') && (this.fsm.inFlight || st === 'HANGAR' || st === 'PAUSED' || !(document.activeElement instanceof HTMLButtonElement))) { this.voice.focus(); return true; }
    if (code === bindings.code('radial') && this.session && this.fsm.inFlight) { this.pilotBar.toggleDial(); return true; }
    if (code === bindings.code('guide') && this.session && (this.fsm.inFlight || st === 'PAUSED')) { this.pilotBar.toggleGuide(); return true; }
    if (code === bindings.code('voiceMic')) { this.voice.toggleMic(); return true; }
    if (code === 'Escape' || code === bindings.code('pause')) {
      if (st === 'PAUSED') { this.pauseBack(); return true; }
      if (st === 'HANGAR') return true;
    }
    if (code === bindings.code('map') && st === 'PAUSED' && this.ui.mapCanvas) { this.doResume(); return true; }
    return false;
  }

  requestPause(what: 'pause' | 'map') {
    if (!this.session || !this.fsm.inFlight) return;
    if (this.fsm.go('PAUSED')) {
      if (what === 'map') this.ui.mapPanel(); else this.ui.pauseMenu();
    }
  }
  private pauseBack() {
    // Esc inside a sub-panel returns to the pause menu; Esc on the menu resumes
    if (this.ui.overlayOpen && !this.pauseMenuShown) { this.ui.pauseMenu(); this.pauseMenuShown = true; return; }
    this.doResume();
  }
  private pauseMenuShown = true;
  private freshCampaign = false;
  private doResume() {
    if (!this.session) return;
    const to = this.fsm.resumeState ?? 'ACTIVE_MISSION';
    if (this.fsm.go(to)) { this.ui.closeOverlay(); this.session.resume(); this.audio.resumeAll(); }
  }

  private rebinding: string | null = null;
  private startRebind(id: string) {
    this.rebinding = id; this.ui.rebindingId = id; this.ui.controls(this.fsm.state === 'PAUSED');
    const fromGame = this.fsm.state === 'PAUSED';
    const done = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopImmediatePropagation();
      window.removeEventListener('keydown', done, true);
      if (['ShiftRight', 'MetaLeft', 'MetaRight'].includes(e.code) === false && e.code !== 'Escape') {
        const swapped = bindings.set(id, e.code);
        if (swapped) this.ui.toast(`Swapped with “${ACTIONS.find(a => a.id === swapped)!.label}”`);
      }
      this.rebinding = null; this.ui.rebindingId = null; this.input.reset(); this.ui.controls(fromGame);
    };
    window.addEventListener('keydown', done, true);
  }

  // ------------------------------------------------------------------------- state changes
  private onState(to: GameStateId, from: GameStateId) {
    this.input.reset();
    document.body.dataset.state = to;
    const ui = this.ui;
    this.pauseMenuShown = true;
    if (to !== 'PAUSED') ui.closeOverlay();
    switch (to) {
      case 'MAIN_MENU':
        this.disposeSession(); this.disposeHangar(); this.sm.setActive('flight'); this.hud.setVisible(false); this.setShowcase(this.save.data.route ?? 'A_BOY_SU57');
        this.audio.setAmbience('none'); this.audio.setMusic('menu');
        ui.mainMenu(this.save.data, this.save.hasCampaign); this.dialogue.clear();
        break;
      case 'PILOT_SELECTION':
        this.setShowcase(this.showcaseRoute ?? this.route); ui.pilotSelection(this.save.data.route);
        document.querySelectorAll<HTMLElement>('.card[data-route]').forEach(c => c.addEventListener('mouseenter', () => this.setShowcase(c.dataset.route as Route)));
        break;
      case 'HANGAR': this.enterHangar(from); break;
      case 'MISSION_BRIEFING':
        this.disposeSession(); this.disposeHangar(); this.sm.setActive('flight'); this.hud.setVisible(false); this.setShowcase(this.route);
        this.audio.setAmbience('none'); this.audio.setMusic('menu');
        ui.briefing(this.mission, this.route);
        break;
      case 'LOADING': ui.clear(); ui.setLoading(0.3, 'Preparing aircraft…'); break;
      case 'TAKEOFF':
        this.sm.setActive('flight'); this.hud.setVisible(true); this.setShowcase(null); ui.clear(); ui.setLoading(null); if (from !== 'PAUSED' && !this.pilotBar.seenBefore()) this.pilotBar.showGuide(true); break;
      case 'ACTIVE_MISSION': break;
      case 'PAUSED': this.session?.pause(); this.audio.pauseAll(); break;
      case 'DEBRIEFING': break;
      case 'MISSION_FAILED': break;
      default: break;
    }
  }

  private disposeSession() {
    if (!this.session) return;
    this.session.dispose(); this.session = null; this.hud.clear(); this.audio.resumeAll();
  }
  private disposeHangar() {
    if (!this.hangar) return;
    this.hangar.dispose(); this.hangar = null; this.audio.setAmbience('none'); this.ui.showPrompt(null);
  }

  // ------------------------------------------------------------------------- hangar
  private enterHangar(from: GameStateId) {
    this.disposeSession(); this.disposeHangar();
    const d = this.save.data;
    this.hud.setVisible(false);
    this.hangar = new HangarScene(this.route, d.livery);
    this.hangar.resize(window.innerWidth, window.innerHeight);
    this.sm.setHangar(this.hangar.scene); this.sm.setActive('hangar');
    this.hangar.onEvent = (e, det) => this.onHangarEvent(e, det);
    this.audio.setAmbience('hangar'); this.audio.setMusic('hangar');
    this.ui.hangarHUD(this.route, d.savedAt);
    this.dialogue.clear();
    const kind = this.pendingHangarKind; this.pendingHangarKind = null;
    const say = (role: 'GC' | 'BOY' | 'GIRL', text: string) => this.dialogue.say({ speaker: resolveRole(role, this.route), text, priority: 1, radio: false });
    if (from === 'DEBRIEFING' && kind) {
      for (const l of HANGAR_SCRIPT[kind]) this.dialogue.say({ speaker: resolveRole(l.role, this.route), text: l.text, priority: 1, radio: l.role === 'GC' });
    } else {
      say('BOY', 'Hangar is quiet. Pick a mission when you are ready.');
    }
    this.ui.toast('Walk with WASD, Q/E turns the camera', 4000);
  }

  private onHangarEvent(e: string, det?: string) {
    switch (e) {
      case 'footstep': this.audio.footstep(); break;
      case 'clink': this.audio.hangarClink(); break;
    }
  }

  private hangarFrame(dt: number) {
    const h = this.hangar!;
    h.update(dt, this.input, this.audio.running);
    this.dialogue.update(dt);
  }

  /** Voice / typed commands that are about the game or its menus rather than the aircraft. Returns feedback, or null if not global. */
  private voiceGlobal(c: Cmd): string | null {
    const st = this.fsm.state;
    switch (c.t) {
      case 'pause': if (this.fsm.inFlight) { this.requestPause('pause'); return 'Paused.'; } return st === 'PAUSED' ? 'Already paused.' : 'Nothing to pause here.';
      case 'resume': if (st === 'PAUSED') { this.doResume(); return 'Resuming.'; } return 'Not paused.';
      case 'map': if (this.fsm.inFlight) { this.requestPause('map'); return 'Map open – say "resume" to fly.'; } if (st === 'PAUSED') { this.onAction('map'); return 'Map open.'; } return 'The map is available in flight.';
      case 'objectives': if (this.fsm.inFlight) this.requestPause('pause'); if (this.fsm.state === 'PAUSED') { this.onAction('objectives'); return 'Objectives shown – say "resume" to fly.'; } return 'Objectives are shown in a mission.';
      case 'restart': if (st === 'PAUSED' || st === 'MISSION_FAILED' || st === 'DEBRIEFING') { this.onAction(st === 'PAUSED' ? 'restart' : 'retry'); return 'Restarting the mission.'; } return this.fsm.inFlight ? 'Say "pause", then "restart mission" – restarting loses progress.' : 'No mission to restart.';
      case 'hangar': if (st === 'MAIN_MENU' || st === 'MISSION_BRIEFING') { if (!this.save.hasCampaign) return 'Start a campaign first.'; this.onAction('hangar'); return 'To the hangar.'; } if (st === 'PAUSED' || st === 'MISSION_FAILED' || st === 'DEBRIEFING') { this.onAction('return_hangar'); return 'Returning to the hangar.'; } return st === 'HANGAR' ? 'You are in the hangar.' : 'Pause first, then say "hangar".';
      case 'menu': if (this.fsm.inFlight) return 'Say "pause" first.'; this.onAction('main_menu'); return 'Main menu.';
      case 'new_campaign': if (st === 'MAIN_MENU' || st === 'HANGAR') { this.onAction('new_campaign'); return 'New campaign – choose a pilot.'; } return 'Go to the main menu first.';
      case 'pick_route': if (st === 'PILOT_SELECTION') { this.onAction('pick_route', c.route); return c.route === 'A_BOY_SU57' ? 'Specter-1, Su-57.' : 'Specter-2, F-35.'; } return 'Open "new campaign" to pick a pilot.';
      case 'launch': if (st === 'MISSION_BRIEFING') { this.onAction('launch', this.mission); return 'Launching the mission.'; } if (st === 'HANGAR') { this.onAction('briefing'); this.onAction('launch', this.mission); return 'Briefing skipped – launching.'; } return 'Open the hangar or briefing first.';
      case 'briefing': if (st === 'HANGAR') { this.onAction('briefing'); return 'Mission briefing.'; } if (st === 'PAUSED') { this.onAction('briefing_review'); return 'Briefing review.'; } return 'Briefing is available from the hangar.';
      case 'continue': if (st === 'MAIN_MENU' && this.save.hasCampaign) { this.onAction('continue'); return 'Continuing the campaign.'; } return 'No saved campaign to continue.';
      case 'settings': if (st === 'MAIN_MENU' || st === 'PAUSED') { this.onAction('settings'); return 'Settings.'; } return 'Settings are in the menus.';
      case 'controls': if (st === 'MAIN_MENU' || st === 'PAUSED') { this.onAction('controls'); return 'Controls.'; } return 'Controls are in the menus.';
      case 'credits': if (st === 'MAIN_MENU') { this.onAction('credits'); return 'Credits.'; } return 'Credits are in the main menu.';
      case 'back': if (this.ui.overlayOpen) { this.onAction('close_overlay'); return 'Closed.'; } if (st === 'MAIN_MENU' || st === 'PILOT_SELECTION') { this.onAction('main_menu'); return 'Back.'; } return 'Nothing to close.';
      case 'interact': return 'There is nobody to interact with here.';
      default: return null;
    }
  }

  // ------------------------------------------------------------------------- mission flow
  async launch(id: MissionId) {
    if (this.launching) return;
    if (this.fsm.state !== 'MISSION_BRIEFING') return;
    this.launching = true;
    this.mission = id;
    try {
      this.fsm.go('LOADING');
      await new Promise(r => setTimeout(r, 40));
      this.ui.setLoading(0.7, 'Spooling up…');
      await new Promise(r => setTimeout(r, 20));
      this.disposeSession();
      this.session = new FlightSession({
        scene: this.sm, audio: this.audio, dialogue: this.dialogue, settings: this.settings, input: this.input, camera: this.cam, hud: this.hud,
        route: this.route, missionId: id, livery: this.save.data.livery,
        onEnd: r => { window.setTimeout(() => { if (this.fsm.inFlight) this.onMissionEnd(r); }, 0); },
        onPause: w => this.requestPause(w),
        onVoiceMessage: s => this.voice.say(s),
        micOn: () => this.voice.listening,
        onStatus: s => { if (s === 'phase:P2_TRANSIT' && this.fsm.state === 'TAKEOFF') this.fsm.go('ACTIVE_MISSION'); },
      });
      this.cam.resize(window.innerWidth, window.innerHeight);
      this.fsm.go('TAKEOFF');
      this.ui.setLoading(null);
    } catch (e) {
      this.errors.push('launch: ' + String(e));
      this.ui.setLoading(null); this.ui.toast('Launch failed: ' + String(e), 6000);
      this.disposeSession();
      this.fsm.go('MAIN_MENU');
    } finally { this.launching = false; }
  }

  private onMissionEnd(res: MissionResult) {
    this.lastResult = res;
    const kind = res.kind;
    const isSchool = this.mission === 'school';
    if (res.completed) {
      const delta = { FLAWLESS: 8, RESCUE: 10, STORM_RUN: 9, CLOSE_CALL: 5, DAMAGED_RETURN: 6, FAIL_CRASH: 0, FAIL_WING: 0, FAIL_FUEL: 0 }[kind];
      const unlocks: string[] = [];
      if (['S', 'A', 'B'].includes(res.grade)) unlocks.push('livery_frost');
      if (['S', 'A'].includes(res.grade)) unlocks.push('livery_ember');
      this.save.recordMission(this.mission, { completed: true, grade: res.grade as Grade, score: res.score, outcome: kind, relationshipDelta: delta, unlocks,
        flags: { [`${this.mission}_${res.stats.route === 'MAIN' ? 'storm_main' : 'storm_alt'}`]: true, [`${this.mission}_wingman_rescued`]: res.stats.rescues > 0, [`${this.mission}_undetected`]: !res.stats.detected } });
    } else {
      this.save.recordMission(this.mission, { completed: false, grade: 'F', score: res.score, outcome: kind });
    }
    void isSchool;
    const lines = (HANGAR_SCRIPT[kind] ?? []).map(l => `<b>${resolveRole(l.role, this.route)}:</b> ${l.text}`);
    this.pendingHangarKind = res.completed ? kind : null;
    const target: GameStateId = res.completed ? 'DEBRIEFING' : 'MISSION_FAILED';
    // hide flight HUD while the debrief is shown
    this.hud.clear(); this.hud.setVisible(false);
    this.fsm.go(target);
    this.disposeSession();
    this.ui.debrief(res, lines);
    if (!res.completed) for (const l of HANGAR_SCRIPT[kind]) this.dialogue.say({ speaker: resolveRole(l.role, this.route), text: l.text, priority: 1 });
    else for (const l of HANGAR_SCRIPT[kind]) this.dialogue.say({ speaker: resolveRole(l.role, this.route), text: l.text, priority: 1, radio: l.role === 'GC' });
    this.audio.setMusic(res.completed ? 'calm' : 'tense');
  }

  // ------------------------------------------------------------------------- UI actions
  private onAction(a: UIAction, p?: string) {
    this.audio.unlock(); this.audio.uiClick();
    const st = this.fsm.state;
    switch (a) {
      case 'new_campaign': {
        const go = () => { this.freshCampaign = true; if (this.fsm.state !== 'MAIN_MENU') this.fsm.go('MAIN_MENU'); this.fsm.go('PILOT_SELECTION'); };
        if (this.save.hasCampaign) { if (confirm('Start a new campaign? This replaces your current saved progress.')) go(); } else go();
        break;
      }
      case 'change_route': this.freshCampaign = false; if (this.fsm.state !== 'MAIN_MENU') this.fsm.go('MAIN_MENU'); this.fsm.go('PILOT_SELECTION'); break;
      case 'pick_route': {
        const r = p as Route; const had = this.save.hasCampaign;
        if (!had || this.freshCampaign) this.save.newCampaign(r); else if (this.save.data.route !== r) this.save.setRoute(r);
        this.freshCampaign = false;
        this.route = r; this.audio.uiConfirm(); this.fsm.go('HANGAR'); break;
      }
      case 'continue': case 'hangar': if (this.save.hasCampaign) { this.route = this.save.data.route!; if (st === 'HANGAR') break; this.fsm.go('HANGAR'); } break;
      case 'mission_select': if (st === 'HANGAR') { this.fsm.go('MAIN_MENU'); } this.ui.missionSelect(this.save.data); break;
      case 'select_mission': this.mission = p as MissionId; this.route = this.save.data.route!; this.fsm.go('MISSION_BRIEFING'); break;
      case 'flight_school': this.mission = 'school'; this.route = this.save.data.route!; this.fsm.go('MISSION_BRIEFING'); break;
      case 'briefing': if (st === 'HANGAR') this.fsm.go('MISSION_BRIEFING'); break;
      case 'aircraft': if (st === 'HANGAR') this.fsm.go('MAIN_MENU'); this.ui.aircraftScreen(this.save.data); break;
      case 'livery': { this.save.data.livery = p!; this.save.save(); this.ui.aircraftScreen(this.save.data); break; }
      case 'settings': if (this.fsm.state === 'PAUSED') { this.ui.settingsPanel(true); this.pauseMenuShown = false; } else this.ui.settingsPanel(false); break;
      case 'credits': this.ui.credits(); break;
      case 'exit': this.save.save(); this.ui.exitScreen(); try { window.close(); } catch { /* browsers may refuse */ } break;
      case 'main_menu':
        if (st === 'MAIN_MENU') { this.ui.mainMenu(this.save.data, this.save.hasCampaign); break; }
        this.fsm.go('MAIN_MENU'); break;
      case 'launch': void this.launch((p as MissionId) ?? this.mission); break;
      case 'resume': this.doResume(); break;
      case 'objectives': if (this.session) { this.ui.objectivesPanel(this.session.director.objectives, this.session.director.phase, this.session.director.hint(2)); this.pauseMenuShown = false; } break;
      case 'map': this.ui.mapPanel(); this.pauseMenuShown = false; break;
      case 'controls': this.ui.controls(this.fsm.state === 'PAUSED'); this.pauseMenuShown = false; break;
      case 'reset_keys': bindings.resetAll(); this.ui.controls(this.fsm.state === 'PAUSED'); this.ui.toast('Keys reset to defaults'); break;
      case 'briefing_review': this.ui.briefing(this.mission, this.route, true); this.pauseMenuShown = false; break;
      case 'close_overlay': if (st === 'PAUSED') { this.ui.pauseMenu(); this.pauseMenuShown = true; } else this.ui.closeOverlay(); break;
      case 'restart': { const id = this.mission; if (this.fsm.go('MISSION_BRIEFING')) void this.launch(id); break; }
      case 'return_hangar': if (this.fsm.state === 'MISSION_FAILED' || this.fsm.state === 'PAUSED' || this.fsm.state === 'DEBRIEFING') this.fsm.go('HANGAR'); break;
      case 'debrief_continue': this.fsm.go('HANGAR'); break;
      case 'debrief_replay': case 'retry': { const id = this.mission; if (this.fsm.go('MISSION_BRIEFING')) void this.launch(id); break; }
      case 'save': this.ui.toast(this.save.save() ? 'Progress saved' : 'Saving is unavailable in this browser'); break;
      case 'reset_save': if (confirm('Erase the whole campaign?')) { this.save.data = freshSave(); this.save.save(); this.ui.toast('Campaign erased'); if (this.fsm.state !== 'MAIN_MENU') this.fsm.go('MAIN_MENU'); else this.ui.mainMenu(this.save.data, false); } break;
      case 'back': break;
    }
  }

  // ------------------------------------------------------------------------- main loop
  private frame = (now: number) => {
    this.raf = requestAnimationFrame(t => this.frame(t));
    const dt = Math.min(Math.max((now - this.last) / 1000, 0.0001), 0.1);   // clamp long gaps (tab switches, breakpoints)
    this.last = now;
    this.t += dt; this.frameCount++;
    try { this.tick(dt); } catch (e) {
      this.errors.push('tick: ' + String((e as Error)?.stack ?? e));
      if (this.errors.length > 20) this.errors.shift();
      if (this.fsm.inFlight && this.errors.filter(x => x.startsWith('tick')).length > 8) { this.ui.toast('Runtime error – returning to menu', 5000); this.disposeSession(); this.fsm.go('PAUSED') || this.fsm.go('MAIN_MENU'); }
    }
    this.input.endFrame();
  };

  private tick(dt: number) {
    if (!this.ready) return;
    const st = this.fsm.state;
    switch (st) {
      case 'TAKEOFF': case 'ACTIVE_MISSION': {
        const s = this.session; if (!s) break;
        s.update(dt);
        this.ui.showPrompt(null);
        this.sm.render(this.cam.camera);
        return;
      }
      case 'PAUSED': {
        const s = this.session;
        if (s) {
          s.update(0.0001);   // keeps camera/HUD frame fresh while frozen (sim is paused)
          if (this.ui.mapCanvas) this.map.render(this.ui.mapCanvas, s);
          this.sm.render(this.cam.camera);
        }
        return;
      }
      case 'HANGAR': if (this.hangar) { this.hangarFrame(dt); this.sm.render(this.hangar.camera); } return;
      default: break;
    }
    // menu background: orbit the parked aircraft on the apron
    const a = this.t * 0.14;
    const cam = this.cam.camera;
    cam.position.set(SHOWCASE.x + Math.sin(a) * 30, SHOWCASE.y + 5 + Math.sin(this.t * 0.2) * 1.5, SHOWCASE.z + Math.cos(a) * 30);
    cam.lookAt(SHOWCASE.x + Math.cos(a) * 7, SHOWCASE.y + 3, SHOWCASE.z - Math.sin(a) * 7);
    this.cam.camera.fov = 50; this.cam.camera.updateProjectionMatrix();
    this.sm.sky.update(dt, cam, cam.position);
    this.sm.airfield.update(dt, cam.position);
    this.dialogue.update(dt);
    this.sm.render(cam);
  }

  // ------------------------------------------------------------------------- debug / test hooks
  /** Automation helper: walks the real state-machine path MAIN_MENU → HANGAR → MISSION_BRIEFING → LOADING → TAKEOFF. */
  async debugLaunch(route: Route, mission: MissionId = 'm01') {
    if (this.fsm.inFlight) this.fsm.go('PAUSED');
    if (this.fsm.state !== 'MAIN_MENU') this.fsm.go('MAIN_MENU');
    if (!this.save.hasCampaign || this.save.data.route !== route) this.save.newCampaign(route);
    this.route = route;
    this.fsm.go('HANGAR'); this.mission = mission; this.fsm.go('MISSION_BRIEFING');
    await this.launch(mission);
  }
  dispose() { cancelAnimationFrame(this.raf); this.input.dispose(); this.sm.dispose(); }
  get debugState() {
    const s = this.session;
    return { state: this.fsm.state, route: this.route, mission: this.mission, phase: s?.director.phase, errors: this.errors.slice(-5), liveries: Object.keys(LIVERY_COLORS) };
  }
}
