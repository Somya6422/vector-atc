import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../src/game/GameState';
import { SAVE_KEY, SaveManager, validateSave, type StorageLike } from '../src/persistence/SaveManager';
import { NyxBrain } from '../src/characters/Nyx';
import { Settings } from '../src/ui/Settings';
import { buildAircraft, checkVisorInvariant, makeHelmet } from '../src/flight/AircraftMesh';
import * as THREE from 'three';

class MemStore implements StorageLike {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

describe('GameStateMachine', () => {
  const full = () => { const g = new GameStateMachine(); g.go('MAIN_MENU'); return g; };
  it('follows the campaign path and rejects invalid transitions', () => {
    const g = full();
    expect(g.go('ACTIVE_MISSION')).toBe(false);
    for (const s of ['PILOT_SELECTION', 'HANGAR', 'MISSION_BRIEFING', 'LOADING', 'TAKEOFF', 'ACTIVE_MISSION', 'DEBRIEFING', 'HANGAR'] as const) expect(g.go(s)).toBe(true);
    expect(g.state).toBe('HANGAR');
  });
  it('rejects double launching and duplicate transitions', () => {
    const g = full(); g.go('HANGAR'); g.go('MISSION_BRIEFING');
    expect(g.go('LOADING')).toBe(true);
    expect(g.go('LOADING')).toBe(false);
    expect(g.go('MISSION_BRIEFING')).toBe(false);
  });
  it('pause resumes only to the state it came from', () => {
    const g = full(); g.go('MISSION_BRIEFING'); g.go('LOADING'); g.go('TAKEOFF'); g.go('ACTIVE_MISSION');
    expect(g.go('PAUSED')).toBe(true);
    expect(g.go('TAKEOFF')).toBe(false);
    expect(g.go('ACTIVE_MISSION')).toBe(true);
  });
  it('failure -> retry path and no duplicate subscriptions', () => {
    const g = full(); let calls = 0;
    const fn = () => { calls++; };
    g.subscribe(fn); g.subscribe(fn);
    expect(g.listenerCount).toBe(1);
    g.go('MISSION_BRIEFING'); g.go('LOADING'); g.go('TAKEOFF'); g.go('MISSION_FAILED');
    expect(g.go('MISSION_BRIEFING')).toBe(true);
    expect(calls).toBe(5);
  });
});

describe('SaveManager', () => {
  it('missing, round-trip, corrupt and invalid data are handled', () => {
    const st = new MemStore();
    const s = new SaveManager(st);
    expect(s.load()).toBe('missing');
    s.newCampaign('B_GIRL_F35');
    s.recordMission('m01', { completed: true, grade: 'A', score: 8000, outcome: 'ok', relationshipDelta: 8, unlocks: ['livery_frost'], flags: { wingman_rescued: true } });
    const s2 = new SaveManager(st);
    expect(s2.load()).toBe('ok');
    expect(s2.data.route).toBe('B_GIRL_F35');
    expect(s2.data.missions.m01.grade).toBe('A');
    expect(s2.data.unlocked).toContain('livery_frost');
    st.setItem(SAVE_KEY, '{not json');
    const s3 = new SaveManager(st);
    expect(s3.load()).toBe('corrupt');
    expect(s3.data.route).toBe(null);
    expect(validateSave({ version: 2 })).toBeNull();
    expect(validateSave({ version: 1, route: 'X' })).toBeNull();
    const weird = validateSave({ version: 1, route: null, relationship: 9999, missions: { a: { grade: 'Z', bestScore: -5 } }, livery: 'nope' })!;
    expect(weird.relationship).toBe(100);
    expect(weird.missions.a.grade).toBe('F');
    expect(weird.livery).toBe('livery_default');
  });
  it('replays never corrupt the primary campaign', () => {
    const s = new SaveManager(new MemStore());
    s.newCampaign('A_BOY_SU57');
    s.recordMission('m01', { completed: true, grade: 'B', score: 5000, outcome: 'ok', relationshipDelta: 8, flags: { x: true } });
    const rel = s.data.relationship;
    s.recordMission('m01', { completed: true, grade: 'S', score: 9000, outcome: 'ok', relationshipDelta: 8, flags: { y: true } });
    s.recordMission('m01', { completed: false, grade: 'F', score: 100, outcome: 'crash' });
    expect(s.data.relationship).toBe(rel);
    expect(s.data.flags.y).toBeUndefined();
    expect(s.data.missions.m01.grade).toBe('S');
    expect(s.data.missions.m01.bestScore).toBe(9000);
    expect(s.data.missions.m01.completed).toBe(true);
  });
});

describe('Settings', () => {
  it('sanitises corrupt values', () => {
    const d = Settings.sanitize({ master: 7, quality: 'ultra', hintLevel: 9, voice: 'yes', subtitleSize: 50 });
    expect(d.master).toBe(1); expect(d.quality).toBe('medium'); expect(d.hintLevel).toBe(1); expect(d.voice).toBe(true); expect(d.subtitleSize).toBe(1.6);
  });
});

describe('Nyx companion state machine', () => {
  const ctx = (boy: { x: number; z: number }, playerIsBoy = true) => ({ boy, player: boy, playerIsBoy, jacket: { x: 4, z: 3 } });
  it('walks to the jacket and sleeps on it', () => {
    const n = new NyxBrain({ x: 0, z: 0 });
    for (let i = 0; i < 60 * 8; i++) n.update(1 / 60, ctx({ x: 30, z: 30 }));
    expect(n.state).toBe('PERCH_JACKET');
    expect(n.anim).toBe('sleep');
    expect(Math.hypot(n.pos.x - 4, n.pos.z - 3)).toBeLessThan(0.4);
    expect(n.purring).toBe(true);
  });
  it('recognises the boy: wakes, stretches and follows him (actual movement)', () => {
    const n = new NyxBrain({ x: 4, z: 3 });
    for (let i = 0; i < 60 * 2; i++) n.update(1 / 60, ctx({ x: 30, z: 30 }));
    expect(n.anim).toBe('sleep');
    const boy = { x: 5, z: 6 };
    const seen = new Set<string>();
    for (let i = 0; i < 60 * 12; i++) { n.update(1 / 60, ctx(boy)); seen.add(n.state); }
    expect(seen.has('STRETCH_PAWS')).toBe(true);
    expect(n.state).toBe('FOLLOW_ACTOR');
    // boy walks away – cat follows
    for (let i = 0; i < 60 * 10; i++) { boy.x += 0.02; boy.z += 0.01; n.update(1 / 60, ctx(boy)); }
    expect(n.distanceTo(boy)).toBeLessThan(2.5);
  });
  it('F interaction changes state & movement; girl interaction still ends with Nyx following the boy', () => {
    const n = new NyxBrain({ x: 4, z: 3 });
    for (let i = 0; i < 60 * 2; i++) n.update(1 / 60, ctx({ x: 30, z: 30 }, false));
    expect(n.state).toBe('PERCH_JACKET');
    const msg = n.interact(false);
    expect(msg).toMatch(/boy/);
    expect(n.state).toBe('STRETCH_PAWS');
    const boy = { x: 12, z: 3 };
    for (let i = 0; i < 60 * 8; i++) n.update(1 / 60, ctx(boy, false));
    expect(n.state).toBe('FOLLOW_ACTOR');
    const n2 = new NyxBrain({ x: 4, z: 3 });
    for (let i = 0; i < 60 * 2; i++) n2.update(1 / 60, ctx({ x: 40, z: 40 }));
    n2.greetReturn();
    expect(n2.state).toBe('STRETCH_PAWS');
  });
  it('is flagged protected', () => { expect(new NyxBrain({ x: 0, z: 0 }).isProtected).toBe(true); });
});

describe('visor invariant', () => {
  it('girl helmet visor is closed, opaque, metallic 1 / roughness 0.05 / transmission 0', () => {
    const h = makeHelmet(true);
    const visor = h.getObjectByName('VISOR') as THREE.Mesh;
    const m = visor.material as THREE.MeshPhysicalMaterial;
    expect(m.metalness).toBe(1); expect(m.roughness).toBe(0.05); expect(m.transmission).toBe(0); expect(m.transparent).toBe(false); expect(m.opacity).toBe(1);
    expect(checkVisorInvariant(h)).toEqual([]);
  });
  it('F-35 (girl) aircraft contains the girl helmet and passes the invariant; tampering is detected', () => {
    const f = buildAircraft('F35');
    let found = false; f.group.traverse(o => { if (o.userData.girlHelmet) found = true; });
    expect(found).toBe(true);
    expect(checkVisorInvariant(f.group)).toEqual([]);
    const visor = f.group.getObjectByName('VISOR') as THREE.Mesh;
    (visor.material as THREE.MeshPhysicalMaterial).transmission = 0.6;
    expect(checkVisorInvariant(f.group).length).toBeGreaterThan(0);
  });
});
