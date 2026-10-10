import { describe, expect, it } from 'vitest';
import { GameStateMachine } from '../src/game/GameState';
import { SAVE_KEY, SaveManager, validateSave, type StorageLike } from '../src/persistence/SaveManager';
import { Settings } from '../src/ui/Settings';
import { buildAircraft, makeHelmet } from '../src/flight/AircraftMesh';
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

describe('pilot helmets', () => {
  it('boy and girl have distinct coloured helmets and no mask or cat remains', () => {
    const boy = makeHelmet(false), girl = makeHelmet(true);
    const shell = (h: THREE.Group) => ((h.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHex();
    expect(shell(boy)).not.toBe(shell(girl));
    expect(girl.getObjectByName('VISOR')).toBeUndefined();
    const f = buildAircraft('F35'); let gold = false;
    f.group.traverse(o => { if (o.userData.girlVisor || /GOLD|MIRROR/i.test(o.name)) gold = true; });
    expect(gold).toBe(false);
  });
});
