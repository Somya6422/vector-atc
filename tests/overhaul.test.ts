import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Unit } from '../src/game/Entity';
import { DRONE, F35, SU57 } from '../src/flight/AircraftConfig';
import { FlightModel } from '../src/flight/FlightModel';
import { FlightController } from '../src/flight/FlightController';
import { Assists } from '../src/voice/Assists';
import { MissionDirector, type MissionHost } from '../src/missions/MissionDirector';
import { MISSIONS } from '../src/missions/MissionSpecs';
import { BIOMES } from '../src/world/Biomes';
import { cxMain, resetBlizzard, terrainHeight, world } from '../src/world/Heightfield';
import { parseCommands } from '../src/voice/CommandParser';
import { ACTIONS } from '../src/game/Bindings';
import { Settings } from '../src/ui/Settings';

const one = (s: string) => parseCommands(s)[0];

describe('voice additions keep the existing contracts', () => {
  it('panic recovery and wingman RTB parse; player RTB still means "take me home"', () => {
    expect(one('recover')).toEqual({ t: 'recover' });
    expect(one("I'm lost, auto recover")).toEqual({ t: 'recover' });
    expect(one('wingman return to base')).toEqual({ t: 'wing', cmd: 'rtb' });
    expect(one('take me home')).toEqual({ t: 'goto_home' });
    expect(one('level the wings')).toEqual({ t: 'level' });
    expect(one('cover me')).toEqual({ t: 'wing', cmd: 'cover' });
  });
  it('new keys are bound without clashes and fly-by-wire defaults on', () => {
    for (const id of ['recover', 'mfd', 'radial']) expect(ACTIONS.some(a => a.id === id)).toBe(true);
    expect(new Set(ACTIONS.map(a => a.def)).size).toBe(ACTIONS.length);
    expect(Settings.sanitize({}).fbw).toBe(true);
    expect(Settings.sanitize({ fbw: false }).fbw).toBe(false);
  });
});

describe.each([SU57, F35])('panic auto-recovery – $name', cfg => {
  it('rolls an inverted, nose-low jet upright and leaves it climbing', () => {
    const player = new Unit('ownship', 'Specter-1', 'player', cfg, world, 1);
    const m = player.model, z = -14000, x = cxMain(z);
    m.setHeadingPlace(x, terrainHeight(x, z) + 2600, z, 0, -25, 220);
    m.q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, -1), Math.PI * 0.9));   // nearly inverted
    m.onGround = false; m.gearPos = 0; m.startEngines(); m.engineN = 0.8;
    const fc = new FlightController(); fc.gearDown = false; fc.throttle = 0.6;
    const a = new Assists(player, fc, null as unknown as MissionDirector);
    expect(a.startRecover()).toMatch(/recovery/i);
    let t = 0, minAgl = 1e9;
    for (; t < 25 && a.auto === 'recover'; t += FlightModel.DT) {
      a.update(FlightModel.DT, t, false, false);
      m.step(FlightModel.DT, fc.controls);
      minAgl = Math.min(minAgl, m.pos.y - terrainHeight(m.pos.x, m.pos.z));
    }
    expect(m.crashed).toBe(false);
    expect(a.auto).toBe('none');                 // recovery finished on its own
    expect(a.apActive).toBe(true);               // and handed over to the holding autopilot
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(m.q);
    expect(up.y).toBeGreaterThan(0.95);          // wings level
    expect(m.vel.y).toBeGreaterThan(0);
    expect(minAgl).toBeGreaterThan(100);
    expect(t).toBeLessThan(20);
  });
});

describe('arcade wave survival', () => {
  function rig() {
    resetBlizzard();
    const spec = MISSIONS.survival;
    const player = new Unit('ownship', 'Specter-1', 'player', SU57, world, 1);
    const wingman = new Unit('wingman', 'Specter-2', 'friendly', F35, world, 2);
    const drones = Array.from({ length: spec.drones }, (_, i) => { const d = new Unit('drone' + (i + 1), 'Wraith-' + (i + 1), 'hostile', DRONE, world, 10 + i); d.dormant = true; return d; });
    let spawned = 0, supplies = 0;
    const host: MissionHost = {
      route: 'A_BOY_SU57', player, wingman, drones, say: () => {}, sayRole: () => {}, getFront: () => 0, setFront: () => {},
      activateDrones: () => {}, alertDrones: () => {}, setWingmanRtb: () => {}, wingmanLanded: () => false, wingmanSeparation: () => 300, setInterference: () => {},
      spawnWave: n => { for (let k = 0; k < n; k++) { const d = drones[spawned++]; d.dormant = false; d.model.setHeadingPlace(cxMain(-20000), 3000, -20000, 180, 0, 200); d.model.onGround = false; } },
      dropSupply: () => { supplies++; },
    };
    const z = -14000; player.model.setHeadingPlace(cxMain(z), 2600, z, 0, 0, 230); player.model.onGround = false;
    wingman.model.setHeadingPlace(cxMain(z) + 140, 2620, z + 160, 0, 0, 230); wingman.model.onGround = false;
    const d = new MissionDirector(host, 'survival');
    return { d, drones, player, wingman, get spawned() { return spawned; }, get supplies() { return supplies; } };
  }
  it('runs four escalating waves with supply drops and finishes with a graded result', () => {
    const r = rig();
    r.d.startSurvival();
    expect(r.d.phase).toBe('P3_INTERCEPT');
    expect(r.spawned).toBe(2);
    const waves = MISSIONS.survival.waves!;
    for (let w = 0; w < waves.length; w++) {
      for (const dr of r.drones.slice(0, r.spawned)) if (dr.alive) { dr.model.destroy('ENEMY'); r.d.notifyKill(dr, r.player, w % 2 ? 'GUN' : 'IR'); }
      r.d.update(0.1);
      if (w < waves.length - 1) {
        expect(r.supplies).toBe(w + 1);
        for (let i = 0; i < 210; i++) r.d.update(0.1);           // the 20 s gap before the next wave
        expect(r.spawned).toBe(waves.slice(0, w + 2).reduce((a, b) => a + b, 0));
      }
    }
    expect(r.d.phase).toBe('P6_DEBRIEF');
    const res = r.d.result!;
    expect(res.completed).toBe(true);
    expect(res.stats.wavesCleared).toBe(4);
    expect(res.stats.kills).toBe(12);
    expect(['S', 'A', 'B']).toContain(res.grade);
  });
  it('losing the wingman does not end a survival run; crashing does', () => {
    const r = rig();
    r.d.startSurvival();
    r.wingman.model.destroy('ENEMY');
    r.d.update(0.1);
    expect(r.d.phase).toBe('P3_INTERCEPT');
    r.player.model.destroy('TERRAIN');
    r.d.update(0.1);
    expect(r.d.phase).toBe('FAILED');
    expect(r.d.result!.score).toBeGreaterThanOrEqual(0);
  });
});

describe('theatre presets', () => {
  it('every mission names a biome that exists, and the three theatres differ', () => {
    for (const m of Object.values(MISSIONS)) expect(BIOMES[m.biome]).toBeTruthy();
    expect(new Set(Object.values(MISSIONS).map(m => m.biome))).toEqual(new Set(['arctic', 'desert', 'neon']));
    expect(BIOMES.desert.palette.snowLine).toBe(Infinity);
    expect(BIOMES.neon.city).toBe(true);
    expect(BIOMES.arctic.trees).toBe(true);
  });
});
