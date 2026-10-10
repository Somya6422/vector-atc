import { AIRCRAFT } from './AircraftConfig';
import * as THREE from 'three';
import { getModel } from './ModelCache';
import type { AircraftId } from './AircraftConfig';

/** Original procedural low-poly approximations (not licensed models, not exact replicas). Nose = -Z, up = +Y. */

export interface Station { z: number; w: number; h: number; y?: number; }

export function loft(stations: Station[], seg = 14, flat = 0): THREE.BufferGeometry {
  const pos: number[] = [], idx: number[] = [];
  for (const s of stations) {
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      let cx = Math.cos(a), cy = Math.sin(a);
      if (flat > 0) { // superellipse – squarer cross-section
        const e = 2 / (2 + flat * 4);
        cx = Math.sign(cx) * Math.pow(Math.abs(cx), e); cy = Math.sign(cy) * Math.pow(Math.abs(cy), e);
      }
      pos.push(cx * s.w * 0.5, (s.y ?? 0) + cy * s.h * 0.5, s.z);
    }
  }
  for (let k = 0; k < stations.length - 1; k++) {
    for (let i = 0; i < seg; i++) {
      const a = k * seg + i, b = k * seg + ((i + 1) % seg), c = a + seg, d = b + seg;
      idx.push(a, c, b, b, c, d);
    }
  }
  // end caps
  const n = stations.length;
  const c0 = pos.length / 3; pos.push(0, stations[0].y ?? 0, stations[0].z);
  const c1 = pos.length / 3; pos.push(0, stations[n - 1].y ?? 0, stations[n - 1].z);
  for (let i = 0; i < seg; i++) {
    idx.push(c0, i, (i + 1) % seg);
    idx.push(c1, (n - 1) * seg + ((i + 1) % seg), (n - 1) * seg + i);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Flat plate from planform points in (x, z); thickness along Y. */
export function plate(points: [number, number][], thick: number, y = 0): THREE.BufferGeometry {
  const sh = new THREE.Shape();
  points.forEach(([x, z], i) => (i === 0 ? sh.moveTo(x, -z) : sh.lineTo(x, -z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: thick, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);   // shape (x, -z) -> world (x, z); extrusion becomes +Y
  g.translate(0, y - thick / 2, 0);
  g.computeVertexNormals();
  return g;
}

/** Subtle panel seams in object space (the supplied meshes have no UVs): fine transverse and longitudinal lines that darken the paint. */
function withPanelSeams<T extends THREE.MeshStandardMaterial>(mat: T, scaleZ = 2.2, scaleX = 1.7): T {
  mat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vObjP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjP;\nfloat seam(float v, float s){ float q = abs(fract(v / s - 0.5) - 0.5) * s; return 1.0 - smoothstep(0.0, max(fwidth(v) * 1.4, 1e-4), q); }')
      .replace('#include <color_fragment>', '#include <color_fragment>\n float sm = max(seam(vObjP.z, ' + scaleZ.toFixed(2) + ') * 0.9, seam(vObjP.x, ' + scaleX.toFixed(2) + ') * 0.6); diffuseColor.rgb *= 1.0 - 0.22 * sm;');
  };
  mat.customProgramCacheKey = () => 'seams' + scaleZ + scaleX;
  return mat;
}
const paint = (color: number, metalness: number, roughness: number, clearcoat = 0.6) => withPanelSeams(new THREE.MeshPhysicalMaterial({ color, metalness, roughness, clearcoat, clearcoatRoughness: 0.28, envMapIntensity: 1.15 }));

/** Soft radial glow for the exhaust bloom sprites (plain texture headless). */
function glowTex(): THREE.Texture {
  if (typeof document === 'undefined') return new THREE.Texture();
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,200,140,0.75)'); gr.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export const MAT = {
  hullSu: () => paint(0x6f7885, 0.55, 0.4),
  hullF35: () => paint(0x7c828b, 0.15, 0.72, 0.12),   // radar-absorbent matte
  hullDrone: () => paint(0x23262c, 0.3, 0.6),
  dark: () => new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.4, roughness: 0.55 }),
  canopy: () => new THREE.MeshPhysicalMaterial({ color: 0x2a3a4a, metalness: 0.15, roughness: 0.03, transparent: true, opacity: 0.55, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.2 }),
  nozzle: () => new THREE.MeshStandardMaterial({ color: 0x3a3028, metalness: 0.8, roughness: 0.45 }),
};

/** Flight helmet. Boy: orange shell; girl: teal shell with a white stripe. Both wear a standard tinted flight visor. */
export function makeHelmet(girl: boolean, scale = 1): THREE.Group {
  const g = new THREE.Group();
  g.name = girl ? 'HELMET_GIRL' : 'HELMET_BOY';
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.15 * scale, 24, 18),
    new THREE.MeshStandardMaterial({ color: girl ? 0x1fa3a8 : 0xe0702a, metalness: 0.2, roughness: 0.35 }));
  g.add(shell);
  const stripe = new THREE.Mesh(new THREE.SphereGeometry(0.152 * scale, 24, 4, 0, Math.PI * 2, Math.PI * 0.08, Math.PI * 0.06), new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.5 }));
  g.add(stripe);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.156 * scale, 20, 12, 0, Math.PI * 2, Math.PI * 0.28, Math.PI * 0.3),
    new THREE.MeshStandardMaterial({ color: girl ? 0x16303a : 0x101820, metalness: 0.9, roughness: 0.15 }));
  visor.rotation.y = Math.PI; visor.rotation.x = -0.15;
  g.add(visor);
  return g;
}

export interface AircraftVisual {
  group: THREE.Group;
  afterburners: THREE.Mesh[];
  /** under-wing missiles (hidden as they are fired) and the anti-collision strobes */
  stores: THREE.Object3D[];
  strobes: THREE.Mesh[];
  /** additive exhaust glow (afterburner bloom) at each nozzle */
  glows: THREE.Sprite[];
  /** transonic vapour cone (shown near Mach 1) */
  vaporCone: THREE.Mesh;
  /** internal weapons-bay doors (hinged groups, rotate on launch) */
  bayDoors: THREE.Group[];
  /** afterburner shock diamonds (Mach disks) along each exhaust */
  diamonds: THREE.Sprite[];
  /** STOVL lift-fan / swivel-nozzle plumes (F-35) */
  liftPlumes: THREE.Sprite[];
  navLights: THREE.Mesh[];
  cockpit: THREE.Group;       // interior – shown only in cockpit view
  exterior: THREE.Group;      // everything else
  pilotHead: THREE.Group | null;
  gear: THREE.Group;
  airbrakes: THREE.Mesh[];
  setLivery(color: number): void;
}

function mirrorX(g: THREE.BufferGeometry) { const m = g.clone(); m.scale(-1, 1, 1); const idx = m.getIndex(); if (idx) { const a = idx.array as Uint32Array | Uint16Array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } } m.computeVertexNormals(); return m; }

function addPair(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0) {
  const a = new THREE.Mesh(geo, mat); a.position.x = x; a.castShadow = true; parent.add(a);
  const b = new THREE.Mesh(mirrorX(geo), mat); b.position.x = -x; b.castShadow = true; parent.add(b);
  return [a, b];
}

function buildCockpit(cockpitZ: number, eyeY: number, girl: boolean): THREE.Group {
  const c = new THREE.Group(); c.name = 'COCKPIT';
  const dark = new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.3, roughness: 0.7 });
  const frame = new THREE.MeshStandardMaterial({ color: 0x20242a, metalness: 0.6, roughness: 0.5 });
  // instrument coaming + glare-shield
  const dash = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.28, 0.9), dark); dash.position.set(0, eyeY - 0.38, cockpitZ - 0.85); dash.rotation.x = -0.18; c.add(dash);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.6), dark); shield.position.set(0, eyeY - 0.18, cockpitZ - 1.15); shield.rotation.x = -0.1; c.add(shield);
  // MFD screens (emissive)
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x0a2a24, emissive: 0x0f8f6a, emissiveIntensity: girl ? 0.9 : 0.6, roughness: 0.3 });
  for (const sx of girl ? [-0.28, 0.28] : [-0.42, 0, 0.42]) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(girl ? 0.5 : 0.3, girl ? 0.22 : 0.2, 0.02), screenMat);
    s.position.set(sx, eyeY - 0.34, cockpitZ - 0.64); s.rotation.x = -0.45; c.add(s);
  }
  // canopy bow + rails
  for (const sx of [-0.62, 0.62]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 3.0), frame); rail.position.set(sx, eyeY - 0.12, cockpitZ + 0.1); c.add(rail);
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.05), frame); pillar.position.set(sx * 0.95, eyeY + 0.2, cockpitZ - 1.3); pillar.rotation.z = -sx * 0.5; c.add(pillar);
  }
  const bow = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.025, 6, 20, Math.PI), frame); bow.position.set(0, eyeY - 0.1, cockpitZ - 1.7); c.add(bow);
  const bow2 = bow.clone(); bow2.position.z = cockpitZ + 0.55; c.add(bow2);
  const side = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.22, 2.4), dark); side.position.set(0, eyeY - 0.55, cockpitZ + 0.3); c.add(side);
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.28, 8), dark); stick.position.set(girl ? 0.32 : 0, eyeY - 0.45, cockpitZ - 0.15); c.add(stick);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.9, 0.2), new THREE.MeshStandardMaterial({ color: 0x2b2f2a, roughness: 0.9 })); seat.position.set(0, eyeY - 0.1, cockpitZ + 0.5); c.add(seat);
  return c;
}

export function buildAircraft(id: AircraftId, opts: { girlPilot?: boolean } = {}): AircraftVisual {
  const group = new THREE.Group();
  const exterior = new THREE.Group();
  group.add(exterior);
  const afterburners: THREE.Mesh[] = [];
  const navLights: THREE.Mesh[] = [];
  const airbrakes: THREE.Mesh[] = [];
  const gear = new THREE.Group();
  let hull: THREE.MeshStandardMaterial;
  let cockpitEyeY = 1.0, cockpitZ = -4.5;
  let pilotHead: THREE.Group | null = null;

  const addGear = (nose: [number, number], mains: [number, number, number]) => {
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
    const strutMat = new THREE.MeshStandardMaterial({ color: 0xb0b4ba, metalness: 0.8, roughness: 0.3 });
    const mk = (x: number, z: number, h: number) => {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, h, 6), strutMat); strut.position.set(x, -h / 2, z); gear.add(strut);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 14), wheelMat); wheel.rotation.z = Math.PI / 2; wheel.position.set(x, -h, z); gear.add(wheel);
    };
    mk(0, nose[0], nose[1]);
    mk(mains[0], mains[1], mains[2]); mk(-mains[0], mains[1], mains[2]);
    exterior.add(gear);
  };

  const modelGeo = id === 'SU57' ? getModel('su57') : id === 'F35' ? getModel('f35') : null;
  if (modelGeo) {
    // ---- user-supplied model (converted: nose = -Z, up = +Y, real-world scale) ----
    hull = id === 'SU57' ? MAT.hullSu() : MAT.hullF35();
    hull.color.setHex(id === 'SU57' ? 0x7d8794 : 0x8a919b); hull.metalness = 0.45; hull.roughness = 0.5;
    const body = new THREE.Mesh(modelGeo, hull); body.castShadow = true; body.name = 'MODEL_' + id; exterior.add(body);
    const su = id === 'SU57';
    const tailZ = su ? 10.0 : 7.8;
    for (const x of su ? [-1.15, 1.15] : [0]) {
      const flame = new THREE.Mesh(new THREE.ConeGeometry(su ? 0.4 : 0.5, su ? 4.5 : 5, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.rotation.x = -Math.PI / 2; flame.position.set(x, su ? -0.2 : 0, tailZ + 2.4); exterior.add(flame); afterburners.push(flame);
    }
    cockpitEyeY = 1.0; cockpitZ = su ? -4.2 : -3.3;
    // pilot helmet sits in the cockpit (the Su-57 pilot = boy in orange, the F-35 pilot = girl in teal)
    const ph = makeHelmet(!su, 1); ph.position.set(0, 0.95, su ? -4.1 : -3.1); exterior.add(ph); pilotHead = ph;
    if (su) addGear([-6, 2.2], [1.7, 1.0, 2.2]); else addGear([-4.6, 2.0], [1.5, 1.0, 1.0]);
    for (const [sx, col] of [[-1, 0xff2020], [1, 0x20ff40]] as const) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), new THREE.MeshBasicMaterial({ color: col })); l.position.set(sx * (su ? 7.1 : 5.4), -0.1, su ? 3.5 : 4.7); exterior.add(l); navLights.push(l);
    }
  } else if (id === 'SU57') {
    hull = MAT.hullSu();
    const fus = new THREE.Mesh(loft([
      { z: -10.2, w: 0.1, h: 0.1, y: -0.1 }, { z: -8.5, w: 0.9, h: 0.7, y: -0.05 }, { z: -6, w: 1.6, h: 1.3 }, { z: -2, w: 2.1, h: 1.55 },
      { z: 2, w: 2.5, h: 1.5 }, { z: 6, w: 2.5, h: 1.3 }, { z: 9, w: 2.3, h: 1.0 },
    ], 14, 0.4), hull);
    fus.castShadow = true; exterior.add(fus);
    // engine nacelles (two) + nozzles
    for (const sx of [-1, 1]) {
      const nac = new THREE.Mesh(loft([{ z: 1, w: 1.3, h: 1.1, y: -0.2 }, { z: 8, w: 1.25, h: 1.05, y: -0.2 }, { z: 10.2, w: 1.0, h: 0.95, y: -0.2 }], 12), hull);
      nac.position.x = sx * 1.15; exterior.add(nac);
      const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.38, 1.0, 14, 1, true), MAT.nozzle()); noz.rotation.x = Math.PI / 2; noz.position.set(sx * 1.15, -0.2, 10.5); exterior.add(noz);
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.4, 4.5, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
      flame.rotation.x = -Math.PI / 2; flame.position.set(sx * 1.15, -0.2, 13); flame.visible = true; exterior.add(flame); afterburners.push(flame);
    }
    // wings (swept, with LERX)
    const wing = plate([[1.2, -1.5], [7.05, 2.4], [7.05, 4.6], [3.2, 7.4], [1.2, 7.6]], 0.22, -0.1);
    addPair(exterior, wing, hull);
    const lerx = plate([[0.9, -7.0], [2.4, -1.0], [1.0, -1.0]], 0.12, 0.05);
    addPair(exterior, lerx, hull);
    const stab = plate([[1.3, 6.5], [4.6, 9.6], [4.6, 10.6], [1.3, 10.4]], 0.16, -0.1);
    addPair(exterior, stab, hull);
    // canted twin fins
    for (const sx of [-1, 1]) {
      const f2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.4, 2.8), hull);
      f2.position.set(sx * 1.9, 1.7, 8.0); f2.rotation.z = -sx * 0.35; f2.castShadow = true;
      exterior.add(f2);
    }
    // canopy
    const can = new THREE.Mesh(new THREE.SphereGeometry(0.62, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.canopy());
    can.scale.set(1, 0.8, 3.4); can.position.set(0, 0.75, -4.4); exterior.add(can);
    cockpitEyeY = 1.0; cockpitZ = -4.2;
    const ph = makeHelmet(false, 1); ph.position.set(0, 0.92, -4.1); exterior.add(ph); pilotHead = ph;
    // airbrake panels (top, behind canopy)
    const ab = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 1.4), MAT.dark()); ab.position.set(0, 0.85, 1.2); exterior.add(ab); airbrakes.push(ab);
    addGear([-6, 2.2], [1.7, 1.0, 2.2]);
    // nav lights
    for (const [sx, col] of [[-1, 0xff2020], [1, 0x20ff40]] as const) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), new THREE.MeshBasicMaterial({ color: col })); l.position.set(sx * 7.1, -0.1, 3.5); exterior.add(l); navLights.push(l);
    }
  } else if (id === 'F35') {
    hull = MAT.hullF35();
    const fus = new THREE.Mesh(loft([
      { z: -7.8, w: 0.1, h: 0.1, y: -0.1 }, { z: -6.2, w: 0.9, h: 0.75, y: -0.1 }, { z: -3.5, w: 1.7, h: 1.4 }, { z: 0, w: 2.3, h: 1.7 },
      { z: 3.5, w: 2.3, h: 1.6 }, { z: 6.2, w: 1.9, h: 1.3 }, { z: 7.6, w: 1.5, h: 1.05 },
    ], 14, 0.5), hull);
    fus.castShadow = true; exterior.add(fus);
    const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.45, 1.0, 16, 1, true), MAT.nozzle()); noz.rotation.x = Math.PI / 2; noz.position.set(0, 0, 8.0); exterior.add(noz);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.5, 5.0, 12, 1, true), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.rotation.x = -Math.PI / 2; flame.position.set(0, 0, 10.6); exterior.add(flame); afterburners.push(flame);
    addPair(exterior, plate([[1.0, 0.0], [5.35, 3.6], [5.35, 5.2], [3.0, 6.4], [1.0, 6.4]], 0.24, -0.15), hull);
    addPair(exterior, plate([[1.0, 5.4], [3.7, 7.6], [3.7, 8.4], [1.0, 8.0]], 0.16, -0.1), hull);
    for (const sx of [-1, 1]) {
      const f2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.0, 2.2), hull);
      f2.position.set(sx * 1.2, 1.5, 5.5); f2.rotation.z = -sx * 0.45; f2.castShadow = true; exterior.add(f2);
    }
    const can = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), MAT.canopy());
    can.scale.set(1, 0.85, 3.1); can.position.set(0, 0.8, -3.4); exterior.add(can);
    cockpitEyeY = 1.0; cockpitZ = -3.3;
    const ph = makeHelmet(true, 1); ph.position.set(0, 0.95, -3.1); exterior.add(ph); pilotHead = ph;
    const eots = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.5), new THREE.MeshStandardMaterial({ color: 0x1b2a3a, metalness: 0.9, roughness: 0.1 })); eots.position.set(0, -0.9, -4.8); exterior.add(eots);
    const ab = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.05, 1.2), MAT.dark()); ab.position.set(0, 0.95, 1.6); exterior.add(ab); airbrakes.push(ab);
    addGear([-4.6, 2.0], [1.5, 1.0, 1.0]);
    for (const [sx, col] of [[-1, 0xff2020], [1, 0x20ff40]] as const) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), new THREE.MeshBasicMaterial({ color: col })); l.position.set(sx * 5.4, -0.1, 4.7); exterior.add(l); navLights.push(l);
    }
  } else {
    hull = MAT.hullDrone();
    const body = new THREE.Mesh(loft([{ z: -4.2, w: 0.1, h: 0.1 }, { z: -2.5, w: 1.0, h: 0.6 }, { z: 0.5, w: 1.6, h: 0.7 }, { z: 3.2, w: 1.0, h: 0.55 }, { z: 4.2, w: 0.7, h: 0.4 }], 10, 0.4), hull);
    body.castShadow = true; exterior.add(body);
    addPair(exterior, plate([[0.5, -2.0], [5.5, 3.2], [5.5, 4.0], [3.0, 3.6], [0.5, 4.2]], 0.14, 0), hull);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 2.6, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xff8030, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    flame.rotation.x = -Math.PI / 2; flame.position.set(0, 0, 5.4); exterior.add(flame); afterburners.push(flame);
    // hostile identity: glowing red sensor eye, canted twin tails and underwing weapon pods
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2a1a })); eye.position.set(0, 0.12, -2.9); eye.scale.set(1.6, 0.7, 1); exterior.add(eye);
    for (const sx of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 1.3), hull); fin.position.set(sx * 0.8, 0.9, 3.0); fin.rotation.z = -sx * 0.4; fin.castShadow = true; exterior.add(fin);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.7), new THREE.MeshBasicMaterial({ color: 0xc01810 })); stripe.position.set(sx * 0.95, 1.45, 3.1); stripe.rotation.z = -sx * 0.4; exterior.add(stripe);
      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 2.2, 8), MAT.dark()); pod.rotation.x = Math.PI / 2; pod.position.set(sx * 2.4, -0.35, 0.6); exterior.add(pod);
    }
    for (const [sx, col] of [[-1, 0xff2020], [1, 0xff5020]] as const) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 6), new THREE.MeshBasicMaterial({ color: col })); l.position.set(sx * 5.4, 0.1, 3.6); exterior.add(l); navLights.push(l);
    }
  }
  // ---- shared detail pass: squadron colours, weapon pylons + missiles, strobes, hot exhaust core ----
  const cfgD = AIRCRAFT[id], half = cfgD.wingspan * 0.5, accent = id === 'SU57' ? 0xe0702a : id === 'F35' ? 0x1fa3a8 : 0xc01810;
  const accentMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5, metalness: 0.2 });
  const stores: THREE.Object3D[] = [], strobes: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 1.6), accentMat); tip.position.set(sx * (half - 0.35), 0.12, cfgD.length * 0.17); exterior.add(tip);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.35), accentMat); stripe.position.set(sx * (half * 0.55), 0.14, cfgD.length * 0.2); exterior.add(stripe);
    for (const k of [0.3, 0.46]) {
      const grp = new THREE.Group(); grp.position.set(sx * half * k, -0.42, cfgD.length * 0.1);
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 1.1), MAT.dark()); pylon.position.y = 0.1; grp.add(pylon);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0xdfe3e6, roughness: 0.4 })); body.rotation.x = Math.PI / 2; body.position.y = -0.18; grp.add(body);
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.5, 8), new THREE.MeshStandardMaterial({ color: 0xb02820, roughness: 0.5 })); nose.rotation.x = -Math.PI / 2; nose.position.set(0, -0.18, -1.55); grp.add(nose);
      for (let i = 0; i < 4; i++) { const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.28, 0.4), MAT.dark()); fin.position.set(0, -0.18, 1.1); fin.rotation.z = i * Math.PI / 2; grp.add(fin); }
      grp.visible = false; exterior.add(grp); stores.push(grp);   // carried internally (stealth): only seen as the bay opens
    }
  }
  for (const sx of [-1, 1]) { const s = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff })); s.position.set(sx * (id === 'DRONE' ? 0.8 : 1.9), id === 'DRONE' ? 1.6 : 2.9, cfgD.length * 0.36); exterior.add(s); strobes.push(s); }
  const glows: THREE.Sprite[] = [];
  const glowMat = new THREE.SpriteMaterial({ map: glowTex(), color: 0xffb070, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, opacity: 0 });
  for (const f of afterburners) {
    const gs = new THREE.Sprite(glowMat.clone()); const h = (f.geometry as THREE.ConeGeometry).parameters.height;
    gs.position.set(f.position.x, f.position.y, f.position.z - h * 0.45); gs.scale.setScalar(2); exterior.add(gs); glows.push(gs);
  }
  const diamonds: THREE.Sprite[] = [];
  for (const f of afterburners) {
    const h = (f.geometry as THREE.ConeGeometry).parameters.height;
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Sprite(glowMat.clone()); (d.material as THREE.SpriteMaterial).color.set(0xffe0b0);
      d.position.set(f.position.x, f.position.y, f.position.z - h * 0.35 + 1.1 + i * 1.25); d.scale.setScalar(0.9 - i * 0.14); d.visible = false; exterior.add(d); diamonds.push(d);
    }
  }
  // weapons-bay doors under the fuselage, hinged on their outer edges
  const bayDoors: THREE.Group[] = [];
  if (id !== 'DRONE') for (const sx of [-1, 1]) {
    const hinge = new THREE.Group(); hinge.position.set(sx * 0.62, -0.62, cfgD.length * 0.04);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, cfgD.length * 0.28), hull); door.position.x = -sx * 0.29; hinge.add(door);
    exterior.add(hinge); bayDoors.push(hinge);
  }
  const liftPlumes: THREE.Sprite[] = [];
  if (id === 'F35') for (const z of [-cfgD.length * 0.2, cfgD.length * 0.36]) {
    const lp = new THREE.Sprite(glowMat.clone()); (lp.material as THREE.SpriteMaterial).color.set(0xbfd6ff); lp.position.set(0, -1.6, z); lp.scale.set(2.2, 4.5, 1); lp.visible = false; exterior.add(lp); liftPlumes.push(lp);
  }
  const vaporCone = new THREE.Mesh(new THREE.ConeGeometry(cfgD.wingspan * 0.42, cfgD.length * 0.55, 28, 1, true), new THREE.MeshBasicMaterial({ color: 0xf4f8ff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  vaporCone.rotation.x = -Math.PI / 2; vaporCone.position.z = cfgD.length * 0.08; vaporCone.visible = false; exterior.add(vaporCone);
  for (const f of [...afterburners]) {   // bright inner core so the afterburner reads as hot white-orange
    const core = new THREE.Mesh(new THREE.ConeGeometry((f.geometry as THREE.ConeGeometry).parameters.radius * 0.45, (f.geometry as THREE.ConeGeometry).parameters.height * 0.7, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff2d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.rotation.copy(f.rotation); core.position.copy(f.position); core.position.z -= (f.geometry as THREE.ConeGeometry).parameters.height * 0.1; exterior.add(core); afterburners.push(core);
  }
  const girl = opts.girlPilot ?? id === 'F35';
  const cockpit = id === 'DRONE' ? new THREE.Group() : buildCockpit(cockpitZ, cockpitEyeY, girl);
  cockpit.visible = false;
  group.add(cockpit);
  gear.visible = true;
  const hullRef = hull;
  return {
    group, afterburners, stores, strobes, glows, vaporCone, bayDoors, diamonds, liftPlumes, navLights, cockpit, exterior, pilotHead, gear, airbrakes,
    setLivery(color: number) { hullRef.color.setHex(color); },
  };
}
