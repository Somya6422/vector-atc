import type { SaveData, Route } from '../persistence/SaveManager';
import type { MissionResult, Objective } from '../missions/MissionDirector';
import type { ActiveLine } from '../story/DialogueSystem';
import { Settings, type SettingsData } from './Settings';
import { MISSIONS } from '../missions/MissionSpecs';
import type { MissionId } from '../missions/MissionSpecs';
import { AIRCRAFT } from '../flight/AircraftConfig';
import { ACTIONS, bindings, keyName } from '../game/Bindings';

export type UIAction =
  | 'commands' | 'new_campaign' | 'continue' | 'mission_select' | 'hangar' | 'aircraft' | 'flight_school' | 'settings' | 'credits' | 'exit' | 'main_menu'
  | 'change_route' | 'pick_route' | 'briefing' | 'launch' | 'resume' | 'objectives' | 'map' | 'controls' | 'briefing_review' | 'restart' | 'return_hangar'
  | 'reset_keys' | 'debrief_continue' | 'debrief_replay' | 'retry' | 'select_mission' | 'livery' | 'back' | 'save' | 'reset_save' | 'close_overlay';

export const CONTROLS: [string, string, string][] = [
  ['Throttle / afterburner', 'Left Shift (hold) = increase · Left Ctrl (hold) = decrease', 'Above 90% the afterburner lights (A/B on HUD)'],
  ['Pitch', 'W = nose down · S = nose up (invert in Settings)', 'Rate-command: neutral stick holds attitude'],
  ['Roll / Yaw', 'A / D roll · Q / E yaw', 'On the ground A/D and Q/E steer the nose wheel'],
  ['Airbrake / wheel brakes', 'B (hold)', 'Airbrake in flight, wheel brakes on the ground'],
  ['Landing gear', 'G', 'Cannot retract while weight is on wheels'],
  ['Camera', 'C cycles chase → cockpit → flyby', 'V toggles head-look (mouse) in any view'],
  ['Map & objectives', 'M', 'Pauses the simulation while open'],
  ['Pause', 'Esc', 'Resume, objectives, map, controls, settings, briefing, restart'],
  ['Target', 'R', 'Cycles detected contacts (radar scan ±60°, lock cone ±30°)'],
  ['Weapon select', 'T', 'GUN → IR-7 (Fox-2) → LR-9 long-range radar missile'],
  ['Fire', 'Space (selected weapon) · Left mouse = cannon', 'Missiles need a steady LOCK tone, identification and range'],
  ['Countermeasures', 'X', 'Flares + chaff: break IR/radar locks on incoming missiles'],
  ['Interact / start engines', 'F', 'Context prompt on screen (engine start on the ramp). Never launches missiles.'],
  ['Wingman', '1 cover · 2 engage target · 3 rejoin · 4 cycle formation', 'Echelon Right → Line Abreast → Trail'],
  ['Radar range / hint', 'Z cycles radar range · H cycles Ground Control hints', 'Hints also appear automatically per the Settings level'],
  ['Debug (Settings → Debug)', '` toggles overlay · F8 teleport · F9 refuel/repair · F10 kill drones', 'Development shortcuts, disabled by default'],
];

const el = <T extends HTMLElement = HTMLElement>(html: string): T => { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild as T; };

export class UI {
  readonly root: HTMLElement;
  private screen: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private subtitle: HTMLElement;
  private toastEl: HTMLElement;
  private loading: HTMLElement;
  private prompt: HTMLElement;
  onAction?: (a: UIAction, p?: string) => void;
  onSetting?: <K extends keyof SettingsData>(k: K, v: SettingsData[K]) => void;
  mapCanvas: HTMLCanvasElement | null = null;
  onRebind?: (action: string) => void;
  rebindingId: string | null = null;

  constructor(host: HTMLElement, private settings: Settings) {
    this.root = el('<div id="ui"></div>'); host.appendChild(this.root);
    this.subtitle = el('<div id="subtitle" aria-live="polite"></div>');
    this.toastEl = el('<div id="toast"></div>');
    this.prompt = el('<div id="hprompt"></div>');
    this.loading = el('<div id="loading"><div class="ld-title">VANTAGE: ZERO</div><div class="ld-bar"><div class="ld-fill"></div></div><div class="ld-text">Generating the Kazbegi Reach…</div></div>');
    host.append(this.subtitle, this.toastEl, this.prompt, this.loading);
    this.root.addEventListener('click', e => {
      const kb = (e.target as HTMLElement).closest('[data-bind]') as HTMLElement | null;
      if (kb) { this.onRebind?.(kb.dataset.bind!); return; }
      const t = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null; if (!t || t.hasAttribute('disabled')) return;
      this.onAction?.(t.dataset.a as UIAction, t.dataset.p);
    });
    this.applySubtitleSize();
  }

  // ---------------------------------------------------------------- generic
  setLoading(f: number | null, text?: string) {
    if (f === null) { this.loading.classList.add('hide'); return; }
    this.loading.classList.remove('hide');
    (this.loading.querySelector('.ld-fill') as HTMLElement).style.width = Math.round(f * 100) + '%';
    if (text) (this.loading.querySelector('.ld-text') as HTMLElement).textContent = text;
  }
  clear() { this.screen?.remove(); this.screen = null; this.closeOverlay(); this.toastEl.classList.remove('show'); this.showPrompt(null); }
  private mount(html: string, cls = '') { this.clear(); const s = el(`<div class="screen ${cls}">${html}</div>`); this.root.appendChild(s); this.screen = s; (s.querySelector('button:not([disabled])') as HTMLElement | null)?.focus?.(); return s; }
  toast(text: string, ms = 2600) { this.toastEl.textContent = text; this.toastEl.classList.add('show'); clearTimeout(this.toastT); this.toastT = window.setTimeout(() => this.toastEl.classList.remove('show'), ms); }
  private toastT = 0;
  showPrompt(text: string | null) { this.prompt.textContent = text ?? ''; this.prompt.classList.toggle('show', !!text); }
  setSubtitle(l: ActiveLine | null) {
    if (!l) { this.subtitle.classList.remove('show'); return; }
    this.subtitle.innerHTML = '';
    const who = document.createElement('span'); who.className = 'who ' + l.speaker.replace(/[^A-Za-z0-9]/g, '').toLowerCase(); who.textContent = l.speaker + (l.radio ? ' (radio)' : '');
    const tx = document.createElement('span'); tx.className = 'txt' + (l.garbled ? ' garbled' : ''); tx.textContent = l.text;
    this.subtitle.append(who, tx); this.subtitle.classList.add('show');
  }
  applySubtitleSize() { this.subtitle.style.fontSize = (18 * this.settings.data.subtitleSize) + 'px'; }

  // ---------------------------------------------------------------- screens
  mainMenu(save: SaveData, hasCampaign: boolean) {
    const done = Object.values(save.missions).filter(m => m.completed).length;
    this.mount(`
      <div class="title"><h1>VANTAGE<span>:</span> ZERO</h1><p>OWN THE SKY. PROTECT YOUR WINGMAN. SURVIVE THE IMPOSSIBLE.</p></div>
      <div class="menu ui-panel">
        <button data-a="new_campaign">New Campaign</button>
        <button data-a="continue" ${hasCampaign ? '' : 'disabled'}>Continue ${hasCampaign ? `<small>${done} mission${done === 1 ? '' : 's'} complete</small>` : ''}</button>
        <button data-a="mission_select" ${hasCampaign ? '' : 'disabled'}>Mission Selection</button>
        <button data-a="hangar" ${hasCampaign ? '' : 'disabled'}>Hangar</button>
        <button data-a="aircraft" ${hasCampaign ? '' : 'disabled'}>Aircraft &amp; Pilot</button>
        <button data-a="flight_school" ${hasCampaign ? '' : 'disabled'}>Flight School</button>
        <button data-a="settings">Settings</button>
        <button data-a="commands">Commands &amp; Shortcuts</button>
        <button data-a="controls">Controls / Keyboard</button>
        <button data-a="credits">Credits</button>
        <button data-a="exit">Exit</button>
      </div>
      <div class="foot">W/S pitch · Ctrl+W/Ctrl+S throttle · mouse-aim (N) · 5 = camera · everything is rebindable in Controls / Keyboard</div>`, 'center-left');
  }

  pilotSelection(current: Route | null) {
    const su = AIRCRAFT.SU57, f35 = AIRCRAFT.F35;
    this.mount(`
      <h2 class="center">SELECT YOUR PILOT</h2>
      <div class="cards">
        <div class="card ui-panel" data-route="A_BOY_SU57">
          <h3>ROUTE A &mdash; SPECTER-1</h3><div class="sub">Boy pilot · ${su.name}</div>
          <p>Instinctive, observant and resourceful; more comfortable with action than theory, occasionally mischievous. He shows his loyalty through practical help and small gestures.</p>
          <ul><li>Twin-engine, thrust-vectoring-inspired handling: snappy pitch at low speed</li><li>Wingman: <b>Specter-2</b> in the F-35 (AI)</li><li>Orange flight suit, quick with a joke</li></ul>
          <button data-a="pick_route" data-p="A_BOY_SU57">${current === 'A_BOY_SU57' ? 'Keep' : 'Select'} Specter-1</button>
        </div>
        <div class="card ui-panel" data-route="B_GIRL_F35">
          <h3>ROUTE B &mdash; SPECTER-2</h3><div class="sub">Girl pilot · ${f35.name}</div>
          <p>Analytical, strategic and independent; academically sharp, funny and tactically decisive. She treats her wingman as an equal.</p>
          <ul><li>Single-engine, sensor-focused cockpit: smoother, more stable handling</li><li>Wingman: <b>Specter-1</b> in the Su-57 (AI)</li><li>Teal flight suit, plans every margin before it is needed</li></ul>
          <button data-a="pick_route" data-p="B_GIRL_F35">${current === 'B_GIRL_F35' ? 'Keep' : 'Select'} Specter-2</button>
        </div>
      </div>
      <div class="center"><button data-a="main_menu" class="sec">Back</button></div>`, 'wide');
  }

  missionSelect(save: SaveData) {
    const row = (id: string, name: string, desc: string) => {
      const r = save.missions[id];
      return `<div class="mrow ui-panel"><div><h3>${name}</h3><p>${desc}</p><small>${r ? `Best grade <b>${r.grade}</b> · best score ${r.bestScore} · plays ${r.plays} · last: ${r.lastOutcome}` : 'Not yet flown'}</small></div><button data-a="select_mission" data-p="${id}">${r ? 'Replay' : 'Fly'}</button></div>`;
    };
    const rows = (['m01', 'm02', 'm03', 'survival', 'school'] as MissionId[]).map(id => row(id, MISSIONS[id].label, MISSIONS[id].menu)).join('');
    this.mount(`<h2 class="center">MISSION SELECTION</h2><div class="mlist">${rows}</div><div class="center"><button data-a="main_menu" class="sec">Back</button></div>`, 'wide');
  }

  aircraftScreen(save: SaveData) {
    const route = save.route!, cfg = route === 'A_BOY_SU57' ? AIRCRAFT.SU57 : AIRCRAFT.F35;
    const liveries: [string, string][] = [['livery_default', 'Standard grey'], ['livery_frost', 'Frost (unlock: grade B or better)'], ['livery_ember', 'Ember (unlock: grade A or better)']];
    this.mount(`
      <h2 class="center">AIRCRAFT &amp; PILOT</h2>
      <div class="cards"><div class="card ui-panel">
        <h3>${route === 'A_BOY_SU57' ? 'Specter-1' : 'Specter-2'} · ${cfg.name}</h3>
        <table class="spec"><tr><td>Empty mass</td><td>${cfg.emptyMass} kg</td></tr><tr><td>Fuel</td><td>${cfg.fuelCapacity} kg</td></tr><tr><td>Thrust (mil / A/B)</td><td>${Math.round(cfg.thrustMil / 1000)} / ${Math.round(cfg.thrustAB / 1000)} kN</td></tr><tr><td>Wing area</td><td>${cfg.wingArea} m²</td></tr><tr><td>Stall (clean, 1 g)</td><td>~${cfg.stallSpeedKt} kt · AoA ${(cfg.alphaCrit * 57.3).toFixed(0)}°</td></tr><tr><td>g-limit</td><td>+${cfg.gLimit} / −${cfg.gLimitNeg}</td></tr><tr><td>Weapons</td><td>20mm ×${cfg.gunAmmo}, IR ×${cfg.irMissiles}, LR ×${cfg.radarMissiles}, flares ×${cfg.flares}</td></tr></table>
        <p class="small">Original game approximation; not a replica of the real aircraft or its performance.</p>
      </div><div class="card ui-panel"><h3>Livery</h3>${liveries.map(([id, n]) => `<button data-a="livery" data-p="${id}" ${save.unlocked.includes(id) ? '' : 'disabled'} class="${save.livery === id ? 'active' : ''}">${n}${save.livery === id ? ' ✓' : ''}</button>`).join('')}
        <h3>Relationship</h3><p>Trust between Specter-1 and Specter-2: <b>${save.relationship}</b>/100</p>
        <button data-a="change_route" class="sec">Change pilot route…</button></div></div>
      <div class="center"><button data-a="main_menu" class="sec">Back</button></div>`, 'wide');
  }

  briefing(missionId: string, route: Route, fromPause = false) {
    const spec = MISSIONS[(missionId in MISSIONS ? missionId : 'm01') as MissionId];
    const you = route === 'A_BOY_SU57' ? 'SPECTER-1 (Su-57)' : 'SPECTER-2 (F-35)', wing = route === 'A_BOY_SU57' ? 'SPECTER-2 (F-35, AI)' : 'SPECTER-1 (Su-57, AI)';
    const html = `
      <h2 class="center">${spec.id === 'school' ? 'FLIGHT SCHOOL' : spec.name.toUpperCase()}</h2>
      <div class="brief ui-panel">
        <p><b>Pilot:</b> ${you} &nbsp; <b>Wingman:</b> ${wing}</p>
        <p>${spec.brief}</p>
        ${spec.tips.length ? `<ul>${spec.tips.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
        <p class="small">Tip: the button bar at the bottom left always shows the next step. Ground Control hints: Settings → Hint level. Press H in flight for the current hint, I for the quick-start guide.</p>
      </div>
      <div class="center">${fromPause ? '<button data-a="close_overlay">Back</button>' : `<button data-a="launch" data-p="${missionId}">Launch Mission</button> <button data-a="hangar" class="sec">Hangar</button> <button data-a="main_menu" class="sec">Main Menu</button>`}</div>`;
    if (fromPause) this.showOverlay(html); else this.mount(html, 'wide');
  }

  settingsPanel(fromGame: boolean) {
    const s = this.settings.data;
    const slider = (k: keyof SettingsData, label: string) => `<label>${label}<input type="range" min="0" max="1" step="0.05" value="${s[k] as number}" data-s="${k}"><output>${Math.round((s[k] as number) * 100)}</output></label>`;
    const toggle = (k: keyof SettingsData, label: string) => `<label class="tg"><input type="checkbox" data-s="${k}" ${s[k] ? 'checked' : ''}> ${label}</label>`;
    const html = `
      <h2 class="center">SETTINGS</h2>
      <div class="settings ui-panel">
        <div class="col"><h3>Audio</h3>${slider('master', 'Master')}${slider('engines', 'Engines')}${slider('weapons', 'Weapons &amp; warnings')}${slider('dialogue', 'Dialogue')}${slider('radio', 'Radio effects')}${slider('music', 'Music')}${slider('environment', 'Environment')}${toggle('voice', 'Spoken radio voices (speech synthesis; subtitles are always on)')}</div>
        <div class="col"><h3>Gameplay &amp; display</h3>
          <label>Graphics quality <select data-s="quality"><option value="low" ${s.quality === 'low' ? 'selected' : ''}>Low</option><option value="medium" ${s.quality === 'medium' ? 'selected' : ''}>Medium</option><option value="high" ${s.quality === 'high' ? 'selected' : ''}>High</option></select></label>
          <label>Difficulty <select data-s="difficulty"><option value="easy" ${s.difficulty === 'easy' ? 'selected' : ''}>Easy · tougher jet, slower enemies</option><option value="normal" ${s.difficulty === 'normal' ? 'selected' : ''}>Normal</option><option value="hard" ${s.difficulty === 'hard' ? 'selected' : ''}>Hard · fragile jet, sharper enemies</option></select> <small>applies to the next mission</small></label>
          <label>Ground Control hints <select data-s="hintLevel"><option value="0" ${s.hintLevel === 0 ? 'selected' : ''}>Off</option><option value="1" ${s.hintLevel === 1 ? 'selected' : ''}>1 · Subtle</option><option value="2" ${s.hintLevel === 2 ? 'selected' : ''}>2 · Helpful</option><option value="3" ${s.hintLevel === 3 ? 'selected' : ''}>3 · Direct</option></select></label>
          <label>Subtitle size<input type="range" min="0.8" max="1.6" step="0.1" value="${s.subtitleSize}" data-s="subtitleSize"><output>${s.subtitleSize.toFixed(1)}×</output></label>
          ${toggle('mouseFlight', 'Mouse-aim flight (nose follows the cursor)')}${toggle('fbw', 'Fly-by-wire assist: AoA limiter + auto ground-collision recovery')}${toggle('voiceAutoSend', 'Voice: auto-send dictated commands (Wispr Flow) without pressing Enter')}${toggle('voiceKeepFocus', 'Voice-only mode: keep the command field focused after each command')}${toggle('invertPitch', 'Invert pitch (reverses the nose up / nose down keys and mouse)')}${toggle('metric', 'Altitude in metres')}${toggle('mouseGun', 'Left mouse button fires cannon')}${toggle('debug', 'Debug mode (overlay with `, dev shortcuts)')}
          <h3>Save</h3><button data-a="save">Save now</button> <button data-a="reset_save" class="danger">Erase campaign…</button>
        </div>
      </div>
      <div class="center"><button data-a="${fromGame ? 'close_overlay' : 'main_menu'}">Back</button></div>`;
    if (fromGame) this.showOverlay(html); else this.mount(html, 'wide');
    this.wireSettings();
  }
  private wireSettings() {
    const root = this.overlay ?? this.screen!;
    root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-s]').forEach(inp => {
      const key = inp.dataset.s as keyof SettingsData;
      const handler = () => {
        let v: unknown;
        if (inp instanceof HTMLInputElement && inp.type === 'checkbox') v = inp.checked;
        else if (inp instanceof HTMLInputElement) v = parseFloat(inp.value);
        else if (key === 'hintLevel') v = parseInt(inp.value, 10);
        else v = inp.value;
        const out = inp.parentElement?.querySelector('output'); if (out) out.textContent = key === 'subtitleSize' ? (v as number).toFixed(1) + '×' : String(Math.round((v as number) * 100));
        this.onSetting?.(key, v as never);
        if (key === 'subtitleSize') this.applySubtitleSize();
      };
      inp.addEventListener('input', handler); inp.addEventListener('change', handler);
    });
  }

  /** Editable key bindings: every function, its current key, click to rebind (conflicting keys swap). */
  controls(fromGame: boolean) {
    const groups = [...new Set(ACTIONS.map(x => x.group))];
    const rows = groups.map(g => `<tr class="grp"><td colspan="3">${g}</td></tr>` + ACTIONS.filter(x => x.group === g).map(x => {
      const waiting = this.rebindingId === x.id;
      return `<tr><td>${x.label}${x.note ? ` <small>(${x.note})</small>` : ''}</td><td><button class="keybtn ${waiting ? 'waiting' : ''} ${bindings.isDefault(x.id) ? '' : 'changed'}" data-bind="${x.id}">${waiting ? 'Press a key… (Esc cancels)' : keyName(bindings.code(x.id)) + (x.arrow ? ' &nbsp;' + x.arrow : '')}</button></td><td><small>${x.alt ? 'also ' + keyName(x.alt) + ' · ' : ''}default: ${keyName(x.def)}</small></td></tr>`;
    }).join('')).join('');
    const html = `<h2 class="center">CONTROLS</h2><p class="center small">Click a key to change it, then press the new key (hold Ctrl/Shift/Alt while pressing to make a combination). If it is already used, the two functions swap. Esc closes menus, even if rebound. Changes save automatically.</p><div class="ui-panel ctl"><table>${rows}</table></div><div class="center"><button data-a="reset_keys" class="danger">Reset all to defaults</button> <button data-a="${fromGame ? 'close_overlay' : 'main_menu'}">Back</button></div>`;
    if (fromGame) this.showOverlay(html); else this.mount(html, 'wide');
  }

  credits() {
    this.mount(`<h2 class="center">CREDITS</h2><div class="ui-panel brief center"><p><b>VANTAGE: ZERO</b><br>Original game, characters, dialogue, audio synthesis and procedural art.</p><p>Engine: Three.js · Web Audio API · TypeScript · Vite</p><p>Terrain relief: real elevation data from the AWS / Mapzen Terrain Tiles (derived from SRTM and other public sources), reshaped into game valleys. Aircraft and pilot meshes: supplied by the project owner.</p><p>All aircraft models are original low-poly approximations and do not claim fidelity to real aircraft.<br>No proprietary assets are used.</p></div><div class="center"><button data-a="main_menu">Back</button></div>`, 'wide');
  }

  exitScreen() {
    this.mount(`<div class="center bigmsg"><h2>SESSION ENDED</h2><p>Progress is saved automatically. You can close this tab, or return to the title.</p><button data-a="main_menu">Return to title</button></div>`, 'wide');
  }

  // ---------------------------------------------------------------- overlays
  showOverlay(html: string) { this.closeOverlay(); this.overlay = el(`<div class="overlay"><div class="ovbody">${html}</div></div>`); this.root.appendChild(this.overlay); (this.overlay.querySelector('button') as HTMLElement | null)?.focus?.(); }
  closeOverlay() { this.overlay?.remove(); this.overlay = null; this.mapCanvas = null; }
  get overlayOpen() { return !!this.overlay; }

  pauseMenu() {
    this.showOverlay(`
      <h2 class="center">PAUSED</h2>
      <div class="menu ui-panel pausemenu">
        <button data-a="resume">Resume</button>
        <button data-a="objectives">Objectives</button>
        <button data-a="map">Map</button>
        <button data-a="commands">Commands &amp; Shortcuts</button>
        <button data-a="controls">Controls</button>
        <button data-a="settings">Settings</button>
        <button data-a="briefing_review">Briefing review</button>
        <button data-a="restart">Restart mission</button>
        <button data-a="return_hangar">Return to Hangar</button>
        <button data-a="main_menu" class="sec">Main menu</button>
      </div>`);
  }
  objectivesPanel(objs: Objective[], phase: string, hint: string) {
    this.showOverlay(`<h2 class="center">OBJECTIVES</h2><div class="ui-panel brief"><p class="small">Phase: ${phase}</p><ul class="objs">${objs.map(o => `<li class="${o.state}">${o.state === 'done' ? '☑' : o.state === 'failed' ? '☒' : o.state === 'active' ? '▶' : '☐'} ${o.text}${o.detail ? `<br><small>${o.detail}</small>` : ''}</li>`).join('')}</ul><p class="hint">${hint}</p></div><div class="center"><button data-a="close_overlay">Back</button></div>`);
  }
  mapPanel() {
    this.showOverlay(`<h2 class="center">TACTICAL MAP</h2><canvas id="mapc" width="520" height="700"></canvas><div class="center"><button data-a="resume">Resume flight</button> <button data-a="objectives">Objectives</button></div><p class="center small">▲ you · blue = wingman · red = hostile · red rings = radar coverage · M or Esc to close</p>`);
    this.mapCanvas = this.overlay!.querySelector('#mapc');
  }

  debrief(res: MissionResult, dialogue: string[]) {
    const s = res.stats;
    const mm = Math.floor(s.time / 60), ss = Math.round(s.time % 60);
    this.mount(`
      <div class="deb">
        <h2 class="center">${res.completed ? 'MISSION COMPLETE' : 'MISSION FAILED'}</h2>
        <div class="gradebox ${res.completed ? '' : 'fail'}"><div class="grade">${res.grade}</div><div><h3>${res.title}</h3><div class="score">${res.score} <small>/ ${res.maxScore}</small></div></div></div>
        <div class="cols">
          <div class="ui-panel"><h3>Score breakdown</h3><table class="bd">${res.breakdown.map(b => `<tr><td>${b.label}</td><td class="${b.points < 0 ? 'neg' : ''}">${b.points >= 0 ? '+' : ''}${b.points}</td></tr>`).join('')}</table></div>
          <div class="ui-panel"><h3>Engagement &amp; condition</h3><table class="bd">
            <tr><td>Time</td><td>${mm}m ${ss}s</td></tr><tr><td>Hostiles destroyed</td><td>${s.kills} (BVR ${s.bvrKills} · IR ${s.irKills} · gun ${s.gunKills}) · escaped ${s.escaped}</td></tr>
            <tr><td>Aircraft condition</td><td>${Math.round(s.healthAtEnd * 100)}%</td></tr><tr><td>Wingman condition</td><td>${Math.round(s.wingHealthAtEnd * 100)}% ${s.wingLanded ? '· landed' : ''}</td></tr>
            <tr><td>Radar network</td><td>${s.detected ? 'DETECTED' : 'undetected'} (max ${Math.round(s.maxDetect)}%)</td></tr><tr><td>Blizzard route</td><td>${s.route === 'NONE' ? '—' : s.route === 'MAIN' ? 'main valley' : 'east pass'}</td></tr>
            <tr><td>Landing</td><td>${s.landed ? `${Math.round(s.touchdownKt)} kt, sink ${s.touchdownSink.toFixed(1)} m/s${s.hardLanding ? ' (HARD)' : ''}` : '—'}</td></tr>
            <tr><td>Missile hits taken / flares</td><td>${s.missileHitsTaken} / ${s.flaresUsed}</td></tr><tr><td>Fuel remaining</td><td>${Math.round(s.fuelAtEnd * 100)}%</td></tr>
            ${res.failReason ? `<tr><td>Failure</td><td class="neg">${res.failReason.replace('_', ' ')}</td></tr>` : ''}
          </table></div>
        </div>
        <div class="ui-panel dlg"><h3>Debrief</h3>${dialogue.map(l => `<p>${l}</p>`).join('')}</div>
        <div class="center">${res.completed ? '<button data-a="debrief_continue">Continue to Hangar</button> <button data-a="debrief_replay" class="sec">Replay mission</button>' : '<button data-a="retry">Retry mission</button> <button data-a="return_hangar" class="sec">Hangar</button>'} <button data-a="main_menu" class="sec">Main menu</button></div>
      </div>`, 'wide scroll');
  }

  hangarHUD(route: Route, savedAt: number) {
    this.mount(`
      <div class="hangar-bar ui-panel">
        <div><b>TACTICAL HANGAR</b> · ${route === 'A_BOY_SU57' ? 'Specter-1' : 'Specter-2'}<br><small>WASD move · Q/E camera · hold right-mouse to orbit</small></div>
        <div><button data-a="briefing">Mission Briefing</button> <button data-a="mission_select" class="sec">Missions</button> <button data-a="aircraft" class="sec">Aircraft</button> <button data-a="main_menu" class="sec">Main menu</button></div>
        <small>${savedAt ? 'Saved ' + new Date(savedAt).toLocaleTimeString() : 'Not saved yet'}</small>
      </div>`, 'hangar');
  }
}
