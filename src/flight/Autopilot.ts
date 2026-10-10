import { Quaternion, Vector3 } from 'three';
import type { FlightControls, FlightModel } from './FlightModel';
import { DEG, G0, clamp, wrapPi } from '../util/math';

const _d = new Vector3(), _qi = new Quaternion();

/**
 * Control-law layer used by wingman, bandits and the test harness. It only produces stick/throttle inputs
 * for a FlightModel – AI aircraft obey exactly the same physics as the player.
 */
export class Autopilot {
  private thrI = 0.55;

  /** Heading / flight-path-angle / speed hold with bank-to-turn (gentle manoeuvring). */
  navigate(m: FlightModel, headingRad: number, gammaRad: number, speed: number, dt: number, opts: { useIas?: boolean; bankMax?: number; gearDown?: boolean } = {}): FlightControls {
    const psi = m.heading * DEG;
    const bankMax = opts.bankMax ?? 40 * DEG;
    const phiT = clamp(wrapPi(headingRad - psi) * 1.7, -bankMax, bankMax);
    const phi = m.rollDeg * DEG;
    const roll = clamp((phiT - phi) * 1.6, -1, 1);
    const V = Math.max(m.tas, 40);
    const gam = Math.atan2(m.vel.y, Math.hypot(m.vel.x, m.vel.z));
    const K = 0.35 + 0.0025 * V;
    const rateAvail = Math.max(0.15, Math.min(m.cfg.maxPitchRate, ((m.cfg.gLimit - 1) * G0) / V));
    const cphi = Math.max(0.5, Math.cos(phi));
    const ff = (G0 * Math.tan(phi) * Math.sin(phi)) / V;
    const rateCmd = K * (gammaRad - gam) + ff + (1 / cphi - 1) * 0.0;
    const pitch = clamp(rateCmd / rateAvail, -1, 1);
    const cur = opts.useIas ? m.ias : m.tas;
    return { pitch, roll, yaw: 0, throttle: this.speedHold(cur, speed, dt), airbrake: false, gearDown: opts.gearDown ?? false };
  }

  speedHold(current: number, target: number, dt: number): number {
    const err = target - current;
    this.thrI = clamp(this.thrI + err * 0.012 * dt, 0.05, 0.95);
    return clamp(this.thrI + err * 0.035, 0, 1);
  }

  /** Roll-to-target pursuit for combat manoeuvres. `dir` is a world-space unit vector to steer the nose toward. */
  pointAt(m: FlightModel, dir: Vector3, pullScale: number, speed: number, dt: number, afterburner = false): FlightControls {
    _qi.copy(m.q).invert();
    _d.copy(dir).applyQuaternion(_qi);          // body frame: x right, y up, -z forward
    const fwdComp = -_d.z;
    const lat = Math.hypot(_d.x, _d.y);
    const angle = Math.atan2(lat, fwdComp);     // total off-boresight angle
    let roll = 0;
    const phiErr = lat > 1e-4 ? Math.atan2(_d.x, _d.y) : 0;   // angle of target around the nose; 0 = straight above
    if (angle > 1.5 * DEG) roll = clamp(phiErr * 2.2, -1, 1);
    if (fwdComp < 0 && Math.abs(phiErr) > 2.4) roll = Math.sign(phiErr || 1);
    const aligned = Math.abs(phiErr) < 45 * DEG;
    const pitch = angle < 4 * DEG ? clamp(_d.y * 8, -1, 1) : aligned ? clamp(angle * 2.6, 0, 1) * pullScale : 0;
    const throttle = afterburner ? 1 : this.speedHold(m.tas, speed, dt);
    return { pitch, roll, yaw: clamp(_d.x * 2, -0.5, 0.5), throttle, airbrake: false, gearDown: false };
  }
}
