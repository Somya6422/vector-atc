import * as THREE from 'three';
import { Avatar } from '../characters/Avatar';
import { buildAircraft } from '../flight/AircraftMesh';
import type { Route } from '../persistence/SaveManager';
import type { Input } from './Input';
import type { AudioEngine } from '../audio/AudioEngine';
import { LIVERY_COLORS } from './FlightSession';

const JACKET: V2 = { x: 6.5, z: 8.5 };
const BOUNDS = { x: 16.5, zMin: -25, zMax: 25 };
const OBSTACLES: { x: number; z: number; r: number }[] = [
  { x: -7, z: -4, r: 3.2 }, { x: -7, z: -9, r: 2.2 }, { x: -7, z: 1, r: 2.2 }, { x: 9, z: -5, r: 3.0 }, { x: 9, z: -9.5, r: 2.2 }, { x: 9, z: -0.5, r: 2.0 },
  { x: JACKET.x, z: JACKET.z + 0.7, r: 1.0 }, { x: -13, z: 12, r: 1.4 }, { x: 13, z: 16, r: 1.3 },
];

type V2 = { x: number; z: number };
export type HangarEvent = 'footstep' | 'clink';

/** The tactical hangar: walkable interior with both pilots, the parked jets and the boy's jacket. */
export class HangarScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(58, 1, 0.1, 200);
  readonly boy: Avatar; readonly girl: Avatar;
  readonly player: Avatar; readonly npc: Avatar;
  private camYaw = 0.5;
  private stepT = 0; private clinkT = 4; private t = 0;
  private npcPath: V2[]; private npcIdx = 0; private npcWait = 3;
  onEvent?: (e: HangarEvent, d?: string) => void;
  /** voice "walk to …": the player avatar walks to a point and then calls back */
  private walkTo: { x: number; z: number; done: () => void } | null = null;
  goTo(x: number, z: number, done: () => void) { this.walkTo = { x, z, done }; }
  private jacket: THREE.Group;

  constructor(readonly route: Route, livery: string) {
    const s = this.scene;
    s.background = new THREE.Color(0x14181d);
    s.fog = new THREE.Fog(0x14181d, 25, 90);
    // ---- shell ----
    const floorTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!; g.fillStyle = '#4a4d50'; g.fillRect(0, 0, 256, 256); g.strokeStyle = '#3b3e41'; g.lineWidth = 3; for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.moveTo(0, i); g.lineTo(256, i); g.stroke(); } g.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < 90; i++) g.fillRect(Math.random() * 256, Math.random() * 256, 8 + Math.random() * 20, 2 + Math.random() * 6); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(10, 15); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const floor = new THREE.Mesh(new THREE.BoxGeometry(36, 0.3, 56), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.55, metalness: 0.1 }));
    floor.position.y = -0.15; floor.receiveShadow = true; s.add(floor);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x59636a, roughness: 0.8, metalness: 0.2 });
    const wall = (w: number, h: number, d: number, x: number, y: number, z: number) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMat); m.position.set(x, y, z); m.receiveShadow = true; s.add(m); return m; };
    wall(0.6, 14, 56, -18, 7, 0); wall(0.6, 14, 56, 18, 7, 0); wall(36, 14, 0.6, 0, 7, -28); wall(36, 2, 56, 0, 15, 0);
    // door wall with an open bay (bright outdoors)
    wall(10, 14, 0.6, -13, 7, 28); wall(10, 14, 0.6, 13, 7, 28); wall(16, 4, 0.6, 0, 12, 28);
    const outside = new THREE.Mesh(new THREE.PlaneGeometry(18, 10), new THREE.MeshBasicMaterial({ color: 0xcfe0f0 })); outside.position.set(0, 5, 29); s.add(outside);
    const mountains = new THREE.Mesh(new THREE.PlaneGeometry(40, 8), new THREE.MeshBasicMaterial({ color: 0x8aa0b8 })); mountains.position.set(0, 4, 40); s.add(mountains);
    // roof trusses + light panels
    const beamMat = new THREE.MeshStandardMaterial({ color: 0x2c3237, roughness: 0.6, metalness: 0.6 });
    for (let z = -24; z <= 24; z += 8) { const b = new THREE.Mesh(new THREE.BoxGeometry(36, 0.5, 0.5), beamMat); b.position.set(0, 13.2, z); s.add(b); }
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2dd, emissiveIntensity: 3.5 });
    for (const x of [-9, 0, 9]) for (const z of [-18, -6, 6, 18]) {
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.12, 0.7), lampMat); lamp.position.set(x, 12.8, z); s.add(lamp);
    }
    s.add(new THREE.HemisphereLight(0xcfd8e4, 0x3a3834, 0.45));
    for (const [x, z] of [[-9, -10], [9, -10], [0, 8], [-9, 14], [9, 14]] as const) {
      const pl = new THREE.PointLight(0xfff0dc, 150, 40, 1.8); pl.position.set(x, 11.5, z); pl.castShadow = x === 0 && z === 8; if (pl.castShadow) pl.shadow.mapSize.set(1024, 1024); s.add(pl);
    }
    // props
    const crateMat = new THREE.MeshStandardMaterial({ color: 0x6a5a3c, roughness: 0.9 });
    const mkCrate = (x: number, z: number, w: number, h: number, d: number) => { const c = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), crateMat); c.position.set(x, h / 2, z); c.castShadow = true; c.receiveShadow = true; s.add(c); return c; };
    mkCrate(-13, 12, 2, 1.6, 2); mkCrate(13, 16, 1.8, 1.2, 1.8); mkCrate(-14.5, 15, 1.2, 0.8, 1.2);
    const bench = mkCrate(JACKET.x, JACKET.z + 0.7, 2.2, 0.9, 0.9);
    const toolbox = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.6), new THREE.MeshStandardMaterial({ color: 0xa31f1f, roughness: 0.5, metalness: 0.4 })); toolbox.position.set(-15, 0.55, -20); s.add(toolbox);
    for (let i = 0; i < 4; i++) { const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 1.0, 14), new THREE.MeshStandardMaterial({ color: i % 2 ? 0x2f5a8a : 0x7a2f2f, roughness: 0.6, metalness: 0.4 })); drum.position.set(15.2, 0.5, -18 + i * 1.0); drum.castShadow = true; s.add(drum); }
    // painted floor lines
    const yel = new THREE.MeshStandardMaterial({ color: 0xe0b020, roughness: 0.8 });
    for (const x of [-15, 15]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.02, 50), yel); l.position.set(x, 0.01, 0); s.add(l); }
    // hangar sign
    const signC = document.createElement('canvas'); signC.width = 512; signC.height = 128; const sg = signC.getContext('2d')!; sg.fillStyle = '#1b2530'; sg.fillRect(0, 0, 512, 128); sg.fillStyle = '#7dffb2'; sg.font = 'bold 54px Arial'; sg.textAlign = 'center'; sg.fillText('SPECTER FLIGHT', 256, 66); sg.font = '28px Arial'; sg.fillStyle = '#9ab'; sg.fillText('TACTICAL HANGAR 03', 256, 106);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(8, 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(signC) })); sign.position.set(0, 9, -27.6); s.add(sign);

    // ---- aircraft ----
    const playerIsBoy = route === 'A_BOY_SU57';
    const suJet = buildAircraft('SU57'); suJet.group.position.set(-7, 2.3, -4); suJet.group.rotation.y = 0.4; s.add(suJet.group);
    const f35Jet = buildAircraft('F35', { girlPilot: true }); f35Jet.group.position.set(9, 2.0, -5); f35Jet.group.rotation.y = -0.5; s.add(f35Jet.group);
    const lc = LIVERY_COLORS[livery]; if (lc) (playerIsBoy ? suJet : f35Jet).setLivery(lc);
    for (const v of [suJet, f35Jet]) { v.cockpit.visible = false; v.afterburners.forEach(a => (a.visible = false)); }
    // chocks / tow bars
    // ---- jacket ----
    this.jacket = new THREE.Group(); this.jacket.position.set(JACKET.x, 0.95, JACKET.z + 0.7);
    const jm = new THREE.MeshStandardMaterial({ color: 0x4d5a3a, roughness: 0.95 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.12, 0.65), jm); body.castShadow = true; this.jacket.add(body);
    for (const sx of [-1, 1]) { const sl = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.18), jm); sl.position.set(sx * 0.62, 0, 0.12); sl.rotation.y = sx * 0.5; this.jacket.add(sl); }
    const patch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.01, 0.12), new THREE.MeshStandardMaterial({ color: 0xe0b020 })); patch.position.set(0.25, 0.07, -0.15); this.jacket.add(patch);
    s.add(this.jacket);
    void bench;

    // ---- people ----
    this.boy = new Avatar('Specter-1', false, 0xd8782c);
    this.girl = new Avatar('Specter-2', true, 0x1e9aa3);
    this.boy.group.position.set(3, 0, 6); this.girl.group.position.set(6.5, 0, -1.5);
    s.add(this.boy.group, this.girl.group);
    this.player = playerIsBoy ? this.boy : this.girl;
    this.npc = playerIsBoy ? this.girl : this.boy;
    this.player.group.position.set(playerIsBoy ? 2 : 4, 0, 15); this.player.heading = Math.PI;   // facing -z (into the hangar)
    this.npcPath = playerIsBoy ? [{ x: 6, z: -1.5 }, { x: 10, z: 2 }, { x: 12, z: -2 }] : [{ x: 5, z: 7 }, { x: JACKET.x - 1, z: JACKET.z - 1 }, { x: -3, z: 2 }, { x: -9, z: 6 }, { x: 0, z: 12 }];
  }

  private collide(p: V2, r: number): V2 {
    for (const o of OBSTACLES) {
      const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), min = o.r + r;
      if (d < min && d > 1e-4) { p.x = o.x + (dx / d) * min; p.z = o.z + (dz / d) * min; }
    }
    p.x = Math.max(-BOUNDS.x, Math.min(BOUNDS.x, p.x)); p.z = Math.max(BOUNDS.zMin, Math.min(BOUNDS.zMax, p.z));
    return p;
  }

  update(dt: number, input: Input | null, audioOn: boolean) {
    this.t += dt;
    // ---- player movement (camera-relative) ----
    let mx = 0, mz = 0;
    if (input) {
      if (input.held('KeyQ')) this.camYaw += dt * 1.6;
      if (input.held('KeyE')) this.camYaw -= dt * 1.6;
      this.camYaw -= input.mouseDX * (input.mouseButtons & 2 ? 0.006 : 0);
      const f = (input.held('KeyW') ? 1 : 0) - (input.held('KeyS') ? 1 : 0), r = (input.held('KeyD') ? 1 : 0) - (input.held('KeyA') ? 1 : 0);
      // camera sits behind +z looking toward -z at camYaw=0
      const sy = Math.sin(this.camYaw), cy = Math.cos(this.camYaw);
      mx = (-sy * f + cy * r); mz = (-cy * f - sy * r);
    }
    if (!input || (mx === 0 && mz === 0)) {
      if (this.walkTo) {
        const dx = this.walkTo.x - this.player.position.x, dz = this.walkTo.z - this.player.position.z, d = Math.hypot(dx, dz);
        if (d < 1.6) { const cb = this.walkTo.done; this.walkTo = null; cb(); } else { mx = dx / d; mz = dz / d; }
      }
    } else this.walkTo = null;
    const mag = Math.hypot(mx, mz);
    const pp = this.player.position;
    const moving = mag > 0.01;
    if (moving) {
      const sp = 3.3 * dt;
      const np = this.collide({ x: pp.x + (mx / mag) * sp, z: pp.z + (mz / mag) * sp }, 0.35);
      pp.x = np.x; pp.z = np.z;
      const want = Math.atan2(-mx, -mz);
      let d = want - this.player.heading; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      this.player.heading += d * Math.min(1, dt * 10);
      this.stepT -= dt; if (this.stepT <= 0) { this.stepT = 0.42; this.onEvent?.('footstep'); }
    }
    this.player.update(dt, moving);
    // ---- NPC patrol ----
    this.npcUpdate(dt);
    this.clinkT -= dt; if (this.clinkT <= 0) { this.clinkT = 5 + Math.random() * 6; if (audioOn) this.onEvent?.('clink'); }
    // ---- camera ----
    const target = new THREE.Vector3(pp.x, 1.5, pp.z);
    const dist = 5.2, h = 2.6;
    const cp = new THREE.Vector3(target.x + Math.sin(this.camYaw) * dist, h + 0.6, target.z + Math.cos(this.camYaw) * dist);
    this.camera.position.lerp(cp, 1 - Math.exp(-dt * 6));
    this.camera.lookAt(target);
  }

  private npcUpdate(dt: number) {
    const n = this.npc, path = this.npcPath;
    if (this.npcWait > 0) {
      this.npcWait -= dt; n.update(dt, false);
      n.gesture = this.route === 'A_BOY_SU57' ? 'arms_crossed' : 'idle';
      if (this.npcWait <= 0) { this.npcIdx = (this.npcIdx + 1) % path.length; n.gesture = 'idle'; }
      return;
    }
    const tgt = path[this.npcIdx];
    const dx = tgt.x - n.position.x, dz = tgt.z - n.position.z, d = Math.hypot(dx, dz);
    if (d < 0.25) { this.npcWait = 3.5 + Math.random() * 3; n.update(dt, false); return; }
    const sp = 1.5 * dt;
    n.position.x += (dx / d) * sp; n.position.z += (dz / d) * sp;
    const want = Math.atan2(-dx, -dz); let df = want - n.heading; while (df > Math.PI) df -= 2 * Math.PI; while (df < -Math.PI) df += 2 * Math.PI; n.heading += df * Math.min(1, dt * 6);
    n.update(dt, true, 0.7);
  }

  dispose() {
    this.scene.traverse(o => {
      const m = o as THREE.Mesh; if (!m.geometry?.userData?.shared) m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      const disposeMat = (x: THREE.Material) => { (x as THREE.MeshStandardMaterial).map?.dispose?.(); x.dispose(); };
      if (Array.isArray(mat)) mat.forEach(disposeMat); else if (mat) disposeMat(mat);
    });
  }
  resize(w: number, h: number) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
}
