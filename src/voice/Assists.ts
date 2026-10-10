import type { Unit } from '../game/Entity';
import { Vector3 } from 'three';
import { Autopilot } from '../flight/Autopilot';
import type { FlightController } from '../flight/FlightController';
import type { MissionDirector, NavPoint } from '../missions/MissionDirector';
import type { Weapons } from '../combat/Weapons';
import { WingmanAI } from '../ai/WingmanAI';
import { terrainAvoid } from '../ai/Maneuvers';
import { DEG, KT, clamp, wrapPi } from '../util/math';
import { FIELD_ELEV, RUNWAY, terrainHeight, world } from '../world/Heightfield';
import { Unit as UnitCtor } from '../game/Entity';

/** The AI controllers expect a weapons system; assists never shoot, so they get an inert one. */
const _rv = new Vector3(), _uv = new Vector3();
const NO_WEAPONS = { threatsTo: () => [], nearestThreat: () => null, dropFlares: () => false, fireGun: () => 0, releaseTrigger: () => {}, launch: () => null } as unknown as Weapons;

export type AutoMode = 'none' | 'takeoff' | 'taxi' | 'land' | 'recover';

/**
 * Voice-driven flight assists. Voice is discrete (not a continuous stick), so spoken commands such as
 * "heading 270", "climb to 4000 feet" or "land" set targets that these control laws fly with the SAME flight model the
 * player uses. Any manual stick input hands control straight back to the pilot.
 */
export class Assists {
  hdg: number | null = null;      // rad
  alt: number | null = null;      // m MSL
  gamma: number | null = null;    // rad
  speed: number | null = null;    // m/s IAS
  bank: number | null = null;     // deg (+ right)
  nav: NavPoint | null = null;
  apActive = false;
  auto: AutoMode = 'none';
  landingAssistUsed = false;
  private ap = new Autopilot();
  private ai: WingmanAI | null = null;
  private ghost: Unit | null = null;
  private taxiStep = 0;
  onMessage?: (s: string) => void;

  constructor(private player: Unit, private fc: FlightController, private director: MissionDirector) { void this.director; }

  get active() { return this.apActive || this.auto !== 'none'; }

  describe(): string | null {
    if (this.auto === 'takeoff') return 'AUTO-TAKEOFF';
    if (this.auto === 'taxi') return 'TAXI ASSIST';
    if (this.auto === 'land') return 'AUTOLAND';
    if (this.auto === 'recover') return 'AUTO-RECOVERY';
    if (!this.apActive) return null;
    const parts: string[] = [];
    if (this.nav) parts.push('NAV ' + this.nav.name);
    else if (this.bank !== null) parts.push(`BANK ${this.bank > 0 ? 'R' : 'L'}${Math.abs(Math.round(this.bank))}`);
    else if (this.hdg !== null) parts.push('HDG ' + String(Math.round(((this.hdg / DEG) % 360 + 360) % 360)).padStart(3, '0'));
    if (this.gamma !== null) parts.push(`PITCH ${Math.round(this.gamma / DEG)}°`);
    if (this.alt !== null) parts.push(`ALT ${Math.round(this.alt / 0.3048)}`);
    if (this.speed !== null) parts.push(`SPD ${Math.round(this.speed * KT)}`);
    return 'AP  ' + parts.join(' · ');
  }

  off(msg?: string) {
    const was = this.active;
    this.apActive = false; this.hdg = this.alt = this.gamma = this.speed = this.bank = null; this.nav = null; this.auto = 'none'; this.ai = null;
    this.fc.brakeLatch = false;
    if (was && msg) this.onMessage?.(msg);
  }

  /** Engage the cruise autopilot (airborne only). Unspecified axes hold the aircraft's current state. */
  engage(p: { hdg?: number | null; alt?: number | null; gamma?: number | null; speed?: number | null; bank?: number | null; nav?: NavPoint | null }): string | null {
    const m = this.player.model;
    if (m.onGround) return 'The autopilot only works in the air.';
    if (this.auto !== 'none') this.auto = 'none';
    if (!this.apActive) { this.hdg = m.heading * DEG; this.alt = m.pos.y; this.gamma = null; this.speed = null; this.bank = null; this.nav = null; }
    this.apActive = true;
    if (p.hdg !== undefined) { this.hdg = p.hdg; this.bank = null; this.nav = null; }
    if (p.alt !== undefined) { this.alt = p.alt; this.gamma = null; }
    if (p.gamma !== undefined) { this.gamma = p.gamma; if (p.gamma !== null) this.alt = null; }
    if (p.speed !== undefined) this.speed = p.speed;
    if (p.bank !== undefined) { this.bank = p.bank; if (p.bank !== null) { this.nav = null; } }
    if (p.nav !== undefined) { this.nav = p.nav; if (p.nav) { this.bank = null; if (this.alt === null) this.alt = m.pos.y; } }
    return null;
  }

  // ------------------------------------------------------------------ ground / automatic procedures
  startTaxi(): string {
    const m = this.player.model;
    if (!m.onGround) return 'Taxi assist is for the ground.';
    if (!m.engineOn) return 'Start the engines first.';
    this.off(); this.auto = 'taxi'; this.taxiStep = 0;
    return 'Taxiing to runway 36.';
  }
  startTakeoff(): string {
    const m = this.player.model;
    if (!m.onGround) return 'Already airborne.';
    if (!m.engineOn) return 'Start the engines first.';
    if (!(Math.abs(m.pos.x) < RUNWAY.halfWid + 10 && Math.abs(m.pos.z) < RUNWAY.halfLen && (m.heading < 25 || m.heading > 335)))
      return 'Line up on runway 36 first – say "taxi".';
    this.off(); this.auto = 'takeoff';
    this.ai = new WingmanAI(this.player); this.ai.state = 'TAKEOFF'; this.ai.takeoffX = clamp(m.pos.x, -10, 10);
    return 'Cleared for takeoff.';
  }
  startLand(): string {
    const m = this.player.model;
    if (m.onGround && m.vel.length() < 2) return 'We are on the ground.';
    this.off(); this.auto = 'land'; this.landingAssistUsed = true;
    this.ghost = new UnitCtor('ghost', 'Ghost', 'friendly', this.player.cfg, world, 1);
    this.ghost.model.pos.set(0, FIELD_ELEV, 0); this.ghost.model.onGround = true;
    this.ai = new WingmanAI(this.player); this.ai.state = 'RTB';
    return 'Returning to base and landing. Autoland assist is penalised in the score.';
  }

  /** Panic button: roll wings level (shortest way, inverted included), unload a stall, then climb at +8 deg. */
  startRecover(): string {
    const m = this.player.model;
    if (m.onGround) return 'Already on the ground.';
    if (this.auto === 'recover') { this.off('Recovery cancelled – you have control.'); return 'Recovery cancelled.'; }
    this.off(); this.auto = 'recover'; this.recoverStable = 0;
    return 'Auto-recovery: wings level, nose up, full power.';
  }
  private recoverStable = 0;
  private recover(dt: number) {
    const m = this.player.model, fc = this.fc, cfg = this.player.cfg;
    const right = _rv.set(1, 0, 0).applyQuaternion(m.q), up = _uv.set(0, 1, 0).applyQuaternion(m.q);
    const bank = Math.atan2(right.y, up.y);                  // 0 = wings level, ±pi = inverted
    const stalled = m.stalled || m.ias < cfg.stallSpeedKt / KT * 1.12;
    fc.yaw = 0; fc.throttle = 1; fc.airbrake = false; fc.brakeLatch = false;
    fc.roll = clamp(bank * 1.7, -1, 1);
    if (stalled) fc.pitch = clamp((-12 - m.pitchDeg) * 0.06, -1, 0.1);          // unload: nose below the horizon to regain speed
    else if (Math.abs(bank) > 0.5) fc.pitch = up.y < 0 ? 0 : 0.15;                // roll first, gentle pull only when upright
    else fc.pitch = clamp((8 - m.pitchDeg) * 0.07, -0.6, 0.8);
    const tav = terrainAvoid(m, this.ap, dt, 240);
    if (tav) { fc.pitch = tav.pitch; fc.roll = tav.roll; }
    const ok = Math.abs(bank) < 0.09 && m.pitchDeg > 0 && m.vel.y > 0 && !stalled;
    this.recoverStable = ok ? this.recoverStable + dt : 0;
    if (this.recoverStable > 1.5) {
      this.auto = 'none';
      this.engage({ hdg: m.heading * DEG, alt: Math.max(m.pos.y + 150, terrainHeight(m.pos.x, m.pos.z) + 450), gamma: null, bank: null, nav: null });
      this.onMessage?.('Recovered. Autopilot holding heading and climbing – move the stick to take over.');
    }
  }

  // ------------------------------------------------------------------ per frame
  /** `manual` = the pilot is touching the stick/mouse/throttle: assists hand control back. */
  update(dt: number, now: number, manual: boolean, manualThrottle: boolean) {
    const m = this.player.model, fc = this.fc;
    if (!this.active) return;
    if (m.crashed) { this.off(); return; }
    if (this.auto === 'recover') { this.recover(dt); return; }   // the panic recovery ignores stick input until it is done
    if (manual && (this.apActive || this.auto === 'land' || this.auto === 'takeoff')) { this.off('Manual control – assists off.'); return; }
    if (manualThrottle) this.speed = null;
    if (this.auto === 'taxi') { this.taxi(dt); return; }
    if (this.auto === 'takeoff' && this.ai) {
      const c = this.ai.update(dt, { now, leader: this.player, weapons: NO_WEAPONS, hostiles: [], playerTarget: null, interference: 0, rtb: false, leaderRolling: true });
      this.apply(c);
      if (this.ai.state !== 'TAKEOFF') {
        const hdg = m.heading * DEG;
        this.auto = 'none'; this.ai = null; this.apActive = false;
        this.engage({ hdg, alt: Math.max(m.pos.y, 1400), speed: null });
        this.onMessage?.('Airborne. Autopilot climbing to 4,500 ft on runway heading.');
      }
      return;
    }
    if (this.auto === 'land' && this.ai) {
      const c = this.ai.update(dt, { now, leader: this.ghost!, weapons: NO_WEAPONS, hostiles: [], playerTarget: null, interference: 0, rtb: true, leaderRolling: false });
      this.apply(c);
      if ((this.ai.state as string) === 'PARKED' || (m.onGround && m.vel.length() < 1)) { this.auto = 'none'; this.ai = null; fc.brakeLatch = true; fc.throttle = 0; this.onMessage?.('Landed and stopped.'); }
      return;
    }
    if (this.apActive) this.cruise(dt);
  }

  private apply(c: { pitch: number; roll: number; yaw: number; throttle: number; airbrake: boolean; gearDown: boolean }) {
    const fc = this.fc;
    fc.pitch = c.pitch; fc.roll = c.roll; fc.yaw = c.yaw; fc.throttle = c.throttle; fc.airbrake = c.airbrake; fc.gearDown = c.gearDown;
  }

  private cruise(dt: number) {
    const m = this.player.model, fc = this.fc;
    if (m.onGround) { this.apActive = false; return; }
    let hdg = this.hdg ?? m.heading * DEG;
    let alt = this.alt;
    if (this.nav) {
      const dx = this.nav.x - m.pos.x, dz = this.nav.z - m.pos.z, dist = Math.hypot(dx, dz);
      if (dist < 1800) { this.hdg = m.heading * DEG; this.nav = null; this.onMessage?.('Waypoint reached – holding heading.'); return; }
      hdg = Math.atan2(dx, -dz);
      // fly above the terrain along the leg
      let ground = 0; for (let k = 0; k <= 8; k++) ground = Math.max(ground, terrainHeight(m.pos.x + dx * Math.min(1, 3500 / dist) * k / 8, m.pos.z + dz * Math.min(1, 3500 / dist) * k / 8));
      alt = Math.max(this.alt ?? 0, ground + 320);
    } else if (this.bank !== null) {
      hdg = m.heading * DEG + this.bank * DEG / 1.7;
    }
    let gamma: number;
    if (this.gamma !== null) gamma = this.gamma;
    else gamma = clamp(((alt ?? m.pos.y) - m.pos.y) * 0.02, -9, 12) * DEG;
    const speedMs = this.speed ?? m.tas;
    const c = this.ap.navigate(m, hdg, gamma, speedMs, dt, { useIas: this.speed !== null, bankMax: (this.bank !== null ? Math.max(15, Math.abs(this.bank)) : 50) * DEG });
    fc.pitch = c.pitch; fc.roll = c.roll; fc.yaw = 0;
    if (this.speed !== null) { fc.throttle = c.throttle; fc.airbrake = m.ias > this.speed + 12; }   // airbrake helps shed excess speed
    // auto-GCAS: the assist never flies into terrain
    const tav = terrainAvoid(m, this.ap, dt, 260);
    if (tav) { fc.pitch = tav.pitch; fc.roll = tav.roll; fc.throttle = Math.max(fc.throttle, 0.9); this.onMessage?.('AUTO-GCAS recovery.'); this.hdg = null; this.alt = Math.max(m.pos.y + 300, this.alt ?? 0); }
  }

  private taxi(dt: number) {
    const m = this.player.model, fc = this.fc;
    const wps: [number, number][] = [[-82, 1300], [-82, 1200], [-70, 1182], [-30, 1180], [-6, 1176]];
    const onRunway = Math.abs(m.pos.x) < RUNWAY.halfWid && m.pos.z < RUNWAY.halfLen;
    const speed = m.vel.length();
    fc.roll = 0; fc.pitch = 0;
    if (!onRunway && this.taxiStep < wps.length) {
      const [tx, tz] = wps[this.taxiStep]; const dx = tx - m.pos.x, dz = tz - m.pos.z;
      if (Math.hypot(dx, dz) < 14) this.taxiStep++;
      const err = wrapPi(Math.atan2(dx, -dz) - m.heading * DEG) / DEG;
      fc.yaw = clamp(err * 0.08, -1, 1);
      fc.throttle = speed < 7 ? 0.32 : 0; fc.brakeLatch = speed > 9;
      return;
    }
    // on the runway: swing the nose north, then stop on the centreline
    const err = wrapPi(0 - m.heading * DEG) / DEG;
    fc.yaw = clamp(err * 0.05, -1, 1); fc.throttle = speed < 3.5 ? 0.3 : 0; fc.brakeLatch = speed > 5;
    void dt;
    if (Math.abs(err) < 4 && speed < 4) { fc.throttle = 0; fc.brakeLatch = true; this.auto = 'none'; this.onMessage?.('Lined up on runway 36. Say "take off" when ready.'); }
  }
}
