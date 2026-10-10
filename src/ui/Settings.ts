import type { StorageLike } from '../persistence/SaveManager';

export interface SettingsData {
  master: number; engines: number; weapons: number; dialogue: number; radio: number; music: number; environment: number;
  voice: boolean;            // speech synthesis for radio voices (subtitles always on)
  subtitleSize: number;      // 0.8..1.6
  quality: 'low' | 'medium' | 'high';
  invertPitch: boolean;
  metric: boolean;           // altitude in metres on the HUD
  hintLevel: 0 | 1 | 2 | 3;  // 0 off, 1 subtle, 2 helpful, 3 direct
  debug: boolean;
  mouseGun: boolean;
  mouseFlight: boolean;      // nose follows the mouse cursor
  voiceAutoSend: boolean;    // send dictated (burst) text without pressing Enter
  voiceKeepFocus: boolean;   // keep the command field focused after sending (voice-only play)
}

export const DEFAULT_SETTINGS: SettingsData = {
  master: 0.8, engines: 0.7, weapons: 0.8, dialogue: 0.9, radio: 0.8, music: 0.35, environment: 0.6,
  voice: true, subtitleSize: 1, quality: 'medium', invertPitch: false, metric: false, hintLevel: 1, debug: false, mouseGun: true, mouseFlight: false, voiceAutoSend: true, voiceKeepFocus: false,
};
const KEY = 'vantage-zero.settings.v1';

export class Settings {
  data: SettingsData = { ...DEFAULT_SETTINGS };
  private listeners = new Set<(s: SettingsData) => void>();
  constructor(private store: StorageLike | null) { this.load(); }

  load() {
    try {
      const t = this.store?.getItem(KEY);
      if (!t) return;
      this.data = Settings.sanitize(JSON.parse(t));
    } catch { this.data = { ...DEFAULT_SETTINGS }; }
  }
  static sanitize(raw: unknown): SettingsData {
    const out = { ...DEFAULT_SETTINGS };
    if (!raw || typeof raw !== 'object') return out;
    const r = raw as Record<string, unknown>;
    for (const k of ['master', 'engines', 'weapons', 'dialogue', 'radio', 'music', 'environment'] as const) if (typeof r[k] === 'number' && Number.isFinite(r[k])) out[k] = Math.max(0, Math.min(1, r[k] as number));
    for (const k of ['voice', 'invertPitch', 'metric', 'debug', 'mouseGun', 'mouseFlight', 'voiceAutoSend', 'voiceKeepFocus'] as const) if (typeof r[k] === 'boolean') out[k] = r[k] as boolean;
    if (typeof r.subtitleSize === 'number') out.subtitleSize = Math.max(0.8, Math.min(1.6, r.subtitleSize));
    if (r.quality === 'low' || r.quality === 'medium' || r.quality === 'high') out.quality = r.quality;
    if (r.hintLevel === 0 || r.hintLevel === 1 || r.hintLevel === 2 || r.hintLevel === 3) out.hintLevel = r.hintLevel;
    return out;
  }
  set<K extends keyof SettingsData>(k: K, v: SettingsData[K]) {
    this.data[k] = v;
    try { this.store?.setItem(KEY, JSON.stringify(this.data)); } catch { /* storage unavailable */ }
    for (const l of this.listeners) l(this.data);
  }
  onChange(fn: (s: SettingsData) => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
}
