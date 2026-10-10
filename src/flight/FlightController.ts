import type { Input } from '../game/Input';
import type { FlightControls } from './FlightModel';
import { clamp } from '../util/math';

/** Interprets keyboard input into smoothed analog flight controls. */
export class FlightController {
  pitch = 0; roll = 0; yaw = 0;
  throttle = 0;
  gearDown = true;
  airbrake = false;
  /** voice command "apply brakes" holds the brakes until released */
  brakeLatch = false;
  invertPitch = false;

  private axis(cur: number, want: number, dt: number) {
    const rate = want === 0 ? 7 : Math.sign(want) === Math.sign(cur) || cur === 0 ? 4.5 : 9;
    const d = want - cur;
    return cur + clamp(d, -rate * dt, rate * dt);
  }

  /** Default: W = nose up, S = nose down (arrow keys work too) – flip with the invert-pitch setting. */
  /** `mouse`: cursor offset from screen centre in -1..1 (mouse-aim flight) or null. */
  update(inp: Input, dt: number, mouse: { x: number; y: number } | null = null) {
    const w = inp.held('pitchDown') ? 1 : 0, s = inp.held('pitchUp') ? 1 : 0;   // s = nose up (W), w = nose down (S)
    let p = s - w; if (this.invertPitch) p = -p;
    let r = (inp.held('rollRight') ? 1 : 0) - (inp.held('rollLeft') ? 1 : 0);
    let y = (inp.held('yawRight') ? 1 : 0) - (inp.held('yawLeft') ? 1 : 0);
    if (mouse) {
      // cursor up = nose up, cursor right = bank + yaw right (the nose goes wherever the cursor goes)
      const sh = (v: number) => { const a = Math.abs(v); return a < 0.06 ? 0 : Math.sign(v) * Math.pow((a - 0.06) / 0.94, 1.25); };
      const mp = -sh(mouse.y) * (this.invertPitch ? -1 : 1);
      p = Math.max(-1, Math.min(1, p + mp)); r = Math.max(-1, Math.min(1, r + sh(mouse.x) * 1.1)); y = Math.max(-1, Math.min(1, y + sh(mouse.x) * 0.3));
    }
    this.pitch = this.axis(this.pitch, p, dt);
    this.roll = this.axis(this.roll, r, dt);
    this.yaw = this.axis(this.yaw, y, dt);
    if (inp.held('throttleUp')) this.throttle = Math.min(1, this.throttle + 0.55 * dt);
    if (inp.held('throttleDown')) this.throttle = Math.max(0, this.throttle - 0.7 * dt);
    if (inp.wasPressed('gear')) this.gearDown = !this.gearDown;
    this.airbrake = inp.held('brake') || this.brakeLatch;
  }
  get controls(): FlightControls {
    return { pitch: this.pitch, roll: this.roll, yaw: this.yaw, throttle: this.throttle, airbrake: this.airbrake, gearDown: this.gearDown };
  }
  reset(throttle = 0) { this.pitch = this.roll = this.yaw = 0; this.throttle = throttle; this.gearDown = true; this.airbrake = false; }
}
