// Converts the user-supplied STL / 3MF models into compact, game-ready binary meshes (public/models/*.bin + manifest.json).
// Usage: node tools/convert-models.mjs <dir with the source files> [su57|f35|pilot]
// Merges duplicate vertices, decimates by vertex clustering, orients (nose = -Z, up = +Y) and scales to real-world size.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

const dir = process.argv[2];
const only = process.argv[3];
const out = 'public/models';
fs.mkdirSync(out, { recursive: true });

function soup(pos) {
  const map = new Map(), verts = [], idx = new Uint32Array(pos.length / 3);
  for (let i = 0; i < pos.length / 3; i++) {
    const key = Math.round(pos[i * 3] * 1000) + ',' + Math.round(pos[i * 3 + 1] * 1000) + ',' + Math.round(pos[i * 3 + 2] * 1000);
    let id = map.get(key);
    if (id === undefined) { id = verts.length / 3; map.set(key, id); verts.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); }
    idx[i] = id;
  }
  return { pos: Float32Array.from(verts), idx };
}
function readStl(p) {
  const b = fs.readFileSync(p); const n = b.readUInt32LE(80); const pos = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) { const o = 84 + i * 50 + 12; for (let k = 0; k < 9; k++) pos[i * 9 + k] = b.readFloatLE(o + k * 4); }
  return soup(pos);
}
function read3mf(p, inner) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'm3-')); const zip = path.join(tmp, 'a.zip'); fs.copyFileSync(p, zip);
  execSync('powershell -NoProfile -Command "Expand-Archive -Force \'' + zip + '\' \'' + tmp + '/x\'"');
  const txt = fs.readFileSync(path.join(tmp, 'x', inner), 'latin1');
  const v = [...txt.matchAll(/<vertex x="([^"]+)" y="([^"]+)" z="([^"]+)"/g)];
  const t = [...txt.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)];
  const pos = new Float32Array(v.length * 3); v.forEach((m, i) => { pos[i * 3] = +m[1]; pos[i * 3 + 1] = +m[2]; pos[i * 3 + 2] = +m[3]; });
  const idx = new Uint32Array(t.length * 3); t.forEach((m, i) => { idx[i * 3] = +m[1]; idx[i * 3 + 1] = +m[2]; idx[i * 3 + 2] = +m[3]; });
  return { pos, idx };
}
function bbox(pos) {
  const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pos[i + k]); mx[k] = Math.max(mx[k], pos[i + k]); }
  return { mn, mx };
}
function cluster(m, mn, cell) {
  const map = new Map(), acc = [], remap = new Uint32Array(m.pos.length / 3);
  for (let i = 0; i < m.pos.length / 3; i++) {
    const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
    const key = Math.floor((x - mn[0]) / cell) + '_' + Math.floor((y - mn[1]) / cell) + '_' + Math.floor((z - mn[2]) / cell);
    let id = map.get(key);
    if (id === undefined) { id = acc.length; map.set(key, id); acc.push([0, 0, 0, 0]); }
    const a = acc[id]; a[0] += x; a[1] += y; a[2] += z; a[3]++; remap[i] = id;
  }
  const pos = new Float32Array(acc.length * 3);
  acc.forEach((a, i) => { pos[i * 3] = a[0] / a[3]; pos[i * 3 + 1] = a[1] / a[3]; pos[i * 3 + 2] = a[2] / a[3]; });
  const idx = [];
  for (let t = 0; t < m.idx.length; t += 3) { const a = remap[m.idx[t]], b = remap[m.idx[t + 1]], c = remap[m.idx[t + 2]]; if (a !== b && b !== c && a !== c) idx.push(a, b, c); }
  return { pos, idx: Uint32Array.from(idx) };
}
function decimate(m, target) {
  if (m.idx.length / 3 <= target) return m;
  const { mn, mx } = bbox(m.pos); const diag = Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
  let lo = diag / 3000, hi = diag / 8, best = null;
  for (let it = 0; it < 14; it++) {
    const cell = Math.sqrt(lo * hi); const r = cluster(m, mn, cell);
    if (r.idx.length / 3 > target) lo = cell; else { hi = cell; best = r; }
  }
  return best ?? cluster(m, mn, hi);
}
function width(m, L, S, lo, hi) {
  let mn = 1e9, mx = -1e9;
  for (let i = 0; i < m.pos.length; i += 3) { const l = m.pos[i + L]; if (l >= lo && l <= hi) { mn = Math.min(mn, m.pos[i + S]); mx = Math.max(mx, m.pos[i + S]); } }
  return mx - mn;
}
function flipWinding(idx) { const r = idx.slice(); for (let t = 0; t < r.length; t += 3) { const x = r[t + 1]; r[t + 1] = r[t + 2]; r[t + 2] = x; } return r; }
function write(name, m, meta) {
  const head = Buffer.alloc(8); head.writeUInt32LE(m.pos.length / 3, 0); head.writeUInt32LE(m.idx.length, 4);
  fs.writeFileSync(path.join(out, name + '.bin'), Buffer.concat([head, Buffer.from(m.pos.buffer, m.pos.byteOffset, m.pos.byteLength), Buffer.from(Uint32Array.from(m.idx).buffer)]));
  const mp = path.join(out, 'manifest.json');
  const manifest = fs.existsSync(mp) ? JSON.parse(fs.readFileSync(mp, 'utf8')) : {};
  manifest[name] = { ...meta, verts: m.pos.length / 3, tris: m.idx.length / 3, bbox: bbox(m.pos) };
  fs.writeFileSync(mp, JSON.stringify(manifest, null, 1));
  console.log('wrote', name, 'verts', m.pos.length / 3, 'tris', m.idx.length / 3);
}

/** axes: length L, span S, up U (source indices). Auto-detects the nose end (narrower) and the up sign (fins stick up). */
function aircraft(m, name, targetLen, tris, axes, forceNose, forceUp) {
  const { L, S, U } = axes; const { mn, mx } = bbox(m.pos); const len = mx[L] - mn[L];
  const wA = width(m, L, S, mn[L], mn[L] + 0.12 * len), wB = width(m, L, S, mx[L] - 0.12 * len, mx[L]);
  const noseLow = forceNose ?? (wA < wB);
  let mean = 0; const n = m.pos.length / 3; for (let i = 0; i < n; i++) mean += m.pos[i * 3 + U]; mean /= n;
  const upSign = forceUp ?? (mean < (mn[U] + mx[U]) / 2 ? 1 : -1);
  console.log(name, 'len', len.toFixed(1), 'nose-end widths', wA.toFixed(1), wB.toFixed(1), 'noseAtLow', noseLow, 'upSign', upSign);
  const cl = (mn[L] + mx[L]) / 2, cs = (mn[S] + mx[S]) / 2, cu = (mn[U] + mx[U]) / 2, k = targetLen / len;
  const pos = new Float32Array(m.pos.length);
  for (let i = 0; i < n; i++) {
    const l = (m.pos[i * 3 + L] - cl) * k, s = (m.pos[i * 3 + S] - cs) * k, u = (m.pos[i * 3 + U] - cu) * k * upSign;
    pos[i * 3] = s; pos[i * 3 + 1] = u; pos[i * 3 + 2] = noseLow ? l : -l;   // nose ends up at -z
  }
  // handedness of (S->x, U->y, L->z) including sign flips decides whether the winding must be reversed
  const perm = [S, U, L]; let inv = 0; for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) if (perm[i] > perm[j]) inv++;
  const parity = (inv % 2 ? -1 : 1) * upSign * (noseLow ? 1 : -1);
  let r = { pos, idx: parity < 0 ? flipWinding(m.idx) : m.idx };
  r = decimate(r, tris);
  write(name, r, { kind: 'aircraft', length: targetLen });
}

if (!only || only === 'su57') {
  const m = readStl(path.join(dir, 'su57.stl')); console.log('su57 raw verts', m.pos.length / 3, 'tris', m.idx.length / 3);
  aircraft(m, 'su57', 20.1, 60000, { L: 0, S: 1, U: 2 });
}
if (!only || only === 'f35') {
  const m = read3mf(path.join(dir, 'f35 fighter jet - war vehichle creator 3mf.3mf'), '3D/3dmodel.model'); console.log('f35 raw verts', m.pos.length / 3, 'tris', m.idx.length / 3);
  aircraft(m, 'f35', 15.7, 60000, { L: 1, S: 0, U: 2 });
}
if (only === 'pilot') {
  const m = read3mf(path.join(dir, 'pilot-stihacky.3mf'), '3D/Objects/object_2.model'); console.log('pilot raw verts', m.pos.length / 3, 'tris', m.idx.length / 3);
  const b = bbox(m.pos); console.log('pilot bbox', b.mn.map(x => +x.toFixed(1)), b.mx.map(x => +x.toFixed(1)));
  const dec = decimate(m, 60000);
  fs.writeFileSync(path.join(os.tmpdir(), 'pilot_dec.json'), JSON.stringify({ pos: Array.from(dec.pos), idx: Array.from(dec.idx) }));
  console.log('pilot decimated tris', dec.idx.length / 3);
}

if (only === 'pilot2') {
  const d = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'pilot_dec.json'), 'utf8'));
  const pos = Float32Array.from(d.pos), idx = Uint32Array.from(d.idx);
  const b = bbox(pos); const H = b.mx[2] - b.mn[2];
  // radius profile per height slice -> top of the display base = last slice where radius ~ base radius
  const slices = 60, prof = new Array(slices).fill(0);
  for (let i = 0; i < pos.length; i += 3) { const s = Math.min(slices - 1, Math.floor((pos[i + 2] - b.mn[2]) / H * slices)); prof[s] = Math.max(prof[s], Math.hypot(pos[i], pos[i + 1])); }
  let top = 0; for (let s = 0; s < slices; s++) { if (prof[s] > 26) top = s; else if (s > 2) break; }
  const cutZ = b.mn[2] + (top + 1) / slices * H;
  console.log('radius profile', prof.slice(0, 14).map(x => x.toFixed(0)).join(' '), 'base top slice', top, 'cutZ', cutZ.toFixed(1));
  // drop triangles fully below the cut plane
  const keep = []; for (let t = 0; t < idx.length; t += 3) { if (pos[idx[t] * 3 + 2] < cutZ && pos[idx[t + 1] * 3 + 2] < cutZ && pos[idx[t + 2] * 3 + 2] < cutZ) continue; keep.push(idx[t], idx[t + 1], idx[t + 2]); }
  // also drop anything still wider than the figure near the bottom (base rim)
  const used = new Set(keep); const nb = bbox(pos);
  // facing: feet point forward -> direction from hip centroid to foot centroid in the XY plane
  const fz0 = cutZ, fz1 = cutZ + 0.1 * H, hz0 = cutZ + 0.35 * H, hz1 = cutZ + 0.5 * H; let fx = 0, fy = 0, fn = 0, hx = 0, hy = 0, hn = 0;
  for (const v of used) { const z = pos[v * 3 + 2]; if (z >= fz0 && z <= fz1) { fx += pos[v * 3]; fy += pos[v * 3 + 1]; fn++; } if (z >= hz0 && z <= hz1) { hx += pos[v * 3]; hy += pos[v * 3 + 1]; hn++; } }
  let dx = fx / fn - hx / hn, dy = fy / fn - hy / hn; console.log('foot-vs-hip offset', dx.toFixed(2), dy.toFixed(2));
  // head offset (top 12%) relative to hip centroid, another forward cue
  let tx = 0, ty = 0, tn = 0; for (const v of used) { if (pos[v * 3 + 2] > b.mx[2] - 0.12 * H) { tx += pos[v * 3]; ty += pos[v * 3 + 1]; tn++; } } console.log('head-vs-hip offset', (tx / tn - hx / hn).toFixed(2), (ty / tn - hy / hn).toFixed(2));
  // remap: source (x,y,z) -> game (x, up=z, back=?) ; choose forward = foot-offset direction -> game -z
  const fl = Math.hypot(dx, dy) || 1; const fxn = dx / fl, fyn = dy / fl;           // forward in source XY
  const height = 1.78, k = height / (b.mx[2] - cutZ);
  let cx = 0, cy = 0, cn = 0; for (const v of used) { cx += pos[v * 3]; cy += pos[v * 3 + 1]; cn++; } cx /= cn; cy /= cn;
  const map = new Map(), np = []; const ni = [];
  const rid = v => { let r = map.get(v); if (r === undefined) { r = np.length / 3; map.set(v, r); const x = pos[v * 3] - cx, y = pos[v * 3 + 1] - cy, z = pos[v * 3 + 2] - cutZ;
    const f = x * fxn + y * fyn, s = x * fyn - y * fxn;               // forward / sideways components in the source plane
    np.push(s * k, z * k, -f * k); } return r; };
  for (let t = 0; t < keep.length; t += 3) ni.push(rid(keep[t]), rid(keep[t + 1]), rid(keep[t + 2]));
  // rotation (x,y)->(s,f) is orientation preserving, z->y keeps handedness if (s,y,-f) is right-handed: check by determinant sign of mapping
  const det = (fyn * 0 + 1) * 1; void det;
  let r = { pos: Float32Array.from(np), idx: Uint32Array.from(ni) };
  // verify winding by signed volume; flip if negative
  let vol = 0; for (let t = 0; t < r.idx.length; t += 3) { const a = r.idx[t] * 3, b2 = r.idx[t + 1] * 3, c = r.idx[t + 2] * 3; vol += r.pos[a] * (r.pos[b2 + 1] * r.pos[c + 2] - r.pos[b2 + 2] * r.pos[c + 1]) - r.pos[a + 1] * (r.pos[b2] * r.pos[c + 2] - r.pos[b2 + 2] * r.pos[c]) + r.pos[a + 2] * (r.pos[b2] * r.pos[c + 1] - r.pos[b2 + 1] * r.pos[c]); }
  if (vol < 0) { r = { pos: r.pos, idx: flipWinding(r.idx) }; console.log('flipped winding'); }
  void nb; write('pilot', r, { kind: 'character', height });
}
