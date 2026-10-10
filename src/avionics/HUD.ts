import * as THREE from 'three';
import type { Unit } from '../game/Entity';
import type { TargetingSystem } from '../combat/TargetingSystem';
import type { Weapons } from '../combat/Weapons';
import type { MissionDirector } from '../missions/MissionDirector';
import { DEG, FT, KT, clamp, wrap360 } from '../util/math';
import { MISSILES, SENSOR } from '../combat/WeaponSpecs';
import { FORMATION_LABEL, type Formation } from '../ai/WingmanAI';
import { terrainHeight } from '../world/Heightfield';

export type CameraView = 'chase' | 'cockpit' | 'wing' | 'tail' | 'orbit' | 'front' | 'target' | 'tactical' | 'tower' | 'cinematic' | 'flyby';
export interface HudWarnings {
  stall: boolean; stallWarn: boolean; pullUp: boolean; missile: { bearing: number; range: number; ir: boolean } | null;
  bingo: boolean; lowFuel: boolean; damage: boolean; flameout: boolean; overG: boolean; interference: number; lockedOn: boolean;
}
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
  mouse: { x: number; y: number; r: number } | null;   // mouse-aim cursor (px) and its dead-zone radius
  assist: string | null;                               // active voice/autopilot assist
}

const GREEN = '#7dffb2', DIM = 'rgba(125,255,178,0.55)', AMBER = '#ffc34d', RED = '#ff5a4d', CYAN = '#7fe3ff', WHITE = '#e8f4ff';
const _v = new THREE.Vector3(), _d = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();

export class HUD {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private W = 1; private H = 1; private dpr = 1;
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
  clear() { this.g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); this.g.clearRect(0, 0, this.W, this.H); }
  setVisible(v: boolean) { this.canvas.style.display = v ? 'block' : 'none'; }

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

  draw(s: HudInput) {
    const g = this.g, W = this.W, H = this.H;
    this.clear();
    this.u = clamp(Math.min(this.W / 1100, this.H / 650), 0.62, 1.2);
    g.lineWidth = 1.6; g.font = '13px Consolas, "Courier New", monospace'; g.textBaseline = 'middle';
    const p = s.player, m = p.model;
    const cam = s.camera;
    const cockpit = s.view === 'cockpit';

    this.scaled(() => this.drawWarningsCentre(s));
    if (s.assist) this.scaled(() => { const g2 = this.g; g2.fillStyle = 'rgba(0,30,40,0.7)'; g2.fillRect(this.W / 2 - 190, 82, 380, 24); g2.strokeStyle = CYAN; g2.strokeRect(this.W / 2 - 190, 82, 380, 24); g2.fillStyle = CYAN; g2.textAlign = 'center'; g2.font = 'bold 13px Consolas, monospace'; g2.fillText(s.assist + '   (move the stick to take over)', this.W / 2, 95); });
    if (s.view !== 'flyby') {
      this.drawLadder(s);
      this.drawFlightPath(s);
      this.scaled(() => { this.drawSpeedTape(s); this.drawAltTape(s); this.drawHeading(s); this.drawStatus(s); });
      this.drawTargets(s);
      this.scaled(() => { this.drawRadar(s); this.drawWeaponPanel(s); });
    } else {
      g.fillStyle = DIM; g.textAlign = 'center'; g.fillText('FLYBY CAMERA – press C for chase view', W / 2, 30);
    }
    this.scaled(() => { this.drawMission(s); this.drawWingman(s); this.drawPrompt(s); });
    if (s.mission && s.mission.phase === 'P2_TRANSIT') this.scaled(() => this.drawDetect(s));
    if (s.guidance?.show) this.scaled(() => this.drawLanding(s));
    if (s.mouse) this.drawMouse(s);
    if (s.debug) this.drawDebug(s);
    void m; void cockpit; void cam;
  }

  // ------------------------------------------------------------------------------------ attitude
  private drawLadder(s: HudInput) {
    const g = this.g, cam = s.camera, m = s.player.model;
    const hdg = m.heading * DEG;
    g.strokeStyle = GREEN; g.fillStyle = GREEN; g.font = '12px Consolas, monospace'; g.textAlign = 'center';
    const pt = (el: number, az: number) => {
      const c = Math.cos(el);
      _r.set(Math.sin(az) * c, Math.sin(el), -Math.cos(az) * c);
      return this.project(cam, _r.clone(), 3000);
    };
    // limit to ±40 deg around the nose elevation
    const centre = m.pitchDeg;
    for (let a = -90; a <= 90; a += 5) {
      if (Math.abs(a - centre) > 38) continue;
      const half = a === 0 ? 9 : 4;
      const L = pt(a * DEG, hdg - half * DEG / Math.max(0.3, Math.cos(a * DEG))), R = pt(a * DEG, hdg + half * DEG / Math.max(0.3, Math.cos(a * DEG)));
      if (!L.ok || !R.ok) continue;
      g.globalAlpha = a === 0 ? 1 : 0.8;
      if (a === 0) {
        const gapL = pt(0, hdg - 2.2 * DEG), gapR = pt(0, hdg + 2.2 * DEG);
        g.beginPath(); g.moveTo(L.x, L.y); g.lineTo(gapL.x, gapL.y); g.moveTo(gapR.x, gapR.y); g.lineTo(R.x, R.y); g.stroke();
      } else {
        const gapL = pt(a * DEG, hdg - 1.6 * DEG), gapR = pt(a * DEG, hdg + 1.6 * DEG);
        g.setLineDash(a < 0 ? [6, 5] : []);
        g.beginPath(); g.moveTo(L.x, L.y); g.lineTo(gapL.x, gapL.y); g.moveTo(gapR.x, gapR.y); g.lineTo(R.x, R.y); g.stroke();
        g.setLineDash([]);
        const tick = a > 0 ? 7 : -7;
        g.beginPath(); g.moveTo(L.x, L.y); g.lineTo(L.x, L.y + tick); g.moveTo(R.x, R.y); g.lineTo(R.x, R.y + tick); g.stroke();
        g.fillText(String(Math.abs(a)), R.x + 16, R.y); g.fillText(String(Math.abs(a)), L.x - 16, L.y);
      }
    }
    g.globalAlpha = 1;
  }

  private drawFlightPath(s: HudInput) {
    const g = this.g, m = s.player.model, cam = s.camera;
    // nose waterline
    m.forward(_r);
    const nose = this.project(cam, _r.clone(), 3000);
    if (nose.ok) {
      g.strokeStyle = GREEN; g.beginPath();
      g.moveTo(nose.x - 22, nose.y); g.lineTo(nose.x - 8, nose.y); g.lineTo(nose.x - 8, nose.y + 6);
      g.moveTo(nose.x + 22, nose.y); g.lineTo(nose.x + 8, nose.y); g.lineTo(nose.x + 8, nose.y + 6);
      g.moveTo(nose.x, nose.y - 3); g.lineTo(nose.x, nose.y + 3); g.stroke();
    }
    // velocity vector (flight-path marker)
    if (m.tas > 8) {
      _d.copy(m.vel).normalize();
      const fp = this.project(cam, _d.clone(), 3000);
      if (fp.ok) {
        g.strokeStyle = GREEN; g.beginPath(); g.arc(fp.x, fp.y, 8, 0, Math.PI * 2);
        g.moveTo(fp.x - 20, fp.y); g.lineTo(fp.x - 8, fp.y); g.moveTo(fp.x + 8, fp.y); g.lineTo(fp.x + 20, fp.y); g.moveTo(fp.x, fp.y - 8); g.lineTo(fp.x, fp.y - 17); g.stroke();
      }
    }
  }

  // ------------------------------------------------------------------------------------ tapes
  private tape(x: number, value: number, unitsPerTick: number, labelEvery: number, side: 'L' | 'R', fmt: (v: number) => string, title: string, color = GREEN) {
    const g = this.g, H = this.H, cy = H / 2, span = 5.4, ppu = (H * 0.5) / (unitsPerTick * span);
    g.save();
    g.beginPath(); g.rect(x - 70, cy - H * 0.25, 140, H * 0.5); g.clip();
    g.strokeStyle = DIM; g.fillStyle = DIM; g.textAlign = side === 'L' ? 'right' : 'left';
    const start = Math.floor((value - unitsPerTick * span) / unitsPerTick) * unitsPerTick;
    for (let v = start; v <= value + unitsPerTick * span; v += unitsPerTick) {
      const y = cy - (v - value) * ppu / unitsPerTick * unitsPerTick;
      if (v < 0 && title === 'KT') continue;
      const major = Math.round(v / unitsPerTick) % labelEvery === 0;
      g.beginPath();
      if (side === 'L') { g.moveTo(x, y); g.lineTo(x - (major ? 14 : 8), y); } else { g.moveTo(x, y); g.lineTo(x + (major ? 14 : 8), y); }
      g.stroke();
      if (major) g.fillText(fmt(v), side === 'L' ? x - 20 : x + 20, y);
    }
    g.restore();
    // value box
    g.strokeStyle = color; g.fillStyle = 'rgba(0,20,10,0.65)';
    const bx = side === 'L' ? x - 76 : x + 6;
    g.fillRect(bx, cy - 14, 70, 28); g.strokeRect(bx, cy - 14, 70, 28);
    g.fillStyle = color; g.textAlign = 'center'; g.font = 'bold 16px Consolas, monospace'; g.fillText(fmt(Math.round(value)), bx + 35, cy + 1);
    g.font = '11px Consolas, monospace'; g.fillStyle = DIM; g.fillText(title, bx + 35, cy - 24);
    g.font = '13px Consolas, "Courier New", monospace';
  }
  private drawSpeedTape(s: HudInput) {
    const m = s.player.model, x = this.W / 2 - Math.min(this.W * 0.22, 230);
    const warn = m.stallWarning && !m.onGround;
    this.tape(x, m.iasKt, 10, 5, 'L', v => String(Math.round(v)), 'KT', warn ? AMBER : GREEN);
    this.g.fillStyle = GREEN; this.g.textAlign = 'right';
    this.g.fillText(`M ${m.mach.toFixed(2)}`, x - 6, this.H / 2 + 40);
    this.g.fillText(`G ${m.gLoad.toFixed(1)}`, x - 6, this.H / 2 + 58);
    if (m.iasKt < 135 && m.onGround && m.throttleCmd > 0.5) { this.g.fillStyle = AMBER; this.g.fillText('ROTATE @135', x - 6, this.H / 2 - 44); }
  }
  private drawAltTape(s: HudInput) {
    const m = s.player.model, x = this.W / 2 + Math.min(this.W * 0.22, 230);
    const val = s.metric ? m.pos.y : m.pos.y * FT;
    this.tape(x, val, s.metric ? 50 : 100, s.metric ? 2 : 2, 'R', v => String(Math.round(v)), s.metric ? 'M' : 'FT');
    const g = this.g, vs = m.vel.y * FT * 60;
    g.fillStyle = GREEN; g.textAlign = 'left';
    g.fillText(`VS ${Math.round(vs / 10) * 10}`, x + 10, this.H / 2 + 40);
    const agl = m.pos.y - terrainHeight(m.pos.x, m.pos.z);
    g.fillText(`AGL ${Math.round(s.metric ? agl : agl * FT)}`, x + 10, this.H / 2 + 58);
    if (m.gearDown && !m.onGround && agl < 300) { g.fillStyle = AMBER; g.fillText(`RAD ${Math.round(agl * FT)}`, x + 10, this.H / 2 + 76); }
  }
  private drawHeading(s: HudInput) {
    const g = this.g, W = this.W, m = s.player.model, hdg = m.heading, y = 38;
    const ppd = 5;
    g.save(); g.beginPath(); g.rect(W / 2 - 200, y - 14, 400, 40); g.clip();
    g.strokeStyle = DIM; g.fillStyle = GREEN; g.textAlign = 'center';
    for (let d = -45; d <= 45; d++) {
      const a = Math.round(hdg + d);
      if (a % 5 !== 0) continue;
      const x = W / 2 + (a - hdg) * ppd;
      const major = a % 10 === 0;
      g.beginPath(); g.moveTo(x, y + 4); g.lineTo(x, y + (major ? 14 : 9)); g.stroke();
      if (major) {
        const aa = wrap360(a);
        const lab = aa === 0 ? 'N' : aa === 90 ? 'E' : aa === 180 ? 'S' : aa === 270 ? 'W' : String(Math.round(aa / 10)).padStart(2, '0');
        g.fillText(lab, x, y - 4);
      }
    }
    // nav bug
    const target = s.mission?.nav[0];
    if (target) {
      const b = wrap360(Math.atan2(target.x - m.pos.x, -(target.z - m.pos.z)) / DEG);
      let diff = ((b - hdg + 540) % 360) - 180;
      diff = clamp(diff, -44, 44);
      const x = W / 2 + diff * ppd;
      g.fillStyle = CYAN; g.beginPath(); g.moveTo(x, y + 16); g.lineTo(x - 6, y + 25); g.lineTo(x + 6, y + 25); g.closePath(); g.fill();
    }
    g.restore();
    g.strokeStyle = GREEN; g.fillStyle = 'rgba(0,20,10,0.65)'; g.fillRect(W / 2 - 24, y + 16, 48, 22); g.strokeRect(W / 2 - 24, y + 16, 48, 22);
    g.fillStyle = GREEN; g.font = 'bold 15px Consolas, monospace'; g.textAlign = 'center'; g.fillText(String(Math.round(hdg) % 360).padStart(3, '0'), W / 2, y + 28);
    g.font = '13px Consolas, "Courier New", monospace';
  }

  // ------------------------------------------------------------------------------------ status
  private drawStatus(s: HudInput) {
    const g = this.g, m = s.player.model, p = s.player, H = this.H, W = this.W;
    const x = 22, y = H - 170;
    // throttle bar
    g.strokeStyle = GREEN; g.strokeRect(x, y, 16, 110);
    const thr = m.throttleCmd, ab = m.afterburner;
    g.fillStyle = ab ? AMBER : GREEN; g.fillRect(x + 2, y + 108 - 106 * thr, 12, 106 * thr);
    g.strokeStyle = DIM; g.beginPath(); g.moveTo(x - 4, y + 108 - 106 * 0.9); g.lineTo(x + 20, y + 108 - 106 * 0.9); g.stroke();
    g.fillStyle = GREEN; g.textAlign = 'left'; g.fillText(`THR ${Math.round(thr * 100)}%`, x + 24, y + 10);
    g.fillStyle = ab ? AMBER : DIM; g.fillText(ab ? 'A/B' : 'MIL', x + 24, y + 26);
    g.fillStyle = GREEN; g.fillText(`N ${Math.round(m.engineN * 100)}%`, x + 24, y + 42);
    // fuel + damage
    const fuel = m.fuel / p.cfg.fuelCapacity;
    g.fillStyle = fuel < 0.22 ? AMBER : GREEN; g.fillText(`FUEL ${Math.round(m.fuel)} kg  ${Math.round(fuel * 100)}%`, x + 24, y + 62);
    g.fillStyle = p.healthFrac < 0.4 ? RED : p.healthFrac < 0.7 ? AMBER : GREEN; g.fillText(`HULL ${Math.round(p.healthFrac * 100)}%`, x + 24, y + 80);
    // config line
    const gear = m.gearPos > 0.95 ? 'DOWN' : m.gearPos < 0.05 ? 'UP' : 'MOVING';
    g.fillStyle = m.gearPos > 0.05 ? (m.gearPos > 0.95 ? GREEN : AMBER) : DIM;
    g.fillText(`GEAR ${gear}`, x + 24, y + 98);
    g.fillStyle = m.airbrakePos > 0.1 ? AMBER : DIM; g.fillText(`${m.onGround ? 'BRAKES' : 'AIRBRAKE'} ${m.airbrakePos > 0.5 ? 'ON' : 'OFF'}`, x + 24, y + 116);
    g.fillStyle = DIM; g.fillText(`${p.cfg.name.toUpperCase()}  ${m.onGround ? 'GROUND' : 'FLIGHT'}`, x, y + 138);
    void W;
  }

  // ------------------------------------------------------------------------------------ targeting
  private drawTargets(s: HudInput) {
    const g = this.g, cam = s.camera, ts = s.targeting, me = s.player;
    for (const u of s.allUnits) {
      if (u === me || !u.alive) continue;
      const pr = this.projectPoint(cam, u.pos);
      if (!pr.ok) continue;
      const hostile = u.side === 'hostile';
      const friendly = u.side === 'friendly';
      const selected = ts.selected === u;
      const range = pr.depth;
      if (range > 60000) continue;
      const known = friendly || (ts.contactFor(u)?.inScan && ts.contactFor(u)?.los) || range < 4500;
      if (!known) continue;
      const size = clamp(2400 / Math.max(range, 200) * 14, 9, 26);
      const col = friendly ? CYAN : hostile ? (u.identified ? RED : AMBER) : WHITE;
      g.strokeStyle = col; g.fillStyle = col; g.lineWidth = selected ? 2.4 : 1.4;
      if (hostile && !u.identified) { // unknown = diamond-less square
        g.strokeRect(pr.x - size / 2, pr.y - size / 2, size, size);
      } else if (hostile) { // hostile = diamond
        g.beginPath(); g.moveTo(pr.x, pr.y - size); g.lineTo(pr.x + size, pr.y); g.lineTo(pr.x, pr.y + size); g.lineTo(pr.x - size, pr.y); g.closePath(); g.stroke();
      } else { // friendly = circle
        g.beginPath(); g.arc(pr.x, pr.y, size, 0, Math.PI * 2); g.stroke();
      }
      g.font = '11px Consolas, monospace'; g.textAlign = 'center';
      g.fillText(`${friendly ? 'FRIEND ' : ''}${u.identified || friendly ? u.callsign : 'UNKNOWN'}`, pr.x, pr.y + size + 12);
      g.fillText(`${(range / 1000).toFixed(1)}km`, pr.x, pr.y + size + 24);
      if (selected) {
        // lock-state reticle
        const st = ts.lock;
        const pulse = Math.floor(s.now * 6) % 2 === 0;
        const c = st === 'LOCK' ? RED : st === 'TRACK' ? AMBER : GREEN;
        g.strokeStyle = c; g.lineWidth = 2.4;
        const k = size + 10;
        const draw = st !== 'TRACK' || pulse;
        if (draw) {
          g.beginPath();
          for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
            g.moveTo(pr.x + dx * k, pr.y + dy * (k - 8)); g.lineTo(pr.x + dx * k, pr.y + dy * k); g.lineTo(pr.x + dx * (k - 8), pr.y + dy * k);
          }
          g.stroke();
        }
        g.fillStyle = c; g.textAlign = 'center';
        const label = ts.weapon === 'GUN' ? 'GUN' : st === 'LOCK' ? 'LOCK' : st === 'TRACK' ? 'TRACKING' : 'SEARCH';
        g.fillText(label, pr.x, pr.y - k - 8);
        // identification progress
        if (!u.identified) { g.strokeStyle = AMBER; g.strokeRect(pr.x - 24, pr.y + k + 18, 48, 6); g.fillStyle = AMBER; g.fillRect(pr.x - 24, pr.y + k + 18, 48 * ts.idProgress, 6); g.fillText('IDENTIFYING', pr.x, pr.y + k + 36); }
      }
      g.lineWidth = 1.6; g.font = '13px Consolas, "Courier New", monospace';
    }
    // predictive gun-sight
    if (ts.weapon === 'GUN' && ts.selected && ts.selected.alive) {
      const lead = ts.lead();
      if (lead) {
        const pr = this.projectPoint(cam, lead.aim);
        if (pr.ok) {
          const inRange = lead.inRange;
          g.strokeStyle = inRange ? GREEN : DIM; g.beginPath(); g.arc(pr.x, pr.y, 15, 0, Math.PI * 2); g.moveTo(pr.x - 2, pr.y); g.lineTo(pr.x + 2, pr.y); g.moveTo(pr.x, pr.y - 2); g.lineTo(pr.x, pr.y + 2); g.stroke();
          g.fillStyle = GREEN; g.textAlign = 'left'; g.fillText(`TOF ${lead.time.toFixed(1)}s`, pr.x + 20, pr.y);
        }
      }
    }
  }

  private drawRadar(s: HudInput) {
    const g = this.g, me = s.player, m = me.model, R = 80, cx = this.W - 150, cy = 215;
    g.save();
    g.fillStyle = 'rgba(0,18,10,0.55)'; g.beginPath(); g.arc(cx, cy, R + 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = DIM; g.lineWidth = 1;
    for (const f of [0.33, 0.66, 1]) { g.beginPath(); g.arc(cx, cy, R * f, 0, Math.PI * 2); g.stroke(); }
    // scan sector (±60°)
    g.strokeStyle = 'rgba(125,255,178,0.5)'; g.beginPath(); g.moveTo(cx, cy);
    g.lineTo(cx + Math.sin(SENSOR.scanHalfAngle) * R, cy - Math.cos(SENSOR.scanHalfAngle) * R); g.moveTo(cx, cy);
    g.lineTo(cx - Math.sin(SENSOR.scanHalfAngle) * R, cy - Math.cos(SENSOR.scanHalfAngle) * R); g.stroke();
    g.strokeStyle = 'rgba(255,195,77,0.45)'; g.beginPath(); g.moveTo(cx, cy);
    g.lineTo(cx + Math.sin(SENSOR.boreCone) * R, cy - Math.cos(SENSOR.boreCone) * R); g.moveTo(cx, cy);
    g.lineTo(cx - Math.sin(SENSOR.boreCone) * R, cy - Math.cos(SENSOR.boreCone) * R); g.stroke();
    const rangeM = s.radarRangeKm * 1000, hdg = m.heading * DEG;
    for (const u of s.allUnits) {
      if (u === me || !u.alive) continue;
      const dx = u.pos.x - m.pos.x, dz = u.pos.z - m.pos.z;
      const range = Math.hypot(dx, dz);
      const friendly = u.side === 'friendly';
      const c = s.targeting.contactFor(u);
      if (!friendly && !(c && c.inScan && c.los)) continue;
      if (range > rangeM) continue;
      const brg = Math.atan2(dx, -dz) - hdg;
      const px = cx + Math.sin(brg) * (range / rangeM) * R, py = cy - Math.cos(brg) * (range / rangeM) * R;
      const col = friendly ? CYAN : u.identified ? RED : AMBER;
      g.fillStyle = col; g.strokeStyle = col;
      if (friendly) { g.beginPath(); g.arc(px, py, 3.5, 0, Math.PI * 2); g.fill(); }
      else { g.beginPath(); g.moveTo(px, py - 5); g.lineTo(px + 5, py); g.lineTo(px, py + 5); g.lineTo(px - 5, py); g.closePath(); if (u === s.targeting.selected) { g.lineWidth = 2.4; g.stroke(); g.lineWidth = 1.6; } else g.fill(); }
      // heading tick
      const vh = Math.atan2(u.vel.x, -u.vel.z) - hdg;
      g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.sin(vh) * 9, py - Math.cos(vh) * 9); g.stroke();
    }
    for (const mm of s.weapons.missiles) if (mm.mode === 'GUIDED' && mm.target === me) {
      const dx = mm.pos.x - m.pos.x, dz = mm.pos.z - m.pos.z, range = Math.hypot(dx, dz); if (range > rangeM) continue;
      const brg = Math.atan2(dx, -dz) - hdg;
      g.fillStyle = RED; g.fillRect(cx + Math.sin(brg) * (range / rangeM) * R - 2, cy - Math.cos(brg) * (range / rangeM) * R - 2, 5, 5);
    }
    g.fillStyle = GREEN; g.beginPath(); g.moveTo(cx, cy - 6); g.lineTo(cx + 4, cy + 4); g.lineTo(cx - 4, cy + 4); g.closePath(); g.fill();
    g.fillStyle = DIM; g.textAlign = 'center'; g.font = '11px Consolas, monospace'; g.fillText(`RDR ${s.radarRangeKm}km  [Z]`, cx, cy + R + 16);
    g.restore();
  }

  private drawWeaponPanel(s: HudInput) {
    const g = this.g, p = s.player, ts = s.targeting, W = this.W, H = this.H;
    const x = W - 300, y = H - 190;
    g.fillStyle = 'rgba(0,18,10,0.45)'; g.fillRect(x - 10, y - 14, 292, 168);
    g.strokeStyle = DIM; g.strokeRect(x - 10, y - 14, 292, 168);
    g.textAlign = 'left'; g.font = '13px Consolas, monospace';
    const row = (i: number, id: string, label: string, count: string, sel: boolean) => {
      g.fillStyle = sel ? AMBER : DIM; g.fillText(`${sel ? '▶' : ' '} ${id.padEnd(5)} ${label.padEnd(14)} ${count}`, x, y + i * 20);
    };
    row(0, 'GUN', '20mm CANNON', String(p.gunAmmo).padStart(4), ts.weapon === 'GUN');
    row(1, 'IR', 'IR-7 FOX-2', `x${p.irMissiles}`, ts.weapon === 'IR');
    row(2, 'LR', 'LR-9 RADAR', `x${p.radarMissiles}`, ts.weapon === 'RADAR');
    g.fillStyle = p.flares < 8 ? AMBER : GREEN; g.fillText(`  FLARES ${String(p.flares).padStart(3)}   [X]${p.flareCooldown > 0 ? ' …' : ''}`, x, y + 3 * 20);
    const st = ts.weapon === 'GUN' ? (ts.selected ? 'TRACKING' : 'NO TGT') : ts.lock;
    const stc = ts.lock === 'LOCK' ? RED : ts.lock === 'TRACK' ? AMBER : GREEN;
    g.fillStyle = stc; g.fillText(`  STATE ${st}`, x, y + 4 * 20);
    const chk = ts.launchCheck();
    g.fillStyle = ts.weapon === 'GUN' || chk.ok ? GREEN : AMBER;
    g.fillText(`  ${ts.weapon === 'GUN' ? 'SPACE/LMB: FIRE CANNON' : chk.ok ? 'SPACE: LAUNCH' : chk.reason}`, x, y + 5 * 20);
    g.fillStyle = DIM; g.fillText('  [T] weapon  [R] target  [X] flares', x, y + 6 * 20);
    if (ts.selected) {
      const c = ts.selectedContact;
      g.fillStyle = WHITE; g.fillText(`  TGT ${ts.selected.identified ? ts.selected.callsign : 'UNKNOWN'} ${c ? (c.range / 1000).toFixed(1) + 'km' : ''} ${c ? Math.round(c.closure * KT) + 'kt cl' : ''}`, x, y + 7 * 20);
    }
    const spec = ts.weapon === 'IR' ? MISSILES.IR : ts.weapon === 'RADAR' ? MISSILES.RADAR : null;
    if (spec) { g.fillStyle = DIM; g.fillText(`  MAX ${(spec.launchMaxRange / 1000).toFixed(0)}km  CONE ${(spec.lockCone / DEG * 2).toFixed(0)}°`, x, y + 8 * 20); }
  }

  // ------------------------------------------------------------------------------------ mission
  private drawMission(s: HudInput) {
    const g = this.g, mi = s.mission; if (!mi) return;
    const x = 20, y = 24;
    g.font = '13px Consolas, monospace'; g.textAlign = 'left';
    g.fillStyle = 'rgba(0,18,10,0.42)'; g.fillRect(x - 8, y - 14, 360, 20 + mi.objectives.filter(o => o.state !== 'pending').slice(-5).length * 34 + 8);
    g.fillStyle = CYAN; g.fillText(mi.spec.name.toUpperCase() + '  ·  ' + mi.phase.split('_')[0] + ' ' + mi.phase.split('_').slice(1).join(' '), x, y);
    let i = 0;
    for (const o of mi.objectives.filter(o => o.state !== 'pending').slice(-5)) {
      const yy = y + 22 + i * 34; i++;
      const col = o.state === 'done' ? DIM : o.state === 'failed' ? RED : GREEN;
      g.fillStyle = col; g.fillText(`${o.state === 'done' ? '☑' : o.state === 'failed' ? '☒' : '☐'} ${o.text}`, x, yy);
      if (o.detail) { g.fillStyle = o.state === 'done' ? DIM : AMBER; g.fillText(`   ${o.detail}`, x, yy + 15); }
    }
    // nav point readouts
    const m = s.player.model;
    mi.nav.slice(0, 2).forEach((n, k) => {
      const d = Math.hypot(n.x - m.pos.x, n.z - m.pos.z);
      const brg = wrap360(Math.atan2(n.x - m.pos.x, -(n.z - m.pos.z)) / DEG);
      g.fillStyle = CYAN; g.fillText(`▸ ${n.name}  BRG ${String(Math.round(brg)).padStart(3, '0')}  ${(d / 1000).toFixed(1)}km`, x, this.H - 260 + k * 18 - (mi.nav.length > 1 ? 0 : 0));
    });
    // waypoint markers
    for (const n of mi.nav) {
      const pr = this.projectPoint(s.camera, _v.set(n.x, Math.max(n.y, terrainHeight(n.x, n.z) + 120), n.z));
      if (!pr.ok) continue;
      g.strokeStyle = CYAN; g.fillStyle = CYAN;
      g.beginPath(); g.moveTo(pr.x, pr.y - 12); g.lineTo(pr.x + 10, pr.y); g.lineTo(pr.x, pr.y + 12); g.lineTo(pr.x - 10, pr.y); g.closePath(); g.stroke();
      g.font = '11px Consolas, monospace'; g.textAlign = 'center'; g.fillText(n.name, pr.x, pr.y + 26); g.fillText(`${(pr.depth / 1000).toFixed(1)}km`, pr.x, pr.y + 38);
      g.font = '13px Consolas, "Courier New", monospace';
    }
  }

  private drawWingman(s: HudInput) {
    const w = s.wing; if (!w) return;
    const g = this.g, x = this.W - 300, y = 24;
    g.fillStyle = 'rgba(0,18,10,0.42)'; g.fillRect(x - 10, y - 14, 292, 76);
    g.textAlign = 'left'; g.font = '13px Consolas, monospace';
    g.fillStyle = CYAN; g.fillText(`WINGMAN ${w.unit.callsign.toUpperCase()}  ${w.unit.cfg.name}`, x, y);
    const hp = w.unit.healthFrac; g.fillStyle = hp < 0.4 ? RED : hp < 0.7 ? AMBER : GREEN; g.fillText(`COND ${Math.round(hp * 100)}%   ${w.state}`, x, y + 18);
    g.fillStyle = GREEN; g.fillText(`${FORMATION_LABEL[w.formation]} [4]  SEP ${(w.separation / 1000).toFixed(1)}km`, x, y + 36);
    if (w.interference > 0.15) { g.fillStyle = AMBER; g.fillText(`ECM/INTERFERENCE ${Math.round(w.interference * 100)}%`, x, y + 54); }
    g.fillStyle = DIM; g.fillText('1 cover  2 engage  3 rejoin', x, y + 72);
  }

  private drawWarningsCentre(s: HudInput) {
    const g = this.g, w = s.warnings, cx = this.W / 2, flash = Math.floor(s.now * 3) % 2 === 0;
    g.textAlign = 'center';
    let y = this.H * 0.26;
    const msg = (text: string, col: string, big = false) => { g.fillStyle = col; g.font = `bold ${big ? 30 : 20}px Consolas, monospace`; g.fillText(text, cx, y); y += big ? 36 : 26; };
    if (w.pullUp) { if (flash) msg('PULL UP  ·  TERRAIN', RED, true); else y += 36; }
    if (w.stall) { if (flash) msg('STALL', RED, true); else y += 36; } else if (w.stallWarn) { msg('LOW ENERGY – LOWER NOSE / ADD POWER', AMBER); }
    if (w.missile) { if (flash) msg(`MISSILE ${w.missile.ir ? '(IR)' : '(RADAR)'} · BRG ${String(Math.round(w.missile.bearing)).padStart(3, '0')} · ${(w.missile.range / 1000).toFixed(1)}km · X FLARES`, RED); else y += 26; }
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
      g.fillStyle = AMBER; g.textAlign = 'center'; g.font = 'bold 16px Consolas, monospace';
      g.fillText(`ENGINE START  ${Math.round(s.startup * 100)}%   [${['BATT', 'APU', 'ENG L', 'ENG R'].map((n, i) => (s.startup > (i + 1) / 4 ? '✓' : '…') + n).join(' ')}]`, this.W / 2, this.H * 0.62);
    }
    if (s.prompt) { g.fillStyle = WHITE; g.textAlign = 'center'; g.font = 'bold 18px Consolas, monospace'; g.fillText(s.prompt, this.W / 2, this.H * 0.68); }
    if (s.weaponMsg) { g.fillStyle = AMBER; g.textAlign = 'center'; g.font = 'bold 15px Consolas, monospace'; g.fillText(s.weaponMsg, this.W / 2, this.H * 0.72); }
    if (s.hint) { g.fillStyle = CYAN; g.textAlign = 'center'; g.font = '15px Consolas, monospace'; g.fillText(s.hint, this.W / 2, this.H * 0.76); }
    g.font = '13px Consolas, "Courier New", monospace';
  }

  private drawDetect(s: HudInput) {
    const mi = s.mission!, g = this.g, x = this.W / 2 - 100, y = 100;
    g.textAlign = 'left'; g.fillStyle = mi.masked ? GREEN : AMBER; g.fillText(`RADAR NETWORK  ${mi.masked ? 'TERRAIN-MASKED' : 'EXPOSED'}`, x, y);
    g.strokeStyle = DIM; g.strokeRect(x, y + 8, 200, 8);
    g.fillStyle = mi.detect > 66 ? RED : mi.detect > 33 ? AMBER : GREEN; g.fillRect(x, y + 8, 200 * mi.detect / 100, 8);
    if (mi.alerted) { g.fillStyle = RED; g.fillText('DETECTED – ENEMY ALERTED', x, y + 32); }
  }

  private drawLanding(s: HudInput) {
    const g = this.g, gd = s.guidance!, m = s.player.model, cx = this.W / 2, cy = this.H / 2 + 120;
    // simple ILS-style cross: localiser (vertical) + glide-slope (horizontal) deviation
    g.save();
    g.strokeStyle = DIM; g.strokeRect(cx - 60, cy - 60, 120, 120);
    g.beginPath(); g.moveTo(cx - 60, cy); g.lineTo(cx + 60, cy); g.moveTo(cx, cy - 60); g.lineTo(cx, cy + 60); g.stroke();
    const lx = clamp(-gd.lateral / 200 * 50, -55, 55), gy = clamp(gd.gsError / 40 * 50, -55, 55);
    g.strokeStyle = Math.abs(gd.lateral) < 60 ? GREEN : AMBER; g.beginPath(); g.moveTo(cx + lx, cy - 55); g.lineTo(cx + lx, cy + 55); g.stroke();
    g.strokeStyle = Math.abs(gd.gsError) < 15 ? GREEN : AMBER; g.beginPath(); g.moveTo(cx - 55, cy + gy); g.lineTo(cx + 55, cy + gy); g.stroke();
    g.fillStyle = GREEN; g.textAlign = 'center';
    g.fillText(`RWY ${gd.dirNorth ? '36' : '18'}  ${(Math.max(0, gd.dz) / 1000).toFixed(1)}km  ${m.gearDown ? 'GEAR ✓' : 'GEAR!'}`, cx, cy + 76);
    g.fillText(`${Math.round(m.iasKt)} kt  →  ${s.player.cfg.touchdownKt} touchdown`, cx, cy + 92);
    g.restore();
  }

  /** Mouse-aim: cursor marker + line from the screen centre; the nose follows the cursor. */
  private drawMouse(s: HudInput) {
    const g = this.g, m = s.mouse!, cx = this.W / 2, cy = this.H / 2;
    g.save(); g.strokeStyle = AMBER; g.lineWidth = 1.5; g.globalAlpha = 0.9;
    g.beginPath(); g.arc(cx, cy, m.r, 0, Math.PI * 2); g.globalAlpha = 0.25; g.stroke(); g.globalAlpha = 0.9;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(m.x, m.y); g.stroke();
    g.beginPath(); g.arc(m.x, m.y, 9, 0, Math.PI * 2); g.moveTo(m.x - 15, m.y); g.lineTo(m.x - 5, m.y); g.moveTo(m.x + 5, m.y); g.lineTo(m.x + 15, m.y); g.moveTo(m.x, m.y - 15); g.lineTo(m.x, m.y - 5); g.moveTo(m.x, m.y + 5); g.lineTo(m.x, m.y + 15); g.stroke();
    g.fillStyle = AMBER; g.font = '11px Consolas, monospace'; g.textAlign = 'center'; g.fillText('MOUSE-AIM', cx, cy + m.r + 14); g.restore();
  }

  private drawDebug(s: HudInput) {
    const g = this.g; g.fillStyle = 'rgba(255,255,255,0.85)'; g.font = '12px Consolas, monospace'; g.textAlign = 'left';
    s.debug!.forEach((l, i) => g.fillText(l, 20, this.H * 0.33 + i * 14));
  }
}
