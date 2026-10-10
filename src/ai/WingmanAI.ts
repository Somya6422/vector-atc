import * as THREE from 'three';
import type { Unit } from '../game/Entity';
import type { Weapons } from '../combat/Weapons';
import { Autopilot } from '../flight/Autopilot';
import type { FlightControls } from '../flight/FlightModel';
import { ManeuverExecutor, terrainAvoid, type ManeuverKind } from './Maneuvers';
import { DEG, KT, Rng, clamp } from '../util/math';
import { FIELD_ELEV, RUNWAY, cxMain, lineOfSight, terrainHeight } from '../world/Heightfield';
import { AIM_OFFSET, GLIDE_DEG, approachInfo, centrelineHeading } from '../world/Landing';
import { MISSILES } from '../combat/WeaponSpecs';
import { computeLead } from '../combat/TargetingSystem';

export type WingmanState = 'HOLD' | 'TAKEOFF' | 'FORMATION' | 'COVER' | 'ENGAGE' | 'REJOIN' | 'DEFENSIVE' | 'RTB' | 'LAND' | 'PARKED';
export type Formation = 'ECHELON_RIGHT' | 'LINE_ABREAST' | 'TRAIL';
export const FORMATIONS: Formation[] = ['ECHELON_RIGHT', 'LINE_ABREAST', 'TRAIL'];
export const FORMATION_LABEL: Record<Formation, string> = { ECHELON_RIGHT: 'ECHELON RIGHT', LINE_ABREAST: 'LINE ABREAST', TRAIL: 'TRAIL' };
export type WingmanCall = 'ENGAGING' | 'THREAT' | 'MISSILE' | 'DAMAGE' | 'REJOINING' | 'KILL' | 'FLARES' | 'RTB' | 'LOST_VISUAL' | 'VISUAL' | 'COVERING' | 'WINCHESTER';

export interface WingmanContext {
  now: number;
  leader: Unit;
  weapons: Weapons;
  hostiles: Unit[];
  playerTarget: Unit | null;
  interference: number;      // 0..1 electronic interference level affecting her sensors
  rtb: boolean;              // mission says go home
  leaderRolling: boolean;    // the leader has started the take-off roll
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _slot = new THREE.Vector3();

export function formationOffset(f: Formation): { right: number; back: number; up: number } {
  switch (f) {
    case 'ECHELON_RIGHT': return { right: 150, back: 130, up: 0 };
    case 'LINE_ABREAST': return { right: 220, back: 0, up: 0 };
    case 'TRAIL': return { right: 0, back: 650, up: -15 };
  }
}

/** AI wingman. Real aircraft, real physics; commands 1/2/3 change its genuine behaviour. */
export class WingmanAI {
  state: WingmanState = 'HOLD';
  formation: Formation = 'ECHELON_RIGHT';
  orderedState: 'COVER' | 'ENGAGE' | 'FORMATION' = 'FORMATION';
  target: Unit | null = null;
  readonly ap = new Autopilot();
  readonly man = new ManeuverExecutor();
  stateTime = 0;
  separation = 0;
  onCall?: (c: WingmanCall, detail?: string) => void;
  /** perceived leader offset error produced by electronic interference (m) */
  readonly sensorError = new THREE.Vector3();
  private rng = new Rng(99);
  private missileCooldown = 4;
  private lastCall = new Map<WingmanCall, number>();
  private lockTimer = 0;
  private lostVisual = false;
  private damageReported = 0;
  private winchester = false;
  private nextManeuverAt = 0;
  readonly log: string[] = [];

  constructor(readonly self: Unit) {}

  private call(c: WingmanCall, now: number, detail?: string, gap = 8) {
    const last = this.lastCall.get(c) ?? -99;
    if (now - last < gap) return;
    this.lastCall.set(c, now); this.onCall?.(c, detail);
  }
  private setState(s: WingmanState, why = '') {
    if (s === this.state) return;
    this.log.push(`${this.state}->${s}${why ? ' (' + why + ')' : ''}`); if (this.log.length > 40) this.log.shift();
    this.state = s; this.stateTime = 0;
  }

  // ---- radio commands -------------------------------------------------
  /** `1` Cover Me / Defensive */  commandCover() { this.orderedState = 'COVER'; if (this.canFight()) this.setState('COVER', 'cmd 1'); }
  /** `2` Engage Target / Offensive */  commandEngage(t: Unit | null) { this.orderedState = 'ENGAGE'; this.target = t; if (this.canFight()) this.setState('ENGAGE', 'cmd 2'); }
  /** `3` Rejoin Formation */  commandRejoin() { this.orderedState = 'FORMATION'; this.target = null; this.setState('REJOIN', 'cmd 3'); }
  cycleFormation() { this.formation = FORMATIONS[(FORMATIONS.indexOf(this.formation) + 1) % FORMATIONS.length]; return this.formation; }
  private canFight() { return this.state !== 'HOLD' && this.state !== 'TAKEOFF' && this.state !== 'RTB' && this.state !== 'LAND' && this.state !== 'PARKED'; }

  /** Slot position in world space, using her *perceived* leader position (degraded by interference). */
  slot(leader: Unit, out: THREE.Vector3): THREE.Vector3 {
    const f = formationOffset(this.formation);
    _a.set(leader.vel.x, 0, leader.vel.z);
    if (_a.lengthSq() < 25) leader.forward(_a).setY(0);
    _a.normalize();
    _b.set(-_a.z, 0, _a.x);                          // right of the heading
    out.copy(leader.pos).addScaledVector(_b, f.right).addScaledVector(_a, -f.back);
    out.y += f.up;
    out.add(this.sensorError);
    out.y = Math.max(out.y, terrainHeight(out.x, out.z) + 150);
    return out;
  }

  update(dt: number, ctx: WingmanContext): FlightControls {
    const me = this.self, m = me.model;
    this.stateTime += dt; this.missileCooldown -= dt;
    const idle: FlightControls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, airbrake: true, gearDown: true };
    if (!me.alive) return idle;

    // electronic interference: random-walk position error of the perceived leader + degraded detection
    const target = ctx.interference * 280;
    this.sensorError.x += (this.rng.signed() * target - this.sensorError.x) * dt * 0.8;
    this.sensorError.z += (this.rng.signed() * target - this.sensorError.z) * dt * 0.8;
    this.sensorError.y += (this.rng.signed() * target * 0.3 - this.sensorError.y) * dt * 0.8;
    this.separation = me.pos.distanceTo(ctx.leader.pos);

    // ---- self-preservation ----
    const missiles = ctx.weapons.threatsTo(me);
    if (missiles.length && this.canFight()) {
      this.call('MISSILE', ctx.now, 'incoming', 6);
      if (ctx.weapons.nearestThreat(me)!.pos.distanceTo(me.pos) < 3000 && ctx.weapons.dropFlares(me, ctx.now)) this.call('FLARES', ctx.now, '', 5);
      if (this.state !== 'DEFENSIVE') { this.setState('DEFENSIVE', 'missile'); }
    }
    if (me.healthFrac < 0.65 && this.damageReported < 1) { this.damageReported = 1; this.call('DAMAGE', ctx.now, 'light', 2); }
    if (me.healthFrac < 0.35 && this.damageReported < 2) { this.damageReported = 2; this.call('DAMAGE', ctx.now, 'heavy', 2); if (this.canFight()) this.setState('RTB', 'critical damage'); }
    if (me.irMissiles <= 0 && me.gunAmmo < 20 && !this.winchester) { this.winchester = true; this.call('WINCHESTER', ctx.now); }
    if (me.model.fuel < me.cfg.fuelCapacity * 0.12 && this.canFight()) this.setState('RTB', 'bingo');

    // terrain avoidance is always on – but degrades slightly under interference (later pull-up)
    const floor = 180 + ctx.interference * 120;
    const tav = this.state === 'LAND' || this.state === 'TAKEOFF' || this.state === 'HOLD' ? null : terrainAvoid(m, this.ap, dt, floor);
    if (tav) { this.man.cancel(); return tav; }

    // ---- RTB request from mission ----
    if (ctx.rtb && this.canFight() && this.state !== 'RTB') this.setState('RTB', 'mission rtb');

    switch (this.state) {
      case 'HOLD': {
        if (ctx.leaderRolling) this.setState('TAKEOFF', 'leader rolling');
        return { ...idle, throttle: 0.0 };
      }
      case 'TAKEOFF': return this.takeoff(dt);
      case 'REJOIN': {
        const ctl = this.formationControls(dt, ctx, 1.25);
        if (this.separation < 450 && this.stateTime > 2) this.setState(this.orderedState === 'COVER' ? 'COVER' : 'FORMATION', 'joined');
        this.call('REJOINING', ctx.now, '', 10);
        return ctl;
      }
      case 'FORMATION': case 'COVER': {
        // threat response: COVER defends the leader against hostiles near it; FORMATION only returns fire when engaged
        const near = this.pickThreat(ctx, this.state === 'COVER' ? 3500 : 2200);
        if (near) { this.target = near; this.setState('ENGAGE', 'threat'); this.call('ENGAGING', ctx.now, near.callsign, 6); break; }
        this.announceThreats(ctx);
        return this.formationControls(dt, ctx, this.state === 'COVER' ? 0.9 : 1);
      }
      case 'ENGAGE': return this.engage(dt, ctx);
      case 'DEFENSIVE': {
        if (!missiles.length && this.man.done && this.stateTime > 3.5) this.setState(this.orderedState === 'ENGAGE' && this.target?.alive ? 'ENGAGE' : 'REJOIN', 'clear');
        if (this.man.done && ctx.now >= this.nextManeuverAt) {
          const opts = (['BREAK_TURN', 'BARREL_ROLL', 'SPLIT_S'] as ManeuverKind[]).filter(k => ManeuverExecutor.feasible(k, m));
          this.man.begin(opts.length ? opts[Math.floor(this.rng.next() * opts.length)] : 'ENERGY_CLIMB', m, this.rng.next() < 0.5 ? 1 : -1);
          this.nextManeuverAt = ctx.now + 0.5;
        }
        if (!this.man.done) return this.man.step(m, dt);
        return this.formationControls(dt, ctx, 1);
      }
      case 'RTB': {
        this.call('RTB', ctx.now, '', 30);
        return this.rtb(dt, ctx);
      }
      case 'LAND': return this.land(dt, ctx);
      case 'PARKED': return { ...idle, throttle: 0 };
    }
    return this.formationControls(dt, ctx, 1);
  }

  private announceThreats(ctx: WingmanContext) {
    const me = this.self;
    for (const h of ctx.hostiles) {
      if (!h.alive) continue;
      const d = h.pos.distanceTo(me.pos);
      // interference removes her radar picture entirely at high levels and adds range error otherwise
      const detect = 60000 * Math.pow(h.cfg.rcs, 0.25) * (1 - ctx.interference * 0.85);
      if (d < detect && lineOfSight(me.pos.x, me.pos.y, me.pos.z, h.pos.x, h.pos.y, h.pos.z, 400)) {
        const err = Math.round(d / 1000 * (1 + this.rng.signed() * ctx.interference * 0.6));
        this.call('THREAT', ctx.now, `${h.callsign}|${err}`, 14);
      }
    }
  }

  private pickThreat(ctx: WingmanContext, radius: number): Unit | null {
    const me = this.self;
    let best: Unit | null = null, bd = 1e12;
    for (const h of ctx.hostiles) {
      if (!h.alive) continue;
      const dLeader = h.pos.distanceTo(ctx.leader.pos);
      const detect = 60000 * Math.pow(h.cfg.rcs, 0.25) * (1 - ctx.interference * 0.85);
      if (me.pos.distanceTo(h.pos) > detect) continue;
      if (dLeader < radius || h.pos.distanceTo(me.pos) < radius * 0.7) { if (dLeader < bd) { bd = dLeader; best = h; } }
    }
    return best;
  }

  private formationControls(dt: number, ctx: WingmanContext, aggressive: number): FlightControls {
    const me = this.self, m = me.model, L = ctx.leader.model;
    this.slot(ctx.leader, _slot);
    _c.copy(_slot).sub(me.pos);
    const dist = _c.length();
    const lead = _c.clone().addScaledVector(L.vel, 0.4);
    const hdg = Math.atan2(lead.x, -lead.z);
    const horiz = Math.hypot(_c.x, _c.z);
    // along-track error → speed
    _a.set(L.vel.x, 0, L.vel.z).normalize();
    const along = _c.dot(_a);
    const speed = Math.max(L.tas + clamp(along * 0.18 * aggressive, -70, 110), 100);
    const climb = clamp(Math.atan2(_c.y + L.vel.y * 0.4, Math.max(horiz, 150)), -22 * DEG, 22 * DEG);
    let hdgCmd = hdg;
    if (dist < 160) hdgCmd = L.heading * DEG;                  // close in: match the leader's heading
    const ctl = this.ap.navigate(m, hdgCmd, dist < 160 ? L.flightPathDeg * DEG + climb * 0.5 : climb, speed, dt, { bankMax: 62 * DEG });
    ctl.roll = clamp(ctl.roll, -1, 1);
    // lost visual: interference too high and leader far → admit it
    if (this.separation > 3200 && ctx.interference > 0.25) { if (!this.lostVisual) { this.lostVisual = true; this.call('LOST_VISUAL', ctx.now, '', 15); } }
    else if (this.lostVisual && this.separation < 1800) { this.lostVisual = false; this.call('VISUAL', ctx.now, '', 15); }
    return ctl;
  }

  private takeoff(dt: number): FlightControls {
    const me = this.self, m = me.model;
    const agl = m.pos.y - terrainHeight(m.pos.x, m.pos.z) - me.cfg.gearHeight;
    const kt = m.iasKt;
    // steer to the runway centreline offset (stay on her half)
    const wantX = this.takeoffX;
    const yaw = clamp((wantX - m.pos.x) * 0.02 - (m.heading > 180 ? m.heading - 360 : m.heading) * 0.04, -0.5, 0.5);
    const rotate = kt >= me.cfg.rotationKt;
    let pitch = 0;
    if (rotate && m.onGround) pitch = 0.5;
    if (!m.onGround) {
      pitch = clamp((12 - m.pitchDeg) * 0.08, -0.4, 0.5);
      if (agl > 20) this.gearUp = true;
    }
    if (!m.onGround && agl > 220 && m.iasKt > 190) this.setState('REJOIN', 'airborne');
    return { pitch, roll: clamp(-m.rollDeg * 0.03, -0.5, 0.5), yaw, throttle: 1, airbrake: false, gearDown: !this.gearUp };
  }
  gearUp = false;
  /** lateral position on the runway used by the take-off roll (the wingman holds her half; assists use the centreline) */
  takeoffX = 13;

  private engage(dt: number, ctx: WingmanContext): FlightControls {
    const me = this.self, m = me.model;
    if (!this.target || !this.target.alive) {
      // pick the leader's target or the nearest hostile
      this.target = ctx.playerTarget && ctx.playerTarget.alive ? ctx.playerTarget : ctx.hostiles.filter(h => h.alive).sort((a, b) => a.pos.distanceTo(me.pos) - b.pos.distanceTo(me.pos))[0] ?? null;
      if (!this.target) { this.call('KILL', ctx.now, 'clear', 6); this.setState(this.orderedState === 'COVER' ? 'COVER' : 'REJOIN', 'no target'); return this.formationControls(dt, ctx, 1); }
    }
    const t = this.target;
    // interference degrades her *perceived* target position
    const noise = ctx.interference * 350;
    const tp = _slot.copy(t.pos).add(_b.set(this.rng.signed() * noise, this.rng.signed() * noise * 0.4, this.rng.signed() * noise));
    const lead = computeLead(me.pos, me.vel, tp, t.vel, 1050);
    _c.copy(lead.aim).sub(me.pos);
    const aimAlt = Math.max(lead.aim.y, terrainHeight(lead.aim.x, lead.aim.z) + 300);
    _c.y += aimAlt - lead.aim.y;
    const range = _c.length(); _c.normalize();
    const ctl = this.ap.pointAt(m, _c, 0.95, 240, dt, range > 8000);
    me.forward(_a);
    const off = Math.acos(clamp(_a.dot(_c), -1, 1));
    // guns inside 1000 m, nose on
    if (range < 1100 && off < 2.4 * DEG && me.gunAmmo > 0) ctx.weapons.fireGun(me, dt); else ctx.weapons.releaseTrigger(me);
    // IR missile with a lock-time delay
    if (me.irMissiles > 0 && this.missileCooldown <= 0 && range > 1300 && range < MISSILES.IR.launchMaxRange * 0.9 && off < MISSILES.IR.lockCone) {
      this.lockTimer += dt;
      if (this.lockTimer > 1.4) { ctx.weapons.launch(me, t, 'IR'); this.missileCooldown = 15; this.lockTimer = 0; this.call('ENGAGING', ctx.now, 'Fox-2', 3); }
    } else this.lockTimer = Math.max(0, this.lockTimer - dt);
    if (this.orderedState !== 'ENGAGE') {
      // threat-driven engagement: break off when the leader is clear or the target is far from the leader
      if (t.pos.distanceTo(ctx.leader.pos) > 7000) this.setState('REJOIN', 'target far from leader');
    }
    return ctl;
  }

  /** Runway direction suited to where she is: land toward the field from whichever side she is on. */
  private runwayDir(): boolean {
    const m = this.self.model;
    return m.pos.z > 400 ? true : m.pos.z < -400 ? false : (m.heading < 90 || m.heading > 270);
  }

  private rtb(dt: number, ctx: WingmanContext): FlightControls {
    const me = this.self, m = me.model, L = ctx.leader.model;
    if (this.goAround > 0) {
      this.goAround -= dt;
      const c = this.ap.navigate(m, this.goAroundHdg, 6 * DEG, 95, dt, { bankMax: 15 * DEG });
      c.throttle = Math.max(c.throttle, 0.75); c.gearDown = this.goAround > 18; c.airbrake = false;
      return c;
    }
    const dirNorth = this.runwayDir();
    const info = approachInfo(m.pos.x - 14, m.pos.y, m.pos.z, dirNorth);
    const agl = m.pos.y - terrainHeight(m.pos.x, m.pos.z);
    // capture the final approach when she is lined up on the extended centreline and not too high / fast
    const hdgErr = Math.abs(((m.heading - info.runwayHeading + 540) % 360) - 180);
    if (ctx.rtb && info.dz > 1500 && info.dz < 7000 && Math.abs(info.lateral) < 350 && hdgErr < 30 && info.gsError < 220 && info.gsError > -40 && m.ias < 105 && agl > 80) {
      this.setState('LAND', 'on the approach'); return this.land(dt, ctx);
    }
    const leaderAirborne = !L.onGround && ctx.leader.alive;
    // in trail behind the leader while he is still flying home
    if (ctx.rtb && leaderAirborne && this.separation < 4500 && L.pos.y - terrainHeight(L.pos.x, L.pos.z) > 150) {
      this.formation = 'TRAIL';
      const c = this.formationControls(dt, ctx, 1);
      // follow him down: configure for landing when he does
      c.gearDown = L.gearDown;
      return c;
    }
    // overshot the approach window without being able to capture it (too high / fast): re-enter from the far side
    if (ctx.rtb && info.dz < 1500 && info.dz > -400 && Math.abs(info.lateral) < 900) { this.goAround = 24; this.goAroundHdg = info.runwayHeading * DEG; this.funnel = false; this.log.push('OVERSHOOT'); }
    return this.routeToIaf(dt, dirNorth);
  }

  /** Terrain-safe route to the initial approach fix: valley follow, a turn-around fix south of the field, then a localiser-style funnel onto the centreline. */
  private routeToIaf(dt: number, dirNorth: boolean): FlightControls {
    const m = this.self.model;
    const iaf = this.iaf(dirNorth);
    const info = approachInfo(m.pos.x - 14, m.pos.y, m.pos.z, dirNorth);
    let hdg: number, wantAlt: number, speed = 170, bank = 42 * DEG, gear = false;
    const hdgErr = Math.abs(((m.heading - info.runwayHeading + 540) % 360) - 180);
    // funnel = localiser-style alignment onto the extended centreline; latched so it cannot flip-flop at its edge
    const preFix = { x: 0, z: iaf.z + 3800 };
    const inRegion = info.dz > 300 && info.dz < (dirNorth ? 11000 : 8000) && hdgErr < 100;
    if (!this.funnel && (inRegion || (dirNorth && Math.hypot(m.pos.x - preFix.x, m.pos.z - preFix.z) < 1300))) this.funnel = true;
    if (this.funnel && (info.dz < 150 || (hdgErr > 100 && !dirNorth) || Math.abs(info.lateral) > 4500)) this.funnel = false;
    const inFunnel = this.funnel;
    if (inFunnel) {
      hdg = centrelineHeading(info) * DEG;
      const lookX = m.pos.x + Math.sin(hdg) * 1500, lookZ = m.pos.z - Math.cos(hdg) * 1500;
      let ground = terrainHeight(m.pos.x, m.pos.z); for (let k = 1; k <= 6; k++) ground = Math.max(ground, terrainHeight(m.pos.x + (lookX - m.pos.x) * k / 6, m.pos.z + (lookZ - m.pos.z) * k / 6));
      // never climb for the profile; descend toward just above the glidepath once pointing at the runway
      const profile = info.gsAlt + 60;
      wantAlt = hdgErr > 90 ? Math.max(m.pos.y, ground + 330) : Math.max(ground + 220, Math.min(profile, m.pos.y));
      speed = hdgErr > 90 ? 100 : 78; bank = hdgErr > 60 ? 55 * DEG : 32 * DEG; gear = info.dz < 8200;
    } else {
      let tx = iaf.x, tz = iaf.z;
      if (!dirNorth) { tz = Math.min(iaf.z, m.pos.z + 3000); tx = cxMain(tz); }                          // north of the field: follow the valley south
      else { tz = iaf.z + 3800; tx = 0; speed = 110; bank = 60 * DEG; }                                    // go beyond the south fix, then turn back north
      hdg = Math.atan2(tx - m.pos.x, -(tz - m.pos.z));
      let ground = 0; for (let k = 0; k <= 8; k++) ground = Math.max(ground, terrainHeight(m.pos.x + (tx - m.pos.x) * k / 8, m.pos.z + (tz - m.pos.z) * k / 8));
      // descent profile toward the fix (4 deg), never below terrain clearance, never climbing for it
      const toIaf = Math.hypot(iaf.x - m.pos.x, iaf.z - m.pos.z);
      const profile = iaf.y + toIaf * Math.tan(4 * DEG);
      wantAlt = Math.max(ground + 330, dirNorth ? 1100 : 0, Math.min(profile, m.pos.y));
      if (toIaf < 6000) speed = Math.min(speed, 100);
    }
    const gam = clamp((wantAlt - m.pos.y) * 0.0012, -9 * DEG, 8 * DEG);
    const c = this.ap.navigate(m, hdg, gam, speed, dt, { bankMax: bank, useIas: speed < 100 });
    c.airbrake = m.tas > speed + 20;
    c.gearDown = gear;
    return c;
  }

  /** Initial approach fix: on the extended centreline, just above the 3-degree glideslope. */
  private iaf(dirNorth: boolean) {
    const dz = 5200;
    return { x: 0, y: FIELD_ELEV + (dz + AIM_OFFSET) * Math.tan(GLIDE_DEG * DEG) + 70, z: (dirNorth ? 1 : -1) * (RUNWAY.halfLen + dz) };
  }

  private land(dt: number, ctx: WingmanContext): FlightControls {
    const me = this.self, m = me.model;
    const dirNorth = this.runwayDir();
    const info = approachInfo(m.pos.x - 14, m.pos.y, m.pos.z, dirNorth);   // lands 14 m right of the centreline
    const agl = m.pos.y - me.cfg.gearHeight - FIELD_ELEV;
    if (m.onGround) {
      if (m.vel.length() < 1.2) { this.setState('PARKED', 'stopped'); }
      return { pitch: m.pitchDeg > 1 ? -0.25 : 0, roll: 0, yaw: clamp(-info.lateral * 0.01, -0.3, 0.3), throttle: 0, airbrake: true, gearDown: true };
    }
    // unstable on short final -> go around (climb out straight ahead, then re-enter the pattern from the other side)
    if (info.dz < 700 && info.dz > -200 && agl > 25 && (info.gsError > 110 || Math.abs(info.lateral) > 140)) {
      this.goAround = 24; this.goAroundHdg = info.runwayHeading * DEG; this.funnel = false; this.setState('RTB', 'go-around'); this.log.push('GO-AROUND');
      return this.rtb(dt, ctx);
    }
    const flare = agl < 16 && info.dz < 900;
    // spacing: slow down if the leader is still airborne just ahead of us on the same approach
    const lInfo = approachInfo(ctx.leader.pos.x, ctx.leader.pos.y, ctx.leader.pos.z, dirNorth);
    const spacing = !ctx.leader.model.onGround && ctx.leader.pos.distanceTo(m.pos) < 800 && lInfo.dz < info.dz ? -9 : 0;
    const gam = flare ? -0.7 * DEG : clamp((-GLIDE_DEG - info.gsError * 0.07) * DEG, -5 * DEG, -0.5 * DEG);
    const vApp = me.cfg.approachKt / KT - 2, vTd = me.cfg.touchdownKt / KT + 1;
    const c = this.ap.navigate(m, centrelineHeading(info) * DEG, gam, (flare ? vTd : vApp) + spacing, dt, { useIas: true, gearDown: true, bankMax: 25 * DEG });
    if (flare) c.throttle = 0;
    return c;
  }
  private goAround = 0;
  private goAroundHdg = 0;
  private funnel = false;
}
