import { clamp, lerp, smoothstep } from '../util/math';
import type { WorldQuery } from '../flight/FlightModel';

/**
 * Pure (render-independent) description of the "Kazbegi Reach" valley: heightfield, runway, valley
 * centre-lines, weather cell and mission geometry. Shared by the renderer, flight model, AI and tests.
 * World axes: +X east, +Y up, -Z north (heading 0). Units: metres.
 */
export const FIELD_ELEV = 350;
export const RUNWAY = { halfLen: 1200, halfWid: 23, shoulder: 14 };
export const START_POS = { x: -82, z: 1385, heading: 0 };
export const LINEUP = { x: 0, z: 1170 };

const hash = (ix: number, iz: number) => {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function vnoise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
}
function fbm(x: number, z: number, oct = 5) {
  let s = 0, amp = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += vnoise(x * f, z * f) * amp; n += amp; amp *= 0.5; f *= 2.03; }
  return s / n;
}

export function cxMain(z: number) {
  const t = smoothstep(-5500, -14000, z);
  return t * (2600 * Math.sin(z * 0.00021) + 1400 * Math.sin(z * 0.00057 + 1.3));
}
export function altBump(z: number) {
  return smoothstep(-8000, -12500, z) * (1 - smoothstep(-26000, -30500, z));
}
export const ALT_OFFSET = 6500;
export function cxAlt(z: number) { return cxMain(z) + ALT_OFFSET * altBump(z); }

export const LAKE = { x: cxMain(-30000) - 900, z: -30000, radius: 650, level: FIELD_ELEV + 30000 * 0.0075 - 4 };
export const WORLD = { minX: -20000, maxX: 20000, minZ: -38000, maxZ: 14000 };

// ---------------- Real-world elevation (optional) ----------------
// When a DEM is installed (public/models/dem.bin, built by tools/fetch-dem.mjs from public SRTM-derived terrain tiles) the mountains
// between the designed flyable valleys come from real Caucasus relief; otherwise the procedural noise below is used (tests, fallback).
export interface Dem { w: number; h: number; cell: number; x0: number; z0: number; scale: number; data: Uint16Array; }
let DEM: Dem | null = null;
export function setDem(d: Dem | null) { DEM = d; }
export const hasDem = () => DEM !== null;
export function parseDem(buf: ArrayBuffer): Dem {
  const dv = new DataView(buf);
  return { w: dv.getUint32(0, true), h: dv.getUint32(4, true), cell: dv.getFloat32(8, true), x0: dv.getFloat32(12, true), z0: dv.getFloat32(16, true), scale: dv.getFloat32(20, true), data: new Uint16Array(buf.slice(24)) };
}
export const DEM_BASE = 1100;   // real elevation (m) treated as "valley floor level"
function demElevation(d: Dem, x: number, z: number): number {
  const fx = Math.min(d.w - 1.001, Math.max(0, (x - d.x0) / d.cell)), fz = Math.min(d.h - 1.001, Math.max(0, (z - d.z0) / d.cell));
  const i = Math.floor(fx), j = Math.floor(fz), ax = fx - i, az = fz - j, q = (a: number, b: number) => d.data[b * d.w + a];
  return ((q(i, j) * (1 - ax) + q(i + 1, j) * ax) * (1 - az) + (q(i, j + 1) * (1 - ax) + q(i + 1, j + 1) * ax) * az) / d.scale;
}

export function terrainHeight(x: number, z: number): number {
  const d1 = Math.abs(x - cxMain(z));
  const bump = altBump(z);
  const d = bump > 0.002 ? Math.min(d1, Math.abs(x - cxAlt(z))) : d1;
  const m = smoothstep(1250, 5200, d);
  const floorN = (fbm(x * 0.0009, z * 0.0009, 3) - 0.5) * 90;
  const floor = FIELD_ELEV + Math.max(0, -z) * 0.0075 + floorN * smoothstep(0, 1500, d);
  const n1 = fbm(x * 0.00021 + 11.3, z * 0.00021 + 4.7, 5);
  const n2 = fbm(x * 0.00055 + 31.1, z * 0.00055 + 8.2, 4);
  const ridged = 1 - Math.abs(2 * n2 - 1);
  const shape = Math.pow(clamp(ridged * 0.55 + n1 * 0.55, 0, 1), 1.45);
  const mountain = DEM
    ? floor + 350 + Math.max(0, demElevation(DEM, x, z) - DEM_BASE) * 0.96 + (fbm(x * 0.004, z * 0.004, 3) - 0.5) * 90
    : floor + 650 + 3650 * shape + (fbm(x * 0.003, z * 0.003, 3) - 0.5) * 220;
  let h = lerp(floor, mountain, m);
  // airfield plateau (kept flat for runway/apron)
  const ax = smoothstep(420, 1000, Math.abs(x)), az = smoothstep(1650, 2300, Math.abs(z));
  h = lerp(FIELD_ELEV, h, Math.max(ax, az));
  // gully under the Red Bridge and the basin of Cinder Lake
  h -= 16 * smoothstep(95, 35, Math.abs(z + 13000)) * smoothstep(1500, 1100, d1);
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  h = lerp(h, LAKE.level - 7, smoothstep(LAKE.radius + 350, LAKE.radius - 150, dl));
  // world-edge ramparts so the play-area is bounded by terrain
  const ex = Math.max(0, Math.abs(x) - 17500), ez = Math.max(0, z > 0 ? z - 11500 : -z - 35500);
  h += (ex + ez) * 1.2;
  return h;
}

export function isPaved(x: number, z: number): boolean {
  const ax = Math.abs(x), az = Math.abs(z);
  if (ax <= RUNWAY.halfWid + RUNWAY.shoulder && az <= RUNWAY.halfLen + 40) return true;
  if (x >= -95 && x <= -70 && z >= 1168 && z <= 1430) return true;       // taxiway A
  if (x >= -95 && x <= -20 && z >= 1168 && z <= 1192) return true;       // connector
  if (x >= -190 && x <= -70 && z >= 1300 && z <= 1440) return true;      // apron
  return false;
}

export const world: WorldQuery = { height: terrainHeight, paved: isPaved };

export function agl(x: number, y: number, z: number) { return y - terrainHeight(x, z); }

/** Terrain line-of-sight between two points (used by radar-network, sensors, AI). */
export function lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number, step = 250): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const L = Math.hypot(dx, dy, dz);
  const n = Math.max(2, Math.ceil(L / step));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (ay + dy * t < terrainHeight(ax + dx * t, az + dz * t) + 5) return false;
  }
  return true;
}

/** Highest terrain along a segment ahead (for GCAS / AI terrain avoidance). */
export function minClearanceAlong(px: number, py: number, pz: number, vx: number, vy: number, vz: number, seconds: number, steps = 16): number {
  let mc = 1e9;
  for (let i = 1; i <= steps; i++) {
    const t = (seconds * i) / steps;
    const x = px + vx * t, z = pz + vz * t;
    mc = Math.min(mc, py + vy * t - terrainHeight(x, z));
  }
  return mc;
}

// ---------------- Mission geometry ----------------
export const CELL_Z = -19500;
/** The blizzard cell sits on the main valley. Its position is chosen when the front forms (see placeBlizzard) so it is always ahead of the player. */
export const BLIZZARD = { x: cxMain(CELL_Z), z: CELL_Z, radius: 4200 };
export const ALT_ROUTE_POINT = { x: cxAlt(CELL_Z), z: CELL_Z };
export function placeBlizzard(z: number) {
  const zc = Math.max(-23500, Math.min(-14500, z));
  BLIZZARD.z = zc; BLIZZARD.x = cxMain(zc); ALT_ROUTE_POINT.z = zc; ALT_ROUTE_POINT.x = cxAlt(zc);
}
export function resetBlizzard() { placeBlizzard(CELL_Z); }

export const WAYPOINTS = {
  W1: { name: 'WP1 HALCYON GATE', x: cxMain(-8000), z: -8000 },
  W2: { name: 'WP2 RED BRIDGE', x: cxMain(-13000), z: -13000 },
  W3: { name: 'WP3 CINDER LAKE', x: cxMain(-30000), z: -30000 },
};
export const LANDMARKS = [
  { name: 'HALCYON GATE', x: cxMain(-8000) + 1500, z: -8000, kind: 'tower' },
  { name: 'RED BRIDGE', x: cxMain(-13000), z: -13000, kind: 'bridge' },
  { name: 'CINDER LAKE', x: cxMain(-30000) - 900, z: -30000, kind: 'lake' },
  { name: 'SIGNAL SPUR', x: cxAlt(-19500), z: -19500, kind: 'beacon' },
] as const;

export interface RadarSite { id: string; x: number; z: number; range: number; }
function ridgeSite(id: string, x: number, z: number, range: number): RadarSite { return { id, x, z, range }; }
export const RADAR_SITES: RadarSite[] = [
  // Sites sit on the floor of the east pass: a low aircraft in the main valley is hidden behind the intervening ridge; one that climbs above it is not.
  ridgeSite('ALPHA', cxAlt(-15500), -15500, 32000),
  ridgeSite('BRAVO', cxAlt(-21000), -21000, 32000),
  ridgeSite('CHARLIE', cxAlt(-26000), -26000, 32000),
];
export function radarSiteAlt(s: RadarSite) { return terrainHeight(s.x, s.z) + 25; }

/** Blizzard intensity 0..1 at a point. `front` (0..1) is the mission-controlled activation. */
export function blizzardAt(x: number, z: number, front: number): number {
  if (front <= 0) return 0;
  const d = Math.hypot(x - BLIZZARD.x, z - BLIZZARD.z);
  const r = BLIZZARD.radius * (0.55 + 0.45 * front);
  return smoothstep(r, r * 0.55, d) * front;
}
