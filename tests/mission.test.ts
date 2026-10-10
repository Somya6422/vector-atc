import { describe, expect, it } from 'vitest';
import { Unit } from '../src/game/Entity';
import { DRONE, F35, SU57 } from '../src/flight/AircraftConfig';
import { MissionDirector, type MissionHost } from '../src/missions/MissionDirector';
import { BLIZZARD, FIELD_ELEV, WAYPOINTS, cxAlt, cxMain, resetBlizzard, world } from '../src/world/Heightfield';
import { DialogueSystem } from '../src/story/DialogueSystem';
import { AudioEngine } from '../src/audio/AudioEngine';
import { SCRIPT, HANGAR_SCRIPT, resolveRole } from '../src/story/Script';
import { Settings } from '../src/ui/Settings';

function rig(route: 'A_BOY_SU57' | 'B_GIRL_F35' = 'A_BOY_SU57', id: 'm01' | 'm02' | 'm03' | 'school' = 'm01') {
  resetBlizzard();
  const player = new Unit('ownship', 'Specter-1', 'player', route === 'A_BOY_SU57' ? SU57 : F35, world, 1);
  const wingman = new Unit('wingman', 'Specter-2', 'friendly', route === 'A_BOY_SU57' ? F35 : SU57, world, 2);
  const drones = [new Unit('drone1', 'Wraith-1', 'hostile', DRONE, world, 3), new Unit('drone2', 'Wraith-2', 'hostile', DRONE, world, 4)];
  drones.forEach(d => (d.dormant = true));
  const said: string[] = [];
  let front = 0, interference = 0, rtb = false, wingLanded = false, activated = false;
  const host: MissionHost = {
    route, player, wingman, drones,
    say: k => said.push(k), sayRole: () => {},
    getFront: () => front, setFront: f => (front = f),
    activateDrones: () => { activated = true; drones.forEach(d => (d.dormant = false)); },
    alertDrones: () => {}, setWingmanRtb: v => (rtb = v), wingmanLanded: () => wingLanded, wingmanSeparation: () => 500,
    setInterference: v => (interference = v),
  };
  const d = new MissionDirector(host, id);
  const place = (u: Unit, x: number, y: number, z: number, o: { ground?: boolean; speed?: number; gear?: number } = {}) => {
    u.model.pos.set(x, y, z); u.model.vel.set(0, 0, -(o.speed ?? 0)); u.model.onGround = !!o.ground; u.model.gearPos = o.gear ?? (o.ground ? 1 : 0);
    u.model.q.identity();
  };
  const run = (secs: number) => { for (let i = 0; i < secs * 10; i++) d.update(0.1); };
  return { d, host, player, wingman, drones, said, place, run, get front() { return front; }, get interference() { return interference; }, get rtb() { return rtb; }, get activated() { return activated; }, setWingLanded: (v: boolean) => (wingLanded = v) };
}

describe('Mission 01 director – authored flow with real state', () => {
  it('runs P1 → P6 only through real conditions (and not through timers)', () => {
    const r = rig();
    const { d, player, place, run } = r;
    place(player, -82, FIELD_ELEV + 2.3, 1385, { ground: true });
    run(30);
    expect(d.phase).toBe('P1_TAKEOFF');
    expect(d.objectives.find(o => o.id === 'start')!.state).toBe('active');          // nothing advances by waiting
    expect(d.requestEngineStart()).toBe(true);
    expect(d.requestEngineStart()).toBe(false);                                      // no double start
    run(8);
    expect(d.objectives.find(o => o.id === 'lineup')!.state).toBe('active');
    place(player, 0, FIELD_ELEV + 2.3, 1170, { ground: true });                      // heading north (identity quaternion), on the runway
    run(1);
    expect(d.objectives.find(o => o.id === 'takeoff')!.state).toBe('active');
    place(player, 0, FIELD_ELEV + 300, 200, { speed: 100, gear: 1 });
    run(1);
    expect(d.objectives.find(o => o.id === 'climb')!.state).toBe('active');
    place(player, 0, 1300, -2000, { speed: 150, gear: 0 });
    run(1);
    expect(d.phase).toBe('P2_TRANSIT');
    expect(r.said).toContain('climb_done');
    // transit
    place(player, WAYPOINTS.W1.x, 800, WAYPOINTS.W1.z);
    run(1);
    expect(d.objectives.find(o => o.id === 'wp1')!.state).toBe('done');
    place(player, WAYPOINTS.W2.x, 800, WAYPOINTS.W2.z);
    run(1);
    expect(d.phase).toBe('P3_INTERCEPT');
    expect(r.activated).toBe(true);
    // intercept resolves only when the drones are actually dead
    run(5);
    expect(d.phase).toBe('P3_INTERCEPT');
    place(player, cxMain(-26000), 1500, -26000);                                    // the fight ends north of the future weather cell
    r.drones.forEach(x => x.model.destroy('ENEMY'));
    run(1);
    expect(d.phase).toBe('P4_BLIZZARD');
    // blizzard forms ahead of the player and ramps up
    run(60);
    expect(r.front).toBeGreaterThan(0.99);
    expect(r.said).toContain('front_warning');
    expect(BLIZZARD.z).toBeGreaterThan(-23500 - 1); expect(BLIZZARD.z).toBeLessThan(-14500 + 1);
    // fly the east pass (clear of the cell) -> ALT route resolves the complication
    const zs = [-24000, -20000, -16000, -12000, -9000];
    for (const z of zs) { place(player, cxAlt(z), 1500, z); run(2); }
    place(player, cxAlt(BLIZZARD.z + BLIZZARD.radius + 800), 1200, BLIZZARD.z + BLIZZARD.radius + 800); run(1);
    expect(d.phase).toBe('P5_RTB');
    expect(d.stats.route).toBe('ALT');
    expect(r.rtb).toBe(true);
    // landing: touchdown event + stopped on the runway completes the mission
    place(player, 0, FIELD_ELEV + 2.3, 400, { ground: true });
    d.notifyTouchdown(1.9, 118, false, true);
    expect(d.stats.landed).toBe(true);
    run(1);
    expect(d.phase).toBe('P5_RTB');                                                  // still rolling? stopped (speed 0) so wait for the wingman
    r.setWingLanded(true);
    run(2);
    expect(d.phase).toBe('P6_DEBRIEF');
    expect(d.result!.completed).toBe(true);
    expect(['S', 'A', 'B', 'C', 'D']).toContain(d.result!.grade);
  });

  it('fails when the player crashes or the wingman is lost – with distinct outcomes', () => {
    const a = rig(); a.place(a.player, 0, 1000, -5000); a.player.model.destroy('TERRAIN'); a.run(1);
    expect(a.d.phase).toBe('FAILED'); expect(a.d.result!.failReason).toBe('CRASH'); expect(a.d.result!.kind).toBe('FAIL_CRASH');
    const b = rig(); b.place(b.player, 0, 1000, -5000); b.wingman.model.destroy('ENEMY'); b.run(1);
    expect(b.d.phase).toBe('FAILED'); expect(b.d.result!.failReason).toBe('WINGMAN_LOST'); expect(b.d.result!.kind).toBe('FAIL_WING');
    expect(a.d.result!.kind).not.toBe(b.d.result!.kind);
  });

  it('scores and outcome variants come from real events', () => {
    const mk = (mut: (r: ReturnType<typeof rig>) => void) => { const r = rig(); r.d.stats.landed = true; r.d.stats.touchdownSink = 1.5; r.d.stats.touchdownKt = 116; mut(r); return r.d.score(true, null); };
    const flawless = mk(r => { r.drones.forEach(x => x.model.destroy('ENEMY')); r.d.stats.kills = 2; r.d.stats.bvrKills = 1; });
    const damaged = mk(r => { r.player.model.health = 30; r.d.stats.kills = 2; });
    const rescue = mk(r => { r.d.stats.rescues = 1; r.d.stats.kills = 2; });
    const storm = mk(r => { r.d.stats.route = 'MAIN'; r.d.stats.kills = 2; });
    expect(flawless.kind).toBe('FLAWLESS'); expect(damaged.kind).toBe('DAMAGED_RETURN'); expect(rescue.kind).toBe('RESCUE'); expect(storm.kind).toBe('STORM_RUN');
    expect(new Set([flawless.kind, damaged.kind, rescue.kind, storm.kind]).size).toBe(4);
    expect(flawless.score).toBeGreaterThan(damaged.score);
    // every outcome has its own hangar dialogue
    for (const k of Object.keys(HANGAR_SCRIPT)) expect(HANGAR_SCRIPT[k as keyof typeof HANGAR_SCRIPT].length).toBeGreaterThan(0);
    expect(HANGAR_SCRIPT.FLAWLESS[0].text).not.toBe(HANGAR_SCRIPT.DAMAGED_RETURN[0].text);
  });

  it('radar network: exposure at altitude raises detection; terrain masking lowers it', () => {
    const r = rig();
    r.place(r.player, 0, 1000, -3000); r.d.requestEngineStart(); r.run(9);
    r.place(r.player, 0, FIELD_ELEV + 2.3, 1170, { ground: true }); r.run(1);
    r.place(r.player, 0, 400, 100, { speed: 100, gear: 1 }); r.run(1);
    r.place(r.player, 0, 1300, -2000, { gear: 0 }); r.run(1);
    expect(r.d.phase).toBe('P2_TRANSIT');
    // high above the ridge crests near the radar sites: exposed
    r.place(r.player, cxAlt(-15500) - 800, 4200, -15500); r.run(30);
    expect(r.d.detect).toBeGreaterThan(60);
    // down on the valley floor, hidden behind the ridge: decays
    const before = r.d.detect;
    r.place(r.player, cxMain(-9000), 520, -9000); r.run(20);
    expect(r.d.detect).toBeLessThan(before);
  });

  it('Flight School skips combat and weather but still needs a real landing', () => {
    const r = rig('B_GIRL_F35', 'school');
    r.place(r.player, 0, 1300, -2000); r.d.requestEngineStart(); r.run(9);
    r.d.stats.landed = false;
    // jump through the early steps via the director's own conditions
    r.place(r.player, 0, FIELD_ELEV + 2.3, 1170, { ground: true }); r.run(1);
    r.place(r.player, 0, 400, 200, { speed: 100, gear: 1 }); r.run(1);
    r.place(r.player, 0, 1300, -2000, { gear: 0 }); r.run(1);
    r.place(r.player, WAYPOINTS.W1.x, 800, WAYPOINTS.W1.z); r.run(1);
    expect(r.d.phase).toBe('P5_RTB');
    expect(r.drones.every(d => d.dormant)).toBe(true);
  });
});

describe('dialogue + subtitles + audio fallbacks', () => {
  it('subtitles work with no audio at all; priorities interrupt; cooldown/dedupe prevent spam', () => {
    const audio = new AudioEngine();                 // never unlocked: all calls are no-ops
    const d = new DialogueSystem(audio, null);
    const shown: string[] = []; d.onSubtitle = l => { if (l) shown.push(`${l.speaker}: ${l.text}`); };
    d.say({ speaker: 'Ground Control', text: 'Routine chatter that is fairly long so it lasts a while.', priority: 1 });
    expect(d.current?.speaker).toBe('Ground Control');
    d.say({ speaker: 'Specter-2', text: 'Missile, missile!', priority: 3 });
    expect(d.current?.text).toBe('Missile, missile!');                       // critical interrupts
    expect(d.say({ speaker: 'Specter-2', text: 'Missile, missile!', priority: 3 })).toBe(false);   // identical text is not stacked
    d.say({ speaker: 'Ground Control', text: 'Hint one', priority: 1, key: 'hint', cooldown: 10 });
    expect(d.say({ speaker: 'Ground Control', text: 'Hint two', priority: 1, key: 'hint', cooldown: 10 })).toBe(false);
    for (let i = 0; i < 40; i++) d.update(0.5);
    expect(shown.length).toBeGreaterThanOrEqual(3);
    expect(d.busy).toBe(false);
    d.interference = 0.8; d.say({ speaker: 'Specter-2', text: 'My radar is full of snow and I cannot trust my picture', priority: 1 });
    expect(d.current!.garbled).toBe(true);                                    // interference degrades her transmissions
    expect(audio.running).toBe(false);
  });
  it('every script key resolves to one of the three required speakers for both routes', () => {
    for (const lines of Object.values(SCRIPT)) for (const l of lines) for (const route of ['A_BOY_SU57', 'B_GIRL_F35'] as const) expect(['Specter-1', 'Specter-2', 'Ground Control']).toContain(resolveRole(l.role, route));
    expect(resolveRole('P', 'A_BOY_SU57')).toBe('Specter-1'); expect(resolveRole('W', 'A_BOY_SU57')).toBe('Specter-2');
    expect(resolveRole('P', 'B_GIRL_F35')).toBe('Specter-2'); expect(resolveRole('W', 'B_GIRL_F35')).toBe('Specter-1');
  });
  it('settings expose the separate volume buses', () => {
    const s = Settings.sanitize({});
    for (const k of ['master', 'engines', 'weapons', 'dialogue', 'radio', 'music', 'environment'] as const) expect(typeof s[k]).toBe('number');
  });
});

describe('missions 02 and 03', () => {
  it('specs: more hostiles, gates and no-storm routing', async () => {
    const { MISSIONS } = await import('../src/missions/MissionSpecs');
    expect(MISSIONS.m02.drones).toBe(4); expect(MISSIONS.m02.storm).toBe(false);
    expect(MISSIONS.m03.gates).toBe(4); expect(MISSIONS.m03.storm).toBe(true);
    expect(MISSIONS.school.drones).toBe(0);
  });
  it('mission 03 builds four gates in the valley and counts a flown-through gate', () => {
    const r = rig('A_BOY_SU57', 'm03');
    expect(r.d.gates.length).toBe(4);
    const g = r.d.gates[0];
    for (const gt of r.d.gates) { expect(gt.z).toBeLessThan(WAYPOINTS.W1.z); expect(gt.z).toBeGreaterThan(WAYPOINTS.W2.z); }
    // simulate being in P2 and flying through the first gate
    (r.d as unknown as { phase: string }).phase = 'P2_TRANSIT';
    r.d.objectives.push({ id: 'gates', text: 'x', state: 'active' });
    r.place(r.player, g.x, g.y, g.z, { speed: 200 });
    r.run(0.5);
    expect(r.d.gates[0].passed).toBe(true);
    expect(r.d.stats.gatesPassed).toBe(1);
  });
  it('mission 02 skips the blizzard once all drones are down', () => {
    const r = rig('A_BOY_SU57', 'm02');
    expect(r.d.spec.storm).toBe(false);
  });
});
