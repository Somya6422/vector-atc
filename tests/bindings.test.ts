import { describe, expect, it } from 'vitest';
import { ACTIONS, Bindings } from '../src/game/Bindings';

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

describe('key bindings', () => {
  it('defaults are unique', () => { expect(new Set(ACTIONS.map(a => a.def)).size).toBe(ACTIONS.length); });
  it('rebinding swaps on conflict, persists, and resets', () => {
    const st = new Mem(), b = new Bindings(); b.attach(st);
    expect(b.set('flares', 'KeyP')).toBeNull();
    expect(b.code('flares')).toBe('KeyP');
    expect(b.set('gear', 'KeyP')).toBe('flares');           // KeyP was flares -> swap
    expect(b.code('gear')).toBe('KeyP'); expect(b.code('flares')).toBe('KeyG');
    const b2 = new Bindings(); b2.attach(st);
    expect(b2.code('gear')).toBe('KeyP');
    b2.resetAll(); expect(b2.code('gear')).toBe('KeyG');
  });
  it('corrupt or duplicate stored data falls back safely', () => {
    const st = new Mem(); st.setItem('vantage-zero.bindings.v1', '{"gear":"KeyA","brake":"KeyA"}');
    const b = new Bindings(); b.attach(st);
    expect(new Set(ACTIONS.map(a => b.code(a.id))).size).toBe(ACTIONS.length);
    st.setItem('vantage-zero.bindings.v1', '{nope'); b.attach(st); expect(b.code('gear')).toBe('KeyG');
  });
});

describe('chords + alternates', () => {
  it('Ctrl+W / Ctrl+S default to throttle and plain W / S to pitch; arrows are alternates', () => {
    const b = new Bindings();
    expect(b.code('throttleUp')).toBe('Ctrl+KeyW'); expect(b.code('throttleDown')).toBe('Ctrl+KeyS');
    expect(b.code('pitchUp')).toBe('KeyW'); expect(b.code('pitchDown')).toBe('KeyS');
    expect(b.specs('pitchUp')).toEqual(['KeyW', 'ArrowUp']); expect(b.code('camera')).toBe('Digit5');
    b.set('flares', 'Ctrl+KeyS');                       // chord conflict swaps with throttle down
    expect(b.code('throttleDown')).toBe('KeyX');
    b.set('rollLeft', 'ArrowLeft');                     // once a key is a main key it is no longer an alternate elsewhere
    expect(b.alt('rollLeft')).toBeNull();
  });
});
