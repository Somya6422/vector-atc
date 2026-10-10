import * as THREE from 'three';
import type { Unit } from '../game/Entity';
import type { Weapons } from '../combat/Weapons';
import { Autopilot } from '../flight/Autopilot';
import type { FlightControls } from '../flight/FlightModel';
import { ManeuverExecutor, terrainAvoid, type ManeuverKind } from './Maneuvers';
import { DEG, Rng, clamp } from '../util/math';
import { lineOfSight, terrainHeight } from '../world/Heightfield';
import { MISSILES } from '../combat/WeaponSpecs';
import { computeLead } from '../combat/TargetingSystem';

export type BanditState = 'PATROL' | 'INTERCEPT' | 'DOGFIGHT' | 'DEFENSIVE_BREAK';

export interface BanditContext {
  now: number;
  weapons: Weapons;
  enemies: Unit[];           // player-side units
  alerted: boolean;          // radar network has detected the formation
  jamming: number;
}

const _d = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3();

/** Hierarchical enemy AI: PATROL → INTERCEPT → DOGFIGHT → DEFENSIVE_BREAK. Moves only via the flight model. */
export class BanditAI {
  state: BanditState = 'PATROL';
  target: Unit | null = null;
  readonly ap = new Autopilot();
  readonly man = new ManeuverExecutor();
  stateTime = 0;
  detectTimer = 0;
  lockTimer = 0;
  missileCooldown = 8;
  breakReason = '';
  private wp = 0;
  private rng: Rng;
  private threatSide = 1;
  private nextManeuverAt = 0;
  private disengaged = false;
  readonly log: string[] = [];
  /** Preferred target index (drone1 -> player, drone2 -> wingman) */
  constructor(readonly self: Unit, private patrol: { x: number; z: number; alt: number }[], seed = 1, private preferId: string | null = null) {
    this.rng = new Rng(seed);
  }

  private setState(s: BanditState, why = '') {
    if (s === this.state) return;
    this.log.push(`${this.state}->${s}${why ? ' (' + why + ')' : ''}`); if (this.log.length > 40) this.log.shift();
    this.state = s; this.stateTime = 0;
  }

  /** Perception: forward detection cone + LOS, with a reaction delay. Radar-network alert grants awareness. */
  private perceive(ctx: BanditContext): Unit | null {
    let best: Unit | null = null, bd = 1e12;
    for (const e of ctx.enemies) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(this.self.pos);
      const range = (ctx.alerted ? 30000 : 24000) * Math.pow(e.cfg.rcs / 0.1, 0.25) * (1 - ctx.jamming * 0.3);
      if (d > Math.min(range, 38000)) continue;
      _d.copy(e.pos).sub(this.self.pos).normalize();
      this.self.forward(_e);
      const inCone = _e.dot(_d) > Math.cos(100 * DEG) || ctx.alerted;
      if (!inCone) continue;
      if (!lineOfSight(this.self.pos.x, this.self.pos.y, this.self.pos.z, e.pos.x, e.pos.y, e.pos.z, 300)) continue;
      const score = d * (this.preferId && e.id === this.preferId ? 0.55 : 1);
      if (score < bd) { bd = score; best = e; }
    }
    return best;
  }

  update(dt: number, ctx: BanditContext): FlightControls {
    const me = this.self, m = me.model;
    this.stateTime += dt; this.missileCooldown -= dt;
    if (!me.alive) return { pitch: 0, roll: 0, yaw: 0, throttle: 0, airbrake: false, gearDown: false };

    // ---- threat assessment ----
    // the drone's warning receiver reports IR launches inside ~5 km and radar missiles only once their seeker is active (or very close)
    const missiles = ctx.weapons.threatsTo(me).filter(mm => (mm.spec.id === 'IR' ? mm.pos.distanceTo(me.pos) < 5000 : mm.active || mm.pos.distanceTo(me.pos) < 6000));
    let gunThreat: Unit | null = null;
    for (const e of ctx.enemies) {
      if (!e.alive) continue;
      const d = e.pos.distanceTo(me.pos);
      if (d < 1600) { _d.copy(me.pos).sub(e.pos).normalize(); e.forward(_e); if (_e.dot(_d) > Math.cos(14 * DEG)) { gunThreat = e; break; } }
    }
    const seen = this.perceive(ctx);
    if (seen) this.detectTimer += dt; else this.detectTimer = Math.max(0, this.detectTimer - dt * 0.5);
    if (seen && this.detectTimer > 2.5) this.target = seen;
    else if (this.target && !this.target.alive) this.target = null;

    // ---- state transitions ----
    const hurt = me.healthFrac < 0.4;
    const noWeapons = me.irMissiles <= 0;
    if ((missiles.length || gunThreat || hurt) && this.state !== 'DEFENSIVE_BREAK' && this.man.done) {
      this.breakReason = missiles.length ? 'MISSILE' : gunThreat ? 'GUN' : 'DAMAGE';
      this.threatSide = this.pickSide(missiles[0]?.pos ?? gunThreat?.pos ?? me.pos);
      this.setState('DEFENSIVE_BREAK', this.breakReason);
    }
    switch (this.state) {
      case 'PATROL':
        if (this.target || ctx.alerted && ctx.enemies.some(e => e.alive)) { this.target ??= this.nearestEnemy(ctx); if (this.target) this.setState('INTERCEPT', ctx.alerted ? 'alerted' : 'detected'); }
        break;
      case 'INTERCEPT':
        if (!this.target) { if (this.stateTime > 20) this.setState('PATROL', 'lost contact'); }
        else if (this.target.pos.distanceTo(me.pos) < 4200) this.setState('DOGFIGHT', 'merge');
        break;
      case 'DOGFIGHT':
        if (!this.target) this.setState('PATROL', 'lost target');
        else if (this.target.pos.distanceTo(me.pos) > 9000) this.setState('INTERCEPT', 'separated');
        break;
      case 'DEFENSIVE_BREAK':
        if (!missiles.length && !gunThreat && !hurt && this.man.done && this.stateTime > 4) this.setState(this.target ? 'INTERCEPT' : 'PATROL', 'clear');
        break;
    }
    if (noWeapons && !hurt && this.state !== 'DEFENSIVE_BREAK') this.disengaged = true;

    // ---- terrain avoidance always wins ----
    const tAv = terrainAvoid(me.model, this.ap, dt, 280);
    if (tAv) { this.man.cancel(); return tAv; }

    // ---- behaviours ----
    switch (this.state) {
      case 'PATROL': return this.patrolControls(dt);
      case 'INTERCEPT': return this.pursue(dt, ctx, false);
      case 'DOGFIGHT': return this.pursue(dt, ctx, true);
      case 'DEFENSIVE_BREAK': return this.defend(dt, ctx, missiles.length ? missiles[0].pos : gunThreat?.pos ?? null, missiles.length > 0);
    }
  }

  private nearestEnemy(ctx: BanditContext): Unit | null {
    let best: Unit | null = null, bd = 1e12;
    for (const e of ctx.enemies) if (e.alive) { const d = e.pos.distanceTo(this.self.pos); if (d < bd) { bd = d; best = e; } }
    return best;
  }
  private pickSide(threat: THREE.Vector3): number {
    const m = this.self.model;
    m.rightVec(_e); _d.copy(threat).sub(m.pos);
    return _e.dot(_d) >= 0 ? 1 : -1;       // turn toward the threat side to get the nose onto it / beam it
  }

  private patrolControls(dt: number): FlightControls {
    const m = this.self.model;
    const p = this.patrol[this.wp % this.patrol.length];
    const dx = p.x - m.pos.x, dz = p.z - m.pos.z;
    if (Math.hypot(dx, dz) < 1800) this.wp++;
    const hdg = Math.atan2(dx, -dz);
    const alt = Math.max(p.alt, terrainHeight(m.pos.x, m.pos.z) + 450);
    const gam = clamp((alt - m.pos.y) * 0.0009, -8 * DEG, 8 * DEG);
    return this.ap.navigate(m, hdg, gam, 185, dt, { bankMax: 45 * DEG });
  }

  private pursue(dt: number, ctx: BanditContext, close: boolean): FlightControls {
    const me = this.self, m = me.model, t = this.target;
    if (!t) return this.patrolControls(dt);
    const range = t.pos.distanceTo(me.pos);
    if (this.disengaged && !close) {
      // out of ordnance: egress north, away from the fight
      return this.ap.navigate(m, 0, 4 * DEG, 260, dt, { bankMax: 60 * DEG });
    }
    // lead pursuit
    const lead = computeLead(me.pos, me.vel, t.pos, t.vel, Math.max(m.tas + 300, 450));
    _f.copy(lead.aim).sub(me.pos);
    // stay above the terrain while chasing downhill targets
    const aimAlt = Math.max(lead.aim.y, terrainHeight(lead.aim.x, lead.aim.z) + 350);
    _f.y += aimAlt - lead.aim.y;
    _f.normalize();
    // energy management: if slow, unload (nose low) to regain speed
    let pull = close ? 1 : 0.7;
    if (m.tas < 150) { _f.y = Math.min(_f.y, -0.2); _f.normalize(); pull = 0.6; }
    const ctl = this.ap.pointAt(m, _f, pull, close ? 250 : 270, dt, !close && range > 9000);
    // missile employment (IR) – needs the target in the seeker cone and a lock period
    _d.copy(t.pos).sub(me.pos); const rng = _d.length(); _d.normalize(); me.forward(_e);
    const off = Math.acos(clamp(_e.dot(_d), -1, 1));
    if (me.irMissiles > 0 && this.missileCooldown <= 0 && rng < MISSILES.IR.launchMaxRange * 0.85 && rng > 1200 && off < MISSILES.IR.lockCone && t.alive) {
      this.lockTimer += dt;
      if (this.lockTimer > 1.6 + this.rng.next()) {
        ctx.weapons.launch(me, t, 'IR'); this.missileCooldown = 22; this.lockTimer = 0;
        this.log.push(`launch IR at ${t.id}`);
      }
    } else this.lockTimer = Math.max(0, this.lockTimer - dt);
    return ctl;
  }

  private defend(dt: number, ctx: BanditContext, threatPos: THREE.Vector3 | null, missile: boolean): FlightControls {
    const me = this.self, m = me.model;
    // countermeasures on incoming missiles
    if (missile) {
      const mm = ctx.weapons.nearestThreat(me);
      if (mm && mm.pos.distanceTo(me.pos) < 3200 && ctx.weapons.dropFlares(me, ctx.now)) this.log.push('flares');
    }
    if (this.man.done && ctx.now >= this.nextManeuverAt) {
      const pick: ManeuverKind[] = missile ? ['BREAK_TURN', 'BARREL_ROLL', 'SPLIT_S'] : ['BARREL_ROLL', 'IMMELMANN', 'BREAK_TURN', 'SPLIT_S', 'ENERGY_CLIMB'];
      const feasible = pick.filter(k => ManeuverExecutor.feasible(k, m));
      const kind = feasible.length ? feasible[Math.floor(this.rng.next() * feasible.length)] : 'ENERGY_CLIMB';
      this.man.begin(kind, m, threatPos ? this.pickSide(threatPos) : 1);
      this.nextManeuverAt = ctx.now + 0.6;
      this.log.push(`maneuver ${kind}`);
    }
    if (!this.man.done) return this.man.step(m, dt);
    return this.ap.navigate(m, m.heading * DEG, 0, 240, dt, { bankMax: 70 * DEG });
  }
}
