export type GameStateId =
  | 'BOOT' | 'MAIN_MENU' | 'PILOT_SELECTION' | 'HANGAR' | 'MISSION_BRIEFING' | 'LOADING'
  | 'TAKEOFF' | 'ACTIVE_MISSION' | 'PAUSED' | 'DEBRIEFING' | 'MISSION_FAILED';

/** Explicit transition table – anything else is rejected (no double-launch, no skipping the briefing, etc.). */
const TABLE: Record<GameStateId, GameStateId[]> = {
  BOOT: ['MAIN_MENU'],
  MAIN_MENU: ['PILOT_SELECTION', 'HANGAR', 'MISSION_BRIEFING'],
  PILOT_SELECTION: ['MAIN_MENU', 'HANGAR'],
  HANGAR: ['MAIN_MENU', 'MISSION_BRIEFING'],
  MISSION_BRIEFING: ['HANGAR', 'MAIN_MENU', 'LOADING'],
  LOADING: ['TAKEOFF', 'MAIN_MENU'],
  TAKEOFF: ['ACTIVE_MISSION', 'PAUSED', 'MISSION_FAILED', 'DEBRIEFING'],
  ACTIVE_MISSION: ['PAUSED', 'DEBRIEFING', 'MISSION_FAILED'],
  PAUSED: ['TAKEOFF', 'ACTIVE_MISSION', 'MISSION_BRIEFING', 'HANGAR', 'MAIN_MENU'],
  DEBRIEFING: ['HANGAR', 'MAIN_MENU'],
  MISSION_FAILED: ['MISSION_BRIEFING', 'HANGAR', 'MAIN_MENU'],
};

export type StateListener = (to: GameStateId, from: GameStateId) => void;

export class GameStateMachine {
  private _state: GameStateId = 'BOOT';
  private _resume: GameStateId | null = null;
  private listeners = new Set<StateListener>();
  readonly log: string[] = [];

  get state() { return this._state; }
  get resumeState() { return this._resume; }
  can(to: GameStateId) {
    if (this._state === 'PAUSED' && (to === 'TAKEOFF' || to === 'ACTIVE_MISSION')) return to === this._resume;
    return TABLE[this._state].includes(to);
  }
  /** Returns true if the transition happened. Invalid transitions are rejected and logged. */
  go(to: GameStateId): boolean {
    if (to === this._state) { this.log.push(`ignored duplicate ${to}`); return false; }
    if (!this.can(to)) { this.log.push(`REJECTED ${this._state} -> ${to}`); return false; }
    const from = this._state;
    if (to === 'PAUSED') this._resume = from;
    if (from === 'PAUSED' && (to === 'TAKEOFF' || to === 'ACTIVE_MISSION')) { /* resume */ }
    if (to !== 'PAUSED' && from === 'PAUSED') this._resume = null;
    this._state = to;
    this.log.push(`${from} -> ${to}`);
    if (this.log.length > 200) this.log.shift();
    for (const l of [...this.listeners]) l(to, from);
    return true;
  }
  /** Subscribe once; the returned function removes the listener. Re-subscribing the same function does not duplicate it. */
  subscribe(fn: StateListener): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  get listenerCount() { return this.listeners.size; }
  get inFlight() { return this._state === 'TAKEOFF' || this._state === 'ACTIVE_MISSION'; }
}
