import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * Textured pilot characters (Meshy .blend files supplied by the project owner, converted with tools/blend_export.py
 * into public/models/pilot_boy.glb and pilot_girl.glb). Each is baked into one mesh that stands on y = 0, faces -Z and
 * has real-world height. tools/pose_pilot.py relaxed the A-pose arms to the sides in Blender. Missing files fall back to the older sculpt.
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
  // the arms were relaxed to the sides offline (tools/pose_pilot.py); the mesh is static
  g.computeBoundingBox(); g.computeBoundingSphere();
  g.userData.shared = true;
  const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
  mat.roughness = Math.max(0.55, mat.roughness ?? 0.6); mat.metalness = 0;
  cache.set(who, { geometry: g, material: mat, height: h });
}

/** Textured jet for the girl's hangar bay (Meshy .blend from the project owner → public/models/jet_girl.glb). */
let hangarJet: THREE.Group | null = null;
export const getHangarJet = () => hangarJet?.clone() ?? null;
async function loadHangarJet(loader: GLTFLoader) {
  const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/jet_girl.glb`);
  const root = gltf.scene; root.updateMatrixWorld(true);
  root.rotation.y = -Math.PI / 2;                              // model nose points -X; aircraft face -Z
  const g = new THREE.Group(); g.add(root); g.updateMatrixWorld(true);
  const bb = new THREE.Box3().setFromObject(g), size = bb.getSize(new THREE.Vector3());
  const k = 15.7 / Math.max(size.x, size.z);                     // F-35 length
  root.scale.setScalar(k); g.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(g);
  root.position.set(-(b2.min.x + b2.max.x) / 2, -b2.min.y, -(b2.min.z + b2.max.z) / 2);
  g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.geometry.userData.shared = true; } });
  hangarJet = g;
}

export async function loadPilotModels(): Promise<void> {
  const loader = new GLTFLoader();
  await loadHangarJet(loader).catch(e => console.warn('jet_girl.glb unavailable – using the F-35 model', e));
  await Promise.all((['boy', 'girl'] as const).map(w => loadOne(w, loader).catch(e => console.warn(`pilot_${w}.glb unavailable – using the older pilot sculpt`, e))));
}
