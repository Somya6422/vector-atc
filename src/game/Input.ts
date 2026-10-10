/**
 * Keyboard / mouse input with edge events. Keys are cleared on blur, visibility change, pause/resume and
 * state changes so nothing can remain "stuck" (e.g. a held throttle key when the window loses focus).
 */
import { bindings } from './Bindings';
const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyB', 'KeyG', 'KeyC', 'KeyV', 'KeyM', 'KeyR', 'KeyF', 'KeyX', 'KeyT', 'KeyZ', 'KeyH', 'Space',
  'ShiftLeft', 'ControlLeft', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Tab', 'Escape', 'Backquote', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F8', 'F9', 'F10']);

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  mouseX = typeof window !== 'undefined' ? window.innerWidth / 2 : 0; mouseY = typeof window !== 'undefined' ? window.innerHeight / 2 : 0; mouseDX = 0; mouseDY = 0;
  mouseButtons = 0;
  enabled = true;
  /** mouse-aim flight wants relative mouse movement: grab the pointer on the next click so it never hits the screen edge */
  wantLock = false;
  private disposers: (() => void)[] = [];
  /** Called for key presses that should reach the UI layer even while the game is idle (e.g. Escape). */
  onKeyDown?: (code: string, e: KeyboardEvent) => boolean | void;

  constructor(private target: HTMLElement) {
    const add = <K extends keyof WindowEventMap>(t: Window | HTMLElement | Document, ev: string, fn: (e: never) => void) => {
      t.addEventListener(ev, fn as EventListener); this.disposers.push(() => t.removeEventListener(ev, fn as EventListener));
    };
    void add;
    const kd = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.repeat) { if (GAME_KEYS.has(e.code) && this.enabled) e.preventDefault(); return; }
      const isMod = /^(Control|Shift|Alt)/.test(e.code);
      const spec = (e.ctrlKey && !isMod ? 'Ctrl+' : '') + (e.shiftKey && !isMod ? 'Shift+' : '') + (e.altKey && !isMod ? 'Alt+' : '') + e.code;
      const consumed = this.onKeyDown?.(e.code, e);
      if ((GAME_KEYS.has(e.code) || bindings.actionFor(spec) || bindings.actionFor(e.code)) && (this.enabled || consumed)) e.preventDefault();
      if (!this.enabled || consumed) return;     // keys consumed by the UI layer must not also reach the flight controls
      this.down.add(e.code);
      this.pressed.add(spec);
    };
    const ku = (e: KeyboardEvent) => { this.down.delete(e.code); if (GAME_KEYS.has(e.code) && this.enabled) e.preventDefault(); };
    const blur = () => this.reset();
    const vis = () => { if (document.hidden) this.reset(); };
    const mm = (e: MouseEvent) => { this.mouseX = e.clientX; this.mouseY = e.clientY; this.mouseDX += e.movementX || 0; this.mouseDY += e.movementY || 0; };
    const md = (e: MouseEvent) => { if (!this.enabled) return; if ((e.target as HTMLElement)?.closest?.('.ui-panel,button,input,select')) return; this.mouseButtons |= 1 << e.button; if (this.wantLock && !document.pointerLockElement) { try { (document.body.requestPointerLock as (() => void) | undefined)?.call(document.body); } catch { /* denied */ } } if (e.button === 0) this.pressed.add('Mouse0'); };
    const mu = (e: MouseEvent) => { this.mouseButtons &= ~(1 << e.button); };
    const cm = (e: Event) => e.preventDefault();
    window.addEventListener('keydown', kd); window.addEventListener('keyup', ku); window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', vis); window.addEventListener('mousemove', mm); window.addEventListener('mousedown', md); window.addEventListener('mouseup', mu);
    target.addEventListener('contextmenu', cm);
    this.disposers.push(() => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', vis); window.removeEventListener('mousemove', mm); window.removeEventListener('mousedown', md); window.removeEventListener('mouseup', mu); target.removeEventListener('contextmenu', cm); });
  }
  private mods() { const d = this.down; return (d.has('ControlLeft') || d.has('ControlRight') ? 1 : 0) | (d.has('ShiftLeft') || d.has('ShiftRight') ? 2 : 0) | (d.has('AltLeft') || d.has('AltRight') ? 4 : 0); }
  private specHeld(spec: string, mods: number) {
    const p = spec.split('+'); const code = p.pop()!; const need = (p.includes('Ctrl') ? 1 : 0) | (p.includes('Shift') ? 2 : 0) | (p.includes('Alt') ? 4 : 0);
    const isMod = /^(Control|Shift|Alt)/.test(code);
    return this.down.has(code) && (isMod || need === mods);
  }
  held(x: string) { if (!this.enabled) return false; const m = this.mods(); return bindings.specs(x).some(s => this.specHeld(s, m)); }
  /** True once per press. */
  wasPressed(x: string) { return bindings.specs(x).some(s => this.pressed.has(s)); }
  get mouseLeft() { return this.enabled && (this.mouseButtons & 1) !== 0; }
  endFrame() { this.pressed.clear(); this.mouseDX = 0; this.mouseDY = 0; }
  reset() { this.down.clear(); this.pressed.clear(); this.mouseButtons = 0; this.mouseDX = 0; this.mouseDY = 0; }
  /** Simulated input for automated tests / debug tooling. */
  inject(code: string, isDown: boolean) { if (isDown) { this.down.add(code); this.pressed.add(code); } else this.down.delete(code); }
  dispose() { this.disposers.forEach(d => d()); }
}
