import * as THREE from 'three';
import type { Unit } from '../game/Entity';
import type { TargetingSystem } from '../combat/TargetingSystem';
import type { Weapons } from '../combat/Weapons';
import type { MissionDirector } from '../missions/MissionDirector';
import { DEG, FT, clamp, wrap360 } from '../util/math';
import { GUN_SPEC } from '../combat/WeaponSpecs';
import { FORMATION_LABEL, type Formation } from '../ai/WingmanAI';
import { WORLD, terrainHeight } from '../world/Heightfield';

export type CameraView = 'chase' | 'cockpit' | 'wing' | 'tail' | 'orbit' | 'front' | 'target' | 'tactical' | 'tower' | 'cinematic' | 'flyby';
export type MfdMode = 'full' | 'clean';
export interface HudWarnings {
  stall: boolean; stallWarn: boolean; pullUp: boolean; missile: { bearing: number; range: number; ir: boolean } | null;
  bingo: boolean; lowFuel: boolean; damage: boolean; flameout: boolean; overG: boolean; interference: number; lockedOn: boolean;
}
export interface HudSystems {
  egt: number;            // exhaust gas temperature, deg C
  fbw: boolean;           // fly-by-wire limiter enabled
  gcasActive: boolean;    // automatic ground-collision recovery is flying the jet
  aoaLimited: boolean;    // the AoA limiter is trimming the stick this frame
  recovering: boolean;    // panic auto-recovery running
  ecm: string;            // jammer state for the DMS
  supercruise: boolean;   // supersonic without afterburner
}
export interface HudComms { lines: { who: string; text: string }[]; active: boolean; level: number; mic: boolean }
export interface HudInput {
  camera: THREE.PerspectiveCamera;
  player: Unit;
  wing: { unit: Unit; state: string; formation: Formation; separation: number; interference: number } | null;
  targeting: TargetingSystem;
  weapons: Weapons;
  allUnits: Unit[];
  mission: MissionDirector | null;
  view: CameraView;
  now: number;
  warnings: HudWarnings;
  prompt: string | null;
  hint: string | null;
  metric: boolean;
  radarRangeKm: number;
  startup: number;
  debug: string[] | null;
  weaponMsg: string;
  freeLook: boolean;
  guidance: { dirNorth: boolean; dz: number; lateral: number; gsError: number; show: boolean } | null;
  helpKeys: string;
  mouse: { x: number; y: number; nx: number; ny: number; r: number } | null;   // mouse-aim cursor and nose marker (px)
  assist: string | null;                               // active voice/autopilot assist
  bgLum: number;                                       // 0..1 brightness of the scene behind the HUD (adaptive contrast)
  mfd: MfdMode;
  sys: HudSystems;
  comms: HudComms;
  radarSites: { x: number; z: number; range: number }[];
  pickups: { x: number; z: number; label: string }[];
  /** F-35 Distributed Aperture System: bearings (rad, relative to the nose) of missiles guiding on us – 360° */
  das: { bearing: number; range: number; ir: boolean }[] | null;
}

// ---- adaptive palette: pastel glow on dark backgrounds, deep saturated green with a dark halo on snow / bright sky ----
let GREEN = '#7dffb2', DIM = 'rgba(125,255,178,0.55)', AMBER = '#ffc34d', CYAN = '#7fe3ff', HALO = 'rgba(0,0,0,0)', PANEL = 'rgba(0,14,10,0.62)';
const RED = '#ff5a4d', WHITE = '#e8f4ff';
function mix(a: number[], b: number[], t: number) { return a.map((v, i) => Math.round(v + (b[i] - v) * t)); }
function setPalette(lum: number) {
  const t = clamp((lum - 0.42) / 0.38, 0, 1);              // 0 = dark scene, 1 = bright snow / haze
  const g = mix([125, 255, 178], [20, 210, 110], t), a = mix([255, 195, 77], [235, 150, 0], t), c = mix([127, 227, 255], [0, 150, 215], t);
  GREEN = `rgb(${g})`; DIM = `rgba(${g},${(0.55 + 0.25 * t).toFixed(2)})`; AMBER = `rgb(${a})`; CYAN = `rgb(${c})`;
  HALO = `rgba(0,0,0,${(0.15 + 0.55 * t).toFixed(2)})`; PANEL = `rgba(0,14,10,${(0.58 + 0.2 * t).toFixed(2)})`;
}

const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();
const MFD = 224;      // MFD size in the HUD's virtual pixels

/** Top-down "fighter" silhouette for the damage MFD (unit coordinates, nose up). */
const SILHOUETTE: [number, number][] = [[0, -1], [0.09, -0.72], [0.13, -0.3], [0.62, 0.12], [0.66, 0.26], [0.16, 0.3], [0.17, 0.62], [0.42, 0.86], [0.42, 0.96], [0.1, 0.92], [0.07, 1], [-0.07, 1], [-0.1, 0.92], [-0.42, 0.96], [-0.42, 0.86], [-0.17, 0.62], [-0.16, 0.3], [-0.66, 0.26], [-0.62, 0.12], [-0.13, -0.3], [-0.09, -0.72]];
const PYLONS: [number, number][] = [[-0.46, 0.2], [-0.3, 0.16], [0.3, 0.16], [0.46, 0.2]];

export class HUD {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private W = 1; private H = 1; private dpr = 1;
  /** screen-space rectangle of the comms MFD (for the clickable squad buttons placed under it) */
  commsRect: { x: number; y: number; w: number; h: number } | null = null;
  private fpm: { x: number; y: number } | null = null;
  private pip: { x: number; y: number } | null = null;
  private boxes = new Map<Unit, { x: number; y: number; s: number }>();
  private topo: HTMLCanvasElement | null = null;
  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas'); this.canvas.id = 'hud'; parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    this.resize();
  }
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.canvas.width = Math.floor(this.W * this.dpr); this.canvas.height = Math.floor(this.H * this.dpr);
    this.canvas.style.width = this.W + 'px'; this.canvas.style.height = this.H + 'px';
  }
  clear() { this.g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); this.g.clearRect(0, 0, this.W, this.H); this.commsRect = null; this.boxes.clear(); this.fpm = this.pip = null; }
  setVisible(v: boolean) { this.canvas.style.display = v ? 'block' : 'none'; }
  /** Rebuilds the topographic map (call after the terrain or biome changes). */
  invalidateTopo() { this.topo = null; }

  private project(cam: THREE.PerspectiveCamera, dir: THREE.Vector3, dist = 1500): { x: number; y: number; ok: boolean } {
    cam.getWorldDirection(_f);
    const ok = dir.dot(_f) > 0.05;
    _v.copy(cam.position).addScaledVector(dir, dist).project(cam);
    return { x: (_v.x * 0.5 + 0.5) * this.W, y: (-_v.y * 0.5 + 0.5) * this.H, ok };
  }
  private projectPoint(cam: THREE.PerspectiveCamera, p: THREE.Vector3): { x: number; y: number; ok: boolean; depth: number } {
    cam.getWorldDirection(_f);
    _d.copy(p).sub(cam.position);
    const ok = _d.dot(_f) > 1;
    _v.copy(p).project(cam);
    return { x: (_v.x * 0.5 + 0.5) * this.W, y: (-_v.y * 0.5 + 0.5) * this.H, ok, depth: _d.length() };
  }

  /** Draw a panel in a virtual coordinate space so the HUD stays readable from small windows to large monitors. */
  private scaled(fn: () => void) {
    const u = this.u; if (Math.abs(u - 1) < 0.02) { fn(); return; }
    const w0 = this.W, h0 = this.H; this.W = w0 / u; this.H = h0 / u; this.g.save(); this.g.scale(u, u);
    try { fn(); } finally { this.g.restore(); this.W = w0; this.H = h0; }
  }
  private u = 1;
  private dtLerp = 0.016;
  private lastNow = 0;

  draw(s: HudInput) {
    const g = this.g, W = this.W;
    const boxes = this.boxes, fpm = this.fpm, pip = this.pip;
    this.clear();
    this.boxes = boxes; this.fpm = fpm; this.pip = pip;
    this.dtLerp = clamp(s.now - this.lastNow, 0, 0.1); this.lastNow = s.now;
    setPalette(s.bgLum);
    this.u = clamp(Math.min(this.W / 1100, this.H / 650), 0.62, 1.2);
    g.lineWidth = 1.6; g.font = '13px Consolas, "Courier New", monospace'; g.textBaseline = 'middle';
    // dark halo behind every stroke/glyph on bright scenes keeps symbology legible against snow glare
    g.shadowColor = HALO; g.shadowBlur = s.bgLum > 0.45 ? 3 : 0;

    this.scaled(() => this.drawWarningsCentre(s));
    if (s.assist) this.scaled(() => { const g2 = this.g; g2.fillStyle = PANEL; g2.fillRect(this.W / 2 - 200, 82, 400, 24); g2.strokeStyle = CYAN; g2.strokeRect(this.W / 2 - 200, 82, 400, 24); g2.fillStyle = CYAN; g2.textAlign = 'center'; g2.font = 'bold 13px Consolas, monospace'; g2.fillText(s.assist + '   (move the stick to take over)', this.W / 2, 95); });
    if (s.view !== 'flyby') {
      this.drawLadder(s);
      this.drawFlightPath(s);
      this.scaled(() => { this.drawSpeedTape(s); this.drawAltTape(s); this.drawHeading(s); });
      this.drawTargets(s);
      this.scaled(() => {
        this.drawTSA(s);
        if (s.mfd === 'full') { this.drawDMS(s); this.drawComms(s); }
        else this.drawCleanStatus(s);
      });
    } else {
      g.fillStyle = DIM; g.textAlign = 'center'; g.fillText('FLYBY CAMERA – press 5 for the next view', W / 2, 30);
    }
    this.scaled(() => { this.drawMission(s); this.drawPrompt(s); });
    if (s.mission && s.mission.phase === 'P2_TRANSIT') this.scaled(() => this.drawDetect(s));
    if (s.guidance?.show) this.scaled(() => this.drawLanding(s));
    if (s.das && s.das.length) this.drawDas(s);
    if (s.mouse) this.drawMouse(s);
    if (s.debug) this.drawDebug(s);
    g.shadowBlur = 0;
  }

  private ease(k: number) { return 1 - Math.exp(-this.dtLerp * k); }

  // ------------------------------------------------------------------------------------ attitude
  private drawLadder(s: HudInput) {
    const g = this.g, cam = s.camera, m = s.player.model;
    const hdg = m.heading * DEG;
    g.strokeStyle = GREEN; g.fillStyle = GREEN; g.font = '11px Consolas, monospace'; g.textAlign = 'center'; g.lineWidth = 1.2;
    const pt = (el: number, az: number) => {
      const c = Math.cos(el);
      _r.set(Math.sin(az) * c, Math.sin(el), -Math.cos(az) * c);
      return this.project(cam, _r.clone(), 3000);
    };
    const centre = m.pitchDeg;
    for (let a = -90; a <= 90; a += 5) {
      if (Math.abs(a - centre) > 38) continue;
      const half = a === 0 ? 10 : 3.6;
      const L = pt(a * DEG, hdg - half * DEG / Math.max(0.3, Math.cos(a * DEG))), R = pt(a * DEG, hdg + half * DEG / Math.max(0.3, Math.cos(a * DEG)));
      if (!L.ok || !R.ok) continue;
      g.globalAlpha = a === 0 ? 0.95 : 0.7;
      if (a === 0) {
        const gapL = pt(0, hdg - 2.4 * DEG), gapR = pt(0, hdg + 2.4 * DEG);
        g.beginPath(); g.moveTo(L.x, L.y); g.lineTo(gapL.x, gapL.y); g.moveTo(gapR.x, gapR.y); g.lineTo(R.x, R.y); g.stroke();
      } else {
        const gapL = pt(a * DEG, hdg - 1.4 * DEG), gapR = pt(a * DEG, hdg + 1.4 * DEG);
        g.setLineDash(a < 0 ? [4, 4] : []);
        g.beginPath(); g.moveTo(L.x, L.y); g.lineTo(gapL.x, gapL.y); g.moveTo(gapR.x, gapR.y); g.lineTo(R.x, R.y); g.stroke();
        g.setLineDash([]);
        const tick = a > 0 ? 5 : -5;
        g.beginPath(); g.moveTo(L.x, L.y); g.lineTo(L.x, L.y + tick); g.moveTo(R.x, R.y); g.lineTo(R.x, R.y + tick); g.stroke();
        g.fillText(String(Math.abs(a)), R.x + 14, R.y);
      }
    }
    g.globalAlpha = 1; g.lineWidth = 1.6;
  }

  private drawFlightPath(s: HudInput) {
    const g = this.g, m = s.player.model, cam = s.camera;
    m.forward(_r);
    const nose = this.project(cam, _r.clone(), 3000);
    if (nose.ok) {   // boresight "W"
      g.strokeStyle = GREEN; g.lineWidth = 1.3; g.beginPath();
      g.moveTo(nose.x - 16, nose.y); g.lineTo(nose.x - 8, nose.y); g.lineTo(nose.x - 4, nose.y + 5); g.lineTo(nose.x, nose.y); g.lineTo(nose.x + 4, nose.y + 5); g.lineTo(nose.x + 8, nose.y); g.lineTo(nose.x + 16, nose.y); g.stroke();
    }
    // velocity vector: low-latency lerped flight-path marker
    if (m.tas > 8) {
      _d.copy(m.vel).normalize();
      const fp = this.project(cam, _d.clone(), 3000);
      if (fp.ok) {
        const k = this.ease(24);
        this.fpm = this.fpm ? { x: this.fpm.x + (fp.x - this.fpm.x) * k, y: this.fpm.y + (fp.y - this.fpm.y) * k } : { x: fp.x, y: fp.y };
        const p = this.fpm;
        g.strokeStyle = GREEN; g.lineWidth = 1.5; g.beginPath(); g.arc(p.x, p.y, 6, 0, Math.PI * 2);
        g.moveTo(p.x - 16, p.y); g.lineTo(p.x - 6, p.y); g.moveTo(p.x + 6, p.y); g.lineTo(p.x + 16, p.y); g.moveTo(p.x, p.y - 6); g.lineTo(p.x, p.y - 13); g.stroke();
        // energy caret: acceleration along the flight path (left of the marker)
        const acc = clamp((m.throttleCmd - 0.55) * 1.6 - Math.sin(m.pitchDeg * DEG) * 1.2, -1, 1);
        g.beginPath(); g.moveTo(p.x - 22, p.y - acc * 12); g.lineTo(p.x - 27, p.y - acc * 12 - 4); g.lineTo(p.x - 27, p.y - acc * 12 + 4); g.closePath(); g.fillStyle = GREEN; g.fill();
      } else this.fpm = null;
    }
    g.lineWidth = 1.6;
  }

  // ------------------------------------------------------------------------------------ tapes
  private tape(x: number, value: number, unitsPerTick: number, labelEvery: number, side: 'L' | 'R', fmt: (v: number) => string, title: string, color = GREEN) {
    const g = this.g, H = this.H, cy = H / 2, span = 5.4, ppu = (H * 0.46) / (unitsPerTick * span);
    g.save();
    g.beginPath(); g.rect(x - 70, cy - H * 0.23, 140, H * 0.46); g.clip();
    g.strokeStyle = DIM; g.fillStyle = DIM; g.textAlign = side === 'L' ? 'right' : 'left'; g.lineWidth = 1.1; g.font = '11px Consolas, monospace';
    const start = Math.floor((value - unitsPerTick * span) / unitsPerTick) * unitsPerTick;
    for (let v = start; v <= value + unitsPerTick * span; v += unitsPerTick) {
      const y = cy - (v - value) * ppu;
      if (v < 0 && title === 'KT') continue;
      const major = Math.round(v / unitsPerTick) % labelEvery === 0;
      g.beginPath();
      if (side === 'L') { g.moveTo(x, y); g.lineTo(x - (major ? 12 : 6), y); } else { g.moveTo(x, y); g.lineTo(x + (major ? 12 : 6), y); }
      g.stroke();
      if (major) g.fillText(fmt(v), side === 'L' ? x - 18 : x + 18, y);
    }
    g.restore();
    // value box: thin pointer box
    g.strokeStyle = color; g.fillStyle = PANEL; g.lineWidth = 1.3;
    const bx = side === 'L' ? x - 72 : x + 8;
    g.beginPath();
    if (side === 'L') { g.moveTo(bx, cy - 12); g.lineTo(bx + 58, cy - 12); g.lineTo(bx + 66, cy); g.lineTo(bx + 58, cy + 12); g.lineTo(bx, cy + 12); }
    else { g.moveTo(bx + 66, cy - 12); g.lineTo(bx + 8, cy - 12); g.lineTo(bx, cy); g.lineTo(bx + 8, cy + 12); g.lineTo(bx + 66, cy + 12); }
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = color; g.textAlign = 'center'; g.font = 'bold 15px Consolas, monospace'; g.fillText(fmt(Math.round(value)), bx + 33, cy + 1);
    g.font = '10px Consolas, monospace'; g.fillStyle = DIM; g.fillText(title, bx + 33, cy - 22);
    g.font = '13px Consolas, "Courier New", monospace'; g.lineWidth = 1.6;
  }
  private drawSpeedTape(s: HudInput) {
    const m = s.player.model, x = this.W / 2 - Math.min(this.W * 0.22, 230);
    const warn = m.stallWarning && !m.onGround;
    this.tape(x, m.iasKt, 10, 5, 'L', v => String(Math.round(v)), 'KT', warn ? AMBER : GREEN);
    const g = this.g; g.fillStyle = GREEN; g.textAlign = 'right'; g.font = '12px Consolas, monospace';
    g.fillText(`M ${m.mach.toFixed(2)}`, x - 6, this.H / 2 + 36);
    g.fillStyle = Math.abs(m.gLoad) > s.player.cfg.gLimit * 0.9 ? AMBER : GREEN; g.fillText(`G ${m.gLoad.toFixed(1)}`, x - 6, this.H / 2 + 52);
    g.fillStyle = m.alpha > s.player.cfg.alphaCrit * 0.8 ? AMBER : DIM; g.fillText(`α ${(m.alpha / DEG).toFixed(0)}°`, x - 6, this.H / 2 + 68);
    if (m.iasKt < 135 && m.onGround && m.throttleCmd > 0.5) { g.fillStyle = AMBER; g.fillText('ROTATE @135', x - 6, this.H / 2 - 40); }
    if (s.sys.supercruise) { g.fillStyle = CYAN; g.fillText('SUPERCRUISE', x - 6, this.H / 2 + 84); }
    g.font = '13px Consolas, monospace';
  }
  private drawAltTape(s: HudInput) {
    const m = s.player.model, x = this.W / 2 + Math.min(this.W * 0.22, 230);
    const val = s.metric ? m.pos.y : m.pos.y * FT;
    this.tape(x, val, s.metric ? 50 : 100, 2, 'R', v => String(Math.round(v)), s.metric ? 'M' : 'FT');
    const g = this.g, vs = m.vel.y * FT * 60;
    g.fillStyle = GREEN; g.textAlign = 'left'; g.font = '12px Consolas, monospace';
    g.fillText(`VS ${Math.round(vs / 10) * 10}`, x + 10, this.H / 2 + 36);
    const agl = m.pos.y - terrainHeight(m.pos.x, m.pos.z);
    g.fillText(`AGL ${Math.round(s.metric ? agl : agl * FT)}`, x + 10, this.H / 2 + 52);
    if (m.gearDown && !m.onGround && agl < 300) { g.fillStyle = AMBER; g.fillText(`RAD ${Math.round(agl * FT)}`, x + 10, this.H / 2 + 68); }
    g.font = '13px Consolas, monospace';
  }
  private drawHeading(s: HudInput) {
    const g = this.g, W = this.W, m = s.player.model, hdg = m.heading, y = 38;
    const ppd = 5;
    g.save(); g.beginPath(); g.rect(W / 2 - 200, y - 14, 400, 40); g.clip();
    g.strokeStyle = DIM; g.fillStyle = GREEN; g.textAlign = 'center'; g.lineWidth = 1.1; g.font = '11px Consolas, monospace';
    for (let d = -45; d <= 45; d++) {
      const a = Math.round(hdg + d);
      if (a % 5 !== 0) continue;
      const x = W / 2 + (a - hdg) * ppd;
      const major = a % 10 === 0;
      g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x, y + (major ? 12 : 8)); g.stroke();
      if (major) {
        const aa = wrap360(a);
        const lab = aa === 0 ? 'N' : aa === 90 ? 'E' : aa === 180 ? 'S' : aa === 270 ? 'W' : String(Math.round(aa / 10)).padStart(2, '0');
        g.fillText(lab, x, y - 4);
      }
    }
    const target = s.mission?.nav[0];
    if (target) {
      const b = wrap360(Math.atan2(target.x - m.pos.x, -(target.z - m.pos.z)) / DEG);
      const diff = clamp(((b - hdg + 540) % 360) - 180, -44, 44);
      const x = W / 2 + diff * ppd;
      g.fillStyle = CYAN; g.beginPath(); g.moveTo(x, y + 14); g.lineTo(x - 5, y + 22); g.lineTo(x + 5, y + 22); g.closePath(); g.fill();
    }
    g.restore();
    g.strokeStyle = GREEN; g.fillStyle = PANEL; g.beginPath(); g.moveTo(W / 2 - 22, y + 18); g.lineTo(W / 2 + 22, y + 18); g.lineTo(W / 2 + 22, y + 36); g.lineTo(W / 2 - 22, y + 36); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = GREEN; g.font = 'bold 14px Consolas, monospace'; g.textAlign = 'center'; g.fillText(String(Math.round(hdg) % 360).padStart(3, '0'), W / 2, y + 28);
    g.font = '13px Consolas, "Courier New", monospace';
  }

  // ------------------------------------------------------------------------------------ targeting
  private drawTargets(s: HudInput) {
    const g = this.g, cam = s.camera, ts = s.targeting, me = s.player;
    const k = this.ease(20);
    for (const u of s.allUnits) {
      if (u === me || !u.alive) continue;
      const pr = this.projectPoint(cam, u.pos);
      if (!pr.ok) { this.boxes.delete(u); continue; }
      const hostile = u.side === 'hostile', friendly = u.side === 'friendly', selected = ts.selected === u;
      const range = pr.depth;
      if (range > 60000) continue;
      const known = friendly || (ts.contactFor(u)?.inScan && ts.contactFor(u)?.los) || range < 4500;
      if (!known) continue;
      const size = clamp(2400 / Math.max(range, 200) * 12, 7, 22);
      const prev = this.boxes.get(u);
      const b = prev ? { x: prev.x + (pr.x - prev.x) * k, y: prev.y + (pr.y - prev.y) * k, s: prev.s + (size - prev.s) * k } : { x: pr.x, y: pr.y, s: size };
      this.boxes.set(u, b);
      const col = friendly ? CYAN : hostile ? (u.identified ? RED : AMBER) : WHITE;
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = selected ? 1.8 : 1.1;
      if (hostile && !u.identified) g.strokeRect(b.x - b.s / 2, b.y - b.s / 2, b.s, b.s);
      else if (hostile) { g.beginPath(); g.moveTo(b.x, b.y - b.s); g.lineTo(b.x + b.s, b.y); g.lineTo(b.x, b.y + b.s); g.lineTo(b.x - b.s, b.y); g.closePath(); g.stroke(); }
      else { g.beginPath(); g.arc(b.x, b.y, b.s, 0, Math.PI * 2); g.stroke(); }
      g.font = '10px Consolas, monospace'; g.textAlign = 'center';
      g.fillText(`${friendly ? 'FRIEND ' : ''}${u.identified || friendly ? u.callsign : 'UNKNOWN'}  ${(range / 1000).toFixed(1)}km`, b.x, b.y + b.s + 12);
      if (selected) {
        // predictive tracking: where the target will be in 2 s at its current velocity
        _v.copy(u.pos).addScaledVector(u.vel, 2);
        const pp = this.projectPoint(cam, _v);
        if (pp.ok) {
          g.setLineDash([3, 4]); g.globalAlpha = 0.7; g.beginPath(); g.moveTo(b.x, b.y); g.lineTo(pp.x, pp.y); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
          g.beginPath(); g.arc(pp.x, pp.y, 3, 0, Math.PI * 2); g.stroke(); g.fillText('+2s', pp.x, pp.y - 9);
        }
        const st = ts.lock, pulse = Math.floor(s.now * 6) % 2 === 0;
        const c = st === 'LOCK' ? RED : st === 'TRACK' ? AMBER : GREEN;
        g.strokeStyle = c; g.lineWidth = 1.8;
        const kk = b.s + 9;
        if (st !== 'TRACK' || pulse) {
          g.beginPath();
          for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) { g.moveTo(b.x + dx * kk, b.y + dy * (kk - 6)); g.lineTo(b.x + dx * kk, b.y + dy * kk); g.lineTo(b.x + dx * (kk - 6), b.y + dy * kk); }
          g.stroke();
        }
        if (st === 'LOCK') { g.beginPath(); g.arc(b.x, b.y, kk + 6, 0, Math.PI * 2); g.stroke(); }
        g.fillStyle = c; g.fillText(ts.weapon === 'GUN' ? 'GUN' : st === 'LOCK' ? 'LOCK' : st === 'TRACK' ? 'TRACKING' : 'SEARCH', b.x, b.y - kk - 8);
        if (!u.identified) { g.strokeStyle = AMBER; g.strokeRect(b.x - 22, b.y + kk + 18, 44, 4); g.fillStyle = AMBER; g.fillRect(b.x - 22, b.y + kk + 18, 44 * ts.idProgress, 4); g.fillText('IDENTIFYING', b.x, b.y + kk + 30); }
      }
      g.lineWidth = 1.6; g.font = '13px Consolas, "Courier New", monospace';
    }
    for (const u of [...this.boxes.keys()]) if (!u.alive) this.boxes.delete(u);
    // lead-computing gun pipper (lerped) with a range bar that unwinds as the target closes
    if (ts.weapon === 'GUN' && ts.selected && ts.selected.alive) {
      const lead = ts.lead();
      const pr = lead ? this.projectPoint(cam, lead.aim) : null;
      if (lead && pr && pr.ok) {
        this.pip = this.pip ? { x: this.pip.x + (pr.x - this.pip.x) * k, y: this.pip.y + (pr.y - this.pip.y) * k } : { x: pr.x, y: pr.y };
        const p = this.pip, inRange = lead.inRange;
        const rng = ts.selectedContact?.range ?? 9999, frac = clamp(1 - rng / (GUN_SPEC.muzzleVelocity * GUN_SPEC.lifetime), 0, 1);
        g.strokeStyle = inRange ? GREEN : DIM; g.lineWidth = 1.4;
        g.beginPath(); g.arc(p.x, p.y, 16, 0, Math.PI * 2); g.stroke();
        g.lineWidth = 3; g.beginPath(); g.arc(p.x, p.y, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); g.stroke(); g.lineWidth = 1.4;
        g.fillStyle = inRange ? GREEN : DIM; g.beginPath(); g.arc(p.x, p.y, 1.8, 0, Math.PI * 2); g.fill();
        g.font = '10px Consolas, monospace'; g.textAlign = 'left'; g.fillText(inRange ? `SHOOT  TOF ${lead.time.toFixed(1)}s` : `TOF ${lead.time.toFixed(1)}s`, p.x + 22, p.y);
        g.font = '13px Consolas, monospace'; g.lineWidth = 1.6;
      } else this.pip = null;
    } else this.pip = null;
  }

  // ------------------------------------------------------------------------------------ MFD frame
  private mfdFrame(x: number, y: number, w: number, h: number, title: string, right = '') {
    const g = this.g;
    g.fillStyle = PANEL; g.fillRect(x, y, w, h);
    g.strokeStyle = DIM; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    g.strokeStyle = GREEN; g.lineWidth = 2;
    for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]] as const) { g.beginPath(); g.moveTo(cx + dx * 12, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + dy * 12); g.stroke(); }
    g.lineWidth = 1.6; g.fillStyle = GREEN; g.font = 'bold 11px Consolas, monospace'; g.textAlign = 'left'; g.fillText(title, x + 8, y + 11);
    if (right) { g.textAlign = 'right'; g.fillStyle = DIM; g.font = '10px Consolas, monospace'; g.fillText(right, x + w - 8, y + 11); }
    g.font = '12px Consolas, monospace';
  }

  // ------------------------------------------------------------------------------------ TSA MFD (topographic tactical map)
  private buildTopo() {
    const cell = 200, w = Math.round((WORLD.maxX - WORLD.minX) / cell), h = Math.round((WORLD.maxZ - WORLD.minZ) / cell);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d')!, img = g.createImageData(w, h);
    const hs = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) hs[j * w + i] = terrainHeight(WORLD.minX + (i + 0.5) * cell, WORLD.minZ + (j + 0.5) * cell);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const v = hs[j * w + i], band = Math.floor(v / 250), t = clamp((v - 300) / 2600, 0, 1);
      const edge = (i + 1 < w && Math.floor(hs[j * w + i + 1] / 250) !== band) || (j + 1 < h && Math.floor(hs[(j + 1) * w + i] / 250) !== band);
      const o = (j * w + i) * 4;
      img.data[o] = 10 + t * 40; img.data[o + 1] = 40 + t * 70; img.data[o + 2] = 30 + t * 50; img.data[o + 3] = 255;
      if (edge) { img.data[o] += 40; img.data[o + 1] += 90; img.data[o + 2] += 60; }
    }
    g.putImageData(img, 0, 0);
    this.topo = c;
  }

  private drawTSA(s: HudInput) {
    const g = this.g, me = s.player, m = me.model, S = s.mfd === 'full' ? MFD : 170;
    const x0 = this.W - S - 14, y0 = this.H - S - 14, cx = x0 + S / 2, cy = y0 + S * 0.62, R = S * 0.5;
    const rangeM = s.radarRangeKm * 1000, k = R / rangeM, hdg = m.heading * DEG;
    this.mfdFrame(x0, y0, S, S, 'TSA', `${s.radarRangeKm} KM [Z]`);
    if (!this.topo) this.buildTopo();
    g.save();
    g.beginPath(); g.rect(x0 + 2, y0 + 20, S - 4, S - 22); g.clip();
    // world layer, heading-up
    g.translate(cx, cy); g.rotate(-hdg); g.scale(k, k);
    g.globalAlpha = 0.85; g.imageSmoothingEnabled = true;
    g.drawImage(this.topo!, WORLD.minX - m.pos.x, WORLD.minZ - m.pos.z, WORLD.maxX - WORLD.minX, WORLD.maxZ - WORLD.minZ);
    g.globalAlpha = 1;
    // SAM / radar detection envelopes
    for (const r of s.radarSites) {
      g.beginPath(); g.arc(r.x - m.pos.x, r.z - m.pos.z, r.range, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,80,60,0.10)'; g.fill();
      g.setLineDash([700, 500]); g.strokeStyle = 'rgba(255,90,77,0.7)'; g.lineWidth = 1.2 / k; g.stroke(); g.setLineDash([]);
    }
    // own predicted flight path (30 s at the current turn rate)
    const right = _r.set(1, 0, 0).applyQuaternion(m.q), bank = Math.asin(clamp(-right.y, -1, 1));
    const sp = Math.max(40, Math.hypot(m.vel.x, m.vel.z)), omega = clamp(9.81 * Math.tan(bank) / sp, -0.5, 0.5);
    let px = 0, pz = 0, h = Math.atan2(m.vel.x, -m.vel.z);
    g.strokeStyle = GREEN; g.lineWidth = 1.4 / k; g.setLineDash([300, 300]); g.beginPath(); g.moveTo(0, 0);
    for (let t = 0; t < 30; t += 1) { h += omega; px += Math.sin(h) * sp; pz -= Math.cos(h) * sp; g.lineTo(px, pz); }
    g.stroke(); g.setLineDash([]);
    g.restore();
    // icons (screen-oriented) placed with the same transform
    const toScreen = (wx: number, wz: number) => {
      const dx = wx - m.pos.x, dz = wz - m.pos.z, c = Math.cos(-hdg), sn = Math.sin(-hdg);
      return { x: cx + (dx * c - dz * sn) * k, y: cy + (dx * sn + dz * c) * k };
    };
    const inside = (p: { x: number; y: number }) => p.x > x0 + 4 && p.x < x0 + S - 4 && p.y > y0 + 22 && p.y < y0 + S - 4;
    g.save(); g.beginPath(); g.rect(x0 + 2, y0 + 20, S - 4, S - 22); g.clip();
    for (const n of s.mission?.nav ?? []) { const p = toScreen(n.x, n.z); if (!inside(p)) continue; g.strokeStyle = CYAN; g.beginPath(); g.moveTo(p.x, p.y - 5); g.lineTo(p.x + 5, p.y); g.lineTo(p.x, p.y + 5); g.lineTo(p.x - 5, p.y); g.closePath(); g.stroke(); }
    for (const pk of s.pickups) { const p = toScreen(pk.x, pk.z); if (!inside(p)) continue; g.fillStyle = AMBER; g.fillRect(p.x - 3, p.y - 3, 6, 6); g.font = '9px Consolas, monospace'; g.textAlign = 'center'; g.fillText(pk.label, p.x, p.y - 9); }
    for (const u of s.allUnits) {
      if (u === me || !u.alive) continue;
      const friendly = u.side === 'friendly', c = s.targeting.contactFor(u);
      if (!friendly && !(c && c.inScan && c.los)) continue;
      const p = toScreen(u.pos.x, u.pos.z); if (!inside(p)) continue;
      const col = friendly ? CYAN : u.identified ? RED : AMBER;
      g.fillStyle = col; g.strokeStyle = col; g.lineWidth = 1.2;
      if (friendly) { g.beginPath(); g.arc(p.x, p.y, 3.5, 0, Math.PI * 2); g.fill(); }
      else { g.beginPath(); g.moveTo(p.x, p.y - 5); g.lineTo(p.x + 5, p.y); g.lineTo(p.x, p.y + 5); g.lineTo(p.x - 5, p.y); g.closePath(); if (u === s.targeting.selected) g.stroke(); else g.fill(); }
      // bandit vector prediction: where it will be in 20 s
      const q = toScreen(u.pos.x + u.vel.x * 20, u.pos.z + u.vel.z * 20);
      g.globalAlpha = 0.75; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(q.x, q.y); g.stroke(); g.globalAlpha = 1;
      if (!friendly) { g.font = '9px Consolas, monospace'; g.textAlign = 'left'; g.fillText(`${Math.round(u.pos.y * FT / 1000)}`, p.x + 7, p.y - 6); }
    }
    for (const mm of s.weapons.missiles) if (mm.mode === 'GUIDED' && mm.target === me) { const p = toScreen(mm.pos.x, mm.pos.z); if (inside(p)) { g.fillStyle = RED; g.fillRect(p.x - 2.5, p.y - 2.5, 5, 5); } }
    g.restore();
    // range rings + ownship
    g.strokeStyle = DIM; g.lineWidth = 0.8; g.globalAlpha = 0.6;
    for (const f of [0.5, 1]) { g.beginPath(); g.arc(cx, cy, R * f, Math.PI * 1.05, Math.PI * 1.95); g.stroke(); }
    g.globalAlpha = 1; g.fillStyle = GREEN; g.beginPath(); g.moveTo(cx, cy - 7); g.lineTo(cx + 5, cy + 5); g.lineTo(cx, cy + 2); g.lineTo(cx - 5, cy + 5); g.closePath(); g.fill();
    g.lineWidth = 1.6;
  }

  // ------------------------------------------------------------------------------------ DMS MFD (systems & damage)
  private drawDMS(s: HudInput) {
    const g = this.g, p = s.player, m = p.model, ts = s.targeting, S = MFD;
    const x0 = 14, y0 = this.H - S - 14;
    const hp = p.healthFrac, hullCol = hp < 0.4 ? RED : hp < 0.7 ? AMBER : GREEN;
    this.mfdFrame(x0, y0, S, S, 'DMS', `${p.cfg.name.toUpperCase()}`);
    // wireframe schematic (nose up), coloured by structural health; engine bay by EGT
    const sx = x0 + 62, sy = y0 + 92, sc = 52;
    g.strokeStyle = hullCol; g.lineWidth = 1.3; g.fillStyle = hp < 0.4 ? 'rgba(255,90,77,0.18)' : hp < 0.7 ? 'rgba(255,195,77,0.14)' : 'rgba(125,255,178,0.08)';
    g.beginPath(); SILHOUETTE.forEach(([a, b], i) => (i ? g.lineTo(sx + a * sc, sy + b * sc) : g.moveTo(sx + a * sc, sy + b * sc))); g.closePath(); g.fill(); g.stroke();
    g.globalAlpha = 0.35; g.beginPath(); g.moveTo(sx, sy - sc); g.lineTo(sx, sy + sc); g.moveTo(sx - 0.62 * sc, sy + 0.18 * sc); g.lineTo(sx + 0.62 * sc, sy + 0.18 * sc); g.stroke(); g.globalAlpha = 1;
    const egtT = clamp((s.sys.egt - 300) / 900, 0, 1);
    g.fillStyle = egtT > 0.95 ? RED : egtT > 0.78 ? AMBER : 'rgba(125,255,178,0.45)';
    g.fillRect(sx - 0.12 * sc, sy + 0.62 * sc, 0.24 * sc, 0.32 * sc);
    // hardpoints: IR on the outer pylons, LR on the inner ones
    const loads = [p.irMissiles > 1, p.radarMissiles > 1, p.radarMissiles > 0, p.irMissiles > 0];
    PYLONS.forEach(([a, b], i) => { g.strokeStyle = loads[i] ? GREEN : DIM; g.fillStyle = loads[i] ? GREEN : 'transparent'; g.beginPath(); g.rect(sx + a * sc - 2.5, sy + b * sc - 7, 5, 14); if (loads[i]) g.fill(); g.stroke(); });
    // readouts
    g.textAlign = 'left'; g.font = '11px Consolas, monospace';
    let ty = y0 + 30; const tx = x0 + 128;
    const row = (label: string, value: string, col = GREEN) => { g.fillStyle = DIM; g.fillText(label, tx, ty); g.fillStyle = col; g.textAlign = 'right'; g.fillText(value, x0 + S - 10, ty); g.textAlign = 'left'; ty += 15; };
    const bar = (frac: number, col: string) => { g.strokeStyle = DIM; g.strokeRect(tx, ty - 9, S - 138, 5); g.fillStyle = col; g.fillRect(tx, ty - 9, (S - 138) * clamp(frac, 0, 1), 5); ty += 6; };
    row('HULL', `${Math.round(hp * 100)}%`, hullCol);
    const gl = Math.abs(m.gLoad) / p.cfg.gLimit;
    row('G', `${m.gLoad.toFixed(1)}/${p.cfg.gLimit}`, gl > 0.9 ? AMBER : GREEN); bar(gl, gl > 0.9 ? AMBER : GREEN);
    row('EGT', `${Math.round(s.sys.egt)}°C`, egtT > 0.95 ? RED : egtT > 0.78 ? AMBER : GREEN); bar(egtT, egtT > 0.95 ? RED : egtT > 0.78 ? AMBER : GREEN);
    row('THR', `${Math.round(m.throttleCmd * 100)}% ${m.afterburner ? 'A/B' : 'MIL'}`, m.afterburner ? AMBER : GREEN); bar(m.throttleCmd, m.afterburner ? AMBER : GREEN);
    const fuel = m.fuel / p.cfg.fuelCapacity;
    row('FUEL', `${Math.round(fuel * 100)}%`, fuel < 0.22 ? AMBER : GREEN);
    row('GEAR', m.gearPos > 0.95 ? 'DOWN' : m.gearPos < 0.05 ? 'UP' : 'TRANSIT', m.gearPos > 0.05 && m.gearPos < 0.95 ? AMBER : GREEN);
    // stores + weapon state (bottom strip)
    const by = y0 + S - 50;
    g.strokeStyle = DIM; g.beginPath(); g.moveTo(x0 + 8, by - 8); g.lineTo(x0 + S - 8, by - 8); g.stroke();
    const sel = (w: string) => (ts.weapon === w ? AMBER : DIM);
    g.fillStyle = sel('GUN'); g.fillText(`GUN ${p.gunAmmo}`, x0 + 10, by + 2);
    g.fillStyle = sel('IR'); g.fillText(`IR ${'■'.repeat(p.irMissiles)}${'□'.repeat(Math.max(0, p.cfg.irMissiles - p.irMissiles))}`, x0 + 74, by + 2);
    g.fillStyle = sel('RADAR'); g.fillText(`LR ${'■'.repeat(p.radarMissiles)}${'□'.repeat(Math.max(0, p.cfg.radarMissiles - p.radarMissiles))}`, x0 + 148, by + 2);
    const chk = ts.launchCheck();
    const st = ts.weapon === 'GUN' ? (ts.selected ? 'GUN TRACK' : 'GUN') : ts.lock;
    g.fillStyle = ts.lock === 'LOCK' ? RED : ts.weapon === 'GUN' || chk.ok ? GREEN : AMBER;
    g.fillText(ts.weapon === 'GUN' ? `${st} · SPACE/LMB` : chk.ok ? `${st} · SPACE: LAUNCH` : `${st} · ${chk.reason}`, x0 + 10, by + 18);
    g.fillStyle = p.flares < 8 ? AMBER : DIM; g.fillText(`FLR ${p.flares}${p.flareCooldown > 0 ? ' …' : ''} [X]`, x0 + 10, by + 34);
    g.fillStyle = s.sys.ecm.startsWith('ACTIVE') ? CYAN : DIM; g.fillText(`ECM ${s.sys.ecm}`, x0 + 82, by + 34);
    const fbw = s.sys.gcasActive ? 'AUTO-GCAS' : s.sys.recovering ? 'RECOVERY' : s.sys.aoaLimited ? 'AOA LIMIT' : s.sys.fbw ? 'FBW ON' : 'FBW OFF';
    g.fillStyle = s.sys.gcasActive || s.sys.recovering ? AMBER : s.sys.fbw ? GREEN : DIM; g.textAlign = 'right'; g.fillText(fbw, x0 + S - 10, by + 34);
    g.font = '13px Consolas, monospace'; g.lineWidth = 1.6;
  }

  /** Clean mode: one compact status block instead of the DMS + comms MFDs. */
  private drawCleanStatus(s: HudInput) {
    const g = this.g, p = s.player, m = p.model, x = 18, y = this.H - 70;
    g.font = '12px Consolas, monospace'; g.textAlign = 'left';
    g.fillStyle = GREEN; g.fillText(`THR ${Math.round(m.throttleCmd * 100)}%${m.afterburner ? ' A/B' : ''}  FUEL ${Math.round(m.fuel / p.cfg.fuelCapacity * 100)}%  HULL ${Math.round(p.healthFrac * 100)}%`, x, y);
    g.fillText(`${s.targeting.weapon}  IR ${p.irMissiles}  LR ${p.radarMissiles}  GUN ${p.gunAmmo}  FLR ${p.flares}   [K] MFDs`, x, y + 16);
    g.font = '13px Consolas, monospace';
  }

  // ------------------------------------------------------------------------------------ comms MFD
  private drawComms(s: HudInput) {
    const g = this.g, S = MFD, h = 150, x0 = this.W - S - 14, y0 = 14;
    this.mfdFrame(x0, y0, S, h, 'COMMS', s.comms.mic ? 'MIC ●' : 'VOICE: ENTER');
    const w = s.wing;
    g.textAlign = 'left'; g.font = '11px Consolas, monospace';
    if (w) {
      const hp = w.unit.healthFrac;
      g.fillStyle = CYAN; g.fillText(`${w.unit.callsign.toUpperCase()} ${w.state}`, x0 + 8, y0 + 28);
      g.fillStyle = hp < 0.4 ? RED : hp < 0.7 ? AMBER : GREEN; g.textAlign = 'right'; g.fillText(`${Math.round(hp * 100)}%  ${(w.separation / 1000).toFixed(1)}km`, x0 + S - 8, y0 + 28); g.textAlign = 'left';
      g.fillStyle = DIM; g.fillText(`${FORMATION_LABEL[w.formation]}${w.interference > 0.15 ? `  ECM ${Math.round(w.interference * 100)}%` : ''}`, x0 + 8, y0 + 42);
    }
    // waveform: animated while someone is transmitting (driven by the radio line, not a recording)
    const wy = y0 + 62, ww = S - 16;
    g.strokeStyle = s.comms.active ? GREEN : DIM; g.lineWidth = 1.2; g.beginPath();
    for (let i = 0; i <= 60; i++) {
      const t = i / 60, env = Math.sin(t * Math.PI);
      const a = s.comms.active ? (Math.sin(t * 38 + s.now * 22) * 0.6 + Math.sin(t * 91 - s.now * 31) * 0.4) * env * 9 * s.comms.level : 0;
      const xx = x0 + 8 + t * ww; if (i === 0) g.moveTo(xx, wy + a); else g.lineTo(xx, wy + a);
    }
    g.stroke(); g.lineWidth = 1.6;
    // last radio lines
    let ly = y0 + 82;
    for (const l of s.comms.lines.slice(-4)) {
      g.fillStyle = l.who === 'Ground Control' ? AMBER : CYAN; g.font = '10px Consolas, monospace';
      const text = `${l.who.replace('Ground Control', 'GC').toUpperCase()}: ${l.text}`;
      g.fillText(text.length > 38 ? text.slice(0, 37) + '…' : text, x0 + 8, ly); ly += 14;
    }
    g.font = '13px Consolas, monospace';
    const u = this.u;
    this.commsRect = { x: x0 * u, y: y0 * u, w: S * u, h: h * u };
  }

  // ------------------------------------------------------------------------------------ mission
  private drawMission(s: HudInput) {
    const g = this.g, mi = s.mission; if (!mi) return;
    const x = 20, y = 24;
    const objs = mi.objectives.filter(o => o.state !== 'pending').slice(-5);
    g.font = '12px Consolas, monospace'; g.textAlign = 'left';
    g.fillStyle = PANEL; g.fillRect(x - 8, y - 14, 360, 20 + objs.length * 32 + 8);
    g.fillStyle = CYAN; g.fillText(mi.spec.name.toUpperCase() + '  ·  ' + mi.phase.split('_')[0] + ' ' + mi.phase.split('_').slice(1).join(' '), x, y);
    let i = 0;
    for (const o of objs) {
      const yy = y + 22 + i * 32; i++;
      g.fillStyle = o.state === 'done' ? DIM : o.state === 'failed' ? RED : GREEN;
      g.fillText(`${o.state === 'done' ? '☑' : o.state === 'failed' ? '☒' : '☐'} ${o.text}`, x, yy);
      if (o.detail) { g.fillStyle = o.state === 'done' ? DIM : AMBER; g.fillText(`   ${o.detail}`, x, yy + 14); }
    }
    const m = s.player.model;
    mi.nav.slice(0, 2).forEach((n, k) => {
      const d = Math.hypot(n.x - m.pos.x, n.z - m.pos.z);
      const brg = wrap360(Math.atan2(n.x - m.pos.x, -(n.z - m.pos.z)) / DEG);
      g.fillStyle = CYAN; g.fillText(`▸ ${n.name}  BRG ${String(Math.round(brg)).padStart(3, '0')}  ${(d / 1000).toFixed(1)}km`, x, this.H - MFD - 48 + k * 16);
    });
    for (const n of mi.nav) {
      const pr = this.projectPoint(s.camera, _v.set(n.x, Math.max(n.y, terrainHeight(n.x, n.z) + 120), n.z));
      if (!pr.ok) continue;
      g.strokeStyle = CYAN; g.fillStyle = CYAN; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(pr.x, pr.y - 10); g.lineTo(pr.x + 8, pr.y); g.lineTo(pr.x, pr.y + 10); g.lineTo(pr.x - 8, pr.y); g.closePath(); g.stroke();
      g.font = '10px Consolas, monospace'; g.textAlign = 'center'; g.fillText(`${n.name}  ${(pr.depth / 1000).toFixed(1)}km`, pr.x, pr.y + 22);
      g.font = '13px Consolas, "Courier New", monospace'; g.lineWidth = 1.6;
    }
  }

  private drawWarningsCentre(s: HudInput) {
    const g = this.g, w = s.warnings, cx = this.W / 2, flash = Math.floor(s.now * 3) % 2 === 0;
    g.textAlign = 'center';
    let y = this.H * 0.26;
    const msg = (text: string, col: string, big = false) => { g.fillStyle = col; g.font = `bold ${big ? 28 : 18}px Consolas, monospace`; g.fillText(text, cx, y); y += big ? 34 : 24; };
    if (s.sys.gcasActive) msg('AUTO-GCAS  ·  RECOVERING', AMBER, true);
    else if (w.pullUp) { if (flash) msg('PULL UP  ·  TERRAIN', RED, true); else y += 34; }
    if (s.sys.recovering) msg('AUTO-RECOVERY  ·  WINGS LEVEL, CLIMBING', CYAN);
    if (w.stall) { if (flash) msg('STALL', RED, true); else y += 34; } else if (w.stallWarn) msg(s.sys.aoaLimited ? 'AOA LIMITER ACTIVE' : 'LOW ENERGY – LOWER NOSE / ADD POWER', AMBER);
    if (w.missile) { if (flash) msg(`MISSILE ${w.missile.ir ? '(IR)' : '(RADAR)'} · BRG ${String(Math.round(w.missile.bearing)).padStart(3, '0')} · ${(w.missile.range / 1000).toFixed(1)}km · X FLARES`, RED); else y += 24; }
    if (w.lockedOn) msg('RADAR LOCK DETECTED', AMBER);
    if (w.flameout) msg('FLAMEOUT – NO FUEL', RED, true);
    else if (w.bingo) msg('BINGO FUEL – RETURN TO BASE', AMBER);
    if (w.damage) msg('DAMAGE', AMBER);
    if (w.overG) msg('OVER-G', AMBER);
    if (w.interference > 0.3) msg(`WINGMAN SENSORS DEGRADED ${Math.round(w.interference * 100)}%`, AMBER);
    g.font = '13px Consolas, monospace';
  }

  private drawPrompt(s: HudInput) {
    const g = this.g;
    if (s.startup > 0 && s.startup < 1) {
      g.fillStyle = AMBER; g.textAlign = 'center'; g.font = 'bold 15px Consolas, monospace';
      g.fillText(`ENGINE START  ${Math.round(s.startup * 100)}%   [${['BATT', 'APU', 'ENG L', 'ENG R'].map((n, i) => (s.startup > (i + 1) / 4 ? '✓' : '…') + n).join(' ')}]`, this.W / 2, this.H * 0.62);
    }
    if (s.prompt) { g.fillStyle = WHITE; g.textAlign = 'center'; g.font = 'bold 17px Consolas, monospace'; g.fillText(s.prompt, this.W / 2, this.H * 0.66); }
    if (s.weaponMsg) { g.fillStyle = AMBER; g.textAlign = 'center'; g.font = 'bold 14px Consolas, monospace'; g.fillText(s.weaponMsg, this.W / 2, this.H * 0.70); }
    if (s.hint) { g.fillStyle = CYAN; g.textAlign = 'center'; g.font = '14px Consolas, monospace'; g.fillText(s.hint, this.W / 2, this.H * 0.74); }
    g.font = '13px Consolas, "Courier New", monospace';
  }

  private drawDetect(s: HudInput) {
    const mi = s.mission!, g = this.g, x = this.W / 2 - 100, y = 100;
    g.textAlign = 'left'; g.font = '12px Consolas, monospace'; g.fillStyle = mi.masked ? GREEN : AMBER; g.fillText(`RADAR NETWORK  ${mi.masked ? 'TERRAIN-MASKED' : 'EXPOSED'}`, x, y);
    g.strokeStyle = DIM; g.strokeRect(x, y + 8, 200, 6);
    g.fillStyle = mi.detect > 66 ? RED : mi.detect > 33 ? AMBER : GREEN; g.fillRect(x, y + 8, 200 * mi.detect / 100, 6);
    if (mi.alerted) { g.fillStyle = RED; g.fillText('DETECTED – ENEMY ALERTED', x, y + 30); }
    g.font = '13px Consolas, monospace';
  }

  private drawLanding(s: HudInput) {
    const g = this.g, gd = s.guidance!, m = s.player.model, cx = this.W / 2, cy = this.H / 2 + 120;
    g.save();
    g.strokeStyle = DIM; g.lineWidth = 1; g.strokeRect(cx - 56, cy - 56, 112, 112);
    g.beginPath(); g.moveTo(cx - 56, cy); g.lineTo(cx + 56, cy); g.moveTo(cx, cy - 56); g.lineTo(cx, cy + 56); g.stroke();
    const lx = clamp(-gd.lateral / 200 * 50, -52, 52), gy = clamp(gd.gsError / 40 * 50, -52, 52);
    g.lineWidth = 1.8;
    g.strokeStyle = Math.abs(gd.lateral) < 60 ? GREEN : AMBER; g.beginPath(); g.moveTo(cx + lx, cy - 52); g.lineTo(cx + lx, cy + 52); g.stroke();
    g.strokeStyle = Math.abs(gd.gsError) < 15 ? GREEN : AMBER; g.beginPath(); g.moveTo(cx - 52, cy + gy); g.lineTo(cx + 52, cy + gy); g.stroke();
    g.fillStyle = GREEN; g.textAlign = 'center'; g.font = '12px Consolas, monospace';
    g.fillText(`RWY ${gd.dirNorth ? '36' : '18'}  ${(Math.max(0, gd.dz) / 1000).toFixed(1)}km  ${m.gearDown ? 'GEAR ✓' : 'GEAR!'}`, cx, cy + 72);
    g.fillText(`${Math.round(m.iasKt)} kt  →  ${s.player.cfg.touchdownKt} touchdown`, cx, cy + 88);
    g.restore();
  }

  /** F-35 DAS: every missile guiding on us, at its true bearing around the nose, through the airframe. */
  private drawDas(s: HudInput) {
    const g = this.g, cx = this.W / 2, cy = this.H / 2, R = Math.min(this.W, this.H) * 0.33, flash = Math.floor(s.now * 4) % 2 === 0;
    g.save(); g.strokeStyle = RED; g.fillStyle = RED; g.lineWidth = 2; g.globalAlpha = 0.35; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
    for (const d of s.das!) {
      const x = cx + Math.sin(d.bearing) * R, y = cy - Math.cos(d.bearing) * R, a = d.bearing;
      g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.moveTo(0, -14); g.lineTo(9, 6); g.lineTo(-9, 6); g.closePath(); if (flash) g.fill(); else g.stroke(); g.restore();
      g.font = 'bold 11px Consolas, monospace'; g.textAlign = 'center'; g.fillText(`${d.ir ? 'IR' : 'RDR'} ${(d.range / 1000).toFixed(1)}`, cx + Math.sin(a) * (R + 22), cy - Math.cos(a) * (R + 22));
    }
    g.font = 'bold 11px Consolas, monospace'; g.fillText('DAS', cx, cy - R - 10); g.restore();
  }

  /** Mouse-aim: the aim point (where the pointer sends the nose) and the nose marker that is flown onto it. */
  private drawMouse(s: HudInput) {
    const g = this.g, m = s.mouse!;
    const dist = Math.hypot(m.x - m.nx, m.y - m.ny);
    g.save(); g.strokeStyle = AMBER; g.fillStyle = AMBER; g.lineWidth = 1.4;
    if (dist > 14) { g.globalAlpha = 0.45; g.setLineDash([5, 5]); g.beginPath(); g.moveTo(m.nx, m.ny); g.lineTo(m.x, m.y); g.stroke(); g.setLineDash([]); }
    g.globalAlpha = 0.95;
    g.beginPath(); g.arc(m.x, m.y, 10, 0, Math.PI * 2); g.moveTo(m.x - 16, m.y); g.lineTo(m.x - 7, m.y); g.moveTo(m.x + 7, m.y); g.lineTo(m.x + 16, m.y); g.moveTo(m.x, m.y - 16); g.lineTo(m.x, m.y - 7); g.moveTo(m.x, m.y + 7); g.lineTo(m.x, m.y + 16); g.stroke();
    g.beginPath(); g.arc(m.x, m.y, 1.6, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(m.nx - 6, m.ny); g.lineTo(m.nx + 6, m.ny); g.moveTo(m.nx, m.ny - 6); g.lineTo(m.nx, m.ny + 6); g.stroke();
    g.font = '10px Consolas, monospace'; g.textAlign = 'center'; g.fillText('MOUSE-AIM', m.x, m.y + 28);
    g.restore();
  }

  private drawDebug(s: HudInput) {
    const g = this.g; g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '12px Consolas, monospace'; g.textAlign = 'left';
    s.debug!.forEach((l, i) => g.fillText(l, 20, this.H * 0.33 + i * 14));
  }
}


