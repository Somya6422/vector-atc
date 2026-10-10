import type { Cmd } from '../voice/CommandParser';

export interface GuideButton { label: string; title: string; cmd: Cmd | { t: 'guide' } | { t: 'radial' }; hot?: boolean; on?: boolean }

/** Action dial: the essential operations as large touch/mouse targets around a ring. */
const DIAL: { label: string; cmd: Cmd }[] = [
  { label: 'START ENGINE', cmd: { t: 'start_engines' } }, { label: 'AUTO-TAXI', cmd: { t: 'taxi' } }, { label: 'AUTO-TAKEOFF', cmd: { t: 'autotakeoff' } },
  { label: 'FLARES', cmd: { t: 'flares' } }, { label: 'WINGMAN ENGAGE', cmd: { t: 'wing', cmd: 'engage' } }, { label: 'CAMERA', cmd: { t: 'camera', next: true } },
  { label: 'AUTOLAND', cmd: { t: 'autoland' } }, { label: 'RECOVER', cmd: { t: 'recover' } },
];
const SQUAD: { label: string; cmd: Cmd }[] = [
  { label: 'COVER', cmd: { t: 'wing', cmd: 'cover' } }, { label: 'ENGAGE', cmd: { t: 'wing', cmd: 'engage' } },
  { label: 'REJOIN', cmd: { t: 'wing', cmd: 'rejoin' } }, { label: 'RTB', cmd: { t: 'wing', cmd: 'rtb' } },
];

const STORE = 'vantage-zero.guideSeen.v1';

/**
 * Clickable pilot bar: the common actions as buttons (so nothing requires remembering a key or a spoken phrase) plus a
 * short quick-start guide. Buttons run through the same command path as typed / spoken commands.
 */
export class PilotBar {
  readonly root: HTMLElement;
  private bar: HTMLElement;
  private guide: HTMLElement;
  private sig = '';
  private dial: HTMLElement;
  private squad: HTMLElement;
  onCommand?: (c: Cmd) => void;
  /** called when the dial opens (so pointer capture can be released for clicking) */
  onDialOpen?: () => void;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div'); this.root.id = 'pilotbar'; this.root.style.display = 'none';
    this.bar = document.createElement('div'); this.bar.className = 'pbbar';
    this.guide = document.createElement('div'); this.guide.id = 'quickguide'; this.guide.style.display = 'none';
    this.guide.innerHTML = `
      <div class="qgcard">
        <h2>Quick start – how to fly</h2>
        <ol>
          <li><b>Start the jet:</b> click <b>START ENGINES</b> (or press F).</li>
          <li><b>Get on the runway:</b> click <b>AUTO-TAXI</b>, then <b>AUTO-TAKEOFF</b>. The jet flies itself into the air.</li>
          <li><b>Fly yourself:</b> move the mouse (nose follows the cursor) or use W/S pitch, A/D roll. Touch any flight key and the autopilot hands control back.</li>
          <li><b>Relax:</b> click <b>AUTOPILOT</b> (or press P) to hold your heading and height. <b>NEXT WAYPOINT</b> flies the route.</li>
          <li><b>Land:</b> click <b>AUTOLAND</b>. It costs 300 score points, so try a manual landing for a better grade.</li>
          <li><b>Lost?</b> Press <b>L</b> (or RECOVER) – the jet rolls wings level and climbs. <b>Tab</b> opens the action dial, <b>K</b> switches between full MFDs and a clean HUD.</li>
        </ol>
        <p>Say or type commands too: press Enter, then “gear up”, “heading 270”, “climb to 4000 feet”. H = Ground Control hint · 5 = camera · Esc = pause.</p>
        <button class="qgclose">Got it</button>
      </div>`;
    this.dial = document.createElement('div'); this.dial.id = 'actiondial'; this.dial.style.display = 'none';
    const ring = document.createElement('div'); ring.className = 'adring';
    DIAL.forEach((d, i) => {
      const a = (i / DIAL.length) * Math.PI * 2 - Math.PI / 2, b = document.createElement('button');
      b.className = 'adbtn'; b.textContent = d.label;
      b.style.left = `calc(50% + ${(Math.cos(a) * 150).toFixed(0)}px)`; b.style.top = `calc(50% + ${(Math.sin(a) * 150).toFixed(0)}px)`;
      b.addEventListener('click', e => { e.stopPropagation(); this.showDial(false); this.onCommand?.(d.cmd); });
      ring.append(b);
    });
    const close = document.createElement('button'); close.className = 'adclose'; close.textContent = 'CLOSE · TAB'; close.addEventListener('click', () => this.showDial(false));
    ring.append(close); this.dial.append(ring);
    this.dial.addEventListener('pointerdown', e => { if (e.target === this.dial) this.showDial(false); });
    this.squad = document.createElement('div'); this.squad.id = 'squadbtns'; this.squad.style.display = 'none';
    for (const s of SQUAD) { const b = document.createElement('button'); b.textContent = s.label; b.title = 'Wingman: ' + s.label.toLowerCase(); b.addEventListener('click', e => { e.stopPropagation(); (e.currentTarget as HTMLElement).blur(); this.onCommand?.(s.cmd); }); this.squad.append(b); }
    host.append(this.root, this.guide, this.dial, this.squad);
    this.root.append(this.bar);
    this.guide.querySelector('.qgclose')!.addEventListener('click', () => this.showGuide(false));
    this.guide.addEventListener('pointerdown', e => { if (e.target === this.guide) this.showGuide(false); });
  }

  setVisible(v: boolean) { this.root.style.display = v ? 'block' : 'none'; if (!v) { this.showGuide(false); this.showDial(false); this.placeSquad(null); } }

  get dialOpen() { return this.dial.style.display !== 'none'; }
  showDial(v: boolean) { this.dial.style.display = v ? 'flex' : 'none'; if (v) this.onDialOpen?.(); }
  toggleDial() { this.showDial(!this.dialOpen); }
  /** Places the squad-command buttons under the comms MFD (screen px), or hides them. */
  placeSquad(r: { x: number; y: number; w: number; h: number } | null) {
    if (!r) { this.squad.style.display = 'none'; return; }
    this.squad.style.display = 'flex'; this.squad.style.left = r.x + 'px'; this.squad.style.top = (r.y + r.h + 4) + 'px'; this.squad.style.width = r.w + 'px';
  }

  get guideOpen() { return this.guide.style.display !== 'none'; }
  showGuide(v: boolean) { this.guide.style.display = v ? 'flex' : 'none'; if (!v) this.markSeen(); }
  toggleGuide() { this.showGuide(!this.guideOpen); }
  seenBefore(): boolean { try { return localStorage.getItem(STORE) === '1'; } catch { return false; } }
  private markSeen() { try { localStorage.setItem(STORE, '1'); } catch { /* storage unavailable */ } }

  /** Re-render only when the set of buttons changes, so clicks are never lost to a rebuild. */
  update(step: string | null, buttons: GuideButton[]) {
    const sig = buttons.map(b => b.label + (b.on ? '*' : '') + (b.hot ? '!' : '')).join('|') + '#' + (step ?? '');
    if (sig === this.sig) return;
    this.sig = sig;
    this.bar.textContent = '';
    if (step) { const s = document.createElement('div'); s.className = 'pbstep'; s.textContent = step; this.bar.append(s); }
    const row = document.createElement('div'); row.className = 'pbrow';
    for (const b of buttons) {
      const el = document.createElement('button'); el.className = 'pbbtn' + (b.hot ? ' hot' : '') + (b.on ? ' on' : ''); el.textContent = b.label; el.title = b.title;
      el.addEventListener('click', e => { e.stopPropagation(); (e.currentTarget as HTMLElement).blur(); const k = (b.cmd as { t: string }).t; if (k === 'guide') this.toggleGuide(); else if (k === 'radial') this.toggleDial(); else this.onCommand?.(b.cmd as Cmd); });
      row.append(el);
    }
    this.bar.append(row);
  }
}
