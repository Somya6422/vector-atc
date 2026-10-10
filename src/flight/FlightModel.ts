import { Euler, Quaternion, Vector3 } from 'three';
import type { AircraftConfig } from './AircraftConfig';
import { DEG, G0, KT, Rng, clamp, smoothstep } from '../util/math';

/**
 * Simplified arcade 6-DOF flight model (documented limitations in README):
 *  - Translational: full 3-D force integration (lift, induced+parasitic+wave drag, side force, thrust, gravity).
 *  - Rotational: body-rate command model (first-order rate response, g-limited, speed/stall-degraded) plus
 *    weathervane + stall nose-drop moments. Not a full inertia-tensor / aerodynamic-moment model.
 * Fixed-step semi-implicit Euler (call with dt = FlightModel.DT).
 */
export interface WorldQuery {
  height(x: number, z: number): number;
  paved(x: number, z: number): boolean;
}

export interface FlightControls {
  pitch: number;     // +1 = nose up
  roll: number;      // +1 = roll right
  yaw: number;       // +1 = yaw right
  throttle: number;  // 0..1 (>0.9 engages afterburner)
  airbrake: boolean; // airbrake in flight, wheel brakes on ground
  gearDown: boolean;
}

export interface TouchdownEvent { sink: number; speed: number; iasKt: number; hard: boolean; paved: boolean; }
export type CrashCause = 'TERRAIN' | 'GEAR_UP_IMPACT' | 'HARD_LANDING' | 'STRUCTURAL' | 'ENEMY' | 'COLLISION';

const _e = new Euler();
const _fwd = new Vector3(), _up = new Vector3(), _right = new Vector3();
const _vd = new Vector3(), _lift = new Vector3(), _f = new Vector3(), _vb = new Vector3(), _qi = new Quaternion();
const _dq = new Quaternion(), _t = new Vector3();

export function isaDensity(h: number) { return 1.225 * Math.exp(-Math.max(0, h) / 9300); }
export function speedOfSound(h: number) { return Math.max(295, 340.3 - 0.0040 * Math.max(0, h)); }

export class FlightModel {
  static readonly DT = 1 / 120;
  readonly pos = new Vector3();
  readonly vel = new Vector3();
  readonly q = new Quaternion();
  readonly w = new Vector3();         // body rates (rad/s): x = pitch up, y = yaw left, z = roll left
  fuel: number;
  engineN = 0;
  engineOn = false;
  throttleCmd = 0;
  afterburner = false;
  gearPos = 1;          // 0 up, 1 down
  airbrakePos = 0;
  onGround = false;
  crashed = false;
  crashCause: CrashCause | null = null;
  health: number;
  weightOnWheels = 0;
  // derived telemetry
  tas = 0; ias = 0; mach = 0; alpha = 0; beta = 0; gLoad = 1; qDyn = 0;
  stalled = false; stallWarning = false; overG = false;
  turbulence = 0;
  extraMass = 0;
  lastAccel = new Vector3();
  onTouchdown?: (e: TouchdownEvent) => void;
  onCrash?: (c: CrashCause) => void;
  private turb = new Vector3();
  private rng: Rng;
  private groundTime = 0;

  constructor(readonly cfg: AircraftConfig, private world: WorldQuery, seed = 1) {
    this.fuel = cfg.fuelCapacity;
    this.health = cfg.hullHealth;
    this.rng = new Rng(seed);
  }

  get mass() { return this.cfg.emptyMass + this.fuel + this.extraMass; }
  get iasKt() { return this.ias * KT; }
  get altitude() { return this.pos.y; }
  get gearDown() { return this.gearPos > 0.8; }
  get thrustFraction() { return this.engineOn ? Math.min(1, Math.pow(Math.min(this.engineN, 0.9) / 0.9, 3)) : 0; }

  setHeadingPlace(x: number, y: number, z: number, headingDeg: number, pitchDeg = 0, speed = 0) {
    this.pos.set(x, y, z);
    _e.set(pitchDeg * DEG, -headingDeg * DEG, 0, 'YXZ');
    this.q.setFromEuler(_e);
    _fwd.set(0, 0, -1).applyQuaternion(this.q);
    this.vel.copy(_fwd).multiplyScalar(speed);
    this.w.set(0, 0, 0);
  }
  forward(out = new Vector3()) { return out.set(0, 0, -1).applyQuaternion(this.q); }
  upVec(out = new Vector3()) { return out.set(0, 1, 0).applyQuaternion(this.q); }
  rightVec(out = new Vector3()) { return out.set(1, 0, 0).applyQuaternion(this.q); }
  /** Heading 0..359 deg (0 = north = -Z). */
  get heading() {
    _fwd.set(0, 0, -1).applyQuaternion(this.q);
    return ((Math.atan2(_fwd.x, -_fwd.z) / DEG) + 360) % 360;
  }
  get pitchDeg() { _fwd.set(0, 0, -1).applyQuaternion(this.q); return Math.asin(clamp(_fwd.y, -1, 1)) / DEG; }
  get rollDeg() {
    this.rightVec(_right); this.upVec(_up);
    return Math.atan2(-_right.y, _up.y) / DEG; // + = right wing down
  }
  get flightPathDeg() { const h = Math.hypot(this.vel.x, this.vel.z); return Math.atan2(this.vel.y, h) / DEG; }
  get verticalSpeed() { return this.vel.y; }

  startEngines() { if (this.fuel > 0) this.engineOn = true; }
  damage(amount: number, cause: CrashCause = 'ENEMY') {
    if (this.crashed) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.destroy(cause);
  }
  destroy(cause: CrashCause) {
    if (this.crashed) return;
    this.crashed = true; this.crashCause = cause; this.health = 0; this.engineOn = false; this.afterburner = false;
    this.onCrash?.(cause);
  }

  step(dt: number, c: FlightControls) {
    if (this.crashed) { this.vel.multiplyScalar(0.98); return; }
    const cfg = this.cfg;
    const h = this.pos.y;
    const rho = isaDensity(h);
    const a = speedOfSound(h);
    const dmgFactor = 0.5 + 0.5 * clamp(this.health / cfg.hullHealth, 0, 1);

    // ---- engine ----
    if (this.fuel <= 0) { this.engineOn = false; }
    const thr = clamp(c.throttle, 0, 1);
    this.throttleCmd = thr;
    const idle = 0.2;
    const target = this.engineOn ? idle + (1 - idle) * thr : 0;
    this.engineN += (target - this.engineN) * (1 - Math.exp(-cfg.spool * dt));
    if (this.engineN < 0.005 && target === 0) this.engineN = 0;
    const N = this.engineN;
    const milFrac = Math.pow(Math.min(N, 0.9) / 0.9, 3);
    const abFrac = N > 0.9 ? (N - 0.9) / 0.1 : 0;
    this.afterburner = abFrac > 0.5 && this.engineOn && cfg.thrustAB > cfg.thrustMil;
    const lapse = Math.pow(rho / 1.225, 0.75) * (1 + 0.25 * Math.min(this.mach, 1.5)) * (1 - 0.9 * smoothstep(1.5, 2.1, this.mach));
    let thrust = this.engineOn ? lapse * (cfg.thrustMil * milFrac + (cfg.thrustAB - cfg.thrustMil) * abFrac) * dmgFactor : 0;
    if (this.engineOn) {
      this.fuel = Math.max(0, this.fuel - dt * (cfg.fuelFlowMil * milFrac + (cfg.fuelFlowAB - cfg.fuelFlowMil) * abFrac));
    }

    // gear / airbrake actuation
    const gTarget = c.gearDown ? 1 : 0;
    this.gearPos += clamp(gTarget - this.gearPos, -dt * 0.28, dt * 0.28);
    this.airbrakePos += clamp((c.airbrake ? 1 : 0) - this.airbrakePos, -dt * 1.5, dt * 1.5);

    // ---- kinematics ----
    _fwd.set(0, 0, -1).applyQuaternion(this.q);
    _up.set(0, 1, 0).applyQuaternion(this.q);
    _right.set(1, 0, 0).applyQuaternion(this.q);
    const V = this.vel.length();
    this.tas = V;
    this.qDyn = 0.5 * rho * V * V;
    this.ias = Math.sqrt(2 * this.qDyn / 1.225);
    this.mach = V / a;
    _qi.copy(this.q).invert();
    _vb.copy(this.vel).applyQuaternion(_qi);
    const u = -_vb.z;
    if (V > 3) {
      this.alpha = Math.atan2(-_vb.y, Math.max(u, 0.1));
      this.beta = Math.atan2(_vb.x, Math.max(u, 0.1));
    } else { this.alpha = 0; this.beta = 0; }
    const alpha = this.alpha;

    // ---- aerodynamic coefficients ----
    const crit = alpha >= 0 ? cfg.alphaCrit : cfg.alphaCritNeg;
    const aa = Math.abs(alpha);
    let CL: number;
    if (aa <= crit) CL = cfg.CL0 + cfg.CLalpha * alpha;
    else {
      const clCrit = cfg.CL0 + cfg.CLalpha * crit * Math.sign(alpha);
      const post = clamp((aa - crit) / (14 * DEG), 0, 1);
      CL = clCrit * (1 - 0.55 * post);
    }
    this.stalled = aa > crit && V > 15;
    this.stallWarning = V > 15 && (aa > crit * 0.82 || (!this.onGround && this.iasKt < 112 && this.iasKt > 20));
    const wave = 0.05 * (cfg.waveDrag ?? 1) * smoothstep(0.85, 1.05, this.mach) * (1 - 0.5 * smoothstep(1.15, 1.6, this.mach));
    const CD = cfg.CD0 + cfg.kInduced * CL * CL + wave + this.gearPos * cfg.gearDrag + this.airbrakePos * cfg.airbrakeDrag
      + (this.stalled ? 0.08 : 0);

    // ---- forces ----
    const S = cfg.wingArea;
    _f.set(0, 0, 0);
    let liftMag = 0;
    if (V > 1) {
      _vd.copy(this.vel).multiplyScalar(1 / V);
      _lift.crossVectors(_right, _vd);
      const ll = _lift.length();
      if (ll > 1e-4) _lift.multiplyScalar(1 / ll); else _lift.copy(_up);
      liftMag = this.qDyn * S * CL;
      _f.addScaledVector(_lift, liftMag);
      _f.addScaledVector(_vd, -this.qDyn * S * CD);
      _f.addScaledVector(_right, -this.qDyn * S * cfg.CYbeta * this.beta);
    }
    _f.addScaledVector(_fwd, thrust);
    // specific force -> g-load along body up (excludes gravity)
    this.lastAccel.copy(_f).multiplyScalar(1 / this.mass);
    this.gLoad = this.lastAccel.dot(_up) / G0;
    this.overG = this.gLoad > cfg.gLimit + 1.5 || this.gLoad < -cfg.gLimitNeg - 1.5;
    if (this.overG) this.damage(dt * 8, 'STRUCTURAL');

    // turbulence (smoothed random accelerations)
    if (this.turbulence > 0) {
      const k = 1 - Math.exp(-dt * 1.2);
      this.turb.x += (this.rng.signed() - this.turb.x) * k;
      this.turb.y += (this.rng.signed() - this.turb.y) * k;
      this.turb.z += (this.rng.signed() - this.turb.z) * k;
      this.vel.addScaledVector(_t.copy(this.turb).multiplyScalar(this.turbulence * 12), dt);
      this.w.x += this.turb.y * this.turbulence * 0.35 * dt;
      this.w.z += this.turb.x * this.turbulence * 0.45 * dt;
    }

    const m = this.mass;
    this.vel.addScaledVector(_f, dt / m);
    this.vel.y -= G0 * dt;

    // ---- rotational response ----
    const iasKt = this.iasKt;
    const eSpeed = smoothstep(30, 112, iasKt);
    const vecFloor = cfg.vectoringAuthority * clamp(this.thrustFraction * 2.2, 0, 1);
    const eStall = this.stalled ? 1 - 0.75 * smoothstep(crit, crit + 8 * DEG, aa) : 1;
    const ePY = Math.max(eSpeed, vecFloor) * eStall * dmgFactor;
    const eR = Math.max(eSpeed, vecFloor * 0.6) * (0.35 + 0.65 * eStall) * dmgFactor;
    const Vc = Math.max(V, 45);
    const rateUp = ((cfg.gLimit - 1) * G0) / Vc;
    const rateDn = ((cfg.gLimitNeg + 1) * G0) / Vc;
    const pitchCmd = clamp(c.pitch, -1, 1);
    let wantP = pitchCmd >= 0 ? pitchCmd * Math.min(cfg.maxPitchRate, rateUp) : pitchCmd * Math.min(cfg.maxPitchRate * 0.8, rateDn);
    wantP *= ePY;
    if (this.stalled && V > 15) {
      const drop = smoothstep(crit, crit + 6 * DEG, aa) * 0.55;
      wantP = wantP * (1 - drop) - Math.sign(alpha) * drop * 0.9;
    }
    const wantR = -clamp(c.roll, -1, 1) * cfg.maxRollRate * eR;       // w.z is roll-left
    let wantY = -clamp(c.yaw, -1, 1) * cfg.maxYawRate * ePY;          // w.y is yaw-left
    if (V > 25) wantY += -this.beta * 1.4 * eSpeed;                    // weathervane / yaw damper
    wantY += this.w.z * 0;                                              // (no adverse-yaw coupling modelled)

    const kp = 1 - Math.exp(-cfg.pitchResponse * dt);
    const kr = 1 - Math.exp(-cfg.rollResponse * dt);
    const ky = 1 - Math.exp(-cfg.yawResponse * dt);
    this.w.x += (wantP - this.w.x) * kp;
    this.w.z += (wantR - this.w.z) * kr;
    this.w.y += (wantY - this.w.y) * ky;

    // ---- orientation ----
    const wm = this.w.length();
    if (wm > 1e-6) {
      _dq.setFromAxisAngle(_t.copy(this.w).multiplyScalar(1 / wm), wm * dt);
      this.q.multiply(_dq).normalize();
    }

    // ---- position ----
    this.pos.addScaledVector(this.vel, dt);

    // ---- ground interaction ----
    this.contactGround(dt, c, liftMag);
  }

  private contactGround(dt: number, c: FlightControls, liftMag: number) {
    const cfg = this.cfg;
    const gh = this.world.height(this.pos.x, this.pos.z);
    const down = this.gearPos > 0.8;
    const clr = down ? cfg.gearHeight : cfg.bellyHeight;
    const prevOn = this.onGround;
    if (this.pos.y - clr > gh + 0.05) { this.onGround = false; this.weightOnWheels = 0; this.groundTime = 0; return; }
    // contact
    const paved = this.world.paved(this.pos.x, this.pos.z);
    const sink = Math.max(0, -this.vel.y);
    const vh = Math.hypot(this.vel.x, this.vel.z);
    _e.setFromQuaternion(this.q, 'YXZ');
    const pitch = _e.x, roll = _e.z;
    if (!prevOn) {
      const hard = sink > 4;
      const okAttitude = Math.abs(roll) < 20 * DEG && pitch > -4 * DEG && pitch < 21 * DEG;
      if (down && paved) {
        if (sink > 8 || !okAttitude && vh > 25) { this.touch(sink, vh, hard, paved); this.destroy('HARD_LANDING'); return; }
        if (hard) this.damage((sink - 4) * 8, 'HARD_LANDING');
      } else if (down && !paved) {
        if (vh > 22 || sink > 5) { this.destroy('TERRAIN'); return; }
      } else {
        if (vh > 45 || sink > 3.5) { this.destroy(vh > 20 ? 'GEAR_UP_IMPACT' : 'TERRAIN'); return; }
        this.damage(12 + vh * 0.5, 'GEAR_UP_IMPACT');
      }
      this.touch(sink, vh, hard, paved);
    }
    if (this.crashed) return;
    this.onGround = true;
    this.groundTime += dt;
    this.pos.y = gh + clr;
    if (this.vel.y < 0) this.vel.y = 0;
    this.weightOnWheels = clamp(1 - liftMag / (this.mass * G0), 0, 1);
    const wow = this.weightOnWheels;

    // gear-up sliding: heavy drag and damage
    let rollFric = down ? 0.025 : 0.6;
    if (!down) this.damage(dt * (1 + vh * 0.08), 'GEAR_UP_IMPACT');
    if (c.airbrake && down) rollFric += 0.5 * wow;   // wheel brakes (~5 m/s^2)
    // lateral grip + rolling resistance in the horizontal plane
    _fwd.set(0, 0, -1).applyQuaternion(this.q); _fwd.y = 0;
    if (_fwd.lengthSq() > 1e-6) {
      _fwd.normalize();
      _right.set(-_fwd.z, 0, _fwd.x);          // 90 deg right of forward in XZ plane
      const vlat = this.vel.x * _right.x + this.vel.z * _right.z;
      const grip = down ? 8 : 1.5;
      const dl = vlat * (1 - Math.exp(-grip * dt * wow));
      this.vel.x -= _right.x * dl; this.vel.z -= _right.z * dl;
      const vf = this.vel.x * _fwd.x + this.vel.z * _fwd.z;
      const dec = Math.min(Math.abs(vf), rollFric * G0 * wow * dt);
      this.vel.x -= _fwd.x * dec * Math.sign(vf); this.vel.z -= _fwd.z * dec * Math.sign(vf);
      if (Math.hypot(this.vel.x, this.vel.z) < 0.15 && this.throttleCmd < 0.12) { this.vel.x = 0; this.vel.z = 0; }
    }
    // nose-wheel steering (A/D or Q/E) fades out with speed
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (down && wow > 0.5) {
      const steer = clamp(c.yaw + c.roll * 0.8, -1, 1);
      const auth = clamp(speed / 6, 0, 1) * (1 - smoothstep(25, 70, speed) * 0.85);
      const want = -steer * 0.55 * auth;
      this.w.y += (want - this.w.y) * (1 - Math.exp(-6 * dt));
    }
    // ground attitude constraints (wheels/tail contact)
    if (wow > 0.3) {
      let p = pitch, r = roll;
      const maxPitch = 13 * DEG;
      if (p < 0) { p = 0; if (this.w.x < 0) this.w.x = 0; }
      if (p > maxPitch) { p = maxPitch; if (this.w.x > 0) this.w.x = 0; }
      r *= Math.exp(-6 * dt);
      if (this.w.z * r > 0 || Math.abs(r) < 1e-3) this.w.z *= 0.2;
      this.w.z *= Math.exp(-6 * dt);
      _e.set(p, _e.y, r, 'YXZ');
      this.q.setFromEuler(_e);
    }
  }

  private touch(sink: number, vh: number, hard: boolean, paved: boolean) {
    this.onTouchdown?.({ sink, speed: vh, iasKt: this.iasKt, hard, paved });
  }
}

export const FLIGHT_STEP = FlightModel.DT;
