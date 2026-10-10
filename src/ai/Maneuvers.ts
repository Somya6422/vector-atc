import * as THREE from 'three';
import type { FlightControls, FlightModel } from '../flight/FlightModel';
import { Autopilot } from '../flight/Autopilot';
import { DEG, clamp, wrapPi } from '../util/math';
import { minClearanceAlong, terrainHeight } from '../world/Heightfield';

/**
 * Simplified, physically-constrained manoeuvres (gameplay approximations, not tactical doctrine).
 * Executors only output stick/throttle commands – the FlightModel still enforces g/rate/energy limits.
 */
export type ManeuverKind = 'BREAK_TURN' | 'BARREL_ROLL' | 'SPLIT_S' | 'IMMELMANN' | 'ENERGY_CLIMB';

const _v = new THREE.Vector3();

export function terrainClearanceAhead(m: FlightModel, seconds = 6): number {
  return minClearanceAlong(m.pos.x, m.pos.y, m.pos.z, m.vel.x, m.vel.y, m.vel.z, seconds, 14);
}

/** Clearance along a hypothetical straight path at heading hdgRad, climbing at gamma. */
function clearanceFor(m: FlightModel, hdgRad: number, gamma: number, seconds: number): number {
  const v = Math.max(m.tas, 150);
  return minClearanceAlong(m.pos.x, m.pos.y, m.pos.z, Math.sin(hdgRad) * Math.cos(gamma) * v, Math.sin(gamma) * v, -Math.cos(hdgRad) * Math.cos(gamma) * v, seconds, 16);
}

/**
 * Terrain-avoidance override (AI GCAS). When the predicted path gets within floorAgl of the ground it evaluates a fan of escape
 * headings (valley-following) and flies the best one in a max-performance climbing turn.
 */
export function terrainAvoid(m: FlightModel, ap: Autopilot, dt: number, floorAgl = 220): FlightControls | null {
  const clr = terrainClearanceAhead(m, 7);
  const agl = m.pos.y - terrainHeight(m.pos.x, m.pos.z);
  if (clr > floorAgl && agl > floorAgl * 0.6) return null;
  const h0 = m.heading * DEG;
  let best = h0, bestC = -1e9;
  for (const dh of [0, 20, -20, 40, -40, 65, -65, 95, -95, 130, -130, 180]) {
    const h = h0 + dh * DEG;
    const c = clearanceFor(m, h, 12 * DEG, 8) - Math.abs(dh) * 1.2;
    if (c > bestC) { bestC = c; best = h; }
  }
  const steep = clr < floorAgl * 0.5 ? 26 * DEG : 15 * DEG;
  const c = ap.navigate(m, best, steep, Math.max(m.tas, 200), dt, { bankMax: Math.abs(wrapPi(best - h0)) > 60 * DEG ? 75 * DEG : 50 * DEG });
  c.throttle = 1;
  return c;
}

export class ManeuverExecutor {
  kind: ManeuverKind | null = null;
  t = 0;
  private phase = 0;
  private hdg0 = 0;
  private rollAccum = 0;
  private side = 1;
  private lastRoll = 0;
  done = true;

  begin(kind: ManeuverKind, m: FlightModel, threatSide = 1) {
    this.kind = kind; this.t = 0; this.phase = 0; this.done = false; this.hdg0 = m.heading * DEG;
    this.rollAccum = 0; this.side = threatSide >= 0 ? 1 : -1; this.lastRoll = m.rollDeg;
  }
  cancel() { this.done = true; this.kind = null; }

  /** Whether an energy / altitude precondition holds for the requested manoeuvre. */
  static feasible(kind: ManeuverKind, m: FlightModel): boolean {
    const agl = m.pos.y - terrainHeight(m.pos.x, m.pos.z);
    switch (kind) {
      case 'SPLIT_S': return agl > 2400 && m.tas > 150;
      case 'IMMELMANN': return m.tas > 210 && agl > 600 && m.pos.y < 5500;
      case 'ENERGY_CLIMB': return m.tas > 120;
      default: return m.tas > 90;
    }
  }

  step(m: FlightModel, dt: number): FlightControls {
    this.t += dt;
    const ctl: FlightControls = { pitch: 0, roll: 0, yaw: 0, throttle: 1, airbrake: false, gearDown: false };
    const roll = m.rollDeg;
    const dRoll = wrapPi((roll - this.lastRoll) * DEG); this.lastRoll = roll; this.rollAccum += Math.abs(dRoll);
    if (terrainClearanceAhead(m, 4) < 200 || m.pos.y - terrainHeight(m.pos.x, m.pos.z) < 800) { this.done = true; this.kind = null; return ctl; }
    switch (this.kind) {
      case 'BREAK_TURN': {
        const target = 78 * this.side;
        ctl.roll = clamp((target - roll) * 0.06, -1, 1);
        ctl.pitch = Math.abs(target - roll) < 28 ? 1 : 0.1;
        if (this.t > 4.2) this.done = true;
        break;
      }
      case 'BARREL_ROLL': {
        ctl.roll = this.side; ctl.pitch = 0.55; ctl.throttle = 0.8;
        if (this.rollAccum > 340 * DEG || this.t > 4.5) this.done = true;
        break;
      }
      case 'SPLIT_S': {
        if (this.phase === 0) { ctl.roll = this.side; if (Math.abs(roll) > 155) this.phase = 1; }
        else if (this.phase === 1) {
          ctl.pitch = 1; ctl.throttle = 0.6; ctl.airbrake = false;
          if (m.pitchDeg < -35) this.phase = 2;
        } else if (this.phase === 2) { ctl.pitch = 1; ctl.throttle = 0.6; if (m.pitchDeg > -8 || this.t > 9) this.phase = 3; }
        else { ctl.roll = clamp(-roll * 0.04, -1, 1); ctl.throttle = 1; if (Math.abs(roll) < 25) this.done = true; }
        if (this.t > 12) this.done = true;
        break;
      }
      case 'IMMELMANN': {
        const dh = Math.abs(wrapPi(m.heading * DEG - this.hdg0));
        if (this.phase === 0) { ctl.pitch = 1; ctl.roll = clamp(-roll * 0.04, -1, 1); if (dh > 150 * DEG && Math.abs(roll) > 90) this.phase = 1; }
        else { ctl.roll = this.side; ctl.pitch = 0.1; if (Math.abs(roll) < 30) this.done = true; }
        if (this.t > 11) this.done = true;
        break;
      }
      case 'ENERGY_CLIMB': {
        _v.copy(m.vel).setY(0);
        ctl.pitch = clamp((25 - m.pitchDeg) * 0.05, -0.3, 0.8);
        ctl.roll = clamp(-roll * 0.05, -1, 1);
        if (this.t > 5) this.done = true;
        break;
      }
      default: this.done = true;
    }
    if (this.done) this.kind = null;
    return ctl;
  }
}
