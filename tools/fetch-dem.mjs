// Builds public/models/dem.bin from public AWS/Mapzen "Terrain Tiles" (terrarium PNG; sources include SRTM).
// Usage: node tools/fetch-dem.mjs [lat0 lon0]   (default: airfield origin 42.40N 44.35E, central Greater Caucasus)
// World axes: +X east, -Z north, origin = airfield. Grid covers x -20000..20000, z -38000..14000 at 80 m.
import fs from 'node:fs';
import { PNG } from 'pngjs';

const lat0 = +(process.argv[2] ?? 42.40), lon0 = +(process.argv[3] ?? 44.35);
const X0 = -20000, X1 = 20000, Z0 = -38000, Z1 = 14000, CELL = 80, ZOOM = 11;
const W = Math.round((X1 - X0) / CELL), H = Math.round((Z1 - Z0) / CELL);
const mPerDegLat = 111320, mPerDegLon = 111320 * Math.cos(lat0 * Math.PI / 180);
const latOf = z => lat0 - z / mPerDegLat, lonOf = x => lon0 + x / mPerDegLon;
const n = 2 ** ZOOM;
const tx = lon => (lon + 180) / 360 * n;
const ty = lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
const xs = [Math.floor(tx(lonOf(X0))), Math.floor(tx(lonOf(X1)))];
const ys = [Math.floor(ty(latOf(Z0))), Math.floor(ty(latOf(Z1)))];
console.log('tiles x', xs, 'y', ys, 'grid', W, 'x', H);

const tiles = new Map(); let bytes = 0;
for (let y = ys[0]; y <= ys[1]; y++) for (let x = xs[0]; x <= xs[1]; x++) {
  const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${ZOOM}/${x}/${y}.png`);
  if (!r.ok) throw new Error(`tile ${x}/${y}: HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer()); bytes += buf.length;
  tiles.set(x + '_' + y, PNG.sync.read(buf));
}
console.log('downloaded', tiles.size, 'tiles,', (bytes / 1024).toFixed(0), 'KB');

function elev(px, py) {            // bilinear in global pixel space
  const sample = (ix, iy) => {
    const t = tiles.get(Math.floor(ix / 256) + '_' + Math.floor(iy / 256)); if (!t) return 0;
    const o = ((iy % 256) * 256 + (ix % 256)) * 4;
    return t.data[o] * 256 + t.data[o + 1] + t.data[o + 2] / 256 - 32768;
  };
  const fx = px - 0.5, fy = py - 0.5, x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
  return (sample(x0, y0) * (1 - ax) + sample(x0 + 1, y0) * ax) * (1 - ay) + (sample(x0, y0 + 1) * (1 - ax) + sample(x0 + 1, y0 + 1) * ax) * ay;
}
const data = new Uint16Array(W * H); let mn = 1e9, mx = -1e9, sum = 0;
for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
  const x = X0 + i * CELL, z = Z0 + j * CELL;
  const e = Math.max(0, elev(tx(lonOf(x)) * 256, ty(latOf(z)) * 256));
  data[j * W + i] = Math.round(e * 10); mn = Math.min(mn, e); mx = Math.max(mx, e); sum += e;
}
console.log('elevation min', mn.toFixed(0), 'max', mx.toFixed(0), 'mean', (sum / (W * H)).toFixed(0));
const head = Buffer.alloc(24); head.writeUInt32LE(W, 0); head.writeUInt32LE(H, 4); head.writeFloatLE(CELL, 8); head.writeFloatLE(X0, 12); head.writeFloatLE(Z0, 16); head.writeFloatLE(10, 20);
fs.mkdirSync('public/models', { recursive: true });
fs.writeFileSync('public/models/dem.bin', Buffer.concat([head, Buffer.from(data.buffer)]));
fs.writeFileSync('public/models/dem.json', JSON.stringify({ source: 'AWS/Mapzen Terrain Tiles (terrarium, z' + ZOOM + ')', lat0, lon0, W, H, cell: CELL, min: mn, max: mx }, null, 1));
console.log('wrote public/models/dem.bin', (24 + data.byteLength) / 1024, 'KB');
