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
  /** `aim`: stick commands from the mouse-aim tracker (nose follows the pointer) or null. */
  update(inp: Input, dt: number, aim: { pitch: number; roll: number; yaw: number } | null = null) {
    const w = inp.held('pitchDown') ? 1 : 0, s = inp.held('pitchUp') ? 1 : 0;   // s = nose up (W), w = nose down (S)
    let p = s - w; if (this.invertPitch) p = -p;
    let r = (inp.held('rollRight') ? 1 : 0) - (inp.held('rollLeft') ? 1 : 0);
    let y = (inp.held('yawRight') ? 1 : 0) - (inp.held('yawLeft') ? 1 : 0);
    if (aim) { p = clamp(p + aim.pitch, -1, 1); r = clamp(r + aim.roll, -1, 1); y = clamp(y + aim.yaw, -1, 1); }
    this.pitch = aim && !this.keysUsed(inp) ? aim.pitch * (this.invertPitch ? -1 : 1) : this.axis(this.pitch, p, dt);
    this.roll = aim && !this.keysUsed(inp) ? aim.roll : this.axis(this.roll, r, dt);
    this.yaw = aim && !this.keysUsed(inp) ? aim.yaw : this.axis(this.yaw, y, dt);
    if (inp.held('throttleUp')) this.throttle = Math.min(1, this.throttle + 0.55 * dt);
    if (inp.held('throttleDown')) this.throttle = Math.max(0, this.throttle - 0.7 * dt);
    if (inp.wasPressed('gear')) this.gearDown = !this.gearDown;
    this.airbrake = inp.held('brake') || this.brakeLatch;
  }
  /** Keyboard flight keys held: they take priority over (and recentre) the mouse-aim tracker. */
  private keysUsed(inp: Input) { return inp.held('pitchUp') || inp.held('pitchDown') || inp.held('rollLeft') || inp.held('rollRight') || inp.held('yawLeft') || inp.held('yawRight'); }
  get controls(): FlightControls {
    return { pitch: this.pitch, roll: this.roll, yaw: this.yaw, throttle: this.throttle, airbrake: this.airbrake, gearDown: this.gearDown };
  }
  reset(throttle = 0) { this.pitch = this.roll = this.yaw = 0; this.throttle = throttle; this.gearDown = true; this.airbrake = false; }
}
