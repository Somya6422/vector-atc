import { describe, expect, it } from 'vitest';
import { Unit } from '../src/game/Entity';
import { F35, SU57 } from '../src/flight/AircraftConfig';
import { FlightModel } from '../src/flight/FlightModel';
import { Weapons } from '../src/combat/Weapons';
import { WingmanAI, type WingmanState } from '../src/ai/WingmanAI';
import { FIELD_ELEV, cxMain, world } from '../src/world/Heightfield';

function run(start: { x: number; y: number; z: number; hdg: number; kt: number }, cfg = F35, maxT = 420) {
  const wing = new Unit('wingman', 'Specter-2', 'friendly', cfg, world, 5);
  const lead = new Unit('ownship', 'Specter-1', 'player', SU57, world, 6);
  lead.model.setHeadingPlace(0, FIELD_ELEV + SU57.gearHeight, 700, 0, 0, 0); lead.model.onGround = true; lead.model.gearPos = 1;
  wing.model.setHeadingPlace(start.x, start.y, start.z, start.hdg, 0, start.kt / 1.944);
  wing.model.startEngines(); wing.model.engineN = 0.6; wing.model.gearPos = 0;
  const units = [lead, wing];
  const weapons = new Weapons(() => units);
  const ai = new WingmanAI(wing); ai.state = 'RTB' as WingmanState;
  const dt = FlightModel.DT; let ctl = { pitch: 0, roll: 0, yaw: 0, throttle: 0, airbrake: false, gearDown: false };
  let t = 0, touch = 0, tdKt = 0, tdSink = 0;
  wing.model.onTouchdown = e => { touch++; tdKt = e.iasKt; tdSink = e.sink; };
  for (let i = 0; t < maxT; i++, t += dt) {
    if (i % 4 === 0) ctl = ai.update(dt * 4, { now: t, leader: lead, weapons, hostiles: [], playerTarget: null, interference: 0.2, rtb: true, leaderRolling: false });
    wing.model.step(dt, ctl);
    if (wing.model.crashed || (ai.state as WingmanState) === 'PARKED') break;
  }
  return { t, state: ai.state, crashed: wing.model.crashed, cause: wing.model.crashCause, touch, tdKt, tdSink, pos: wing.pos.toArray().map(Math.round), log: ai.log.join(' | '), v: wing.model.vel.length() };
}

describe('wingman RTB and landing (headless, real physics)', () => {
  const cases: [string, { x: number; y: number; z: number; hdg: number; kt: number }][] = [
    ['north valley, low, heading south', { x: cxMain(-9000), y: 1200, z: -9000, hdg: 190, kt: 360 }],
    ['north valley, high', { x: cxMain(-14000), y: 3000, z: -14000, hdg: 170, kt: 400 }],
    ['east pass leaving the weather', { x: 6000, y: 2200, z: -11000, hdg: 215, kt: 330 }],
    ['near the field north-west', { x: -1500, y: 900, z: -4000, hdg: 150, kt: 300 }],
    ['south of the field, heading away', { x: 400, y: 900, z: 4000, hdg: 180, kt: 280 }],
  ];
  it.each(cases)('%s', (_n, start) => {
    const r = run(start);
    console.log(_n, JSON.stringify(r));
    expect(r.crashed).toBe(false);
    expect(r.state).toBe('PARKED');
    expect(r.touch).toBeGreaterThan(0);
    expect(r.tdSink).toBeLessThan(5);
  }, 60000);
});
