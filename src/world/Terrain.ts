import * as THREE from 'three';
import { FIELD_ELEV, LAKE, WORLD, cxAlt, cxMain, isPaved, terrainHeight } from './Heightfield';
import { Rng, clamp, lerp, smoothstep } from '../util/math';

const CHUNK = 2000;

function chunkRes(cx: number, cz: number): number {
  // finer meshes around the airfield and along the valley routes the mission uses
  const dAir = Math.hypot(cx, cz);
  const dMain = Math.abs(cx - cxMain(cz)), dAlt = Math.abs(cx - cxAlt(cz));
  const dRoute = Math.min(dMain, dAlt);
  if (dAir < 4500) return 44;
  if (dRoute < 3500 || dAir < 9000) return 28;
  if (dRoute < 6500) return 18;
  return 11;
}

const snow = new THREE.Color(0xf2f5fa), rock = new THREE.Color(0x6f6a64), rock2 = new THREE.Color(0x4f4a47);
const grass = new THREE.Color(0x56603a), grassDry = new THREE.Color(0x7a7447), forest = new THREE.Color(0x2c3d2a), scree = new THREE.Color(0x8b8680);
const tmp = new THREE.Color();

function colorAt(h: number, slope: number, x: number, z: number, out: THREE.Color) {
  const n = (Math.sin(x * 0.0021 + z * 0.0013) + Math.sin(x * 0.0067 - z * 0.0049)) * 0.25 + 0.5;
  // lowland
  out.copy(grass).lerp(grassDry, n * 0.7);
  const forestMask = smoothstep(1250, 900, h) * smoothstep(0.55, 0.3, slope) * smoothstep(0.25, 0.5, n);
  out.lerp(forest, forestMask * 0.85);
  const rockMask = Math.max(smoothstep(0.35, 0.7, slope), smoothstep(1100, 1900, h));
  tmp.copy(rock).lerp(rock2, n);
  out.lerp(tmp, rockMask);
  out.lerp(scree, smoothstep(0.3, 0.45, slope) * 0.2 * (1 - rockMask));
  const snowLine = 2150 + (n - 0.5) * 380;
  const snowMask = smoothstep(snowLine, snowLine + 260, h) * (1 - smoothstep(0.75, 1.05, slope) * 0.75);
  out.lerp(snow, snowMask);
  if (h < LAKE.level + 8 && Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius + 120) out.set(0x4a4a3a);
}

function buildChunk(cx: number, cz: number, res: number, step: number): THREE.Mesh {
  const x0 = cx * CHUNK + WORLD.minX, z0 = cz * CHUNK + WORLD.minZ;
  const n = res + 1, g = n + 2;
  const hs = new Float32Array(g * g);
  for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) hs[j * g + i] = terrainHeight(x0 + (i - 1) * step, z0 + (j - 1) * step);
  const skirt = 90;
  const verts = n * n + 4 * n;
  const pos = new Float32Array(verts * 3), col = new Float32Array(verts * 3), nor = new Float32Array(verts * 3);
  const c = new THREE.Color();
  const put = (k: number, x: number, y: number, z: number, nx: number, ny: number, nz: number, h: number, slope: number) => {
    pos[k * 3] = x; pos[k * 3 + 1] = y; pos[k * 3 + 2] = z;
    nor[k * 3] = nx; nor[k * 3 + 1] = ny; nor[k * 3 + 2] = nz;
    colorAt(h, slope, x, z, c);
    col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const gi = i + 1, gj = j + 1, h = hs[gj * g + gi];
      const dx = hs[gj * g + gi + 1] - hs[gj * g + gi - 1], dz = hs[(gj + 1) * g + gi] - hs[(gj - 1) * g + gi];
      const nx = -dx / (2 * step), nz = -dz / (2 * step);
      const il = 1 / Math.hypot(nx, 1, nz);
      const x = x0 + i * step, z = z0 + j * step;
      let hh = h;
      if (isPaved(x, z) && h < FIELD_ELEV + 2) hh = h - 0.6; // sink the terrain under pavement so slabs sit on top
      put(j * n + i, x, hh, z, nx * il, il, nz * il, h, 1 - il);
    }
  }
  // skirts (hide LOD cracks): bottom, top, left, right
  let k = n * n;
  const edge: number[][] = [[], [], [], []];
  for (let i = 0; i < n; i++) { edge[0].push(i); edge[1].push((n - 1) * n + i); edge[2].push(i * n); edge[3].push(i * n + n - 1); }
  const skirtStart: number[] = [];
  for (const e of edge) {
    skirtStart.push(k);
    for (const v of e) { pos[k * 3] = pos[v * 3]; pos[k * 3 + 1] = pos[v * 3 + 1] - skirt; pos[k * 3 + 2] = pos[v * 3 + 2]; nor[k * 3] = nor[v * 3]; nor[k * 3 + 1] = nor[v * 3 + 1]; nor[k * 3 + 2] = nor[v * 3 + 2]; col[k * 3] = col[v * 3]; col[k * 3 + 1] = col[v * 3 + 1]; col[k * 3 + 2] = col[v * 3 + 2]; k++; }
  }
  const idx: number[] = [];
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  edge.forEach((e, ei) => {
    for (let t = 0; t < n - 1; t++) {
      const a = e[t], b = e[t + 1], sa = skirtStart[ei] + t, sb = sa + 1;
      idx.push(a, sa, b, b, sa, sb, a, b, sa, b, sb, sa); // double-sided
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, terrainMaterial);
  mesh.receiveShadow = true;
  mesh.matrixAutoUpdate = false;
  return mesh;
}

const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0.0 });

function buildTrees(): THREE.InstancedMesh {
  const rng = new Rng(2024);
  const cone = new THREE.ConeGeometry(5, 18, 5); cone.translate(0, 11, 0);
  const trunk = new THREE.CylinderGeometry(0.8, 1.0, 4, 4); trunk.translate(0, 2, 0);
  const merged = mergeGeos([cone, trunk]);
  const cols: number[] = [];
  const cc = new THREE.Color();
  const pa = merged.getAttribute('position');
  for (let i = 0; i < pa.count; i++) { if (pa.getY(i) < 4.2 && Math.abs(pa.getX(i)) < 1.1) cc.set(0x3b2a1c); else cc.set(0x294227); cols.push(cc.r, cc.g, cc.b); }
  merged.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const mesh = new THREE.InstancedMesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), 6500);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  let count = 0;
  const tryPlace = (x: number, z: number) => {
    if (count >= 6500) return;
    if (isPaved(x, z) || (Math.abs(x) < 520 && Math.abs(z) < 1800)) return;
    const h = terrainHeight(x, z);
    if (h > 1250 || h < LAKE.level + 12 && Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.radius + 200) return;
    const e = 6;
    const slope = Math.hypot(terrainHeight(x + e, z) - terrainHeight(x - e, z), terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
    if (slope > 0.55) return;
    if (rng.next() > smoothstep(1300, 600, h) * 0.9) return;
    const sc = rng.range(0.7, 1.6);
    p.set(x, h - 0.5, z); s.set(sc, sc * rng.range(0.9, 1.4), sc); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, 6.28));
    m.compose(p, q, s); mesh.setMatrixAt(count++, m);
  };
  // dense around the airfield valley, sparser along routes
  for (let x = -3200; x <= 3200; x += 70) for (let z = -3500; z <= 7500; z += 70) tryPlace(x + rng.range(-30, 30), z + rng.range(-30, 30));
  for (let z = -33000; z < -3000; z += 85) for (const cxf of [cxMain, cxAlt]) {
    const c0 = cxf(z);
    for (let k = 0; k < 4; k++) tryPlace(c0 + rng.range(-3600, 3600), z + rng.range(-40, 40));
  }
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = false;
  mesh.frustumCulled = false;
  return mesh;
}

function mergeGeos(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], nor: number[] = [], idx: number[] = [];
  let off = 0;
  for (const g0 of gs) {
    const g = g0.index ? g0 : g0;
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

export class Terrain {
  readonly group = new THREE.Group();
  private ready = false;
  private cancelled = false;

  /** Time-sliced generation so the loading screen stays responsive. */
  async build(onProgress?: (f: number) => void): Promise<void> {
    const nx = Math.round((WORLD.maxX - WORLD.minX) / CHUNK), nz = Math.round((WORLD.maxZ - WORLD.minZ) / CHUNK);
    let done = 0, last = performance.now();
    for (let cz = 0; cz < nz; cz++) {
      for (let cx = 0; cx < nx; cx++) {
        if (this.cancelled) return;
        const wx = WORLD.minX + (cx + 0.5) * CHUNK, wz = WORLD.minZ + (cz + 0.5) * CHUNK;
        const res = chunkRes(wx, wz);
        this.group.add(buildChunk(cx, cz, res, CHUNK / res));
        done++;
        if (performance.now() - last > 30) { onProgress?.(done / (nx * nz)); await new Promise(r => setTimeout(r, 0)); last = performance.now(); }
      }
    }
    this.group.add(buildTrees());
    // lake surface
    const lake = new THREE.Mesh(new THREE.CircleGeometry(LAKE.radius + 80, 40), new THREE.MeshStandardMaterial({ color: 0x1d3a52, roughness: 0.08, metalness: 0.6 }));
    lake.rotation.x = -Math.PI / 2; lake.position.set(LAKE.x, LAKE.level - 1.0, LAKE.z);
    this.group.add(lake);
    this.ready = true; onProgress?.(1);
  }
  get isReady() { return this.ready; }
  dispose() {
    this.cancelled = true;
    this.group.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); });
  }
}

export { clamp, lerp };
