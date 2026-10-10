import * as THREE from 'three';
import { cxMain, isPaved, terrainHeight } from './Heightfield';
import { Rng, smoothstep } from '../util/math';

export interface CityBox { x: number; z: number; hx: number; hz: number; top: number }

/** Lit-window facade texture: dark panels with a grid of white windows (tinted per building by the instance colour). */
function windowTexture(): THREE.Texture {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128;
  const g = c.getContext('2d')!, rng = new Rng(4);
  g.fillStyle = '#07080c'; g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 8) for (let x = 4; x < 60; x += 8) {
    if (rng.next() < 0.42) continue;
    const v = 120 + Math.floor(rng.next() * 135); g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 4, 4);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter;
  return t;
}

/**
 * Neon megacity set dressing for the Midnight Canyon theatre: towers on the valley floor either side of the flight lane
 * (the centre of the valley stays open), glowing neon strips on some roofs. Buildings are solid: their boxes are exported
 * so the flight session can treat them as obstacles.
 */
export class NeonCity {
  readonly group = new THREE.Group();
  readonly boxes: CityBox[] = [];
  constructor() {
    const rng = new Rng(1971);
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
    const MAX = 900;
    const towers = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: windowTexture(), color: 0xffffff }), MAX);
    const strips = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), MAX);
    const neon = [0xff2fd6, 0x29f0ff, 0x8a5bff, 0xff7a2f, 0x3dff9b];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    let n = 0, ns = 0;
    for (let z = -2600; z > -31000 && n < MAX; z -= 210) {
      for (const side of [-1, 1]) {
        for (let k = 0; k < 2 && n < MAX; k++) {
          const off = 650 + rng.next() * 2100, x = cxMain(z) + side * off + rng.signed() * 60, zz = z + rng.signed() * 70;
          if (isPaved(x, zz)) continue;
          const h0 = terrainHeight(x, zz), floor = terrainHeight(cxMain(zz), zz);
          if (h0 - floor > 70) continue;                                    // valley floor only
          const e = 30, slope = Math.abs(terrainHeight(x + e, zz) - terrainHeight(x - e, zz)) / (2 * e);
          if (slope > 0.25) continue;
          const w = 40 + rng.next() * 70, d = 40 + rng.next() * 70;
          const ht = (60 + rng.next() * 170) * (0.6 + 0.6 * smoothstep(2600, 900, off));   // taller towers hug the lane
          p.set(x, h0 - 2, zz); s.set(w, ht, d); q.identity();
          m.compose(p, q, s); towers.setMatrixAt(n, m);
          col.set(neon[Math.floor(rng.next() * neon.length)]).lerp(new THREE.Color(0xffffff), 0.35); towers.setColorAt(n, col);
          this.boxes.push({ x, z: zz, hx: w / 2 + 6, hz: d / 2 + 6, top: h0 - 2 + ht + 4 });
          n++;
          if (rng.next() < 0.55 && ns < MAX) {
            p.set(x, h0 - 2 + ht, zz); s.set(w * 1.02, 2.2, d * 1.02); m.compose(p, q, s); strips.setMatrixAt(ns, m);
            strips.setColorAt(ns, col.set(neon[Math.floor(rng.next() * neon.length)])); ns++;
          }
        }
      }
    }
    towers.count = n; strips.count = ns;
    towers.instanceMatrix.needsUpdate = true; strips.instanceMatrix.needsUpdate = true;
    if (towers.instanceColor) towers.instanceColor.needsUpdate = true;
    if (strips.instanceColor) strips.instanceColor.needsUpdate = true;
    towers.frustumCulled = false; strips.frustumCulled = false;
    this.group.add(towers, strips);
    // the windows repeat with building height
    (towers.material as THREE.MeshBasicMaterial).map!.repeat.set(3, 6);
  }
  dispose() { this.group.traverse(o => { const mm = o as THREE.Mesh; mm.geometry?.dispose(); const mat = mm.material as THREE.MeshBasicMaterial | undefined; mat?.map?.dispose(); mat?.dispose(); }); }
}
