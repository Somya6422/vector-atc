import type { StorageLike } from '../persistence/SaveManager';

export interface ActionDef { id: string; label: string; group: string; def: string; note?: string; alt?: string; arrow?: string }

/** Every rebindable function. `def` is the default key (KeyboardEvent.code). */
export const ACTIONS: ActionDef[] = [
  { id: 'throttleUp', label: 'Throttle up / afterburner', group: 'Flight', def: 'Ctrl+KeyW', note: 'hold', arrow: '⇈' },
  { id: 'throttleDown', label: 'Throttle down', group: 'Flight', def: 'Ctrl+KeyS', note: 'hold', arrow: '⇊' },
  { id: 'pitchUp', label: 'Pitch – nose up', group: 'Flight', def: 'KeyW', alt: 'ArrowUp', arrow: '↑' },
  { id: 'pitchDown', label: 'Pitch – nose down', group: 'Flight', def: 'KeyS', alt: 'ArrowDown', arrow: '↓' },
  { id: 'rollLeft', label: 'Roll left', group: 'Flight', def: 'KeyA', alt: 'ArrowLeft', arrow: '←' },
  { id: 'rollRight', label: 'Roll right', group: 'Flight', def: 'KeyD', alt: 'ArrowRight', arrow: '→' },
  { id: 'yawLeft', label: 'Yaw left', group: 'Flight', def: 'KeyQ', arrow: '↶' },
  { id: 'yawRight', label: 'Yaw right', group: 'Flight', def: 'KeyE', arrow: '↷' },
  { id: 'mouseFlight', label: 'Mouse-aim flight on/off (nose follows the cursor)', group: 'Flight', def: 'KeyN', arrow: '🖱' },
  { id: 'autopilot', label: 'Autopilot on/off (holds heading, altitude, speed)', group: 'Flight', def: 'KeyP' },
  { id: 'recover', label: 'Panic recovery: wings level and climb', group: 'Flight', def: 'KeyL' },
  { id: 'stovl', label: 'F-35: STOVL hover ↔ wing-borne (vertical take-off / landing)', group: 'Aircraft skills', def: 'KeyJ' },
  { id: 'cobra', label: "Su-57: Pugachev's Cobra (200–470 kt)", group: 'Aircraft skills', def: 'KeyU' },
  { id: 'kulbit', label: 'Su-57: Kulbit somersault (220–480 kt)', group: 'Aircraft skills', def: 'KeyO' },
  { id: 'ecm', label: 'Electronic jammer (8 s, breaks radar locks)', group: 'Aircraft skills', def: 'Digit6' },
  { id: 'brake', label: 'Airbrake / wheel brakes', group: 'Flight', def: 'KeyB', note: 'hold' },
  { id: 'gear', label: 'Landing gear', group: 'Flight', def: 'KeyG' },
  { id: 'camera', label: 'Cycle camera angle', group: 'View', def: 'Digit5', alt: 'KeyC', note: 'chase · cockpit · wing · orbit · front · flyby' },
  { id: 'headLook', label: 'Head-look (mouse)', group: 'View', def: 'KeyV' },
  { id: 'mfd', label: 'MFDs: full / clean HUD', group: 'View', def: 'KeyK' },
  { id: 'radarRange', label: 'Radar range', group: 'View', def: 'KeyZ' },
  { id: 'map', label: 'Map & objectives', group: 'Game', def: 'KeyM' },
  { id: 'pause', label: 'Pause', group: 'Game', def: 'Escape' },
  { id: 'guide', label: 'Quick-start guide', group: 'Game', def: 'KeyI' },
  { id: 'radial', label: 'Action dial (on-screen shortcuts)', group: 'Game', def: 'Tab' },
  { id: 'help', label: 'Commands & shortcut keys sheet', group: 'Game', def: 'Slash' },
  { id: 'hint', label: 'Ground Control hint', group: 'Game', def: 'KeyH' },
  { id: 'interact', label: 'Interact (engine start)', group: 'Game', def: 'KeyF' },
  { id: 'target', label: 'Cycle target', group: 'Weapons', def: 'KeyR' },
  { id: 'weapon', label: 'Cycle weapon', group: 'Weapons', def: 'KeyT' },
  { id: 'fire', label: 'Fire selected weapon', group: 'Weapons', def: 'Space', note: 'left mouse also fires the cannon' },
  { id: 'flares', label: 'Countermeasures', group: 'Weapons', def: 'KeyX' },
  { id: 'cmdCover', label: 'Wingman: cover me', group: 'Wingman', def: 'Digit1' },
  { id: 'cmdEngage', label: 'Wingman: engage target', group: 'Wingman', def: 'Digit2' },
  { id: 'cmdRejoin', label: 'Wingman: rejoin', group: 'Wingman', def: 'Digit3' },
  { id: 'cmdFormation', label: 'Wingman: cycle formation', group: 'Wingman', def: 'Digit4' },
  { id: 'voice', label: 'Voice / text command line (Wispr Flow types here)', group: 'Voice', def: 'Enter' },
  { id: 'voiceMic', label: 'Browser microphone on/off', group: 'Voice', def: 'KeyY' },
  { id: 'debug', label: 'Debug overlay (debug mode only)', group: 'Debug', def: 'Backquote' },
];

const KEY = 'vantage-zero.bindings.v1';

export function keyName(spec: string): string {
  const parts = spec.split('+'); const code = parts.pop()!; const mods = parts.map(m => m);
  return [...mods, keyName1(code)].join(' + ');
}
function keyName1(code: string): string {
  return code.replace(/^Key/, '').replace(/^Digit/, '').replace('ShiftLeft', 'Left Shift').replace('ShiftRight', 'Right Shift')
    .replace('ControlLeft', 'Left Ctrl').replace('ControlRight', 'Right Ctrl').replace('AltLeft', 'Left Alt').replace('Backquote', '`')
    .replace('Escape', 'Esc').replace(/^Arrow/, '↔ ').replace('Space', 'Space').replace('Semicolon', ';').replace('Comma', ',').replace('Period', '.').replace('Slash', '/');
}

export class Bindings {
  private map = new Map<string, string>();
  private store: StorageLike | null = null;
  constructor() { this.resetAll(false); }

  attach(store: StorageLike | null) {
    this.store = store;
    try {
      const raw = store?.getItem(KEY);
      if (!raw) return;
      const o = JSON.parse(raw) as Record<string, unknown>;
      const used = new Set<string>();
      for (const a of ACTIONS) { const v = o[a.id]; if (typeof v === 'string' && /^((Ctrl|Shift|Alt)+)*[A-Za-z0-9]{1,20}$/.test(v) && !used.has(v)) { this.map.set(a.id, v); used.add(v); } else this.map.set(a.id, a.def); }
      // a corrupt file could leave duplicates; fall back to defaults for any clash
      if (new Set(this.map.values()).size !== this.map.size) this.resetAll(false);
    } catch { this.resetAll(false); }
  }
  code(action: string): string { return this.map.get(action) ?? action; }
  specs(x: string): string[] { const a = this.alt(x); return a ? [this.code(x), a] : [this.code(x)]; }
  isAction(x: string) { return this.map.has(x); }
  actionFor(code: string): string | null { for (const [a, c] of this.map) if (c === code) return a; return null; }
  /** Binds `code` to `action`; if another action used it the two swap, so no key is ever bound twice. */
  set(action: string, code: string): string | null {
    const other = this.actionFor(code);
    const old = this.code(action);
    this.map.set(action, code);
    if (other && other !== action) this.map.set(other, old);
    this.save();
    return other && other !== action ? other : null;
  }
  reset(action: string) { const d = ACTIONS.find(a => a.id === action)!; this.set(action, d.def); }
  resetAll(save = true) { for (const a of ACTIONS) this.map.set(a.id, a.def); if (save) this.save(); }
  /** Only user overrides are stored, so future changes to the defaults still reach everyone who did not customise that key. */
  private save() { try { this.store?.setItem(KEY, JSON.stringify(Object.fromEntries([...this.map].filter(([a, c]) => c !== ACTIONS.find(x => x.id === a)!.def)))); } catch { /* storage unavailable */ } }
  /** Secondary (fixed) key, only active while no other function uses it as its main key. */
  alt(action: string): string | null { const a = ACTIONS.find(x => x.id === action)?.alt ?? null; return a && !this.actionFor(a) ? a : null; }
  isDefault(action: string) { return this.code(action) === ACTIONS.find(a => a.id === action)!.def; }
}

export const bindings = new Bindings();
