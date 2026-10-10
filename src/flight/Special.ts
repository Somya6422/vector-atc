import * as THREE from 'three';
import type { Unit } from '../game/Entity';
import type { FlightController } from './FlightController';
import { DEG, KT, clamp, smoothstep } from '../util/math';
import { isPaved, terrainHeight } from '../world/Heightfield';

/**
 * Signature abilities of the two airframes, flown as scripted / special-mode dynamics on top of the normal model:
 *  - Su-57: Pugachev's Cobra and Kulbit, both made possible by 3-D thrust vectoring (post-stall manoeuvres).
 *  - F-35 (B-model behaviour): STOVL – transition to a jet-borne hover, hover-taxi, vertical take-off and landing.
 * While one of these runs it owns the aircraft state; afterwards the normal flight model resumes from that state.
 */
export type SpecialMode = 'none' | 'cobra' | 'kulbit' | 'transIn' | 'hover' | 'transOut';

const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _f = new THREE.Vector3();

export class SpecialFlight {
  mode: SpecialMode = 'none';
  /** 0 = nozzle aft (wing-borne), 1 = nozzle down + lift fan open (jet-borne) – drives the visuals */
  nozzleDown = 0;
  private t = 0;
  private q0 = new THREE.Quaternion();
  private axis = new THREE.Vector3();
  private iasRatio = 1;
  private machRatio = 1 / 315;
  private yaw = 0;            // hover heading (rad)
  private lastVy = 0;
  onMessage?: (s: string) => void;

  constructor(private unit: Unit) {}

  get active() { return this.mode !== 'none'; }
  get label(): string | null {
    switch (this.mode) {
      case 'cobra': return "PUGACHEV'S COBRA";
      case 'kulbit': return 'KULBIT';
      case 'transIn': return 'STOVL – CONVERTING TO HOVER';
      case 'hover': return 'STOVL HOVER  ·  throttle = height · W/S fwd/back · A/D slide · Q/E turn';
      case 'transOut': return 'STOVL – ACCELERATING TO WING-BORNE FLIGHT';
      default: return null;
    }
  }
  private get m() { return this.unit.model; }
  private agl() { const m = this.m; return m.pos.y - terrainHeight(m.pos.x, m.pos.z); }
  private bank() { const r = _v.set(1, 0, 0).applyQuaternion(this.m.q), u = _f.set(0, 1, 0).applyQuaternion(this.m.q); return Math.atan2(r.y, u.y); }

  // ------------------------------------------------------------------ Su-57 post-stall manoeuvres
  /** Pugachev's Cobra: nose snaps past vertical while the jet keeps travelling forward, bleeding speed, then drops back. */
  startCobra(): string {
    const m = this.m, kt = m.iasKt;
    if (this.unit.cfg.id !== 'SU57') return "Only the Su-57's thrust vectoring can fly the Cobra.";
    if (this.active) return 'Finish the current manoeuvre first.';
    if (m.onGround) return 'Get airborne first.';
    if (kt < 200 || kt > 470) return `Cobra entry speed is 200–470 kt (now ${Math.round(kt)}).`;
    if (Math.abs(this.bank()) > 30 * DEG) return 'Level the wings first (bank under 30°).';
    if (this.agl() < 300) return 'Too low – need 300 m above the ground.';
    this.begin('cobra'); return "Pugachev's Cobra!";
  }
  /** Kulbit: a full 360° somersault in roughly the aircraft's own length. */
  startKulbit(): string {
    const m = this.m, kt = m.iasKt;
    if (this.unit.cfg.id !== 'SU57') return "Only the Su-57's thrust vectoring can fly the Kulbit.";
    if (this.active) return 'Finish the current manoeuvre first.';
    if (m.onGround) return 'Get airborne first.';
    if (kt < 220 || kt > 480) return `Kulbit entry speed is 220–480 kt (now ${Math.round(kt)}).`;
    if (Math.abs(this.bank()) > 30 * DEG) return 'Level the wings first (bank under 30°).';
    if (this.agl() < 450) return 'Too low – need 450 m above the ground.';
    this.begin('kulbit'); return 'Kulbit!';
  }
  private begin(mode: SpecialMode) {
    const m = this.m;
    this.mode = mode; this.t = 0; this.q0.copy(m.q);
    this.axis.set(1, 0, 0).applyQuaternion(m.q);           // body pitch axis (right wing)
    this.iasRatio = m.tas > 1 ? m.ias / m.tas : 1; this.machRatio = m.tas > 1 ? m.mach / m.tas : 1 / 315;
  }

  // ------------------------------------------------------------------ F-35 STOVL
  /** J: hover ↔ wing-borne. From the ground this prepares a vertical take-off. */
  toggleStovl(fc: FlightController): string {
    const m = this.m;
    if (this.unit.cfg.id !== 'F35') return 'STOVL hover is an F-35 (B-model) ability.';
    if (this.mode === 'cobra' || this.mode === 'kulbit') return 'Finish the current manoeuvre first.';
    if (this.mode === 'hover' || this.mode === 'transIn') {
      if (m.onGround) { this.mode = 'none'; this.nozzleDown = 0; return 'Nozzle aft – conventional mode.'; }
      this.mode = 'transOut'; this.t = 0; fc.throttle = 1; return 'Converting to wing-borne flight.';
    }
    if (this.mode === 'transOut') { this.mode = 'transIn'; this.t = 0; return 'Back to hover.'; }
    if (!m.engineOn) return 'Start the engine first.';
    if (m.onGround) { if (m.vel.length() > 3) return 'Stop the aircraft before a vertical take-off.'; this.enterHover(fc, 'hover'); fc.throttle = 0.45; return 'Lift fan open, nozzle down. Add throttle above 50% to lift off.'; }
    if (m.iasKt > 300) return `Slow below 300 kt to convert (now ${Math.round(m.iasKt)}).`;
    this.enterHover(fc, 'transIn'); return 'Converting to hover – decelerating.';
  }
  private enterHover(fc: FlightController, mode: SpecialMode) {
    const m = this.m;
    this.mode = mode; this.t = 0; this.iasRatio = m.tas > 1 ? m.ias / m.tas : 1; this.machRatio = m.tas > 1 ? m.mach / m.tas : 1 / 315;
    this.yaw = m.heading * DEG; fc.gearDown = true; fc.throttle = Math.max(0.5, Math.min(fc.throttle, 0.6));
  }

  // ------------------------------------------------------------------ per fixed step
  /** Returns true when this module moved the aircraft this step (the normal flight-model step is skipped). */
  step(dt: number, fc: FlightController): boolean {
    if (this.mode === 'none') { this.nozzleDown = Math.max(0, this.nozzleDown - dt * 0.5); return false; }
    const m = this.m;
    if (m.crashed) { this.mode = 'none'; return false; }
    this.t += dt;
    if (this.mode === 'cobra' || this.mode === 'kulbit') return this.stepPostStall(dt);
    return this.stepStovl(dt, fc);
  }

  private stepPostStall(dt: number): boolean {
    const m = this.m, cobra = this.mode === 'cobra';
    const T = cobra ? 2.7 : 3.3;
    const k = this.t / T;
    // attitude profile about the original pitch axis (radians)
    const ang = cobra
      ? 105 * DEG * (smoothstep(0, 0.36, k) - smoothstep(0.55, 1, k))
      : Math.PI * 2 * (k < 1 ? (k * k * (3 - 2 * k)) : 1);
    _q.setFromAxisAngle(this.axis, ang); m.q.copy(_q).multiply(this.q0);
    // the velocity keeps its direction while the airframe acts as a giant airbrake
    const alpha = cobra ? ang : Math.abs(Math.sin(ang / 2)) * 90 * DEG;
    const v = m.vel.length(), bleed = (0.05 + 0.85 * Math.sin(Math.min(alpha, Math.PI / 2)) ** 2) * v * dt;
    _v.copy(m.vel).normalize().multiplyScalar(Math.max(60, v - bleed));
    _v.y += (cobra ? 0.6 : 1.4) * dt;                            // vectored thrust holds the altitude (slight climb)
    m.vel.copy(_v); m.pos.addScaledVector(m.vel, dt);
    this.syncDerived(alpha, 1 + Math.sin(alpha) * (cobra ? 1.5 : 2.5));
    m.fuel = Math.max(0, m.fuel - this.unit.cfg.fuelFlowAB * dt);
    if (this.agl() < 5) { m.destroy('TERRAIN'); this.mode = 'none'; return true; }
    if (k >= 1) {
      // hand back: nose on the velocity vector, no residual rotation
      const vh = m.vel;
      m.setHeadingPlace(m.pos.x, m.pos.y, m.pos.z, (Math.atan2(vh.x, -vh.z) / DEG + 360) % 360, Math.asin(clamp(vh.y / Math.max(vh.length(), 1), -1, 1)) / DEG, vh.length());
      m.w.set(0, 0, 0); m.onGround = false; m.gearPos = 0;
      this.onMessage?.(cobra ? `Cobra complete – ${Math.round(m.iasKt)} kt.` : `Kulbit complete – ${Math.round(m.iasKt)} kt.`);
      this.mode = 'none';
    }
    return true;
  }

  private stepStovl(dt: number, fc: FlightController): boolean {
    const m = this.m, cfg = this.unit.cfg, G = 9.81;
    this.nozzleDown = this.mode === 'transOut' ? Math.max(0, this.nozzleDown - dt * 0.25) : Math.min(1, this.nozzleDown + dt * 0.5);
    m.gearPos = Math.min(1, m.gearPos + dt * 0.4); fc.gearDown = true;
    const fwd = _f.set(Math.sin(this.yaw), 0, -Math.cos(this.yaw)), right = _v.set(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    const vF = m.vel.dot(fwd), vR = m.vel.x * right.x + m.vel.z * right.z;
    let tiltP = 0, tiltR = 0, aF = 0, aR = 0, targetVy = 0;
    if (this.mode === 'hover') {
      // stick tilts the thrust: nose-down (S) drives forward, bank slides sideways; throttle above 50% climbs
      tiltP = clamp(fc.pitch, -1, 1) * 12 * DEG; tiltR = clamp(fc.roll, -1, 1) * 12 * DEG;
      aF = -Math.tan(tiltP) * G * 1.6; aR = Math.tan(tiltR) * G * 1.6;
      aF -= vF * 0.25; aR -= vR * 0.35;                                  // hover drag keeps it controllable (~25 kt hover-taxi)
      targetVy = (clamp(fc.throttle, 0, 1) - 0.5) * 2 * 9;
      this.yaw += (clamp(fc.yaw, -1, 1) * 0.55 + clamp(fc.roll, -1, 1) * 0.12) * dt;
      if (Math.hypot(vF, vR) > 28) { aF -= vF * 0.6; aR -= vR * 0.6; }    // jet-borne speed limit ~55 kt
    } else if (this.mode === 'transIn') {
      aF = -clamp(vF, -8, 8); aR = -vR * 0.8; targetVy = 0; tiltP = clamp(vF / 60, 0, 1) * 6 * DEG;
      if (Math.hypot(vF, vR) < 6) { this.mode = 'hover'; fc.throttle = 0.5; this.onMessage?.('Hovering. Throttle 50% holds height; J converts back.'); }
    } else {
      aF = 8.5; aR = -vR * 0.8; targetVy = 0.5; tiltP = -4 * DEG;
      if (vF > 90) {   // ~175 kt: wing-borne again
        this.mode = 'none';
        m.setHeadingPlace(m.pos.x, m.pos.y, m.pos.z, (this.yaw / DEG + 360) % 360, 6, vF);
        m.vel.copy(fwd).multiplyScalar(vF); m.w.set(0, 0, 0); fc.throttle = 0.9;
        this.onMessage?.('Wing-borne. Raise the gear (G).');
        return true;
      }
    }
    m.vel.x += (fwd.x * aF + right.x * aR) * dt; m.vel.z += (fwd.z * aF + right.z * aR) * dt;
    m.vel.y += (targetVy - m.vel.y) * Math.min(1, dt * 1.6);
    // engine has to be able to hold the jet: no fuel or engine = it settles
    if (!m.engineOn || m.fuel <= 0) m.vel.y -= G * dt;
    m.pos.addScaledVector(m.vel, dt);
    _e.set(tiltP, -this.yaw, -tiltR, 'YXZ'); m.q.setFromEuler(_e); m.w.set(0, 0, 0);
    m.fuel = Math.max(0, m.fuel - cfg.fuelFlowMil * 1.6 * dt);
    m.engineN += (Math.max(0.75, fc.throttle) - m.engineN) * Math.min(1, dt * 1.5);
    // ground contact: vertical landing / take-off
    const ground = terrainHeight(m.pos.x, m.pos.z) + cfg.gearHeight;
    if (m.pos.y <= ground) {
      const sink = -m.vel.y;
      m.pos.y = ground;
      if (!m.onGround) {
        const hard = sink > 4.5;
        if (sink > 7) { m.destroy('HARD_LANDING'); this.mode = 'none'; return true; }
        m.onGround = true; m.weightOnWheels = 1;
        m.onTouchdown?.({ sink, speed: Math.hypot(m.vel.x, m.vel.z), iasKt: Math.hypot(m.vel.x, m.vel.z) * KT, hard, paved: isPaved(m.pos.x, m.pos.z) });
      }
      m.vel.y = Math.max(0, m.vel.y); m.vel.x *= Math.max(0, 1 - dt * 4); m.vel.z *= Math.max(0, 1 - dt * 4);
    } else if (m.pos.y > ground + 0.3) { m.onGround = false; m.weightOnWheels = 0; }
    this.syncDerived(0, 1 + (m.vel.y - this.lastVy) / Math.max(dt, 1e-3) / G * 0.1);
    this.lastVy = m.vel.y;
    return true;
  }

  /** Keeps the readouts the HUD and AI use (speeds, mach, AoA, g) consistent while the special mode owns the state. */
  private syncDerived(alpha: number, g: number) {
    const m = this.m;
    m.tas = m.vel.length(); m.ias = m.tas * this.iasRatio; m.mach = m.tas * this.machRatio; m.alpha = alpha; m.beta = 0; m.gLoad = g;
    m.stalled = false; m.stallWarning = false;
  }
}
