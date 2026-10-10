import { describe, expect, it } from 'vitest';
import { FlightModel, type FlightControls } from '../src/flight/FlightModel';
import { F35, SU57 } from '../src/flight/AircraftConfig';
import { FIELD_ELEV, LINEUP, RUNWAY, world } from '../src/world/Heightfield';
import { AIM_OFFSET, GLIDE_DEG, approachInfo, centrelineHeading } from '../src/world/Landing';
import { Autopilot } from '../src/flight/Autopilot';
import { KT, DEG, clamp } from '../src/util/math';

const ctl = (o: Partial<FlightControls> = {}): FlightControls => ({ pitch: 0, roll: 0, yaw: 0, throttle: 0, airbrake: false, gearDown: true, ...o });

function spawn(cfg = SU57) {
  const m = new FlightModel(cfg, world, 7);
  m.setHeadingPlace(LINEUP.x, FIELD_ELEV + cfg.gearHeight, LINEUP.z, 0);
  m.startEngines();
  for (let i = 0; i < 120 * 6; i++) m.step(FlightModel.DT, ctl()); // spool to idle
  return m;
}

describe.each([SU57, F35])('flight model – $name', (cfg) => {
  it('takes off with rotation near 135 kt, retracts gear and climbs through 4000 ft', () => {
    const m = spawn(cfg);
    expect(m.onGround).toBe(true);
    expect(Math.abs(m.vel.length())).toBeLessThan(1);
    let t = 0, rotated = false, rotSpeed = 0, liftoffZ = 0, liftoffKt = 0, gear = true;
    for (; t < 120; t += FlightModel.DT) {
      const kt = m.iasKt;
      if (!rotated && kt >= 135) { rotated = true; rotSpeed = kt; }
      const climbing = !m.onGround;
      if (climbing && liftoffZ === 0) { liftoffZ = m.pos.z; liftoffKt = kt; }
      if (climbing && m.pos.y - FIELD_ELEV > 25) gear = false;
      const pitchHold = rotated ? (m.pitchDeg < 11 ? 0.5 : (m.pitchDeg > 13 ? -0.3 : 0.05)) : 0;
      const pitch = m.pos.y - FIELD_ELEV > 200 ? (m.pitchDeg < 12 ? 0.3 : -0.2) : pitchHold;
      m.step(FlightModel.DT, ctl({ throttle: 1, pitch, gearDown: gear }));
      if (m.pos.y > 1219 + 100 && !gear) break;
    }
    expect(m.crashed).toBe(false);
    expect(rotSpeed).toBeGreaterThan(134);
    expect(liftoffZ).not.toBe(0);
    expect(LINEUP.z - liftoffZ).toBeLessThan(2300); // lifts off inside the 2400 m runway
    expect(liftoffKt).toBeGreaterThan(125);
    expect(liftoffKt).toBeLessThan(200);
    expect(m.pos.y).toBeGreaterThan(1219);             // 4000 ft MSL
    expect(m.gearPos).toBeLessThan(0.05);
  });

  it('level flight with neutral stick holds attitude and ~1 g', () => {
    const m = new FlightModel(cfg, world, 3);
    m.setHeadingPlace(0, 3000, 0, 90, 2, 200);
    m.startEngines(); m.engineN = 0.7;
    for (let i = 0; i < 120 * 10; i++) m.step(FlightModel.DT, ctl({ throttle: 0.7, gearDown: false }));
    expect(m.crashed).toBe(false);
    expect(m.gLoad).toBeGreaterThan(0.7);
    expect(m.gLoad).toBeLessThan(1.4);
    expect(Math.abs(m.heading - 90)).toBeLessThan(2);
  });

  it('control input produces correct sense of motion', () => {
    const run = (o: Partial<FlightControls>, secs = 1.2) => {
      const m = new FlightModel(cfg, world, 3);
      m.setHeadingPlace(0, 4000, 0, 0, 0, 220); m.startEngines(); m.engineN = 0.7;
      for (let i = 0; i < 120 * secs; i++) m.step(FlightModel.DT, ctl({ throttle: 0.7, gearDown: false, ...o }));
      return m;
    };
    expect(run({ pitch: 1 }).pitchDeg).toBeGreaterThan(8);
    expect(run({ pitch: -1 }).pitchDeg).toBeLessThan(-5);
    expect(run({ roll: 1 }, 0.5).rollDeg).toBeGreaterThan(40);
    expect(run({ roll: -1 }, 0.5).rollDeg).toBeLessThan(-40);
    const yr = run({ yaw: 1 });
    expect(yr.heading).toBeGreaterThan(0.5);
    expect(yr.heading).toBeLessThan(180);
  });

  it('stalls when pulled too slow: warning, nose drop, recoverable', () => {
    const m = new FlightModel(cfg, world, 3);
    m.setHeadingPlace(0, 6000, 0, 0, 25, 85); m.startEngines(); m.engineN = 0.3;
    let stalled = false, warn = false;
    for (let i = 0; i < 120 * 14; i++) {
      m.step(FlightModel.DT, ctl({ throttle: 0.2, pitch: 1, gearDown: false }));
      stalled ||= m.stalled; warn ||= m.stallWarning;
    }
    expect(warn).toBe(true);
    expect(stalled).toBe(true);
    // recovery: stick forward + full power
    for (let i = 0; i < 120 * 20; i++) m.step(FlightModel.DT, ctl({ throttle: 1, pitch: m.pitchDeg > -5 ? -0.5 : 0.1, gearDown: false }));
    expect(m.crashed).toBe(false);
    expect(m.stalled).toBe(false);
    expect(m.iasKt).toBeGreaterThan(150);
  });

  it('terrain impact destroys the aircraft', () => {
    const m = new FlightModel(cfg, world, 3);
    m.setHeadingPlace(5000, 900, 5000, 0, -20, 220);
    let cause = '';
    m.onCrash = c => (cause = c);
    for (let i = 0; i < 120 * 30 && !m.crashed; i++) m.step(FlightModel.DT, ctl({ throttle: 0.5, gearDown: false }));
    expect(m.crashed).toBe(true);
    expect(cause).not.toBe('');
  });

  it('transonic drag rise is present around Mach 1', () => {
    const drag = (mach: number) => {
      const m = new FlightModel(cfg, world, 3);
      m.setHeadingPlace(0, 8000, 0, 0, 0, mach * 308);
      m.startEngines(); m.engineN = 0;
      const v0 = m.vel.length();
      m.step(FlightModel.DT, ctl({ gearDown: false }));
      return v0 - m.vel.length();
    };
    expect(drag(1.05) / 1.05 ** 2).toBeGreaterThan(drag(0.6) / 0.6 ** 2);
  });
});

describe('landing', () => {
  it.each([true, false])('stabilised approach (dirNorth=%s) touches down on the runway, rolls out and stops', (dirNorth) => {
    const cfg = SU57;
    const m = new FlightModel(cfg, world, 5);
    const s = dirNorth ? 1 : -1;
    const dz0 = dirNorth ? 4800 : 2800; // north approach: valley bends beyond ~3 km
    m.setHeadingPlace(0, FIELD_ELEV + Math.tan(GLIDE_DEG * DEG) * (dz0 + AIM_OFFSET) + 10, s * (RUNWAY.halfLen + dz0), dirNorth ? 0 : 180, -3, 68);
    m.startEngines(); m.engineN = 0.5; m.gearPos = 1;
    const ap = new Autopilot();
    let tdSink = 0, tdKt = 0, landed = false;
    m.onTouchdown = e => { tdSink = e.sink; tdKt = e.iasKt; landed = true; };
    for (let i = 0; i < 120 * 240 && !m.crashed; i++) {
      const info = approachInfo(m.pos.x, m.pos.y, m.pos.z, dirNorth);
      const agl = m.pos.y - cfg.gearHeight - FIELD_ELEV;
      let c;
      if (!m.onGround) {
        const flare = agl < 16 && info.dz < 900;
        const gam = flare ? -0.7 * DEG : clamp((-GLIDE_DEG - info.gsError * 0.07) * DEG, -5 * DEG, -0.5 * DEG);
        c = ap.navigate(m, centrelineHeading(info) * DEG, gam, flare ? 60 : 66, FlightModel.DT, { useIas: true, gearDown: true });
        if (flare) c.throttle = 0;
      } else {
        c = { pitch: m.pitchDeg > 1 ? -0.25 : 0, roll: 0, yaw: -clamp(info.lateral * 0.01, -0.3, 0.3), throttle: 0, airbrake: true, gearDown: true };
      }
      m.step(FlightModel.DT, c);
      if (i % 480 === 0 || m.crashed) console.log(i / 120 | 0, 'dz', info.dz | 0, 'lat', info.lateral | 0, 'agl', agl | 0, 'kt', m.iasKt | 0, 'vs', m.vel.y.toFixed(1), 'pit', m.pitchDeg.toFixed(1), 'gsErr', info.gsError | 0);
      if (landed && m.onGround && m.vel.length() < 0.5) break;
    }
    expect(m.crashCause).toBe(null);
    expect(landed).toBe(true);
    expect(tdSink).toBeLessThan(4);
    expect(tdKt).toBeGreaterThan(100);
    expect(tdKt).toBeLessThan(145);
    expect(m.onGround).toBe(true);
    expect(m.vel.length()).toBeLessThan(1);
    expect(Math.abs(m.pos.z)).toBeLessThan(1260);   // stopped on the runway
    expect(Math.abs(m.pos.x)).toBeLessThan(40);
  });
});

describe('units', () => { it('knots conversion', () => { expect(Math.round(100 * 1 / 0.514444)).toBeCloseTo(194, 0); expect(KT).toBeCloseTo(1.9438, 3); }); });
