import type { Cmd } from '../voice/CommandParser';

export interface GuideButton { label: string; title: string; cmd: Cmd | { t: 'guide' }; hot?: boolean; on?: boolean }

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
  onCommand?: (c: Cmd) => void;

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
        </ol>
        <p>Say or type commands too: press Enter, then “gear up”, “heading 270”, “climb to 4000 feet”. H = Ground Control hint · 5 = camera · Esc = pause.</p>
        <button class="qgclose">Got it</button>
      </div>`;
    host.append(this.root, this.guide);
    this.root.append(this.bar);
    this.guide.querySelector('.qgclose')!.addEventListener('click', () => this.showGuide(false));
    this.guide.addEventListener('pointerdown', e => { if (e.target === this.guide) this.showGuide(false); });
  }

  setVisible(v: boolean) { this.root.style.display = v ? 'block' : 'none'; if (!v) this.showGuide(false); }

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
      el.addEventListener('click', e => { e.stopPropagation(); (e.currentTarget as HTMLElement).blur(); if ((b.cmd as { t: string }).t === 'guide') this.toggleGuide(); else this.onCommand?.(b.cmd as Cmd); });
      row.append(el);
    }
    this.bar.append(row);
  }
}
