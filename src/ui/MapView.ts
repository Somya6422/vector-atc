import type { FlightSession } from '../game/FlightSession';
import { ALT_ROUTE_POINT, BLIZZARD, FIELD_ELEV, LAKE, RADAR_SITES, WORLD, cxAlt, cxMain, terrainHeight } from '../world/Heightfield';
import { smoothstep } from '../util/math';

/** Top-down tactical map (key M). Terrain tint is pre-rendered once from the actual heightfield. */
export class MapView {
  private terrain: HTMLCanvasElement | null = null;
  private readonly x0 = -16000; private readonly x1 = 16000; private readonly z0 = -37000; private readonly z1 = 6000;

  private build() {
    const W = 240, H = Math.round(W * (this.z1 - this.z0) / (this.x1 - this.x0));
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d')!; const img = g.createImageData(W, H);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = this.x0 + (i / W) * (this.x1 - this.x0), z = this.z0 + (j / H) * (this.z1 - this.z0);
      const h = terrainHeight(x, z);
      const hx = terrainHeight(x + 120, z) - terrainHeight(x - 120, z);
      const shade = Math.max(0.55, Math.min(1.25, 1 + hx / 700));
      const t = smoothstep(350, 3600, h);
      let r = 70 + t * 140, gg = 100 + t * 70, b = 60 + t * 100;
      if (h > 3200) { r = gg = b = 235; }
      const k = (j * W + i) * 4;
      img.data[k] = Math.min(255, r * shade); img.data[k + 1] = Math.min(255, gg * shade); img.data[k + 2] = Math.min(255, b * shade); img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    this.terrain = c;
  }

  render(canvas: HTMLCanvasElement, s: FlightSession) {
    if (!this.terrain) this.build();
    const g = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    g.clearRect(0, 0, W, H);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.terrain!, 0, 0, W, H);
    const X = (x: number) => ((x - this.x0) / (this.x1 - this.x0)) * W, Z = (z: number) => ((z - this.z0) / (this.z1 - this.z0)) * H;
    // valleys
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 1.5;
    for (const f of [cxMain, cxAlt]) { g.beginPath(); for (let z = 6000; z >= -37000; z -= 500) { const px = X(f(z)), pz = Z(z); if (z === 6000) g.moveTo(px, pz); else g.lineTo(px, pz); } g.stroke(); }
    // lake + runway
    g.fillStyle = '#2f6ea0'; g.beginPath(); g.arc(X(LAKE.x), Z(LAKE.z), (LAKE.radius / (this.x1 - this.x0)) * W, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#222'; g.fillRect(X(-30), Z(1200), Math.max(3, (60 / (this.x1 - this.x0)) * W), (2400 / (this.z1 - this.z0)) * H);
    g.fillStyle = '#fff'; g.font = '11px Consolas, monospace'; g.fillText('AIRFIELD', X(0) + 8, Z(0));
    // radar sites + coverage rings
    for (const r of RADAR_SITES) {
      g.strokeStyle = 'rgba(255,90,77,0.45)'; g.beginPath(); g.arc(X(r.x), Z(r.z), (r.range / (this.x1 - this.x0)) * W, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#ff5a4d'; g.beginPath(); g.arc(X(r.x), Z(r.z), 4, 0, Math.PI * 2); g.fill(); g.fillText('RADAR ' + r.id, X(r.x) + 6, Z(r.z) - 4);
    }
    // blizzard cell
    const front = s.weatherFront;
    if (front > 0) {
      g.fillStyle = `rgba(230,240,255,${0.25 + front * 0.4})`; g.beginPath(); g.arc(X(BLIZZARD.x), Z(BLIZZARD.z), (BLIZZARD.radius * (0.55 + 0.45 * front) / (this.x1 - this.x0)) * W, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.fillText('BLIZZARD', X(BLIZZARD.x) - 20, Z(BLIZZARD.z));
      g.fillStyle = '#7fe3ff'; g.fillText('EAST PASS', X(ALT_ROUTE_POINT.x) + 6, Z(ALT_ROUTE_POINT.z));
    }
    // nav points
    g.fillStyle = '#7fe3ff'; g.strokeStyle = '#7fe3ff';
    for (const n of s.director.nav) { g.beginPath(); g.moveTo(X(n.x), Z(n.z) - 8); g.lineTo(X(n.x) + 7, Z(n.z)); g.lineTo(X(n.x), Z(n.z) + 8); g.lineTo(X(n.x) - 7, Z(n.z)); g.closePath(); g.stroke(); g.fillText(n.name, X(n.x) + 10, Z(n.z) + 3); }
    // units
    for (const u of s.units) {
      if (u.dormant || !u.alive) continue;
      const hostile = u.side === 'hostile';
      if (hostile && !s.targeting.contactFor(u)?.los && !u.identified) continue;
      const px = X(u.pos.x), pz = Z(u.pos.z);
      g.fillStyle = u.side === 'player' ? '#7dffb2' : hostile ? '#ff5a4d' : '#7fe3ff';
      g.save(); g.translate(px, pz); g.rotate(u.model.heading * Math.PI / 180);
      g.beginPath(); g.moveTo(0, -8); g.lineTo(5, 6); g.lineTo(0, 3); g.lineTo(-5, 6); g.closePath(); g.fill(); g.restore();
      g.fillStyle = '#fff'; g.fillText(u.callsign, px + 9, pz + 3);
    }
    g.fillStyle = '#fff'; g.fillText(`FIELD ${Math.round(FIELD_ELEV)} m`, 6, H - 6);
    void WORLD;
  }
}
