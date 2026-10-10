import * as THREE from 'three';
import type { Contact, Unit } from '../game/Entity';
import { lineOfSight } from '../world/Heightfield';
import { G0, clamp } from '../util/math';
import { GUN_SPEC, MISSILES, SENSOR, type WeaponId } from './WeaponSpecs';

export type LockState = 'NONE' | 'SEARCH' | 'TRACK' | 'LOCK';

const _inv = new THREE.Quaternion(), _r = new THREE.Vector3(), _b = new THREE.Vector3();

/** Computes the lead point for a gun with finite muzzle velocity (plus gravity drop). Pure function – unit-tested. */
export function computeLead(shooterPos: THREE.Vector3, shooterVel: THREE.Vector3, targetPos: THREE.Vector3, targetVel: THREE.Vector3, muzzle = GUN_SPEC.muzzleVelocity) {
  const r = targetPos.clone().sub(shooterPos);
  const vr = targetVel.clone().sub(shooterVel);
  const a = vr.dot(vr) - muzzle * muzzle, b = 2 * r.dot(vr), c = r.dot(r);
  let t = -1;
  if (Math.abs(a) < 1e-6) t = c / Math.max(1e-6, -b);
  else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      const t1 = (-b - s) / (2 * a), t2 = (-b + s) / (2 * a);
      const cand = [t1, t2].filter(x => x > 0);
      if (cand.length) t = Math.min(...cand);
    }
  }
  if (!(t > 0) || t > GUN_SPEC.lifetime * 1.05) t = Math.min(GUN_SPEC.lifetime, Math.sqrt(c) / muzzle);
  // Round leaves with shooterVel + muzzle*dir, so the bore direction is along (r + vr*t) in the shooter frame.
  const aim = shooterPos.clone().add(r).addScaledVector(vr, t);
  aim.y += 0.5 * G0 * t * t;           // compensate gravity drop of the round
  return { time: t, aim, inRange: t <= GUN_SPEC.lifetime };
}

export class TargetingSystem {
  contacts: Contact[] = [];
  selected: Unit | null = null;
  weapon: WeaponId = 'GUN';
  lock: LockState = 'NONE';
  lockProgress = 0;
  idProgress = 0;
  /** short human reason when a launch is blocked */
  blockReason = '';
  private grace = 0;
  private lastSelectedId = '';

  constructor(private owner: Unit, private enemies: () => Unit[], private jamming: () => number = () => 0) {}
  /** F-35 sensor fusion (AN/APG-81 + DAS + EOTS): 20 % more radar range and twice-as-fast identification */
  private get fusion() { return this.owner.cfg.id === 'F35' ? 1.2 : 1; }

  /** Off-boresight angle (rad) from the owner's nose to a world point. */
  offBoresight(p: THREE.Vector3): number {
    const m = this.owner.model;
    _r.copy(p).sub(this.owner.pos);
    const len = _r.length();
    if (len < 1) return 0;
    m.forward(_b);
    return Math.acos(clamp(_b.dot(_r) / len, -1, 1));
  }

  /** Sensor model: a target is a radar contact if inside the scan sector, inside RCS-scaled range and not terrain-masked. */
  update(dt: number) {
    const me = this.owner;
    const cs: Contact[] = [];
    for (const u of this.enemies()) {
      if (!u.alive || u === me) continue;
      const range = u.pos.distanceTo(me.pos);
      const off = this.offBoresight(u.pos);
      const effRange = SENSOR.radarRange * Math.pow(u.cfg.rcs, 0.25) * (1 - 0.5 * this.jamming()) * this.fusion;
      const inScan = off <= SENSOR.scanHalfAngle && range <= effRange;
      const los = inScan && lineOfSight(me.pos.x, me.pos.y, me.pos.z, u.pos.x, u.pos.y, u.pos.z, 300);
      _r.copy(u.vel).sub(me.vel);
      const closure = -_r.dot(_b.copy(u.pos).sub(me.pos).normalize());
      cs.push({ unit: u, range, offBoresight: off, inScan, los, closure });
    }
    this.contacts = cs.sort((a, b) => a.range - b.range);
    // lost the selected contact?
    if (this.selected) {
      const c = this.contactFor(this.selected);
      if (!this.selected.alive || !c || !c.inScan || !c.los) {
        // keep a short memory so a brief terrain mask doesn't drop everything
        this.grace += dt;
        if (!this.selected.alive || this.grace > 3) this.setSelected(null);
      } else this.grace = 0;
    }
    this.updateId(dt);
    this.updateLock(dt);
  }

  contactFor(u: Unit) { return this.contacts.find(c => c.unit === u) ?? null; }
  get selectedContact() { return this.selected ? this.contactFor(this.selected) : null; }
  detected() { return this.contacts.filter(c => c.inScan && c.los); }

  setSelected(u: Unit | null) {
    this.selected = u;
    this.idProgress = u?.identified ? 1 : 0;
    this.lockProgress = 0; this.lock = u ? 'SEARCH' : 'NONE'; this.grace = 0;
    this.lastSelectedId = u?.id ?? '';
  }
  /** `R` – cycle to the next detected contact (nearest first). */
  cycle(): Unit | null {
    const list = this.detected();
    if (!list.length) { this.setSelected(null); return null; }
    const i = this.selected ? list.findIndex(c => c.unit === this.selected) : -1;
    const next = list[(i + 1) % list.length].unit;
    this.setSelected(next);
    return next;
  }
  /** Auto-select the contact closest to the nose inside the 60-degree cone if nothing is selected. */
  autoSelect() {
    if (this.selected) return;
    const inCone = this.detected().filter(c => c.offBoresight <= SENSOR.boreCone).sort((a, b) => a.offBoresight - b.offBoresight);
    if (inCone.length) this.setSelected(inCone[0].unit);
  }
  selectWeapon(w: WeaponId) { this.weapon = w; this.lockProgress = 0; this.lock = this.selected ? 'SEARCH' : 'NONE'; }

  private updateId(dt: number) {
    const c = this.selectedContact;
    if (!this.selected || !c) return;
    if (this.selected.identified) { this.idProgress = 1; return; }
    if (c.range <= SENSOR.idRange && c.offBoresight <= SENSOR.boreCone && c.los) {
      this.idProgress = Math.min(1, this.idProgress + dt / SENSOR.idTime * (this.fusion > 1 ? 2 : 1));
      if (this.idProgress >= 1) this.selected.identified = true;
    } else this.idProgress = Math.max(0, this.idProgress - dt * 0.5);
  }

  /** Conditions for a missile launch with the currently-selected weapon. */
  launchCheck(): { ok: boolean; reason: string } {
    const c = this.selectedContact;
    if (this.weapon === 'GUN') return { ok: true, reason: '' };
    if (!this.selected || !c) return { ok: false, reason: 'NO TARGET' };
    if (!this.selected.identified) return { ok: false, reason: 'ROE: IDENTIFY TARGET' };
    if (this.selected.side === 'friendly' || this.selected.side === 'player') return { ok: false, reason: 'FRIENDLY' };
    const spec = this.weapon === 'IR' ? MISSILES.IR : MISSILES.RADAR;
    if (c.range > spec.launchMaxRange) return { ok: false, reason: 'OUT OF RANGE' };
    if (c.range < spec.launchMinRange) return { ok: false, reason: 'TOO CLOSE' };
    if (this.lock !== 'LOCK') return { ok: false, reason: 'NO LOCK' };
    return { ok: true, reason: '' };
  }

  private updateLock(dt: number) {
    if (this.weapon === 'GUN' || !this.selected) { this.lock = this.selected ? 'SEARCH' : 'NONE'; this.lockProgress = 0; return; }
    const c = this.selectedContact;
    const spec = this.weapon === 'IR' ? MISSILES.IR : MISSILES.RADAR;
    let ok = !!c && c.los && c.inScan && c.offBoresight <= spec.lockCone && c.range <= spec.launchMaxRange * 1.05 && this.selected.alive;
    if (ok && this.weapon === 'IR' && c) ok = this.selected.heat(this.owner.pos) > 0.18;   // needs a heat source
    if (ok && this.weapon === 'RADAR' && c) ok = c.range <= SENSOR.radarRange * Math.pow(this.selected.cfg.rcs, 0.25) * (1 - 0.5 * this.jamming()) * 0.95;
    if (ok) this.lockProgress = Math.min(1, this.lockProgress + dt / spec.lockTime);
    else this.lockProgress = Math.max(0, this.lockProgress - dt / 0.6);
    this.lock = this.lockProgress >= 1 ? 'LOCK' : this.lockProgress > 0 ? 'TRACK' : 'SEARCH';
  }

  /** Lead data for the gun-sight (world-space aim point, time-of-flight). */
  lead() {
    if (!this.selected) return null;
    return computeLead(this.owner.pos, this.owner.vel, this.selected.pos, this.selected.vel);
  }
}
