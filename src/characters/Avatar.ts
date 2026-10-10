import * as THREE from 'three';
import { getModel } from '../flight/ModelCache';

export type Gesture = 'idle' | 'arms_crossed' | 'hand_on_hip' | 'crouch';

/**
 * Stylised pilot with colour: orange flight suit and brown hair for the boy, teal suit and auburn ponytail for the girl.
 * Both show their faces in the hangar; the girl no longer wears a mask.
 */
export class Avatar {
  readonly group = new THREE.Group();
  readonly isGirl: boolean;
  private head: THREE.Group; private armL: THREE.Group; private armR: THREE.Group; private legL: THREE.Group; private legR: THREE.Group; private torso: THREE.Mesh;
  private t = Math.random() * 10;
  heading = 0;
  gesture: Gesture = 'idle';
  lookTarget: THREE.Vector3 | null = null;
  private walkPhase = 0;
  private modelMode = false;
  private static headCache: THREE.Vector3 | null = null;
  static headCentre(g: THREE.BufferGeometry): THREE.Vector3 {
    if (Avatar.headCache) return Avatar.headCache.clone();
    const p = g.getAttribute('position'); g.computeBoundingBox(); const top = g.boundingBox!.max.y; const v = new THREE.Vector3(); let n = 0;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > top - 0.22) { v.x += p.getX(i); v.z += p.getZ(i); n++; }
    Avatar.headCache = new THREE.Vector3(v.x / n, top - 0.115, v.z / n); return Avatar.headCache.clone();
  }
  private crouchAmt = 0;

  constructor(readonly name: string, girl: boolean, suitColor: number) {
    this.isGirl = girl;
    this.group.name = 'AVATAR_' + name;
    const suit = new THREE.MeshStandardMaterial({ color: suitColor, roughness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1e2226, roughness: 0.9 });
    const pm = getModel('pilot');
    if (pm) {
      // user-supplied pilot sculpt (base removed, feet at y=0, facing -Z). Limbs are baked into the mesh, so motion is body sway/lean/bob.
      const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.78, metalness: 0.05 });
      this.torso = new THREE.Mesh(Avatar.colourise(pm, suitColor, girl), mat); this.torso.castShadow = true; this.torso.rotation.y = Math.PI; this.group.add(this.torso);   // sculpt faces +Z natively; avatars face -Z
      this.armL = new THREE.Group(); this.armR = new THREE.Group(); this.legL = new THREE.Group(); this.legR = new THREE.Group();
      this.head = new THREE.Group();
      const hc = Avatar.headCentre(pm); hc.x *= -1; hc.z *= -1; this.head.position.copy(hc); this.group.add(this.head);
      this.addHair(girl, 0.16);
      this.modelMode = true;
    } else {
      this.torso = new THREE.Mesh(new THREE.CapsuleGeometry(girl ? 0.2 : 0.23, 0.45, 4, 10), suit); this.torso.position.y = 1.2; this.torso.castShadow = true; this.group.add(this.torso);
      const belt = new THREE.Mesh(new THREE.CylinderGeometry(girl ? 0.2 : 0.23, girl ? 0.2 : 0.23, 0.08, 12), dark); belt.position.y = 0.98; this.group.add(belt);
      this.head = new THREE.Group(); this.head.position.y = 1.72; this.group.add(this.head);
      const skin = new THREE.MeshStandardMaterial({ color: girl ? 0xe0b08c : 0xd9a77f, roughness: 0.7 });
      const skull = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skin); this.head.add(skull);
      this.addHair(girl, 0.135);
      for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 6), new THREE.MeshBasicMaterial({ color: 0x111111 })); e.position.set(sx * 0.045, 0.01, -0.12); this.head.add(e); }
      const mkLimb = (len: number, r: number, mat: THREE.Material) => {
        const g = new THREE.Group(); const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat); m.position.y = -len / 2 - r; m.castShadow = true; g.add(m); return g;
      };
      this.armL = mkLimb(0.5, 0.06, suit); this.armR = mkLimb(0.5, 0.06, suit);
      this.armL.position.set(-0.3, 1.5, 0); this.armR.position.set(0.3, 1.5, 0);
      this.legL = mkLimb(0.62, 0.085, suit); this.legR = mkLimb(0.62, 0.085, suit);
      this.legL.position.set(-0.12, 0.95, 0); this.legR.position.set(0.12, 0.95, 0);
      for (const l of [this.legL, this.legR]) { const boot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.26), dark); boot.position.set(0, -0.8, -0.04); l.add(boot); }
      this.group.add(this.armL, this.armR, this.legL, this.legR);
      if (girl) { const patch = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.01), new THREE.MeshStandardMaterial({ color: 0xd8a437, metalness: 0.8, roughness: 0.3 })); patch.position.set(0.1, 1.4, -0.21); this.group.add(patch); }
    }
  }

  private addHair(girl: boolean, r: number) {
    const hairMat = new THREE.MeshStandardMaterial({ color: girl ? 0x6a2f1c : 0x2b1d14, roughness: 0.85 });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), hairMat); cap.position.y = 0.02; this.head.add(cap);
    if (girl) { const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.2, 4, 8), hairMat); tail.position.set(0, -0.06, 0.16); tail.rotation.x = 0.35; this.head.add(tail); }
  }

  /** Per-vertex colours on a clone of the sculpt: boots, suit, belt, trim, skin (head) – so one plain mesh reads as a dressed pilot. */
  private static colourise(src: THREE.BufferGeometry, suit: number, girl: boolean): THREE.BufferGeometry {
    const g = src.clone(); g.computeBoundingBox();
    const top = g.boundingBox!.max.y, bot = g.boundingBox!.min.y, h = top - bot;
    const p = g.getAttribute('position'), col = new Float32Array(p.count * 3);
    const c = new THREE.Color(), suitC = new THREE.Color(suit), dark = new THREE.Color(0x24282c), skin = new THREE.Color(girl ? 0xe0b08c : 0xd9a77f), belt = new THREE.Color(0x3a2e24), trim = new THREE.Color(girl ? 0xf2f4f6 : 0x2b3a2a);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) - bot;
      if (y < 0.06 * h) c.copy(dark);
      else if (y > h * 0.865) c.copy(skin);
      else if (y > 0.5 * h && y < 0.55 * h) c.copy(belt);
      else if (y > 0.74 * h && y < 0.78 * h) c.copy(trim);
      else c.copy(suitC);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }

  get position() { return this.group.position; }
  update(dt: number, moving: boolean, speed = 1) {
    this.t += dt;
    this.group.rotation.y = this.heading;
    if (moving) this.walkPhase += dt * 7.5 * speed;
    const sw = moving ? Math.sin(this.walkPhase) * 0.7 : 0;
    this.legL.rotation.x = sw; this.legR.rotation.x = -sw;
    const breathe = Math.sin(this.t * 1.7) * 0.015;
    if (this.modelMode) { this.torso.position.y = (moving ? Math.abs(Math.sin(this.walkPhase)) * 0.035 : breathe * 0.5) - this.crouchAmt * 0.25; this.torso.rotation.x = moving ? -0.07 : 0; this.torso.rotation.z = moving ? Math.sin(this.walkPhase) * 0.04 : 0; this.head.position.y = Avatar.headCentre(getModel('pilot')!).y + this.torso.position.y; }
    else this.torso.position.y = 1.2 + breathe;
    const target = this.gesture === 'crouch' ? 1 : 0;
    this.crouchAmt += (target - this.crouchAmt) * Math.min(1, dt * 6);
    this.group.position.y = -this.crouchAmt * 0.35;
    this.legL.rotation.x += this.crouchAmt * -1.0; this.legR.rotation.x += this.crouchAmt * -1.0;
    // arms
    let aL = -sw * 0.8, aR = sw * 0.8, zL = 0, zR = 0;
    if (!moving && this.gesture === 'arms_crossed') { aL = -1.1; aR = -1.1; zL = 0.55; zR = -0.55; }
    if (!moving && this.gesture === 'hand_on_hip') { aR = 0.0; zR = -0.7; aL = 0.1; }
    if (this.gesture === 'crouch') { aL = -0.9; aR = -0.9; }
    this.armL.rotation.x += (aL - this.armL.rotation.x) * Math.min(1, dt * 8); this.armR.rotation.x += (aR - this.armR.rotation.x) * Math.min(1, dt * 8);
    this.armL.rotation.z += (zL - this.armL.rotation.z) * Math.min(1, dt * 8); this.armR.rotation.z += (zR - this.armR.rotation.z) * Math.min(1, dt * 8);
    // head follows look target (body language), plus idle micro-movement
    let hy = Math.sin(this.t * 0.6) * 0.15, hp = 0;
    if (this.lookTarget) {
      const dx = this.lookTarget.x - this.group.position.x, dz = this.lookTarget.z - this.group.position.z;
      let d = Math.atan2(dx, dz) + Math.PI - this.heading; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      hy = Math.max(-1.1, Math.min(1.1, d)); hp = this.lookTarget.y < 0.6 ? 0.35 : 0;
    }
    this.head.rotation.y += (hy - this.head.rotation.y) * Math.min(1, dt * 5);
    this.head.rotation.x += (hp - this.head.rotation.x) * Math.min(1, dt * 5);
    if (this.isGirl && !moving && this.gesture === 'idle') this.head.rotation.z = Math.sin(this.t * 0.4) * 0.12;   // curious head tilt
  }
}
