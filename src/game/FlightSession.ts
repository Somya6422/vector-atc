import * as THREE from 'three';
import { Unit } from './Entity';
import { AIRCRAFT, DRONE } from '../flight/AircraftConfig';
import { buildAircraft, checkVisorInvariant } from '../flight/AircraftMesh';
import { FlightController } from '../flight/FlightController';
import { FlightModel } from '../flight/FlightModel';
import type { FlightControls } from '../flight/FlightModel';
import { Weapons } from '../combat/Weapons';
import { TargetingSystem } from '../combat/TargetingSystem';
import type { WeaponId } from '../combat/WeaponSpecs';
import { BanditAI } from '../ai/BanditAI';
import { WingmanAI, type WingmanCall } from '../ai/WingmanAI';
import { MissionDirector, type MissionHost, type MissionId, type MissionResult, type Phase } from '../missions/MissionDirector';
import { FIELD_ELEV, START_POS, WAYPOINTS, blizzardAt, cxMain, minClearanceAlong, resetBlizzard, terrainHeight, world } from '../world/Heightfield';
import { approachInfo, chooseRunwayDirection } from '../world/Landing';
import { HUD, type CameraView, type HudWarnings } from '../avionics/HUD';
import { CameraRig, VIEW_LABEL } from './CameraRig';
import { bindings, keyName } from './Bindings';
import { Assists } from '../voice/Assists';
import type { Cmd } from '../voice/CommandParser';
import type { Input } from './Input';
import type { SceneManager } from './SceneManager';
import type { AudioEngine } from '../audio/AudioEngine';
import { DialogueSystem } from '../story/DialogueSystem';
import { SCRIPT, resolveRole, type Role } from '../story/Script';
import type { Route } from '../persistence/SaveManager';
import type { Settings } from '../ui/Settings';
import { DEG, KT, clamp } from '../util/math';

const _a = new THREE.Vector3(), _b = new THREE.Vector3();
export const LIVERY_COLORS: Record<string, number> = { livery_default: 0, livery_frost: 0xb9c6d4, livery_ember: 0x7a4b3a };

export interface SessionOptions {
  scene: SceneManager; audio: AudioEngine; dialogue: DialogueSystem; settings: Settings; input: Input; camera: CameraRig; hud: HUD;
  route: Route; missionId: MissionId; livery: string;
  onEnd: (r: MissionResult) => void;
  onPause: (what: 'pause' | 'map') => void;
  onStatus?: (s: string) => void;
  onVoiceMessage?: (s: string) => void;
}

/** One mission run: units, AI, weapons, director, camera/HUD feed. Destroyed completely when the mission ends or restarts. */
export class FlightSession {
  readonly player: Unit; readonly wingman: Unit; readonly drones: Unit[] = [];
  readonly units: Unit[] = [];
  readonly weapons: Weapons;
  readonly targeting: TargetingSystem;
  readonly wingAI: WingmanAI;
  readonly bandits: BanditAI[] = [];
  readonly director: MissionDirector;
  readonly fc = new FlightController();
  readonly assists!: Assists;
  private gunBurstUntil = 0;
  elapsed = 0;
  paused = false;
  weaponMsg = ''; private weaponMsgT = 0;
  hintText: string | null = null; private hintT = 0; private hintLevel = 0;
  debug = false;
  private root = new THREE.Group();
  private accum = 0;
  private stepNo = 0;
  private wingCtl: FlightControls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, airbrake: true, gearDown: true };
  private droneCtl = new Map<string, FlightControls>();
  private interference = 0;
  private rtb = false;
  private endTimer = -1;
  private ended = false;
  private radarRanges = [10, 20, 40, 80]; private radarIdx = 2;
  private selectedWeapon: WeaponId = 'GUN';
    private lastKillKind = new Map<Unit, 'GUN' | 'IR' | 'RADAR'>();
  private threatenedWing = new Map<Unit, number>();
  private gcasT = 0; private gcas = false;
  private warnings: HudWarnings;
  private alertedBandits = false;
  private disposers: (() => void)[] = [];
  private lastWingState = '';
  private crashHandled = false;
  private touchSound = 0;
  private lastMissileWarn = false;
  frames = 0;

  constructor(private o: SessionOptions) {
    const route = o.route;
    const playerCfg = route === 'A_BOY_SU57' ? AIRCRAFT.SU57 : AIRCRAFT.F35;
    const wingCfg = route === 'A_BOY_SU57' ? AIRCRAFT.F35 : AIRCRAFT.SU57;
    this.player = new Unit('ownship', route === 'A_BOY_SU57' ? 'Specter-1' : 'Specter-2', 'player', playerCfg, world, 101);
    this.wingman = new Unit('wingman', route === 'A_BOY_SU57' ? 'Specter-2' : 'Specter-1', 'friendly', wingCfg, world, 102);
    this.wingman.damageScale = 0.6;
    this.units.push(this.player, this.wingman);
    for (let i = 0; i < (o.missionId === 'm01' ? 2 : 0); i++) {
      const d = new Unit(i ? 'drone2' : 'drone1', i ? 'Wraith-2' : 'Wraith-1', 'hostile', DRONE, world, 110 + i);
      d.dormant = true; d.model.setHeadingPlace(cxMain(-31000 - i * 1500) + (i ? -250 : 250), 3500 + i * 100, -31000 - i * 1500, 180, 0, 190);
      this.drones.push(d); this.units.push(d);
    }
    // ---- visuals ----
    o.scene.flightScene.add(this.root);
    for (const u of this.units) {
      const v = buildAircraft(u.cfg.id, { girlPilot: u.cfg.id === 'F35' });
      u.visual = v; this.root.add(v.group);
      const lc = LIVERY_COLORS[o.livery];
      if (u === this.player && lc) v.setLivery(lc);
      if (u.dormant) v.group.visible = false;
    }
    this.player.visual!.pilotHead && (this.player.visual!.pilotHead.visible = true);
    const violations = checkVisorInvariant(this.root);
    if (violations.length) throw new Error('Visor invariant violated: ' + violations.join('; '));
    // ---- systems ----
    this.weapons = new Weapons(() => this.units.filter(u => !u.dormant));
    this.root.add(this.weapons.group);
    this.targeting = new TargetingSystem(this.player, () => this.units.filter(u => u !== this.player && !u.dormant && (u.side === 'hostile')), () => this.interferenceFor(this.player));
    this.wingAI = new WingmanAI(this.wingman);
    const host = this.makeHost();
    this.director = new MissionDirector(host, o.missionId);
    this.assists = new Assists(this.player, this.fc, this.director);
    this.assists.onMessage = s => { this.o.onVoiceMessage?.(s); this.flash(s, 2.5); };
    for (const [i, d] of this.drones.entries()) {
      const z0 = -27000 - i * 1500;
      const pts = [] as { x: number; z: number; alt: number }[];
      for (let z = z0; z >= -33500; z -= 3200) pts.push({ x: cxMain(z), z, alt: 3500 + i * 100 });
      for (let z = -33500; z <= z0; z += 3200) pts.push({ x: cxMain(z), z, alt: 3500 + i * 100 });
      this.bandits.push(new BanditAI(d, pts, 7 + i, i === 0 ? 'ownship' : 'wingman'));
    }
    this.wireEvents();
    this.resetPositions();
    this.warnings = { stall: false, stallWarn: false, pullUp: false, missile: null, bingo: false, lowFuel: false, damage: false, flameout: false, overG: false, interference: 0, lockedOn: false };
    resetBlizzard();
    o.dialogue.clear();
    o.audio.startEngine(playerCfg.id === 'SU57' ? 'SU57' : 'F35');
    o.audio.setMusic('calm');
    this.fc.invertPitch = o.settings.data.invertPitch;
    o.camera.view = 'chase'; o.camera.freeLook = false; o.camera.snap();
    this.debug = o.settings.data.debug;
  }

  // ------------------------------------------------------------------ setup
  private resetPositions() {
    const p = this.player.model;
    p.setHeadingPlace(START_POS.x, FIELD_ELEV + this.player.cfg.gearHeight, START_POS.z, START_POS.heading, 0, 0);
    p.gearPos = 1; p.onGround = true; p.engineOn = false; p.engineN = 0;
    this.fc.reset(0);
    const w = this.wingman.model;
    w.setHeadingPlace(13, FIELD_ELEV + this.wingman.cfg.gearHeight, 1135, 0, 0, 0);
    w.gearPos = 1; w.onGround = true; w.startEngines(); w.engineN = 0.2;
    this.wingAI.state = 'HOLD';
  }

  private makeHost(): MissionHost {
    const s = this;
    return {
      route: this.o.route, player: this.player, wingman: this.wingman, drones: this.drones,
      say: (key) => this.sayKey(key),
      sayRole: (role, text, pr = 1, key) => this.o.dialogue.say({ speaker: resolveRole(role, this.o.route), text, priority: pr, key }),
      getFront: () => this.o.scene.sky.front,
      setFront: f => { this.o.scene.sky.front = f; },
      activateDrones: (alerted) => this.activateDrones(alerted),
      alertDrones: () => { this.alertedBandits = true; },
      setWingmanRtb: on => { this.rtb = on; },
      wingmanLanded: () => this.wingAI.state === 'PARKED' || (this.wingman.alive && this.wingman.model.onGround && this.wingman.model.vel.length() < 1.5 && this.director?.phase === 'P5_RTB' && this.director.stats.landed),
      wingmanSeparation: () => this.wingAI.separation,
      setInterference: v => { this.interference = v; this.o.dialogue.interference = v; },
      onPhase: (p: Phase) => { this.onPhase(p); },
      onObjective: o => { void o; s.o.onStatus?.('objective'); },
    };
  }

  private sayKey(key: string) {
    const lines = SCRIPT[key];
    if (!lines) return;
    for (const l of lines) this.o.dialogue.say({ speaker: resolveRole(l.role, this.o.route), text: l.text, priority: l.priority ?? 1 });
  }

  private onPhase(p: Phase) {
    this.o.audio.setMusic(p === 'P3_INTERCEPT' ? 'tense' : p === 'P4_BLIZZARD' ? 'tense' : p === 'P6_DEBRIEF' ? 'calm' : p === 'P2_TRANSIT' ? 'tense' : 'calm');
    this.o.onStatus?.('phase:' + p);
  }

  private activateDrones(alerted: boolean) {
    this.alertedBandits = alerted;
    for (const [i, d] of this.drones.entries()) {
      d.dormant = false; if (d.visual) d.visual.group.visible = true;
      d.model.startEngines(); d.model.engineN = 0.7;
      void i;
    }
  }

  private wireEvents() {
    const w = this.weapons, o = this.o;
    w.events.onGunFire = () => { /* continuous gun audio handled per frame */ };
    w.events.onMissileLaunch = m => {
      o.audio.missileLaunch(m.spec.id);
      if (m.owner === this.player) o.dialogue.say({ speaker: resolveRole('P', o.route), text: m.spec.id === 'RADAR' ? 'Sabre away!' : 'Fox-two!', priority: 2 });
      if (m.owner.side === 'hostile' && m.target === this.wingman) {
        this.threatenedWing.set(m.owner, this.elapsed);
        this.sayKey('missile_w');
      }
      if (m.owner.side === 'hostile' && m.target === this.player) {
        this.sayKey('missile_p');
      }
    };
    w.events.onHit = (t, dmg, by, kind) => {
      if (by === this.player) { o.audio.hit(); }
      if (t === this.player) { this.cameraKick = 1; this.director?.notifyMissileHit(t, by?.side === 'hostile' && kind !== 'GUN'); }
      if (t === this.wingman && by?.side === 'hostile') this.wingmanHitAt = this.elapsed;
      if (kind) this.lastKillKind.set(t, kind);
      if (t.side === 'friendly' && by === this.player) this.director.stats.friendlyDamage += dmg;
    };
    w.events.onKill = (t, by) => {
      const kind = this.lastKillKind.get(t) ?? 'GUN';
      this.director.notifyKill(t, by, kind);
      if (t === this.player || t === this.wingman) return;
      const threatAt = this.threatenedWing.get(t);
      if (by === this.player && threatAt !== undefined && this.elapsed - threatAt < 30) this.director.notifyRescue();
    };
    w.events.onDetonate = (pos, hit) => { o.audio.explosion(pos.distanceTo(this.player.pos)); void hit; };
    w.events.onFlare = u => { if (u === this.player) { o.audio.flare(); this.director.notifyFlare(); } };
    this.wingAI.onCall = (c, d) => this.wingCall(c, d);
    const m = this.player.model;
    m.onTouchdown = e => {
      o.audio.touchdown(e.hard); this.director.notifyTouchdown(e.sink, e.iasKt, e.hard, e.paved);
    };
    m.onCrash = () => { /* handled in update */ };
  }
  cameraKick = 0;
  private wingmanHitAt = -99;

  private wingCall(c: WingmanCall, detail?: string) {
    const d = this.o.dialogue, route = this.o.route;
    const W = (text: string, pr: 0 | 1 | 2 | 3 = 1, key?: string) => d.say({ speaker: resolveRole('W', route), text, priority: pr, key, cooldown: 6 });
    switch (c) {
      case 'ENGAGING': W(detail === 'Fox-2' ? 'Fox-two!' : `Tally ho, engaging ${detail ?? 'target'}.`, 1, 'w_eng'); break;
      case 'THREAT': { const [cs, km] = (detail ?? '|').split('|'); W(`Contact: ${cs}, bearing north, range ${km} kilometres.`, 1, 'w_thr'); break; }
      case 'MISSILE': W('Missile! Breaking and flaring!', 3, 'w_mis'); break;
      case 'DAMAGE': W(detail === 'heavy' ? 'Heavy damage! I am going home.' : 'I took a hit, still flying.', 3, 'w_dmg'); break;
      case 'REJOINING': W('Rejoining on you.', 0, 'w_rej'); break;
      case 'KILL': W('Target destroyed.', 1, 'w_kill'); break;
      case 'FLARES': W('Flares!', 2, 'w_fl'); break;
      case 'RTB': W('Heading home.', 1, 'w_rtb'); break;
      case 'LOST_VISUAL': this.sayKey('lost_visual'); break;
      case 'VISUAL': this.sayKey('visual_regain'); break;
      case 'COVERING': W('Covering you.', 1); break;
      case 'WINCHESTER': W('Winchester. I am out of missiles.', 2, 'w_win'); break;
    }
  }

  // ------------------------------------------------------------------ update
  update(frameDt: number) {
    if (this.ended) return;
    const dt = Math.min(frameDt, 0.05);
    this.frames++;
    const o = this.o, inp = o.input;
    if (!this.paused) this.handleInput(dt);
    if (!this.paused) {
      this.elapsed += dt;
      this.accum += dt;
      let n = 0;
      while (this.accum >= FlightModel.DT && n < 8) { this.fixedStep(); this.accum -= FlightModel.DT; n++; }
      if (this.accum > FlightModel.DT * 8) this.accum = 0;   // never spiral
      // weapons / sensors in ≤20 ms slices
      let rem = dt;
      while (rem > 1e-4) { const s = Math.min(rem, 0.02); this.weapons.update(s, this.elapsed); rem -= s; }
      this.targeting.update(dt);
      this.director.update(dt);
      this.postUpdate(dt);
      o.dialogue.update(dt);
    }
    this.updateVisuals(dt);
    this.updateCameraAndHud(dt);
    inp.endFrame();
  }

  private fixedStep() {
    this.stepNo++;
    const p = this.player, pm = p.model, dir = this.director;
    // --- player ---
    const c = this.fc.controls;
    if (pm.onGround && pm.weightOnWheels > 0.2) c.gearDown = true;
    if (!dir.engineStartRequested) c.throttle = 0;
    if (dir.startupProgress > 0.45 && !pm.engineOn && pm.fuel > 0) pm.startEngines();
    if (dir.engineStartRequested && dir.startupProgress < 1) c.airbrake = true;   // chocks / brakes during start
    // once the engines are running the aircraft starts rolling forward by itself (no key needed); wheel brakes keep taxi speed sane
    if (dir.startupProgress >= 1 && !this.autoRolled) { this.autoRolled = true; this.fc.throttle = Math.max(this.fc.throttle, 0.3); }
    if (pm.onGround && c.throttle < 0.6 && pm.vel.length() > 9) c.airbrake = true;
    pm.step(FlightModel.DT, c);
    // --- AI @30 Hz ---
    const aiDt = FlightModel.DT * 4;
    if (this.stepNo % 4 === 0) {
      this.wingCtl = this.wingAI.update(aiDt, {
        now: this.elapsed, leader: p, weapons: this.weapons, hostiles: this.drones.filter(d => !d.dormant), playerTarget: this.targeting.selected,
        interference: this.interference, rtb: this.rtb, leaderRolling: dir.leaderRolling,
      });
      for (const [i, b] of this.bandits.entries()) {
        const d = this.drones[i]; if (d.dormant || !d.alive) continue;
        this.droneCtl.set(d.id, b.update(aiDt, { now: this.elapsed, weapons: this.weapons, enemies: [p, this.wingman].filter(u => u.alive), alerted: this.alertedBandits, jamming: 0 }));
      }
    }
    if (!this.wingman.model.crashed) this.wingman.model.step(FlightModel.DT, this.wingCtl);
    for (const d of this.drones) {
      if (d.dormant || d.model.crashed) continue;
      const dc = this.droneCtl.get(d.id);
      if (dc) d.model.step(FlightModel.DT, dc);
    }
  }

  private handleInput(dt: number) {
    const inp = this.o.input, p = this.player, ts = this.targeting, st = this.o.settings.data;
    this.fc.invertPitch = st.invertPitch;
    const mouseOn = st.mouseFlight && !this.o.camera.freeLook;
    this.mouseNorm = mouseOn ? this.mouseOffset() : null;
    this.fc.update(inp, dt, this.mouseNorm);
    // voice assists (autopilot / taxi / take-off / landing): any manual stick input hands control straight back
    const manual = inp.held('pitchUp') || inp.held('pitchDown') || inp.held('rollLeft') || inp.held('rollRight') || inp.held('yawLeft') || inp.held('yawRight') || (!!this.mouseNorm && Math.hypot(this.mouseNorm.x, this.mouseNorm.y) > 0.3);
    this.assists.update(dt, this.elapsed, this.assists.auto === 'taxi' ? false : manual, inp.held('throttleUp') || inp.held('throttleDown'));
    if (inp.wasPressed('mouseFlight')) { this.o.settings.set('mouseFlight', !st.mouseFlight); this.flash(this.o.settings.data.mouseFlight ? 'MOUSE-AIM ON – the nose follows the cursor' : 'MOUSE-AIM OFF – keyboard flight', 1.8); }
    if (inp.wasPressed('pause')) { this.o.onPause('pause'); return; }
    if (inp.wasPressed('map')) { this.o.onPause('map'); return; }
    if (inp.wasPressed('camera')) { const v = this.o.camera.cycle(); this.flash('CAMERA: ' + VIEW_LABEL[v], 1.4); }
    if (inp.wasPressed('headLook')) { this.o.camera.freeLook = !this.o.camera.freeLook; this.flash(this.o.camera.freeLook ? 'HEAD-LOOK ON (mouse)' : 'HEAD-LOOK OFF', 1.2); }
    if (inp.wasPressed('debug')) this.debug = !this.debug;
    if (inp.wasPressed('radarRange')) { this.radarIdx = (this.radarIdx + 1) % this.radarRanges.length; }
    if (inp.wasPressed('interact')) { if (this.director.phase === 'P1_TAKEOFF' && !this.director.engineStartRequested) { this.director.requestEngineStart(); this.o.audio.uiConfirm(); } }
    if (inp.wasPressed('hint')) { this.hintLevel = (this.hintLevel % 3) + 1; this.showHint(this.director.hint(this.hintLevel as 1 | 2 | 3)); }
    // weapons
    if (inp.wasPressed('weapon')) {
      const order: WeaponId[] = ['GUN', 'IR', 'RADAR']; this.selectedWeapon = order[(order.indexOf(this.selectedWeapon) + 1) % 3];
      ts.selectWeapon(this.selectedWeapon); this.o.audio.uiClick();
      this.flash('WEAPON: ' + (this.selectedWeapon === 'GUN' ? '20mm CANNON' : this.selectedWeapon === 'IR' ? 'IR-7 (FOX-2) – close range' : 'LR-9 – long-range radar'), 1.6);
    }
    if (inp.wasPressed('target')) { const t = ts.cycle(); this.flash(t ? `TARGET: ${t.identified ? t.callsign : 'UNKNOWN CONTACT'}` : 'NO CONTACTS', 1.2); }
    if (!ts.selected) ts.autoSelect();
    const trigger = inp.held('fire') || (st.mouseGun && inp.mouseLeft);
    const gunWanted = (this.selectedWeapon === 'GUN' && inp.held('fire')) || (st.mouseGun && inp.mouseLeft) || this.elapsed < this.gunBurstUntil;
    if (gunWanted && p.alive && p.gunAmmo > 0) { this.weapons.fireGun(p, dt); this.o.audio.setGun(true); }
    else { this.o.audio.setGun(false); this.weapons.releaseTrigger(p); if (gunWanted && p.gunAmmo <= 0) this.flash('WINCHESTER – GUN EMPTY', 1.2); }
    if (inp.wasPressed('fire') && this.selectedWeapon !== 'GUN') {
      const chk = ts.launchCheck();
      if (!chk.ok) this.flash(chk.reason, 1.4);
      else {
        const m = this.weapons.launch(p, ts.selected, this.selectedWeapon === 'IR' ? 'IR' : 'RADAR');
        if (!m) this.flash(this.selectedWeapon === 'IR' ? 'NO IR MISSILES' : 'NO LR MISSILES', 1.4);
        else { ts.lockProgress = 0; ts.lock = 'SEARCH'; }
      }
    }
    void trigger;
    if (inp.wasPressed('flares')) { if (!this.weapons.dropFlares(p, this.elapsed)) this.flash(p.flares <= 0 ? 'FLARES EMPTY' : 'COUNTERMEASURES RECYCLING', 1); }
    // wingman commands
    if (inp.wasPressed('cmdCover')) { this.wingAI.commandCover(); this.sayKey('cmd_cover'); }
    if (inp.wasPressed('cmdEngage')) { this.wingAI.commandEngage(ts.selected ?? null); this.sayKey('cmd_engage'); }
    if (inp.wasPressed('cmdRejoin')) { this.wingAI.commandRejoin(); this.sayKey('cmd_rejoin'); }
    if (inp.wasPressed('cmdFormation')) { const f = this.wingAI.cycleFormation(); this.flash('FORMATION: ' + f.replace('_', ' '), 1.4); this.sayKey('cmd_formation'); }
    if (this.debug && st.debug) this.debugKeys();
  }

  private debugKeys() {
    const inp = this.o.input, pm = this.player.model;
    if (inp.wasPressed('F8')) { pm.setHeadingPlace(WAYPOINTS.W2.x, 2500, WAYPOINTS.W2.z + 3000, 0, 0, 230); pm.onGround = false; pm.gearPos = 0; this.fc.gearDown = false; this.fc.throttle = 0.8; pm.startEngines(); pm.engineN = 0.8; this.director.engineStartRequested = true; }
    if (inp.wasPressed('F9')) { pm.fuel = this.player.cfg.fuelCapacity; pm.health = this.player.cfg.hullHealth; }
    if (inp.wasPressed('F10')) { for (const d of this.drones) if (d.alive) this.weapons.applyDamage(d, 999, this.player, 'GUN'); }
  }

  private mouseNorm: { x: number; y: number } | null = null;
  private autoRolled = false;
  /** Cursor offset from the screen centre, normalised by ~38 % of the short side and clamped to -1..1. */
  private mouseOffset() {
    const W = window.innerWidth, H = window.innerHeight, r = Math.min(W, H) * 0.38, i = this.o.input;
    return { x: Math.max(-1, Math.min(1, (i.mouseX - W / 2) / r)), y: Math.max(-1, Math.min(1, (i.mouseY - H / 2) / r)) };
  }

  flash(text: string, secs: number) { this.weaponMsg = text; this.weaponMsgT = secs; }
  showHint(t: string) { this.hintText = t; this.hintT = 9; this.o.dialogue.say({ speaker: 'Ground Control', text: t.replace(/^Ground:\s*/, ''), priority: 1, key: 'hint', cooldown: 4 }); }

  // ------------------------------------------------------------------ voice / text commands
  private gcSay(text: string, pr: 0 | 1 | 2 | 3 = 1) { this.o.dialogue.say({ speaker: 'Ground Control', text, priority: pr }); return text; }

  /** Executes one parsed voice command and returns a short feedback line. Anything a hand can do on keyboard/mouse is reachable here. */
  voiceExec(c: Cmd): string {
    const p = this.player, m = p.model, fc = this.fc, ts = this.targeting, A = this.assists;
    const needAir = () => (m.onGround ? 'The autopilot only works in the air.' : null);
    switch (c.t) {
      case 'throttle': {
        if (!this.director.engineStartRequested) return 'Engines are cold – say "start engines".';
        A.speed = null;
        fc.throttle = clamp(c.set !== undefined ? c.set : fc.throttle + (c.delta ?? 0), 0, 1);
        return fc.throttle > 0.95 ? 'Full power – afterburner.' : `Throttle ${Math.round(fc.throttle * 100)}%.`;
      }
      case 'gear': if (m.onGround && !c.down) return 'Weight on wheels – gear stays down.'; fc.gearDown = c.down; return `Gear ${c.down ? 'down' : 'up'}.`;
      case 'brake': fc.brakeLatch = c.on; return c.on ? 'Brakes on.' : 'Brakes released.';
      case 'airbrake': fc.brakeLatch = c.on; return c.on ? 'Airbrake out.' : 'Airbrake in.';
      case 'flares': return this.weapons.dropFlares(p, this.elapsed) ? 'Flares and chaff away.' : (p.flares <= 0 ? 'Flares empty.' : 'Countermeasures recycling.');
      case 'ap_off': A.off(); fc.brakeLatch = false; return 'Autopilot off – you have control.';
      case 'level': return needAir() ?? (A.engage({ hdg: m.heading * DEG, alt: m.pos.y, gamma: null, bank: null, nav: null }) ?? 'Wings level, holding altitude and heading.');
      case 'hold_alt': return needAir() ?? (A.engage({ alt: m.pos.y }) ?? `Holding ${Math.round(m.pos.y / 0.3048)} ft.`);
      case 'hold_hdg': return needAir() ?? (A.engage({ hdg: m.heading * DEG }) ?? `Holding heading ${Math.round(m.heading)}.`);
      case 'hold_speed': return needAir() ?? (A.engage({ speed: c.kt / KT }) ?? `Holding ${c.kt} knots.`);
      case 'alt': return needAir() ?? (A.engage({ alt: c.meters }) ?? `Going to ${Math.round(c.meters / 0.3048)} ft.`);
      case 'alt_rel': return needAir() ?? (A.engage({ alt: m.pos.y + c.meters }) ?? `${c.meters > 0 ? 'Climbing' : 'Descending'} ${Math.round(Math.abs(c.meters) / 0.3048)} ft.`);
      case 'turn': {
        if (m.onGround) { A.off(); fc.yaw = c.dir === 'left' ? -0.8 : 0.8; return `Steering ${c.dir}.`; }
        const h = (m.heading + (c.dir === 'left' ? -c.deg : c.deg) + 360) % 360;
        return A.engage({ hdg: h * DEG, bank: null }) ?? `Turning ${c.dir} to heading ${String(Math.round(h)).padStart(3, '0')}.`;
      }
      case 'bank': return needAir() ?? (A.engage({ bank: (c.dir === 'left' ? -1 : 1) * c.deg }) ?? `Banking ${c.dir} ${c.deg}°.`);
      case 'heading': return needAir() ?? (A.engage({ hdg: c.deg * DEG, bank: null }) ?? `Heading ${String(c.deg).padStart(3, '0')}.`);
      case 'pitch': return needAir() ?? (A.engage({ gamma: c.deg * DEG }) ?? `Nose ${c.deg > 0 ? 'up' : 'down'} ${Math.abs(c.deg)}°.`);
      case 'goto_nav': { const n = this.director.nav[0]; if (!n) return 'No waypoint is active.'; return needAir() ?? (A.engage({ nav: n }) ?? `Flying to ${n.name}.`); }
      case 'goto_home': case 'autoland': { const r = A.startLand(); if (A.auto === 'land') this.director.stats.assistLanding = true; return r; }
      case 'autotakeoff': return A.startTakeoff();
      case 'taxi': return A.startTaxi();
      case 'stop': A.off(); fc.throttle = 0; fc.brakeLatch = true; return 'Stopping.';
      case 'weapon': this.selectedWeapon = c.w; ts.selectWeapon(c.w); return `Weapon: ${c.w === 'GUN' ? '20 mm cannon' : c.w === 'IR' ? 'IR-7 Fox-2' : 'LR-9 long range'}.`;
      case 'target': { const t = ts.cycle(); return t ? `Target: ${t.identified ? t.callsign : 'unknown contact'}.` : 'No radar contacts.'; }
      case 'fire': {
        if (c.w) { this.selectedWeapon = c.w; ts.selectWeapon(c.w); }
        if (!ts.selected) ts.autoSelect();
        if (this.selectedWeapon === 'GUN') { if (p.gunAmmo <= 0) return 'Cannon empty.'; this.gunBurstUntil = this.elapsed + 1.6; return 'Guns!'; }
        const chk = ts.launchCheck();
        if (!chk.ok) return `Cannot launch: ${chk.reason.toLowerCase()}.`;
        const ms = this.weapons.launch(p, ts.selected, this.selectedWeapon === 'IR' ? 'IR' : 'RADAR');
        if (!ms) return 'No missiles of that type left.';
        ts.lockProgress = 0; ts.lock = 'SEARCH'; return this.selectedWeapon === 'IR' ? 'Fox two!' : 'Sabre away!';
      }
      case 'cease': this.gunBurstUntil = 0; return 'Cease fire.';
      case 'wing':
        if (c.cmd === 'cover') { this.wingAI.commandCover(); this.sayKey('cmd_cover'); return 'Wingman: cover me.'; }
        if (c.cmd === 'engage') { this.wingAI.commandEngage(ts.selected ?? null); this.sayKey('cmd_engage'); return 'Wingman: engage.'; }
        if (c.cmd === 'rejoin') { this.wingAI.commandRejoin(); this.sayKey('cmd_rejoin'); return 'Wingman: rejoin.'; }
        { let n = 0; while (c.f && this.wingAI.formation !== c.f && n++ < 3) this.wingAI.cycleFormation(); this.sayKey('cmd_formation'); return `Formation: ${this.wingAI.formation.replace('_', ' ').toLowerCase()}.`; }
      case 'wing_report': {
        const w = this.wingman, ai = this.wingAI;
        const t = `${w.callsign}: ${ai.state.toLowerCase()}, condition ${Math.round(w.healthFrac * 100)} percent, ${w.irMissiles} IR and ${w.radarMissiles} long-range missiles, ${Math.round(w.model.fuel / w.cfg.fuelCapacity * 100)} percent fuel.`;
        this.o.dialogue.say({ speaker: resolveRole('W', this.o.route), text: t, priority: 1 }); return t;
      }
      case 'report': return this.report(c.what);
      case 'camera': { if (c.next) this.o.camera.cycle(); else if (c.view) this.o.camera.setView(c.view); this.flash('CAMERA: ' + VIEW_LABEL[this.o.camera.view], 1.4); return `Camera: ${VIEW_LABEL[this.o.camera.view].toLowerCase()}.`; }
      case 'mouse': { const on = c.on ?? !this.o.settings.data.mouseFlight; this.o.settings.set('mouseFlight', on); return `Mouse-aim ${on ? 'on' : 'off'}.`; }
      case 'radar_range': { const i = this.radarRanges.indexOf(c.km); if (i >= 0) this.radarIdx = i; return `Radar range ${this.radarRanges[this.radarIdx]} km.`; }
      case 'hint': { const t = this.director.hint((this.o.settings.data.hintLevel || 2) as 1 | 2 | 3); this.showHint(t); return t; }
      case 'start_engines': return this.director.requestEngineStart() ? 'Starting engines.' : (this.director.engineStartRequested ? 'Engines are already running.' : 'Cannot start engines now.');
      case 'radio': {
        const who = c.to === 'ground' ? 'Ground Control' : this.wingman.callsign;
        this.o.dialogue.say({ speaker: p.callsign as 'Specter-1' | 'Specter-2', text: c.text, priority: 1 });
        const reply = `Copy, ${p.callsign}.${c.to === 'ground' && /(help|hint|lost|where)/i.test(c.text) ? ' Say "hint" for guidance.' : ''}`;
        this.o.dialogue.say({ speaker: (c.to === 'ground' ? 'Ground Control' : this.wingman.callsign) as 'Ground Control', text: reply, priority: 1 });
        return `Sent to ${who}.`;
      }
      default: return 'That command is not available right now.';
    }
  }

  private report(what: 'status' | 'fuel' | 'altitude' | 'speed' | 'heading' | 'enemies' | 'airfield'): string {
    const p = this.player, m = p.model;
    switch (what) {
      case 'fuel': return this.gcSay(`Fuel ${Math.round(m.fuel)} kilograms, ${Math.round(m.fuel / p.cfg.fuelCapacity * 100)} percent.`);
      case 'altitude': return this.gcSay(`Altitude ${Math.round(m.pos.y / 0.3048)} feet, ${Math.round(m.pos.y - terrainHeight(m.pos.x, m.pos.z))} metres above ground.`);
      case 'speed': return this.gcSay(`Airspeed ${Math.round(m.iasKt)} knots, Mach ${m.mach.toFixed(2)}.`);
      case 'heading': return this.gcSay(`Heading ${String(Math.round(m.heading)).padStart(3, '0')}.`);
      case 'airfield': { const dx = -m.pos.x, dz = -m.pos.z; const b = ((Math.atan2(dx, -dz) / DEG) + 360) % 360; return this.gcSay(`Airfield bearing ${String(Math.round(b)).padStart(3, '0')}, ${(Math.hypot(dx, dz) / 1000).toFixed(1)} kilometres.`); }
      case 'enemies': {
        const det = this.targeting.detected();
        if (!det.length) return this.gcSay('No radar contacts. Keep your nose toward the threat axis.');
        const c = det[0]; const dx = c.unit.pos.x - m.pos.x, dz = c.unit.pos.z - m.pos.z;
        const b = ((Math.atan2(dx, -dz) / DEG) + 360) % 360;
        return this.gcSay(`${det.length} contact${det.length > 1 ? 's' : ''}. Nearest bearing ${String(Math.round(b)).padStart(3, '0')}, ${(c.range / 1000).toFixed(1)} kilometres, altitude ${Math.round(c.unit.pos.y / 0.3048)} feet${c.unit.identified ? ', hostile' : ', unidentified'}.`);
      }
      default: return this.gcSay(`Hull ${Math.round(p.healthFrac * 100)} percent, fuel ${Math.round(m.fuel / p.cfg.fuelCapacity * 100)} percent, ${Math.round(m.iasKt)} knots at ${Math.round(m.pos.y / 0.3048)} feet. Wingman ${Math.round(this.wingman.healthFrac * 100)} percent.`);
    }
  }

  // ------------------------------------------------------------------ per-frame logic
  private interferenceFor(u: Unit) { return u === this.player ? 0 : this.interference; }

  private postUpdate(dt: number) {
    const p = this.player, pm = p.model, o = this.o, w = this.warnings;
    // mid-air collisions (player/wingman/drones)
    for (let i = 0; i < this.units.length; i++) for (let j = i + 1; j < this.units.length; j++) {
      const a = this.units[i], b = this.units[j];
      if (!a.alive || !b.alive || a.model.onGround || b.model.onGround) continue;
      if (a.pos.distanceToSquared(b.pos) < ((a.cfg.radius + b.cfg.radius) * 0.55) ** 2) {
        a.model.damage(70, 'COLLISION'); b.model.damage(70, 'COLLISION');
      }
    }
    // blizzard turbulence acts on the real flight models (player and wingman)
    const front = this.o.scene.sky.front;
    pm.turbulence = blizzardAt(pm.pos.x, pm.pos.z, front) * 0.9;
    this.wingman.model.turbulence = blizzardAt(this.wingman.pos.x, this.wingman.pos.z, front) * 0.9;
    // time-limited UI strings
    if (this.weaponMsgT > 0) { this.weaponMsgT -= dt; if (this.weaponMsgT <= 0) this.weaponMsg = ''; }
    if (this.hintT > 0) { this.hintT -= dt; if (this.hintT <= 0) this.hintText = null; }
    const auto = this.director.autoHint(dt, o.settings.data.hintLevel);
    if (auto) this.showHint(auto);
    // ---- GCAS (predicted path vs terrain) ----
    this.gcasT -= dt;
    if (this.gcasT <= 0) {
      this.gcasT = 0.1;
      let warn = false;
      if (!pm.onGround && !pm.crashed && pm.tas > 40) {
        const clr = minClearanceAlong(pm.pos.x, pm.pos.y, pm.pos.z, pm.vel.x, pm.vel.y, pm.vel.z, 5, 12);
        const info = approachInfo(pm.pos.x, pm.pos.y, pm.pos.z, chooseRunwayDirection(pm.pos.z, pm.heading));
        const landingCfg = pm.gearDown && info.dz > -1300 && info.dz < 4200 && Math.abs(info.lateral) < 400 && pm.vel.y > -9;
        const nearField = Math.hypot(pm.pos.x, pm.pos.z) < 3500 && pm.pos.y - terrainHeight(pm.pos.x, pm.pos.z) < 450 && pm.gearPos > 0.05;   // departure / arrival configuration
        warn = clr < 90 && !landingCfg && !nearField;
      }
      if (warn && !this.gcas) this.o.dialogue.say({ speaker: 'Ground Control', text: 'Terrain ahead! Pull up!', priority: 3, key: 'gcas', cooldown: 6 });
      this.gcas = warn;
    }
    // ---- warnings struct ----
    const threat = this.weapons.nearestThreat(p);
    const fuelFrac = pm.fuel / p.cfg.fuelCapacity;
    w.stall = pm.stalled && !pm.onGround; w.stallWarn = pm.stallWarning && !pm.onGround && !w.stall && pm.iasKt > 20;
    w.pullUp = this.gcas;
    w.missile = threat ? { bearing: this.bearingTo(threat.pos), range: threat.pos.distanceTo(pm.pos), ir: threat.spec.id === 'IR' } : null;
    w.bingo = fuelFrac < 0.22 && pm.fuel > 0; w.lowFuel = fuelFrac < 0.4; w.flameout = pm.fuel <= 0 && !pm.crashed; w.damage = p.healthFrac < 0.6; w.overG = pm.overG;
    w.interference = this.interference;
    // ---- audio from simulation state ----
    const ts = this.targeting;
    o.audio.updateEngine(pm.engineN, pm.afterburner ? 1 : 0, pm.tas, pm.mach, pm.engineOn, o.camera.view === 'cockpit');
    o.audio.setLockTone(this.selectedWeapon === 'GUN' ? 'NONE' : ts.lock, this.selectedWeapon === 'IR');
    o.audio.setWarning(w.missile ? 'missile' : w.pullUp ? 'pullup' : (w.stall || w.stallWarn) ? 'stall' : 'none');
    if (w.missile && !this.lastMissileWarn) this.o.dialogue.interference = this.interference;
    this.lastMissileWarn = !!w.missile;
    // ---- mission end handling ----
    if (!this.ended && this.director.result && this.endTimer < 0) {
      this.endTimer = this.director.result.completed ? 2.5 : 3.2;
      if (!this.director.result.completed) { this.crashEffects(); o.audio.failure(); } else o.audio.missionComplete();
    }
    if (this.endTimer >= 0) {
      this.endTimer -= dt;
      if (this.endTimer < 0 && !this.ended) { this.ended = true; this.o.audio.quiet(); this.o.onEnd(this.director.result!); }
    }
    if (pm.crashed && !this.crashHandled) { this.crashHandled = true; this.crashEffects(); }
  }

  private crashEffects() {
    const p = this.player;
    this.weapons.boomAt(p.pos, 90);
    this.o.audio.explosion(0);
    if (p.visual) p.visual.group.visible = false;
  }

  private bearingTo(pos: THREE.Vector3) { const m = this.player.model; return ((Math.atan2(pos.x - m.pos.x, -(pos.z - m.pos.z)) / DEG) + 360) % 360; }

  // ------------------------------------------------------------------ visuals
  private updateVisuals(dt: number) {
    const t = this.elapsed;
    for (const u of this.units) {
      const v = u.visual; if (!v) continue;
      if (u.dormant) { v.group.visible = false; continue; }
      const m = u.model;
      if (m.crashed) { if (u !== this.player) { v.group.visible = false; if (!this.deadFx.has(u)) { this.deadFx.add(u); this.weapons.boomAt(u.pos, 80); } } continue; }
      v.group.position.copy(m.pos); v.group.quaternion.copy(m.q);
      v.gear.visible = m.gearPos > 0.06; v.gear.scale.y = Math.max(0.05, m.gearPos);
      const ab = m.afterburner ? 1 : 0;
      for (const f of v.afterburners) {
        const mat = f.material as THREE.MeshBasicMaterial; mat.opacity = ab * (0.55 + 0.35 * Math.sin(t * 60 + f.position.x)) + (m.engineOn ? m.engineN * 0.12 : 0);
        f.scale.set(1, 1 + 0.15 * Math.sin(t * 45), 1);
      }
      for (const a of v.airbrakes) a.rotation.x = -m.airbrakePos * 0.9;
      v.navLights.forEach((l, i) => { l.visible = Math.floor(t * 2 + i) % 2 === 0 || true; });
      const cockpitView = u === this.player && this.o.camera.view === 'cockpit';
      v.cockpit.visible = cockpitView;
      v.exterior.visible = !cockpitView;
      if (u === this.player && v.pilotHead) v.pilotHead.visible = !cockpitView;
      void dt;
    }
  }
  private deadFx = new Set<Unit>();

  private updateCameraAndHud(dt: number) {
    const o = this.o, cam = o.camera, p = this.player;
    cam.update(dt, p, o.input.mouseDX, o.input.mouseDY);
    if (!p.model.crashed || this.endTimer >= 0) o.scene.sky.update(dt, cam.camera, p.pos);
    o.scene.airfield.update(dt, p.pos);
    const pm = p.model;
    const info = approachInfo(pm.pos.x, pm.pos.y, pm.pos.z, chooseRunwayDirection(pm.pos.z, pm.heading));
    const phase = this.director.phase;
    const showILS = phase === 'P5_RTB' && !pm.onGround && info.dz < 16000 && info.dz > -800;
    const prompt = this.contextPrompt();
    o.hud.draw({
      camera: cam.camera, player: p,
      wing: { unit: this.wingman, state: this.wingAI.state, formation: this.wingAI.formation, separation: this.wingAI.separation, interference: this.interference },
      targeting: this.targeting, weapons: this.weapons, allUnits: this.units.filter(u => !u.dormant), mission: this.director, view: cam.view, now: this.elapsed,
      warnings: this.warnings, prompt, hint: this.hintText, metric: o.settings.data.metric, radarRangeKm: this.radarRanges[this.radarIdx], startup: this.director.engineStartRequested ? this.director.startupProgress : 0,
      debug: this.debug ? this.debugLines() : null, weaponMsg: this.weaponMsg, freeLook: cam.freeLook,
      guidance: { dirNorth: info.dirNorth, dz: info.dz, lateral: info.lateral, gsError: info.gsError, show: showILS }, helpKeys: '',
      assist: this.assists.describe(),
      mouse: this.mouseNorm && cam.view !== 'flyby' ? { x: window.innerWidth / 2 + this.mouseNorm.x * Math.min(window.innerWidth, window.innerHeight) * 0.38, y: window.innerHeight / 2 + this.mouseNorm.y * Math.min(window.innerWidth, window.innerHeight) * 0.38, r: Math.min(window.innerWidth, window.innerHeight) * 0.38 * 0.06 } : null,
    });
  }

  private contextPrompt(): string | null {
    const d = this.director, pm = this.player.model;
    if (d.phase === 'P1_TAKEOFF' && !d.engineStartRequested) return 'PRESS  F  TO START ENGINES';
    if (d.phase === 'P1_TAKEOFF' && d.startupProgress >= 1 && pm.onGround && d.lineupPending) return `TAXI TO RUNWAY 36  (${keyName(bindings.code('rollLeft'))}/${keyName(bindings.code('rollRight'))} steer · ${keyName(bindings.code('throttleUp'))} thrust · ${keyName(bindings.code('brake'))} brakes)`;
    if (pm.onGround && d.lineupDone && pm.vel.length() < 3 && this.fc.throttle < 0.2 && d.phase === 'P1_TAKEOFF') return `HOLD ${keyName(bindings.code('throttleUp')).toUpperCase()}: FULL POWER  ·  ROTATE AT 135 KT (${keyName(bindings.code('pitchUp'))} = nose up)`;
    if (this.warnings.flameout) return 'ENGINE OUT – GLIDE TO THE RUNWAY';
    return null;
  }

  private debugLines(): string[] {
    const p = this.player, m = p.model, st = this.o.scene.stats;
    return [
      `phase ${this.director.phase}  t=${this.director.t.toFixed(0)}s  detect=${this.director.detect.toFixed(0)}`,
      `pos ${m.pos.x.toFixed(0)},${m.pos.y.toFixed(0)},${m.pos.z.toFixed(0)}  ias ${m.iasKt.toFixed(0)}  M${m.mach.toFixed(2)}  a ${(m.alpha / DEG).toFixed(1)}°  g ${m.gLoad.toFixed(1)}`,
      `ground ${m.onGround} wow ${m.weightOnWheels.toFixed(2)} gear ${m.gearPos.toFixed(2)} eng ${m.engineN.toFixed(2)}`,
      `wing ${this.wingAI.state} sep ${this.wingAI.separation.toFixed(0)} interf ${this.interference.toFixed(2)}`,
      ...this.bandits.map(b => `${b.self.id} ${b.state} hp ${b.self.health.toFixed(0)} ${b.man.kind ?? ''}`),
      `bullets ${this.weapons.activeBullets} missiles ${this.weapons.missiles.length} flares ${this.weapons.activeFlares}`,
      `gl geom ${st.geometries} tex ${st.textures} calls ${st.calls} tris ${st.triangles}`,
      `lock ${this.targeting.lock} ${this.targeting.lockProgress.toFixed(2)} sel ${this.targeting.selected?.id ?? '-'}`,
    ];
  }

  pause() { this.paused = true; this.o.audio.setGun(false); this.o.audio.setLockTone('NONE'); this.o.audio.setWarning('none'); this.o.dialogue.pause(); this.o.input.reset(); }
  resume() { this.paused = false; this.o.dialogue.resume(); this.o.input.reset(); this.accum = 0; }

  dispose() {
    this.ended = true;
    const sc = this.o.scene;
    sc.flightScene.remove(this.root);
    this.root.traverse(obj => {
      const m = obj as THREE.Mesh;
      if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else mat?.dispose?.();
    });
    this.weapons.clear();
    sc.sky.front = 0; resetBlizzard();
    this.o.audio.stopEngine(); this.o.audio.quiet(); this.o.audio.setMusic('menu');
    this.o.dialogue.clear(); this.o.dialogue.interference = 0;
    this.disposers.forEach(d => d());
  }

  // test / automation hooks -------------------------------------------------
  get phase() { return this.director.phase; }
  get weatherFront() { return this.o.scene.sky.front; }
  get ended_() { return this.ended; }
}

