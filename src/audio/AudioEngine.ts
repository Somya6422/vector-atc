import type { SettingsData } from '../ui/Settings';

export type BusName = 'engines' | 'weapons' | 'dialogue' | 'radio' | 'music' | 'environment';
export type MusicMood = 'off' | 'menu' | 'calm' | 'tense' | 'combat' | 'hangar';
export type AircraftSound = 'SU57' | 'F35';
type LockTone = 'NONE' | 'SEARCH' | 'TRACK' | 'LOCK';

/**
 * Centralised, fully synthesised audio (Web Audio API) – no external audio assets, no network.
 * All entry points are safe no-ops when audio is unavailable or not yet unlocked by a user gesture.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses = {} as Record<BusName, GainNode>;
  private white!: AudioBuffer; private brown!: AudioBuffer;
  private settings: SettingsData | null = null;
  available = typeof AudioContext !== 'undefined' || typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined';

  // engine voice
  private eng: null | {
    profile: AircraftSound;
    osc: OscillatorNode[]; oscGain: GainNode; whine: BiquadFilterNode; whineGain: GainNode; roarGain: GainNode; abGain: GainNode; wind: GainNode;
    sources: AudioScheduledSourceNode[]; out: GainNode;
  } = null;
  // continuous tones
  private tone: { osc: OscillatorNode; gain: GainNode; lfo: OscillatorNode; lfoGain: GainNode } | null = null;
  private warn: { osc: OscillatorNode; gain: GainNode; lfo: OscillatorNode; lfoGain: GainNode } | null = null;
  private gun: { src: AudioBufferSourceNode; gain: GainNode; gate: OscillatorNode; gateGain: GainNode; lp: BiquadFilterNode } | null = null;
  private gunOn = false;
  private music: { oscs: OscillatorNode[]; gain: GainNode; lp: BiquadFilterNode; pulse: GainNode; mood: MusicMood } | null = null;
  private ambience: { out: GainNode; sources: AudioScheduledSourceNode[] } | null = null;
  private lastMach = 0;
  readonly log: string[] = [];

  /** Must be called from a user gesture (key / click). Safe to call repeatedly. */
  unlock() {
    if (!this.available) return;
    try {
      if (!this.ctx) this.init();
      if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    } catch (e) { this.available = false; this.log.push('audio init failed: ' + String(e)); }
  }
  get running() { return !!this.ctx && this.ctx.state === 'running'; }

  private init() {
    const AC = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext });
    const Ctor = AC.AudioContext ?? AC.webkitAudioContext!;
    const ctx = this.ctx = new Ctor();
    this.master = ctx.createGain(); this.master.connect(ctx.destination);
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.disconnect(); this.master.connect(comp); comp.connect(ctx.destination);
    for (const n of ['engines', 'weapons', 'dialogue', 'radio', 'music', 'environment'] as BusName[]) {
      const g = ctx.createGain(); g.connect(this.master); this.buses[n] = g;
    }
    const mk = (secs: number, brownian: boolean) => {
      const b = ctx.createBuffer(1, ctx.sampleRate * secs, ctx.sampleRate); const d = b.getChannelData(0); let last = 0;
      for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brownian) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
      return b;
    };
    this.white = mk(2, false); this.brown = mk(3, true);
    if (this.settings) this.applySettings(this.settings);
  }

  applySettings(s: SettingsData) {
    this.settings = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    for (const n of ['engines', 'weapons', 'dialogue', 'radio', 'music', 'environment'] as BusName[]) this.buses[n].gain.setTargetAtTime(s[n], t, 0.05);
  }

  private noise(buf: AudioBuffer, loop = true) { const s = this.ctx!.createBufferSource(); s.buffer = buf; s.loop = loop; return s; }
  private gainNode(v: number, dest: AudioNode) { const g = this.ctx!.createGain(); g.gain.value = v; g.connect(dest); return g; }
  private filt(type: BiquadFilterType, f: number, q = 1) { const b = this.ctx!.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }

  // ------------------------------------------------------------------ engine
  startEngine(profile: AircraftSound) {
    if (!this.ctx) return;
    this.stopEngine();
    const ctx = this.ctx, out = this.gainNode(0, this.buses.engines);
    const sources: AudioScheduledSourceNode[] = [];
    const twin = profile === 'SU57';
    const oscGain = this.gainNode(0.0, out);
    const osc: OscillatorNode[] = [];
    for (let i = 0; i < (twin ? 2 : 1); i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 60; o.detune.value = twin ? (i ? 18 : -18) : 0;
      const lp = this.filt('lowpass', twin ? 420 : 320, 0.7); o.connect(lp); lp.connect(oscGain); o.start(); osc.push(o); sources.push(o);
    }
    const w = this.noise(this.white); const whine = this.filt('bandpass', 1500, twin ? 6 : 9); const whineGain = this.gainNode(0, out);
    w.connect(whine); whine.connect(whineGain); w.start(); sources.push(w);
    const r = this.noise(this.brown); const rl = this.filt('lowpass', twin ? 600 : 480, 0.6); const roarGain = this.gainNode(0, out);
    r.connect(rl); rl.connect(roarGain); r.start(); sources.push(r);
    const a = this.noise(this.brown); const al = this.filt('lowpass', 220, 0.5); const abGain = this.gainNode(0, out);
    a.connect(al); al.connect(abGain); a.start(); sources.push(a);
    const wn = this.noise(this.white); const wh = this.filt('highpass', 1200, 0.5); const wind = this.gainNode(0, this.buses.environment);
    wn.connect(wh); wh.connect(wind); wn.start(); sources.push(wn);
    out.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
    this.eng = { profile, osc, oscGain, whine, whineGain, roarGain, abGain, wind, sources, out };
  }
  /** n: engine spool 0..1 (mil to 0.9, AB above), ab: 0..1, speed in m/s. Driven by the real simulation state. */
  updateEngine(n: number, ab: number, speed: number, mach: number, engineOn: boolean, inCockpit: boolean) {
    const e = this.eng, ctx = this.ctx; if (!e || !ctx) return;
    const t = ctx.currentTime, tc = 0.08;
    const on = engineOn ? 1 : 0.0;
    const twin = e.profile === 'SU57';
    const nn = Math.min(n, 1);
    const base = (twin ? 52 : 40) + nn * (twin ? 70 : 60);
    e.osc.forEach((o, i) => o.frequency.setTargetAtTime(base * (twin && i ? 1.012 : 1), t, tc));
    e.oscGain.gain.setTargetAtTime((0.1 + 0.25 * nn) * on * (inCockpit ? 0.6 : 1), t, tc);
    e.whine.frequency.setTargetAtTime((twin ? 1100 : 1500) + nn * (twin ? 2400 : 3100), t, tc);
    e.whineGain.gain.setTargetAtTime((0.04 + 0.34 * nn * nn) * on * (inCockpit ? 0.55 : 1), t, tc);
    e.roarGain.gain.setTargetAtTime((0.2 + 0.7 * nn) * on, t, tc);
    e.abGain.gain.setTargetAtTime(ab * 1.3 * on, t, 0.2);
    e.wind.gain.setTargetAtTime(Math.min(0.5, (speed / 400) ** 1.6) * (inCockpit ? 0.6 : 1), t, 0.2);
    // transonic boom: when Mach rises through 1
    if (this.lastMach < 1 && mach >= 1) this.sonicBoom();
    this.lastMach = mach;
  }
  stopEngine() {
    if (!this.eng || !this.ctx) return;
    const e = this.eng; e.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    e.wind.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    setTimeout(() => e.sources.forEach(s => { try { s.stop(); } catch { /* already stopped */ } }), 700);
    this.eng = null;
  }

  // ------------------------------------------------------------------ one-shots
  private burst(dest: BusName, dur: number, f0: number, f1: number, vol: number, type: BiquadFilterType = 'lowpass', q = 0.7, brown = false) {
    const ctx = this.ctx; if (!ctx) return;
    const s = this.noise(brown ? this.brown : this.white, false); const f = this.filt(type, f0, q); const g = this.gainNode(0, this.buses[dest]);
    const t = ctx.currentTime;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(f); f.connect(g); s.start(t); s.stop(t + dur + 0.05);
  }
  private beep(dest: BusName, f: number, dur: number, vol = 0.2, type: OscillatorType = 'sine', when = 0, f2?: number) {
    const ctx = this.ctx; if (!ctx) return;
    const o = ctx.createOscillator(), g = this.gainNode(0, this.buses[dest]); o.type = type;
    const t = ctx.currentTime + when;
    o.frequency.setValueAtTime(f, t); if (f2) o.frequency.linearRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 0.01); g.gain.setTargetAtTime(0, t + dur * 0.7, dur * 0.1);
    o.connect(g); o.start(t); o.stop(t + dur + 0.1);
  }
  sonicBoom() { this.burst('environment', 1.6, 260, 40, 1.1, 'lowpass', 0.8, true); }
  explosion(distance = 500) { const v = Math.max(0.15, 1 - distance / 7000); this.burst('weapons', 1.8, 700, 50, 1.0 * v, 'lowpass', 0.6, true); this.burst('weapons', 0.5, 3000, 300, 0.5 * v); }
  missileLaunch(kind: 'IR' | 'RADAR') { this.burst('weapons', kind === 'IR' ? 1.4 : 2.2, 3000, 300, 0.55, 'bandpass', 0.8); this.burst('weapons', 0.4, 400, 90, 0.7, 'lowpass', 1, true); }
  flare() { this.burst('weapons', 0.7, 6000, 2000, 0.25, 'highpass', 0.5); }
  uiClick() { this.beep('weapons', 880, 0.05, 0.12, 'square'); }
  uiConfirm() { this.beep('weapons', 660, 0.08, 0.12, 'triangle'); this.beep('weapons', 990, 0.1, 0.12, 'triangle', 0.07); }
  gearThunk() { this.burst('environment', 0.35, 500, 80, 0.7, 'lowpass', 1, true); }
  touchdown(hard: boolean) { this.burst('environment', hard ? 0.6 : 0.35, 900, 70, hard ? 1.0 : 0.6, 'lowpass', 1, true); this.beep('environment', 90, 0.2, 0.3, 'sine', 0, 50); }
  hit() { this.burst('weapons', 0.18, 2500, 600, 0.45, 'bandpass', 2); }
  success() { [523, 659, 784, 1047].forEach((f, i) => this.beep('music', f, 0.3, 0.16, 'triangle', i * 0.12)); }
  failure() { [392, 330, 262, 196].forEach((f, i) => this.beep('music', f, 0.42, 0.18, 'sawtooth', i * 0.2)); }
  missionComplete() { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => this.beep('music', f, 0.45, 0.14, 'triangle', i * 0.14)); }
  footstep() { this.burst('environment', 0.09, 700, 200, 0.35, 'lowpass', 1); }
  hangarClink() { this.beep('environment', 2400 + Math.random() * 1500, 0.25, 0.04, 'sine'); }
  radioClick(open: boolean) { this.burst('radio', open ? 0.06 : 0.09, open ? 3500 : 2200, 900, open ? 0.3 : 0.22, 'bandpass', 1.5); }

  // continuous gun with rotary wind-down
  setGun(firing: boolean) {
    const ctx = this.ctx; if (!ctx) return;
    if (firing && !this.gunOn) {
      this.gunOn = true;
      if (!this.gun) {
        const src = this.noise(this.white); const lp = this.filt('lowpass', 1800, 0.8); const gateGain = this.gainNode(0, this.buses.weapons);
        const gate = ctx.createOscillator(); gate.type = 'square'; gate.frequency.value = 78;
        const gain = ctx.createGain(); gain.gain.value = 0;
        const shaper = ctx.createGain(); shaper.gain.value = 0.5; gate.connect(shaper); shaper.connect(gain.gain);
        src.connect(lp); lp.connect(gain); gain.connect(gateGain); gateGain.gain.value = 0.9;
        src.start(); gate.start(); this.gun = { src, gain, gate, gateGain, lp };
      }
      const t = ctx.currentTime;
      this.gun.gate.frequency.cancelScheduledValues(t); this.gun.gate.frequency.setTargetAtTime(78, t, 0.05);
      this.gun.gateGain.gain.cancelScheduledValues(t); this.gun.gateGain.gain.setTargetAtTime(0.9, t, 0.02);
    } else if (!firing && this.gunOn && this.gun) {
      this.gunOn = false;
      const t = ctx.currentTime;   // barrels spin down: rate decays, level fades
      this.gun.gate.frequency.cancelScheduledValues(t); this.gun.gate.frequency.setValueAtTime(78, t); this.gun.gate.frequency.exponentialRampToValueAtTime(9, t + 0.55);
      this.gun.gateGain.gain.cancelScheduledValues(t); this.gun.gateGain.gain.setTargetAtTime(0, t + 0.12, 0.2);
    }
  }

  // ------------------------------------------------------------------ continuous cues
  /** Lock tone: searching silent, tracking pulses, confirmed lock is a steady tone. */
  setLockTone(state: LockTone, ir = false) {
    const ctx = this.ctx; if (!ctx) return;
    if (!this.tone) {
      const osc = ctx.createOscillator(), gain = this.gainNode(0, this.buses.weapons), lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
      osc.type = 'sine'; lfo.type = 'square'; lfo.frequency.value = 7; lfoGain.gain.value = 0;
      lfo.connect(lfoGain); lfoGain.connect(gain.gain); osc.connect(gain); osc.start(); lfo.start();
      this.tone = { osc, gain, lfo, lfoGain };
    }
    const t = ctx.currentTime, tn = this.tone;
    if (state === 'TRACK') { tn.osc.frequency.setTargetAtTime(ir ? 760 : 980, t, 0.02); tn.gain.gain.setTargetAtTime(0.1, t, 0.02); tn.lfoGain.gain.setTargetAtTime(0.1, t, 0.02); }
    else if (state === 'LOCK') { tn.osc.frequency.setTargetAtTime(ir ? 1250 : 1500, t, 0.02); tn.gain.gain.setTargetAtTime(0.16, t, 0.02); tn.lfoGain.gain.setTargetAtTime(0, t, 0.02); }
    else { tn.gain.gain.setTargetAtTime(0, t, 0.03); tn.lfoGain.gain.setTargetAtTime(0, t, 0.03); }
  }
  /** kind: none | stall | pullup | missile */
  setWarning(kind: 'none' | 'stall' | 'pullup' | 'missile') {
    const ctx = this.ctx; if (!ctx) return;
    if (!this.warn) {
      const osc = ctx.createOscillator(), gain = this.gainNode(0, this.buses.weapons), lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
      osc.type = 'square'; lfo.type = 'square'; lfoGain.gain.value = 0; lfo.connect(lfoGain); lfoGain.connect(gain.gain); osc.connect(gain); osc.start(); lfo.start();
      this.warn = { osc, gain, lfo, lfoGain };
    }
    const t = ctx.currentTime, w = this.warn;
    switch (kind) {
      case 'stall': w.osc.frequency.setTargetAtTime(520, t, 0.01); w.lfo.frequency.setTargetAtTime(4, t, 0.01); w.gain.gain.setTargetAtTime(0.09, t, 0.01); w.lfoGain.gain.setTargetAtTime(0.09, t, 0.01); break;
      case 'pullup': w.osc.frequency.setTargetAtTime(880, t, 0.01); w.lfo.frequency.setTargetAtTime(2.5, t, 0.01); w.gain.gain.setTargetAtTime(0.1, t, 0.01); w.lfoGain.gain.setTargetAtTime(0.1, t, 0.01); break;
      case 'missile': w.osc.frequency.setTargetAtTime(1200, t, 0.01); w.lfo.frequency.setTargetAtTime(8, t, 0.01); w.gain.gain.setTargetAtTime(0.09, t, 0.01); w.lfoGain.gain.setTargetAtTime(0.09, t, 0.01); break;
      default: w.gain.gain.setTargetAtTime(0, t, 0.02); w.lfoGain.gain.setTargetAtTime(0, t, 0.02);
    }
  }

  // ------------------------------------------------------------------ radio + voice
  /** Radio voice fallback: a synthesised babble whose cadence follows the text, filtered like a radio. */
  radioBabble(speaker: string, text: string, durationSec: number) {
    const ctx = this.ctx; if (!ctx) return;
    const base = speaker === 'Specter-2' ? 330 : speaker === 'Ground Control' ? 190 : 140;
    const syll = Math.min(60, Math.max(4, Math.round(text.replace(/[^aeiouy]/gi, '').length)));
    const step = durationSec / syll;
    const t0 = ctx.currentTime + 0.05;
    for (let i = 0; i < syll; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const f = base * (0.85 + Math.random() * 0.5); const t = t0 + i * step;
      o.frequency.setValueAtTime(f, t);
      const bp = this.filt('bandpass', 700 + Math.random() * 1400, 3); const bp2 = this.filt('highpass', 400);
      const g = this.gainNode(0, this.buses.radio);
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.1, t + step * 0.25); g.gain.linearRampToValueAtTime(0, t + step * 0.85);
      o.connect(bp); bp.connect(bp2); bp2.connect(g); o.start(t); o.stop(t + step);
    }
    // static bed
    this.burst('radio', durationSec + 0.2, 3200, 2600, 0.035, 'bandpass', 0.5);
  }

  // ------------------------------------------------------------------ music + ambience
  setMusic(mood: MusicMood) {
    const ctx = this.ctx; if (!ctx) return;
    if (!this.music) {
      const gain = this.gainNode(0, this.buses.music), lp = this.filt('lowpass', 500, 0.8), pulse = this.gainNode(1, gain);
      lp.connect(pulse);
      const oscs = [55, 82.4, 110, 164.8].map((f, i) => { const o = ctx.createOscillator(); o.type = i % 2 ? 'sawtooth' : 'triangle'; o.frequency.value = f; o.detune.value = (i - 1.5) * 7; const og = this.gainNode(0.25, lp); o.connect(og); o.start(); return o; });
      const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 260; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
      this.music = { oscs, gain, lp, pulse, mood: 'off' };
    }
    const m = this.music, t = ctx.currentTime;
    m.mood = mood;
    const lvl = { off: 0, menu: 0.5, calm: 0.35, tense: 0.5, combat: 0.7, hangar: 0.3 }[mood];
    m.gain.gain.setTargetAtTime(lvl * 0.5, t, 1.0);
    m.lp.frequency.setTargetAtTime({ off: 300, menu: 700, calm: 600, tense: 900, combat: 1500, hangar: 520 }[mood], t, 1.5);
    const root = { off: 55, menu: 55, calm: 55, tense: 58.3, combat: 61.7, hangar: 49 }[mood];
    m.oscs.forEach((o, i) => o.frequency.setTargetAtTime(root * [1, 1.5, 2, 3][i], t, 2.0));
  }
  setAmbience(kind: 'none' | 'hangar') {
    const ctx = this.ctx; if (!ctx) return;
    if (kind === 'hangar' && !this.ambience) {
      const out = this.gainNode(0, this.buses.environment); const sources: AudioScheduledSourceNode[] = [];
      const n = this.noise(this.brown); const lp = this.filt('lowpass', 180, 0.7); n.connect(lp); lp.connect(out); n.start(); sources.push(n);
      const h = ctx.createOscillator(); h.frequency.value = 100; h.type = 'sine'; const hg = this.gainNode(0.2, out); h.connect(hg); h.start(); sources.push(h);
      out.gain.setTargetAtTime(0.5, ctx.currentTime, 0.5); this.ambience = { out, sources };
    } else if (kind === 'none' && this.ambience) {
      const a = this.ambience; a.out.gain.setTargetAtTime(0, ctx.currentTime, 0.3); setTimeout(() => a.sources.forEach(s => { try { s.stop(); } catch { /* */ } }), 900); this.ambience = null;
    }
  }
  /** Silence everything that is continuous (used on mission end / pause). */
  quiet() { this.setGun(false); this.setLockTone('NONE'); this.setWarning('none'); }
  pauseAll() { void this.ctx?.suspend(); }
  resumeAll() { if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume(); }
}
