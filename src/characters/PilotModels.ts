import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Textured pilot characters (Meshy .blend files supplied by the project owner, converted with tools/blend_export.py
 * into public/models/pilot_boy.glb and pilot_girl.glb). Each is baked into one mesh that stands on y = 0, faces -Z and
 * has real-world height (A-pose kept as supplied – the models are not rigged). Missing files fall back to the older sculpt.
 */
export interface PilotModel { geometry: THREE.BufferGeometry; material: THREE.Material; height: number }
const cache = new Map<'boy' | 'girl', PilotModel>();
export const getPilotModel = (who: 'boy' | 'girl') => cache.get(who) ?? null;

const HEIGHT = { boy: 1.78, girl: 1.68 };

async function loadOne(who: 'boy' | 'girl', loader: GLTFLoader) {
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/pilot_${who}.glb`);
  gltf.scene.updateMatrixWorld(true);
  let mesh: THREE.Mesh | null = null;
  gltf.scene.traverse(o => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
  if (!mesh) throw new Error('no mesh');
  const m = mesh as THREE.Mesh;
  const g = m.geometry.clone(); g.applyMatrix4(m.matrixWorld);
  g.rotateY(Math.PI);                                         // the models face +Z after export; avatars face -Z
  g.computeBoundingBox();
  const bb = g.boundingBox!, h = HEIGHT[who], k = h / (bb.max.y - bb.min.y);
  g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); g.scale(k, k, k);
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  // the source models stand in an A-pose; they are not rigged, so the pose is kept as supplied
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData.shared = true;
  const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
  mat.roughness = Math.max(0.55, mat.roughness ?? 0.6); mat.metalness = 0;
  cache.set(who, { geometry: g, material: mat, height: h });
}

export async function loadPilotModels(): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all((['boy', 'girl'] as const).map(w => loadOne(w, loader).catch(e => console.warn(`pilot_${w}.glb unavailable – using the older pilot sculpt`, e))));
}
