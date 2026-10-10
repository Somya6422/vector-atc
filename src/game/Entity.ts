import * as THREE from 'three';
import type { AircraftConfig } from '../flight/AircraftConfig';
import { FlightModel, type WorldQuery } from '../flight/FlightModel';
import type { AircraftVisual } from '../flight/AircraftMesh';

export type Side = 'player' | 'friendly' | 'hostile';
export type Id = 'ownship' | 'wingman' | 'drone1' | 'drone2' | string;

const _f = new THREE.Vector3(), _d = new THREE.Vector3();

/** A flying unit: same physics body for player, wingman and bandits. */
export class Unit {
  readonly model: FlightModel;
  visual: AircraftVisual | null = null;
  gunAmmo: number;
  flares: number;
  irMissiles: number;
  radarMissiles: number;
  gunCooldown = 0;
  flareCooldown = 0;
  chaffUntil = 0;
  lastDamagedBy: Unit | null = null;
  /** incoming-damage multiplier (the AI wingman is built a little sturdier than the player so the story stays about protecting her, not babysitting) */
  damageScale = 1;
  shotsFired = 0; hits = 0; kills = 0;
  removed = false;
  /** dormant units exist but are inactive: not simulated, rendered or targetable (e.g. drones before the intercept phase) */
  dormant = false;
  /** hostile units start as unidentified radar contacts */
  identified: boolean;
  /** a human-readable label for HUD */
  constructor(readonly id: Id, readonly callsign: string, readonly side: Side, readonly cfg: AircraftConfig, world: WorldQuery, seed = 1) {
    this.model = new FlightModel(cfg, world, seed);
    this.gunAmmo = cfg.gunAmmo; this.flares = cfg.flares; this.irMissiles = cfg.irMissiles; this.radarMissiles = cfg.radarMissiles;
    this.identified = side !== 'hostile';
  }
  get pos() { return this.model.pos; }
  get vel() { return this.model.vel; }
  get alive() { return !this.model.crashed && this.model.health > 0 && !this.removed && !this.dormant; }
  get health() { return this.model.health; }
  get healthFrac() { return Math.max(0, this.model.health / this.cfg.hullHealth); }
  forward(out = new THREE.Vector3()) { return this.model.forward(out); }

  /** Infrared output seen from `from` – rear aspect and afterburner are hottest. */
  heat(from: THREE.Vector3): number {
    const m = this.model;
    _d.copy(this.pos).sub(from).normalize();
    m.forward(_f);
    const rear = Math.max(0, _f.dot(_d));            // 1 when the observer is directly behind
    const aspect = 0.3 + 0.7 * rear;
    const engine = 0.3 + 0.7 * m.thrustFraction + (m.afterburner ? 1.2 : 0);
    return this.cfg.irSignature * engine * aspect;
  }
  get callsignShort() { return this.callsign; }
  get isMissileTarget() { return this.alive; }
}

export interface Contact { unit: Unit; range: number; offBoresight: number; inScan: boolean; los: boolean; closure: number; }
