import * as THREE from 'three';
import { FIELD_ELEV, LANDMARKS, RADAR_SITES, RUNWAY, START_POS, cxMain, radarSiteAlt, terrainHeight } from './Heightfield';
import { GLIDE_DEG, approachInfo } from './Landing';
import { DEG, smoothstep } from '../util/math';

const emissive = (c: number, i = 2) => new THREE.MeshStandardMaterial({ color: 0x111111, emissive: c, emissiveIntensity: i });

function numeralsTexture(text: string) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0)'; g.clearRect(0, 0, 256, 256);
  g.fillStyle = '#f0f0ea'; g.font = 'bold 190px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 138);
  const t = new THREE.CanvasTexture(c); t.anisotropy = 8; return t;
}

/** Real scene geometry for the mountain airfield: thick runway slab, markings, lights, buildings, landmarks. */
export class Airfield {
  readonly group = new THREE.Group();
  private flashers: THREE.Mesh[][] = [[], []];
  private papi: THREE.Mesh[][] = [[], []];
  private beacons: { mesh: THREE.Mesh; phase: number }[] = [];
  private t = 0;
  readonly colliders: { x: number; z: number; r: number; h: number }[] = [];

  constructor() {
    const g = this.group;
    const asphalt = new THREE.MeshStandardMaterial({ color: 0x3a3b3e, roughness: 0.92 });
    const concrete = new THREE.MeshStandardMaterial({ color: 0x77776f, roughness: 0.95 });
    const paint = new THREE.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.7 });

    const L = RUNWAY.halfLen * 2 + 80, W = (RUNWAY.halfWid + RUNWAY.shoulder) * 2;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(W, 0.8, L), asphalt); slab.position.set(0, FIELD_ELEV - 0.4, 0); slab.receiveShadow = true; g.add(slab);
    const mk = (w: number, d: number, x: number, z: number, y = 0.03, mat = paint) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), mat); m.position.set(x, FIELD_ELEV + y, z); m.receiveShadow = true; g.add(m); return m;
    };
    // centreline dashes
    for (let z = -RUNWAY.halfLen + 60; z < RUNWAY.halfLen - 60; z += 50) mk(0.9, 28, 0, z);
    // threshold bars + aiming points + touchdown zone marks (both ends)
    for (const s of [1, -1]) {
      const zt = s * (RUNWAY.halfLen - 14);
      for (let i = -7; i <= 7; i++) if (i !== 0) mk(1.3, 30, i * 2.6 + (i > 0 ? 1.3 : -1.3), zt);
      mk(4.5, 60, 9.5, s * (RUNWAY.halfLen - 320)); mk(4.5, 60, -9.5, s * (RUNWAY.halfLen - 320));
      for (const d of [480, 640]) { mk(2.4, 24, 7, s * (RUNWAY.halfLen - d)); mk(2.4, 24, -7, s * (RUNWAY.halfLen - d)); }
      const num = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.MeshBasicMaterial({ map: numeralsTexture(s > 0 ? '36' : '18'), transparent: true, opacity: 0.88 }));
      num.rotation.x = -Math.PI / 2; num.rotation.z = s > 0 ? 0 : Math.PI; num.position.set(0, FIELD_ELEV + 0.05, s * (RUNWAY.halfLen - 95)); g.add(num);
    }
    // edge lights + threshold/end lights
    const lampGeo = new THREE.SphereGeometry(0.28, 6, 4);
    const whiteLamp = emissive(0xfff4d8, 3), greenLamp = emissive(0x24ff5a, 3), redLamp = emissive(0xff2020, 3), blueLamp = emissive(0x3a6bff, 3);
    const edge = new THREE.InstancedMesh(lampGeo, whiteLamp, 2 * 41);
    const m4 = new THREE.Matrix4(); let ei = 0;
    for (const sx of [-1, 1]) for (let z = -RUNWAY.halfLen; z <= RUNWAY.halfLen + 1; z += 60) { m4.makeTranslation(sx * (RUNWAY.halfWid + 1.5), FIELD_ELEV + 0.3, z); edge.setMatrixAt(ei++, m4); }
    edge.count = ei; g.add(edge);
    const grn = new THREE.InstancedMesh(lampGeo, greenLamp, 40), red = new THREE.InstancedMesh(lampGeo, redLamp, 40);
    let gi = 0, ri = 0;
    for (const s of [1, -1]) for (let i = -9; i <= 9; i++) {
      m4.makeTranslation(i * 2.6, FIELD_ELEV + 0.25, s * (RUNWAY.halfLen + 1)); grn.setMatrixAt(gi++, m4);
      m4.makeTranslation(i * 2.6, FIELD_ELEV + 0.25, s * (RUNWAY.halfLen + 24)); red.setMatrixAt(ri++, m4);
    }
    grn.count = gi; red.count = ri; g.add(grn, red);
    // taxiway edge lights (blue)
    const blue = new THREE.InstancedMesh(lampGeo, blueLamp, 80); let bi = 0;
    for (let z = 1170; z <= 1430; z += 26) { m4.makeTranslation(-97, FIELD_ELEV + 0.25, z); blue.setMatrixAt(bi++, m4); m4.makeTranslation(-68, FIELD_ELEV + 0.25, z); blue.setMatrixAt(bi++, m4); }
    blue.count = bi; g.add(blue);

    // taxiway, connector, apron slabs (real boxes)
    const slabAt = (x0: number, x1: number, z0: number, z1: number, mat = asphalt) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.8, z1 - z0), mat); m.position.set((x0 + x1) / 2, FIELD_ELEV - 0.4, (z0 + z1) / 2); m.receiveShadow = true; g.add(m);
    };
    slabAt(-95, -70, 1168, 1430); slabAt(-95, -20, 1168, 1192); slabAt(-190, -70, 1300, 1440, concrete);
    mk(0.5, 260, -82.5, 1300, 0.03, new THREE.MeshStandardMaterial({ color: 0xf0c040 }));
    // approach lighting (both directions): crossbars + sequenced flashers
    const barGeo = new THREE.InstancedMesh(lampGeo, whiteLamp, 2 * 16 * 5); let bj = 0;
    [1, -1].forEach((s, di) => {
      for (let k = 0; k < 15; k++) {
        const z = s * (RUNWAY.halfLen + 40 + k * 60);
        for (let c = -2; c <= 2; c++) { m4.makeTranslation(c * 2.4, FIELD_ELEV + 0.5, z); barGeo.setMatrixAt(bj++, m4); }
        const f = new THREE.Mesh(new THREE.SphereGeometry(0.7, 8, 6), emissive(0xffffff, 0)); f.position.set(0, FIELD_ELEV + 1.2, z + s * 8); g.add(f); this.flashers[di].push(f);
      }
      // PAPI: 4 light boxes left of the runway at the aiming point of this direction
      for (let p = 0; p < 4; p++) {
        const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.0, 1.2), emissive(0xffffff, 2)); b.position.set(-(RUNWAY.halfWid + 12 + p * 3.6), FIELD_ELEV + 0.6, s * (RUNWAY.halfLen - 330)); g.add(b); this.papi[di].push(b);
      }
    });
    barGeo.count = bj; g.add(barGeo);

    // hangar (arched), tower, tanks, windsock
    const hMat = new THREE.MeshStandardMaterial({ color: 0x5b6b59, roughness: 0.8, metalness: 0.2 });
    const hangar = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 70, 20, 1, false, 0, Math.PI), hMat);
    hangar.rotation.set(-Math.PI / 2, 0, Math.PI / 2); hangar.scale.set(1, 1, 0.6);
    hangar.position.set(-250, FIELD_ELEV + 1, 1370); hangar.castShadow = true; hangar.receiveShadow = true; g.add(hangar);
    const hwall = new THREE.Mesh(new THREE.BoxGeometry(70, 2, 48), concrete); hwall.position.set(-250, FIELD_ELEV + 0.5, 1370); g.add(hwall);
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 26, 10), concrete); tower.position.set(60, FIELD_ELEV + 13, 1330); tower.castShadow = true; g.add(tower);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(7, 5, 5, 10), new THREE.MeshStandardMaterial({ color: 0x1c3345, metalness: 0.8, roughness: 0.1 })); cab.position.set(60, FIELD_ELEV + 28, 1330); g.add(cab);
    this.colliders.push({ x: 60, z: 1330, r: 6, h: 32 }, { x: -250, z: 1370, r: 35, h: 25 });
    for (let i = 0; i < 3; i++) { const t = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 10, 14), concrete); t.position.set(150 + i * 16, FIELD_ELEV + 5, 1400); t.castShadow = true; g.add(t); }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 7, 6), paint); pole.position.set(38, FIELD_ELEV + 3.5, 980); g.add(pole);
    const sock = new THREE.Mesh(new THREE.ConeGeometry(0.7, 3.5, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0xff7a1a, side: THREE.DoubleSide })); sock.rotation.z = Math.PI / 2; sock.position.set(40, FIELD_ELEV + 7, 980); g.add(sock);
    // start marker on the taxiway (hold line)
    mk(25, 0.8, -82.5, 1178, 0.04, new THREE.MeshStandardMaterial({ color: 0xf0c040 }));

    // landmarks and radar sites along the valley
    for (const lm of LANDMARKS) this.addLandmark(lm.name, lm.x, lm.z, lm.kind);
    for (const s of RADAR_SITES) {
      const y = radarSiteAlt(s) - 25;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.8, 40, 8), concrete); mast.position.set(s.x, y + 20, s.z); g.add(mast);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(7, 14, 10), new THREE.MeshStandardMaterial({ color: 0xe8ecef, roughness: 0.5 })); dome.position.set(s.x, y + 46, s.z); dome.castShadow = true; g.add(dome);
      const bc = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), emissive(0xff2020, 3)); bc.position.set(s.x, y + 56, s.z); g.add(bc); this.beacons.push({ mesh: bc, phase: Math.random() * 3 });
    }
  }

  private addLandmark(name: string, x: number, z: number, kind: string) {
    const g = this.group;
    const y = terrainHeight(x, z);
    const stone = new THREE.MeshStandardMaterial({ color: 0x8b857a, roughness: 0.9 });
    if (kind === 'tower') {
      for (const dx of [-60, 60]) { const p = new THREE.Mesh(new THREE.BoxGeometry(24, 120, 24), stone); p.position.set(x + dx, y + 60, z); p.castShadow = true; g.add(p); }
      const arch = new THREE.Mesh(new THREE.BoxGeometry(150, 20, 22), stone); arch.position.set(x, y + 112, z); g.add(arch);
    } else if (kind === 'bridge') {
      const red = new THREE.MeshStandardMaterial({ color: 0xa32a22, roughness: 0.6, metalness: 0.4 });
      const deck = new THREE.Mesh(new THREE.BoxGeometry(16, 3, 150), red); deck.position.set(x, y + 1, z); g.add(deck);
      for (let i = -3; i <= 3; i++) { const tr = new THREE.Mesh(new THREE.BoxGeometry(1.2, 22, 1.2), red); tr.position.set(x + 8, y + 12, z + i * 22); g.add(tr); const tr2 = tr.clone(); tr2.position.x = x - 8; g.add(tr2); }
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 150), red); top.position.set(x + 8, y + 23, z); g.add(top); const top2 = top.clone(); top2.position.x = x - 8; g.add(top2);
    } else if (kind === 'beacon') {
      const tw = new THREE.Mesh(new THREE.CylinderGeometry(2, 3, 50, 8), stone); tw.position.set(x, y + 25, z); g.add(tw);
      const bc = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), emissive(0xffb020, 3)); bc.position.set(x, y + 54, z); g.add(bc); this.beacons.push({ mesh: bc, phase: 1.2 });
    } else if (kind === 'lake') {
      const jetty = new THREE.Mesh(new THREE.BoxGeometry(6, 1.5, 90), stone); jetty.position.set(x + 40, y + 0.4, z); g.add(jetty);
    }
  }

  update(dt: number, playerPos: THREE.Vector3) {
    this.t += dt;
    // sequenced flashers ("rabbit")
    this.flashers.forEach(row => {
      const ph = (this.t * 2.0) % 1;
      row.forEach((m, i) => {
        const k = 1 - (((i / row.length) + ph) % 1);
        (m.material as THREE.MeshStandardMaterial).emissiveIntensity = k > 0.88 ? 7 : 0;
      });
    });
    // PAPI colours from the player's actual glide angle to each runway aim point
    [true, false].forEach((north, di) => {
      const info = approachInfo(playerPos.x, playerPos.y, playerPos.z, north);
      const dist = Math.max(50, info.dz + 330);
      const ang = Math.atan2(playerPos.y - FIELD_ELEV, dist) / DEG;
      const inRange = info.dz > -100 && info.dz < 9000 && Math.abs(info.lateral) < 1500;
      this.papi[di].forEach((b, i) => {
        const thr = GLIDE_DEG - 0.9 + i * 0.6;   // 2.1, 2.7, 3.3, 3.9
        const white = ang > thr;
        (b.material as THREE.MeshStandardMaterial).emissive.setHex(inRange && !white ? 0xff2020 : 0xffffff);
        (b.material as THREE.MeshStandardMaterial).emissiveIntensity = inRange ? 3 : 0.3;
      });
    });
    for (const b of this.beacons) (b.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = smoothstep(0.55, 0.62, (this.t * 0.8 + b.phase) % 1) * 5 + 0.2;
  }
  dispose() { this.group.traverse(o => { const m = o as THREE.Mesh; m.geometry?.dispose?.(); }); }
}

export { START_POS, cxMain };
