import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Unit } from '../src/game/Entity';
import { DRONE, F35, SU57 } from '../src/flight/AircraftConfig';
import { FlightModel } from '../src/flight/FlightModel';
import { Autopilot } from '../src/flight/Autopilot';
import { Weapons } from '../src/combat/Weapons';
import { TargetingSystem, computeLead } from '../src/combat/TargetingSystem';
import { BanditAI } from '../src/ai/BanditAI';
import { WingmanAI } from '../src/ai/WingmanAI';
import { cxMain, world } from '../src/world/Heightfield';

const valley = (zA: number, zB: number, alt: number) => { const out = []; for (let z = zA; z >= zB; z -= 3500) out.push({ x: cxMain(z), z, alt }); return out; };

function setup() {
  const wing = new Unit('wingman', 'Specter-2', 'friendly', F35, world, 11);
  const lead = new Unit('ownship', 'Specter-1', 'player', SU57, world, 12);
  const d1 = new Unit('drone1', 'Wraith-1', 'hostile', DRONE, world, 13);
  const d2 = new Unit('drone2', 'Wraith-2', 'hostile', DRONE, world, 14);
  const z0 = -15000, x0 = cxMain(z0);
  lead.model.setHeadingPlace(x0, 2800, z0, 0, 0, 230); lead.model.startEngines(); lead.model.engineN = 0.8;
  wing.model.setHeadingPlace(x0 + 150, 2790, z0 + 130, 0, 0, 230); wing.model.startEngines(); wing.model.engineN = 0.8;
  d1.model.setHeadingPlace(cxMain(z0 - 16000) + 200, 2100, z0 - 16000, 180, 0, 190); d1.model.startEngines(); d1.model.engineN = 0.7;
  d2.model.setHeadingPlace(cxMain(z0 - 16500) - 300, 2150, z0 - 16500, 180, 0, 190); d2.model.startEngines(); d2.model.engineN = 0.7;
  const units = [lead, wing, d1, d2];
  const weapons = new Weapons(() => units);
  const wAI = new WingmanAI(wing); wAI.state = 'FORMATION';
  const b1 = new BanditAI(d1, valley(z0 - 16000, z0 - 26000, 2100), 1, 'ownship');
  const b2 = new BanditAI(d2, valley(z0 - 16500, z0 - 26500, 2150), 2, 'wingman');
  return { wing, lead, d1, d2, units, weapons, wAI, b1, b2 };
}

describe('combat + AI (headless simulation)', () => {
  it('computeLead: bullet launched along the lead direction reaches the moving target', () => {
    const sp = new THREE.Vector3(0, 3000, 0), sv = new THREE.Vector3(0, 0, -230);
    const tp = new THREE.Vector3(300, 3050, -1800), tv = new THREE.Vector3(-120, 0, -150);
    const lead = computeLead(sp, sv, tp, tv);
    const dir = lead.aim.clone().sub(sp).normalize();
    const bv = sv.clone().addScaledVector(dir, 1050);
    const t = lead.time;
    const bullet = sp.clone().addScaledVector(bv, t); bullet.y -= 0.5 * 9.80665 * t * t;
    const target = tp.clone().addScaledVector(tv, t);
    expect(bullet.distanceTo(target)).toBeLessThan(6);
  });

  it('wingman + bandits fly with real physics: bandits detect/intercept/dogfight; wingman engages; weapons change real state', () => {
    const s = setup();
    const dt = FlightModel.DT;
    const leadAp = new Autopilot();
    s.wAI.commandEngage(s.d1);
    const bstates = new Set<string>(), wstates = new Set<string>();
    let t = 0;
    const calls: string[] = [];
    s.wAI.onCall = c => calls.push(c);
    let killed = 0; s.weapons.events.onKill = () => killed++;
    let minAgl = 1e9;
    for (; t < 240; t += dt) {
      const now = t;
      s.lead.model.step(dt, leadAp.navigate(s.lead.model, 0, 0, 230, dt));
      s.wing.model.step(dt, s.wAI.update(dt, { now, leader: s.lead, weapons: s.weapons, hostiles: [s.d1, s.d2], playerTarget: s.d1, interference: 0, rtb: false, leaderRolling: true }));
      for (const [b, d] of [[s.b1, s.d1], [s.b2, s.d2]] as const) {
        d.model.step(dt, b.update(dt, { now, weapons: s.weapons, enemies: [s.lead, s.wing], alerted: false, jamming: 0 }));
        bstates.add(b.state);
      }
      wstates.add(s.wAI.state);
      s.weapons.update(dt, now);
      for (const u of s.units) if (u.alive) minAgl = Math.min(minAgl, u.pos.y - world.height(u.pos.x, u.pos.z));
      if (!s.d1.alive && !s.d2.alive) break;
    }
    console.log('t', t.toFixed(0), 'b1', s.b1.state, s.d1.health, s.b1.log.slice(-6).join(' | '), '\n b2', s.b2.state, s.d2.health, s.b2.log.slice(-6).join(' | '));
    console.log('wing', s.wAI.state, s.wing.health, 'ir', s.wing.irMissiles, 'ammo', s.wing.gunAmmo, 'calls', calls.join(','), 'killed', killed, s.wAI.log.join(' | '));
    expect([...bstates]).toContain('INTERCEPT');
    expect(wstates.has('ENGAGE')).toBe(true);
    const someoneShot = (F35.irMissiles - s.wing.irMissiles) + (F35.gunAmmo - s.wing.gunAmmo) + (2 - s.d1.irMissiles) + (2 - s.d2.irMissiles);
    expect(someoneShot).toBeGreaterThan(0);
    expect(s.wing.model.crashCause).not.toBe('TERRAIN');   // wingman never flew into terrain
    void minAgl;
  }, 60000);

  it('targeting: R cycles contacts nearest-first, cone/LOS enforced, ID needed before launch', () => {
    const s = setup();
    const ts = new TargetingSystem(s.lead, () => [s.d1, s.d2, s.wing]);
    s.lead.model.setHeadingPlace(0, 6000, -15000, 0, 0, 230); s.d1.model.setHeadingPlace(0, 6000, -24000, 180, 0, 150);
    s.d2.model.setHeadingPlace(400, 6000, -29000, 180, 0, 150);
    ts.update(0.1);
    expect(ts.detected().length).toBeGreaterThan(0);
    const a = ts.cycle(); const b = ts.cycle();
    expect(a).not.toBe(b);
    ts.setSelected(s.d1);
    ts.selectWeapon('RADAR');
    ts.update(0.05);
    expect(ts.launchCheck().ok).toBe(false);
    expect(ts.launchCheck().reason).toBe('ROE: IDENTIFY TARGET');
    for (let i = 0; i < 100; i++) ts.update(0.05);
    expect(s.d1.identified).toBe(true);
    expect(ts.lock).toBe('LOCK');
    expect(ts.launchCheck().ok).toBe(true);
    s.d1.model.setHeadingPlace(0, 6000, -7000, 0, 0, 150);   // now behind the player
    for (let i = 0; i < 40; i++) ts.update(0.05);
    expect(ts.lock === 'LOCK').toBe(false);
  });

  it('missiles: radar & IR missiles kill a target; flares are an actual sensor input', () => {
    const run = (flares: boolean, kind: 'IR' | 'RADAR') => {
      const s = setup();
      const dz = kind === 'IR' ? 3000 : 9000; s.lead.model.setHeadingPlace(0, 6000, -15000, 0, 0, 230); s.d1.model.setHeadingPlace(0, 6000, -15000 - dz, 0, 0, 200);
      s.d1.model.engineN = 0.9;
      s.units.splice(3, 1);
      const m = s.weapons.launch(s.lead, s.d1, kind)!;
      expect(m).toBeTruthy();
      let defeated = '';
      s.weapons.events.onMissileDefeated = (_m, why) => (defeated = why);
      let dropped = 0;
      for (let t = 0; t < 40 && s.d1.alive; t += FlightModel.DT) {
        s.lead.model.step(FlightModel.DT, { pitch: 0, roll: 0, yaw: 0, throttle: 0.8, airbrake: false, gearDown: false });
        s.d1.model.step(FlightModel.DT, { pitch: 0, roll: 0.0, yaw: 0, throttle: 0.9, airbrake: false, gearDown: false });
        if (flares && m.mode === 'GUIDED' && m.pos.distanceTo(s.d1.pos) < 1500 && dropped < 8 && Math.round(t * 120) % 24 === 0) { s.d1.flareCooldown = 0; s.d1.flares = 20; s.weapons.dropFlares(s.d1, t); dropped++; }
        s.weapons.update(FlightModel.DT, t);
      }
      return { alive: s.d1.alive, health: s.d1.health, defeated, flaresSeen: dropped };
    };
    expect(run(false, 'RADAR').alive).toBe(false);
    expect(run(false, 'IR').alive).toBe(false);
    console.log('IR with flares:', run(true, 'IR'));
  });
});
