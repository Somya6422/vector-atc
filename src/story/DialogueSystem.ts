import type { AudioEngine } from '../audio/AudioEngine';

export type Speaker = 'Specter-1' | 'Specter-2' | 'Ground Control' | 'SYSTEM' | 'Narrator';
export interface Line {
  speaker: Speaker;
  text: string;
  /** 0 chatter, 1 normal, 2 important, 3 critical (interrupts lower priorities) */
  priority?: 0 | 1 | 2 | 3;
  /** de-duplication key + cooldown (s) */
  key?: string;
  cooldown?: number;
  /** radio effect (static, clicks, filtered voice). Default true except hangar/narration. */
  radio?: boolean;
}
export interface ActiveLine extends Required<Pick<Line, 'speaker' | 'text'>> { priority: number; total: number; remaining: number; radio: boolean; garbled: boolean; }

export interface SpeechLike { speak(u: unknown): void; cancel(): void; getVoices(): { lang: string; name: string }[]; pause?(): void; resume?(): void; }

/**
 * Central dialogue/radio/subtitle manager. Subtitles are produced for every line regardless of audio state;
 * voice (speech synthesis) and radio effects are optional layers on top.
 */
export class DialogueSystem {
  current: ActiveLine | null = null;
  readonly queue: { line: Line; at: number }[] = [];
  readonly history: { t: number; speaker: Speaker; text: string }[] = [];
  onSubtitle?: (a: ActiveLine | null) => void;
  voiceEnabled = true;
  private clock = 0;
  private lastKey = new Map<string, number>();
  private paused = false;
  /** 0..1, set by the mission when electronic interference garbles transmissions */
  interference = 0;
  private voices: { lang: string; name: string }[] | null = null;

  constructor(private audio: AudioEngine | null, private speech: SpeechLike | null = (typeof speechSynthesis !== 'undefined' ? (speechSynthesis as unknown as SpeechLike) : null)) {}

  static duration(text: string) { return Math.max(2.0, 0.066 * text.length + 0.9); }

  say(line: Line): boolean {
    const pr = line.priority ?? 1;
    if (line.key) {
      const last = this.lastKey.get(line.key);
      if (last !== undefined && this.clock - last < (line.cooldown ?? 8)) return false;
      this.lastKey.set(line.key, this.clock);
    }
    // identical text already queued/current → skip
    if (this.current?.text === line.text || this.queue.some(q => q.line.text === line.text)) return false;
    // keep the queue bounded; drop old chatter first
    if (this.queue.length >= 8) {
      const idx = this.queue.findIndex(q => (q.line.priority ?? 1) <= 0);
      if (idx >= 0) this.queue.splice(idx, 1); else if (pr <= 1) return false; else this.queue.shift();
    }
    this.queue.push({ line, at: this.clock });
    this.queue.sort((a, b) => (b.line.priority ?? 1) - (a.line.priority ?? 1) || a.at - b.at);
    if (this.current && pr === 3 && this.current.priority < 3) this.interrupt();
    if (!this.current) this.next();
    return true;
  }

  private interrupt() {
    if (!this.current) return;
    this.speech?.cancel();
    this.audio?.radioClick(false);
    // important lines that were cut off get replayed afterwards
    if (this.current.priority >= 2) this.queue.push({ line: { speaker: this.current.speaker, text: this.current.text, priority: 2 as const, radio: this.current.radio }, at: this.clock });
    this.current = null;
  }

  private next() {
    const n = this.queue.shift();
    if (!n) { this.current = null; this.onSubtitle?.(null); return; }
    const l = n.line;
    const radio = l.radio ?? (l.speaker !== 'SYSTEM' && l.speaker !== 'Narrator');
    const garbled = radio && this.interference > 0.35 && l.speaker === 'Specter-2' && (l.priority ?? 1) < 3;
    const total = DialogueSystem.duration(l.text);
    this.current = { speaker: l.speaker, text: garbled ? this.garble(l.text) : l.text, priority: l.priority ?? 1, total, remaining: total, radio, garbled };
    this.history.push({ t: this.clock, speaker: l.speaker, text: l.text });
    if (this.history.length > 300) this.history.shift();
    if (radio) this.audio?.radioClick(true);
    this.speak(l, total);
    this.onSubtitle?.(this.current);
  }

  /** Interference replaces random words with static so the transmission is audibly/visually degraded. */
  private garble(t: string) {
    return t.split(' ').map((w, i) => ((i * 7 + t.length) % 5 === 0 ? '[static]' : w)).join(' ');
  }

  private speak(l: Line, total: number) {
    const radio = this.current?.radio;
    if (this.voiceEnabled && this.speech && l.speaker !== 'SYSTEM' && typeof SpeechSynthesisUtterance !== 'undefined') {
      try {
        this.voices ??= this.speech.getVoices();
        const u = new SpeechSynthesisUtterance(this.current!.text);
        u.lang = 'en-US';
        const pick = (re: RegExp) => this.voices!.find(v => re.test(v.name) && v.lang.startsWith('en'));
        const v = l.speaker === 'Specter-2' ? pick(/zira|female|samantha|aria|jenny|hazel/i) : l.speaker === 'Ground Control' ? pick(/david|mark|george|guy|male/i) : pick(/david|mark|guy|ryan|male/i);
        if (v) (u as unknown as { voice: unknown }).voice = v;
        u.pitch = l.speaker === 'Specter-2' ? 1.18 : l.speaker === 'Ground Control' ? 0.8 : 0.95;
        u.rate = Math.min(1.5, Math.max(0.9, (0.066 * l.text.length) / (total - 0.9) * 1.0));
        u.volume = 0.9;
        this.speech.speak(u);
        return;
      } catch { /* fall back to babble below */ }
    }
    if (this.audio && l.speaker !== 'SYSTEM') this.audio.radioBabble(l.speaker, l.text, total - 0.3);
  }

  update(dt: number) {
    if (this.paused) return;
    this.clock += dt;
    if (!this.current) { if (this.queue.length) this.next(); return; }
    this.current.remaining -= dt;
    if (this.current.remaining <= 0) {
      if (this.current.radio) this.audio?.radioClick(false);
      this.current = null; this.onSubtitle?.(null);
      if (this.queue.length) this.next();
    }
  }
  pause() { this.paused = true; this.speech?.pause?.(); }
  resume() { this.paused = false; this.speech?.resume?.(); }
  clear() { this.queue.length = 0; this.current = null; this.speech?.cancel(); this.onSubtitle?.(null); this.lastKey.clear(); }
  get busy() { return !!this.current || this.queue.length > 0; }
}
