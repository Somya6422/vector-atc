import { describe, expect, it } from 'vitest';
import { Unit } from '../src/game/Entity';
import { F35, SU57 } from '../src/flight/AircraftConfig';
import { FlightModel } from '../src/flight/FlightModel';
import { FlightController } from '../src/flight/FlightController';
import { SpecialFlight } from '../src/flight/Special';
import { cxMain, terrainHeight, world } from '../src/world/Heightfield';
import { parseCommands } from '../src/voice/CommandParser';
import type { Input } from '../src/game/Input';

const one = (s: string) => parseCommands(s)[0];
/** Minimal keyboard stand-in: the listed actions are held. */
const keys = (held: string[] = []) => ({ held: (a: string) => held.includes(a), wasPressed: () => false }) as unknown as Input;

function airborne(cfg = SU57, kt = 300, alt = 2600) {
  const u = new Unit('ownship', 'Specter', 'player', cfg, world, 1), m = u.model, z = -12000, x = cxMain(z);
  m.setHeadingPlace(x, terrainHeight(x, z) + alt, z, 0, 0, kt / 1.943844);
  m.onGround = false; m.gearPos = 0; m.startEngines(); m.engineN = 0.85;
  for (let i = 0; i < 30; i++) m.step(FlightModel.DT, { pitch: 0, roll: 0, yaw: 0, throttle: 0.8, airbrake: false, gearDown: false });
  const fc = new FlightController(); fc.gearDown = false; fc.throttle = 0.8;
  return { u, m, fc, sp: new SpecialFlight(u) };
}
const fly = (s: ReturnType<typeof airborne>, secs: number, held: string[] = []) => {
  for (let t = 0; t < secs; t += FlightModel.DT) { s.fc.update(keys(held), FlightModel.DT); if (!s.sp.step(FlightModel.DT, s.fc)) s.m.step(FlightModel.DT, s.fc.controls); }
};

describe('keyboard feel', () => {
  it('a short tap gives a small deflection, holding ramps to full, release snaps back', () => {
    const fc = new FlightController();
    for (let t = 0; t < 0.15; t += 1 / 60) fc.update(keys(['rollRight']), 1 / 60);
    expect(fc.roll).toBeGreaterThan(0.2); expect(fc.roll).toBeLessThan(0.45);
    for (let t = 0; t < 0.5; t += 1 / 60) fc.update(keys(['rollRight']), 1 / 60);
    expect(fc.roll).toBe(1);
    for (let t = 0; t < 0.1; t += 1 / 60) fc.update(keys(), 1 / 60);
    expect(fc.roll).toBe(0);
    expect(fc.rollHoldT).toBe(0);
  });
});

describe('Su-57 post-stall manoeuvres', () => {
  it("Pugachev's Cobra bleeds speed, passes ~100° pitch and hands back a flying jet", () => {
    const s = airborne(SU57, 320);
    const kt0 = s.m.iasKt;
    expect(s.sp.startCobra()).toMatch(/cobra/i);
    let maxNoseUp = 0;
    for (let t = 0; t < 3 && s.sp.active; t += FlightModel.DT) {
      s.sp.step(FlightModel.DT, s.fc);
      const f = s.m.forward(new (s.m.pos.constructor as new () => typeof s.m.pos)());
      maxNoseUp = Math.max(maxNoseUp, Math.atan2(f.y, Math.hypot(f.x, f.z)) * 57.3 + (f.z > 0 ? 90 : 0));
    }
    expect(s.sp.active).toBe(false);
    expect(s.m.iasKt).toBeLessThan(kt0 * 0.6);
    expect(maxNoseUp).toBeGreaterThan(80);
    expect(s.m.crashed).toBe(false);
    fly(s, 8);                                   // the normal model takes over and recovers speed
    expect(s.m.crashed).toBe(false);
  });
  it('Kulbit completes a full somersault and the F-35 cannot do either', () => {
    const s = airborne(SU57, 330);
    expect(s.sp.startKulbit()).toMatch(/kulbit/i);
    for (let t = 0; t < 4 && s.sp.active; t += FlightModel.DT) s.sp.step(FlightModel.DT, s.fc);
    expect(s.sp.active).toBe(false);
    expect(Math.abs(s.m.pitchDeg)).toBeLessThan(15);
    expect(s.m.heading < 10 || s.m.heading > 350).toBe(true);
    const f = airborne(F35, 330);
    expect(f.sp.startCobra()).toMatch(/Su-57/);
    expect(f.sp.active).toBe(false);
  });
  it('refuses outside the entry window', () => {
    expect(airborne(SU57, 150).sp.startCobra()).toMatch(/200–470/);
    expect(airborne(SU57, 320, 150).sp.startCobra()).toMatch(/Too low/);
  });
});

describe('F-35 STOVL', () => {
  it('converts to a hover that holds height, then accelerates back to wing-borne flight', () => {
    const s = airborne(F35, 200, 900);
    expect(s.sp.toggleStovl(s.fc)).toMatch(/hover/i);
    fly(s, 40);
    expect(s.sp.mode).toBe('hover');
    const y0 = s.m.pos.y; s.fc.throttle = 0.5;
    fly(s, 10);
    expect(Math.abs(s.m.pos.y - y0)).toBeLessThan(3);
    fly(s, 4, ['pitchDown']);                    // nose down: hover-taxi forward
    expect(s.m.vel.length()).toBeGreaterThan(6);
    s.sp.toggleStovl(s.fc);
    fly(s, 20);
    expect(s.sp.mode).toBe('none');
    expect(s.m.iasKt).toBeGreaterThan(150);
    expect(s.m.crashed).toBe(false);
  });
  it('takes off vertically from the ground and lands vertically', () => {
    const u = new Unit('ownship', 'Specter-2', 'player', F35, world, 2), m = u.model;
    m.setHeadingPlace(0, terrainHeight(0, 900) + F35.gearHeight, 900, 0, 0, 0); m.onGround = true; m.gearPos = 1; m.startEngines(); m.engineN = 0.6;
    const fc = new FlightController(), sp = new SpecialFlight(u);
    let touch = 0; m.onTouchdown = () => { touch++; };
    expect(sp.toggleStovl(fc)).toMatch(/Lift fan/);
    fc.throttle = 0.8;
    for (let t = 0; t < 6; t += FlightModel.DT) sp.step(FlightModel.DT, fc);
    expect(m.onGround).toBe(false);
    expect(m.pos.y - terrainHeight(m.pos.x, m.pos.z)).toBeGreaterThan(20);
    fc.throttle = 0.3;
    for (let t = 0; t < 25; t += FlightModel.DT) sp.step(FlightModel.DT, fc);
    expect(m.onGround).toBe(true);
    expect(touch).toBe(1);
    expect(m.crashed).toBe(false);
    expect(new SpecialFlight(new Unit('x', 'x', 'player', SU57, world, 3)).toggleStovl(fc)).toMatch(/F-35/);
  });
});

describe('voice: skills and the commands sheet', () => {
  it('parses the new commands without disturbing existing ones', () => {
    expect(one('cobra')).toEqual({ t: 'cobra' });
    expect(one('do a kulbit')).toEqual({ t: 'kulbit' });
    expect(one('hover')).toEqual({ t: 'stovl' });
    expect(one('vertical takeoff')).toEqual({ t: 'stovl' });
    expect(one('jammer on')).toEqual({ t: 'ecm' });
    expect(one('show commands')).toEqual({ t: 'controls' });
    expect(one('take off')).toEqual({ t: 'autotakeoff' });
    expect(one('land the aircraft')).toEqual({ t: 'autoland' });
  });
});
