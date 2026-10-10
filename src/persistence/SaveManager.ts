export type Route = 'A_BOY_SU57' | 'B_GIRL_F35';
export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

export interface MissionRecord { completed: boolean; grade: Grade; bestScore: number; plays: number; lastOutcome: string; }
export interface SaveData {
  version: 1;
  route: Route | null;
  missions: Record<string, MissionRecord>;
  unlocked: string[];          // cosmetics / missions
  livery: string;
  relationship: number;        // 0..100 trust between Specter-1 and Specter-2
  flags: Record<string, boolean>;
  savedAt: number;
}

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; }
export const SAVE_KEY = 'vantage-zero.save.v1';
const GRADES: Grade[] = ['S', 'A', 'B', 'C', 'D', 'F'];

export function freshSave(): SaveData {
  return { version: 1, route: null, missions: {}, unlocked: ['livery_default'], livery: 'livery_default', relationship: 40, flags: {}, savedAt: 0 };
}

/** Validates + sanitises untrusted JSON. Returns null when structurally unusable. */
export function validateSave(raw: unknown): SaveData | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1) return null;
  const out = freshSave();
  if (r.route === 'A_BOY_SU57' || r.route === 'B_GIRL_F35' || r.route === null) out.route = r.route as Route | null; else return null;
  if (r.missions && typeof r.missions === 'object') {
    for (const [k, v] of Object.entries(r.missions as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const m = v as Record<string, unknown>;
      const grade = GRADES.includes(m.grade as Grade) ? (m.grade as Grade) : 'F';
      const rec: MissionRecord = {
        completed: m.completed === true, grade,
        bestScore: Number.isFinite(m.bestScore) ? Math.max(0, Math.min(1e6, m.bestScore as number)) : 0,
        plays: Number.isFinite(m.plays) ? Math.max(0, Math.floor(m.plays as number)) : 0,
        lastOutcome: typeof m.lastOutcome === 'string' ? m.lastOutcome.slice(0, 40) : '',
      };
      out.missions[k.slice(0, 32)] = rec;
    }
  }
  if (Array.isArray(r.unlocked)) out.unlocked = Array.from(new Set(['livery_default', ...r.unlocked.filter((x): x is string => typeof x === 'string').slice(0, 50)]));
  if (typeof r.livery === 'string' && out.unlocked.includes(r.livery)) out.livery = r.livery;
  const num = (v: unknown, d: number) => (Number.isFinite(v) ? Math.max(0, Math.min(100, v as number)) : d);
  out.relationship = num(r.relationship, 40);
  if (r.flags && typeof r.flags === 'object') for (const [k, v] of Object.entries(r.flags as Record<string, unknown>)) if (typeof v === 'boolean') out.flags[k.slice(0, 40)] = v;
  out.savedAt = Number.isFinite(r.savedAt) ? (r.savedAt as number) : 0;
  return out;
}

export type LoadStatus = 'ok' | 'missing' | 'corrupt';

export class SaveManager {
  data: SaveData = freshSave();
  status: LoadStatus = 'missing';
  constructor(private store: StorageLike | null) {}

  load(): LoadStatus {
    try {
      const txt = this.store?.getItem(SAVE_KEY) ?? null;
      if (txt === null) { this.data = freshSave(); return (this.status = 'missing'); }
      const v = validateSave(JSON.parse(txt));
      if (!v) throw new Error('invalid');
      this.data = v; return (this.status = 'ok');
    } catch {
      try { const bad = this.store?.getItem(SAVE_KEY); if (bad) this.store?.setItem(SAVE_KEY + '.corrupt', bad); } catch { /* ignore */ }
      this.data = freshSave(); return (this.status = 'corrupt');
    }
  }
  save(): boolean {
    this.data.savedAt = Date.now();
    try { this.store?.setItem(SAVE_KEY, JSON.stringify(this.data)); return !!this.store; } catch { return false; }
  }
  get hasCampaign() { return this.data.route !== null; }
  newCampaign(route: Route) { this.data = freshSave(); this.data.route = route; this.save(); }
  setRoute(route: Route) { this.data.route = route; this.save(); }

  /**
   * Records a mission result. Replays only improve the personal-best score; they never touch the story
   * flags / relationship / unlocks of the primary campaign (which are written on first completion only).
   */
  recordMission(id: string, res: { completed: boolean; grade: Grade; score: number; outcome: string; relationshipDelta?: number; unlocks?: string[]; flags?: Record<string, boolean> }) {
    const prev = this.data.missions[id];
    const first = !prev || !prev.completed;
    const rec: MissionRecord = prev ?? { completed: false, grade: 'F', bestScore: 0, plays: 0, lastOutcome: '' };
    rec.plays++;
    rec.lastOutcome = res.outcome;
    if (res.completed) {
      if (first || GRADES.indexOf(res.grade) < GRADES.indexOf(rec.grade)) rec.grade = res.grade;
      rec.completed = true;
      if (first) {
        this.data.relationship = Math.max(0, Math.min(100, this.data.relationship + (res.relationshipDelta ?? 0)));
        for (const u of res.unlocks ?? []) if (!this.data.unlocked.includes(u)) this.data.unlocked.push(u);
        Object.assign(this.data.flags, res.flags ?? {});
      }
    }
    rec.bestScore = Math.max(rec.bestScore, res.score);
    this.data.missions[id] = rec;
    this.save();
  }
  isCompleted(id: string) { return this.data.missions[id]?.completed === true; }
  availableMissions(): string[] { return this.hasCampaign ? ['m01', 'm02', 'm03', 'survival', 'school'] : []; }
}
