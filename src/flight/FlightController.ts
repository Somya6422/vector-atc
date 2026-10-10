import type { Input } from '../game/Input';
import type { FlightControls } from './FlightModel';
import { clamp } from '../util/math';

/**
 * Interprets keyboard input into smoothed analog flight controls.
 * Keys act like a progressive stick: a tap gives a small, precise deflection and holding the key ramps to full
 * deflection; releasing snaps back quickly so the aircraft stops where you let go.
 */
export class FlightController {
  pitch = 0; roll = 0; yaw = 0;
  throttle = 0;
  gearDown = true;
  airbrake = false;
  /** voice command "apply brakes" holds the brakes until released */
  brakeLatch = false;
  invertPitch = false;
  /** seconds the current roll key has been held (fly-by-wire lets deliberate long holds roll past the bank limit) */
  rollHoldT = 0;
  /** true when a keyboard pitch / roll key is held this frame */
  keyPitch = false; keyRoll = false;

  private static readonly RATES = { roll: { up: 2.2, back: 14, flip: 7 }, pitch: { up: 3.2, back: 10, flip: 8 }, yaw: { up: 3, back: 10, flip: 8 } };
  private axis(cur: number, want: number, dt: number, k: { up: number; back: number; flip: number }) {
    const rate = want === 0 ? k.back : Math.sign(want) === Math.sign(cur) || cur === 0 ? k.up : k.flip;
    return cur + clamp(want - cur, -rate * dt, rate * dt);
  }

  /** Default: W = nose up, S = nose down (arrow keys work too) – flip with the invert-pitch setting. */
  /** `aim`: stick commands from the mouse-aim tracker (nose follows the pointer) or null. */
  update(inp: Input, dt: number, aim: { pitch: number; roll: number; yaw: number } | null = null) {
    const w = inp.held('pitchDown') ? 1 : 0, s = inp.held('pitchUp') ? 1 : 0;   // s = nose up (W), w = nose down (S)
    let p = s - w; if (this.invertPitch) p = -p;
    let r = (inp.held('rollRight') ? 1 : 0) - (inp.held('rollLeft') ? 1 : 0);
    let y = (inp.held('yawRight') ? 1 : 0) - (inp.held('yawLeft') ? 1 : 0);
    this.keyPitch = p !== 0; this.keyRoll = r !== 0;
    this.rollHoldT = r !== 0 ? this.rollHoldT + dt : 0;
    const R = FlightController.RATES;
    if (aim) { p = clamp(p + aim.pitch, -1, 1); r = clamp(r + aim.roll, -1, 1); y = clamp(y + aim.yaw, -1, 1); }
    const keys = this.keysUsed(inp);
    this.pitch = aim && !keys ? aim.pitch * (this.invertPitch ? -1 : 1) : this.axis(this.pitch, p, dt, R.pitch);
    this.roll = aim && !keys ? aim.roll : this.axis(this.roll, r, dt, R.roll);
    this.yaw = aim && !keys ? aim.yaw : this.axis(this.yaw, y, dt, R.yaw);
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
  reset(throttle = 0) { this.pitch = this.roll = this.yaw = 0; this.throttle = throttle; this.gearDown = true; this.airbrake = false; this.rollHoldT = 0; }
}
