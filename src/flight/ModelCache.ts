import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Pre-loads the user-supplied models (converted by tools/convert-models.mjs into public/models/*.bin).
 * Anything that fails to load is simply absent and the procedural fallback meshes are used instead.
 */
const cache = new Map<string, THREE.BufferGeometry>();
export const MODEL_NAMES = ['su57', 'f35', 'pilot'] as const;
export type ModelName = typeof MODEL_NAMES[number];

export function getModel(name: ModelName): THREE.BufferGeometry | null { return cache.get(name) ?? null; }
export const loadedModels = () => [...cache.keys()];

export function parseModel(buf: ArrayBuffer, crease = 38): THREE.BufferGeometry {
  const head = new Uint32Array(buf, 0, 2);
  const nv = head[0], ni = head[1];
  const pos = new Float32Array(buf, 8, nv * 3);
  const idx = new Uint32Array(buf, 8 + nv * 12, ni);
  let g: THREE.BufferGeometry = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3));
  g.setIndex(new THREE.BufferAttribute(idx.slice(), 1));
  g = toCreasedNormals(g, crease * Math.PI / 180);      // hard edges stay crisp, curved surfaces stay smooth
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData.shared = true;                             // never dispose per mission – shared across instances
  return g;
}

export async function loadModels(progress?: (f: number) => void): Promise<string[]> {
  let done = 0;
  await Promise.all(MODEL_NAMES.map(async n => {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}models/${n}.bin`);
      if (!r.ok) throw new Error(String(r.status));
      cache.set(n, parseModel(await r.arrayBuffer(), n === 'pilot' ? 50 : 38));
    } catch (e) { console.warn(`model ${n} unavailable – using procedural fallback`, e); }
    progress?.(++done / MODEL_NAMES.length);
  }));
  return loadedModels();
}
