import * as THREE from 'three';
import type { Unit } from '../game/Entity';

const N = 48;                    // points per trail
const _v = new THREE.Vector3();

class Trail {
  readonly line: THREE.Line;
  private pos = new Float32Array(N * 3);
  private col = new Float32Array(N * 3);
  private bright = new Float32Array(N);
  private primed = false;
  constructor(parent: THREE.Object3D) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.line.frustumCulled = false; parent.add(this.line);
  }
  push(p: THREE.Vector3, intensity: number, dt: number) {
    for (let i = N - 1; i > 0; i--) { this.pos.copyWithin(i * 3, (i - 1) * 3, (i - 1) * 3 + 3); this.bright[i] = this.bright[i - 1] * Math.max(0, 1 - dt * 0.9); }
    if (!this.primed) { for (let i = 0; i < N; i++) { this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z; } this.primed = true; }
    this.pos[0] = p.x; this.pos[1] = p.y; this.pos[2] = p.z; this.bright[0] = intensity;
    for (let i = 0; i < N; i++) { const b = this.bright[i] * 0.85; this.col[i * 3] = b; this.col[i * 3 + 1] = b; this.col[i * 3 + 2] = b; }
    (this.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.line.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
  dispose() { this.line.removeFromParent(); this.line.geometry.dispose(); (this.line.material as THREE.Material).dispose(); }
}

/** Wingtip condensation trails: appear when an aircraft pulls hard (g load) at altitude, then fade behind it. */
export class VaporTrails {
  private trails = new Map<Unit, [Trail, Trail]>();
  constructor(private parent: THREE.Object3D) {}

  update(units: Unit[], dt: number) {
    for (const u of units) {
      const m = u.model;
      if (u.dormant || m.crashed) { this.drop(u); continue; }
      let t = this.trails.get(u);
      if (!t) { t = [new Trail(this.parent), new Trail(this.parent)]; this.trails.set(u, t); }
      const alt = m.pos.y, g = Math.abs(m.gLoad);
      // visible when pulling >3 g above ~600 m; stronger with more g
      const k = alt > 600 && !m.onGround ? Math.min(1, Math.max(0, (g - 3) / 2.5)) : 0;
      const half = u.cfg.wingspan * 0.5 * 0.96, z = u.cfg.length * 0.16;
      [-1, 1].forEach((s, i) => { _v.set(s * half, 0, z).applyQuaternion(m.q).add(m.pos); t![i].push(_v, k, dt); });
    }
  }
  private drop(u: Unit) { const t = this.trails.get(u); if (t) { t[0].dispose(); t[1].dispose(); this.trails.delete(u); } }
  dispose() { for (const u of [...this.trails.keys()]) this.drop(u); }
}
