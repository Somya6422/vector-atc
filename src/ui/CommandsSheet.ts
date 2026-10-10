import { ACTIONS, bindings, keyName } from '../game/Bindings';

/** Spoken / typed command examples (Wispr Flow dictation or the browser mic), grouped like the keyboard list. */
const VOICE: [string, string[]][] = [
  ['Start & ground', ['start engines', 'taxi to the runway', 'take off', 'stop', 'apply the brakes']],
  ['Flying', ['throttle eighty percent', 'full power', 'gear up', 'heading two seven zero', 'turn left 45 degrees', 'climb to 4000 feet', 'hold speed 300 knots', 'level the wings', 'recover']],
  ['Autopilot & landing', ['fly to the next waypoint', 'autopilot off', 'land the aircraft', 'take me home']],
  ['Aircraft skills', ['cobra (Su-57)', 'kulbit (Su-57)', 'hover / forward flight (F-35)', 'vertical take-off (F-35)', 'jammer on']],
  ['Weapons', ['select radar missiles', 'switch to guns', 'next target', 'fire', 'fox two', 'deploy flares', 'cease fire']],
  ['Wingman', ['cover me', 'engage my target', 'rejoin', 'line abreast formation', 'wingman return to base', 'wingman report']],
  ['Information', ['bogey dope', 'status report', 'fuel status', 'where is the airfield']],
  ['Views & menus', ['cockpit view', 'tactical view', 'next camera', 'open the map', 'hint', 'pause', 'resume', 'new campaign', 'launch the mission']],
];

/** Signature abilities, with the conditions the game checks before it lets you fly them. */
const SKILLS: [string, string, string][] = [
  ['Su-57', "Pugachev's Cobra (U)", 'Thrust-vectoring post-stall manoeuvre: nose past vertical, speed bleeds from ~300 to ~100 kt, then recovers. Wings level, 200–470 kt, 300 m above ground.'],
  ['Su-57', 'Kulbit (O)', 'Full 360° somersault in about the aircraft\'s own length. Wings level, 220–480 kt, 450 m above ground.'],
  ['Su-57', 'Supercruise', 'Holds about Mach 1.09 at military power (no afterburner) at altitude. The HUD shows SUPERCRUISE.'],
  ['F-35', 'STOVL hover (J)', 'Lift fan and swivel nozzle: convert below 300 kt to a jet-borne hover, take off and land vertically. In hover, throttle 50 % holds height, W/S tilt forward/back, A/D slide, Q/E turn. J again accelerates back to wing-borne flight.'],
  ['F-35', 'Sensor fusion + DAS', '20 % more radar range, twice-as-fast target identification, and a 360° Distributed Aperture display of every missile guiding on you.'],
  ['Both', 'Electronic jammer (6)', '8 s of noise jamming: radar-guided missiles on you may lose lock and enemy radars see less. 26 s recharge.'],
  ['Both', 'Internal weapons bays', 'Missiles are carried inside for stealth; the bay doors open for a moment at each launch.'],
  ['Both', 'Fly-by-wire', 'Keyboard taps bank precisely, the bank holds when you let go, turns stay level, AoA limiter and auto-GCAS keep you out of the ground (Settings).'],
];

/** Full-screen reference: every shortcut key (live, so rebinding shows here), the aircraft skills and voice commands. */
export class CommandsSheet {
  readonly root: HTMLElement;
  constructor(host: HTMLElement) {
    this.root = document.createElement('div'); this.root.id = 'commands'; this.root.style.display = 'none';
    host.append(this.root);
    this.root.addEventListener('pointerdown', e => { if (e.target === this.root) this.show(false); });
  }
  get open() { return this.root.style.display !== 'none'; }
  toggle() { this.show(!this.open); }
  show(v: boolean) {
    if (v) this.render();
    this.root.style.display = v ? 'flex' : 'none';
    if (v) { try { document.exitPointerLock?.(); } catch { /* not locked */ } }
  }
  private render() {
    const groups = new Map<string, string[]>();
    for (const a of ACTIONS) {
      if (a.group === 'Debug') continue;
      const keys = bindings.specs(a.id).map(keyName).join(' / ');
      const row = `<tr><td class="ck">${keys}</td><td>${a.label}${a.note ? ` <span class="cn">${a.note}</span>` : ''}</td></tr>`;
      (groups.get(a.group) ?? groups.set(a.group, []).get(a.group)!).push(row);
    }
    groups.get('Flight')?.push('<tr><td class="ck">Mouse</td><td>With mouse-aim on (N): move to place the aim cursor, the nose follows. Left click fires the gun.</td></tr>');
    const keyHtml = [...groups].map(([g, rows]) => `<h3>${g}</h3><table>${rows.join('')}</table>`).join('');
    const skills = SKILLS.map(([who, name, desc]) => `<div class="cs"><b>${name}</b> <span class="cw">${who}</span><p>${desc}</p></div>`).join('');
    const voice = VOICE.map(([g, ex]) => `<h3>${g}</h3><p class="cv">${ex.map(e => `“${e}”`).join(' · ')}</p>`).join('');
    this.root.innerHTML = `
      <div class="ccard">
        <div class="chead"><h2>Commands &amp; shortcut keys</h2><button class="cclose">Close · /</button></div>
        <div class="ccols">
          <section><h2 class="csec">Keyboard</h2>${keyHtml}<p class="cn">Rebind any key in Settings → Controls.</p></section>
          <section><h2 class="csec">Aircraft skills</h2>${skills}</section>
          <section><h2 class="csec">Voice (Wispr Flow or MIC)</h2><p class="cn">Press ${keyName(bindings.code('voice'))}, then speak or type. Several commands can be chained: “gear up and throttle eighty percent”.</p>${voice}</section>
        </div>
      </div>`;
    this.root.querySelector('.cclose')!.addEventListener('click', () => this.show(false));
  }
}
