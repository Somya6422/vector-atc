import * as THREE from 'three';
import type { Unit } from '../game/Entity';
import { terrainHeight } from '../world/Heightfield';
import { G0, Rng, clamp } from '../util/math';
import { GUN_SPEC, MISSILES, type MissileSpec } from './WeaponSpecs';

export interface WeaponEvents {
  onGunFire?(shooter: Unit): void;
  onMissileLaunch?(m: Missile): void;
  onDetonate?(pos: THREE.Vector3, hit: Unit | null, m: Missile | null): void;
  onHit?(target: Unit, damage: number, by: Unit | null, kind: 'GUN' | 'IR' | 'RADAR'): void;
  onKill?(target: Unit, by: Unit | null): void;
  onFlare?(unit: Unit): void;
  onMissileDefeated?(m: Missile, why: string): void;
}

export interface Missile {
  spec: MissileSpec;
  owner: Unit;
  target: Unit | null;
  pos: THREE.Vector3; vel: THREE.Vector3;
  age: number; speed: number;
  mode: 'GUIDED' | 'LOST' | 'DONE';
  active: boolean;           // radar missile: onboard seeker active
  mesh: THREE.Group; trail: THREE.Line; trailPts: Float32Array; trailN: number;
  lastSeek: number;
  seekTarget: THREE.Vector3; // current tracked point (target or flare)
  lockedOnFlare: boolean;
  chaffBroke: boolean;
}

interface Flare { pos: THREE.Vector3; vel: THREE.Vector3; age: number; sprite: THREE.Sprite; active: boolean; owner: Unit; }
interface Boom { sprite: THREE.Sprite; age: number; life: number; size: number; active: boolean; }

const MAX_BULLETS = 520, MAX_FLARES = 48, MAX_BOOMS = 24;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const FWD = new THREE.Vector3(0, 0, -1);

function glowTexture(inner: string, outer: string) {
  if (typeof document === 'undefined') return new THREE.Texture();   // headless (tests)
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!; const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
}

export class Weapons {
  readonly group = new THREE.Group();
  readonly missiles: Missile[] = [];
  events: WeaponEvents = {};
  private bulletMesh: THREE.InstancedMesh;
  private tracerGlow: THREE.InstancedMesh;
  private bp = new Float32Array(MAX_BULLETS * 3); private bv = new Float32Array(MAX_BULLETS * 3);
  private bl = new Float32Array(MAX_BULLETS); private bo: (Unit | null)[] = new Array(MAX_BULLETS).fill(null);
  private bn = 0;
  private flares: Flare[] = [];
  private booms: Boom[] = [];
  private rng = new Rng(4242);
  private flareTex = glowTexture('rgba(255,250,220,1)', 'rgba(255,170,60,0.55)');
  private boomTex = glowTexture('rgba(255,255,230,1)', 'rgba(255,120,30,0.7)');
  private missileGeo = (() => {
    const g = new THREE.CylinderGeometry(0.14, 0.14, 3.0, 8); g.rotateX(Math.PI / 2);
    return g;
  })();
  private missileMat = new THREE.MeshStandardMaterial({ color: 0xdadada, metalness: 0.4, roughness: 0.5 });
  private flameMat = new THREE.SpriteMaterial({ map: glowTexture('rgba(255,255,255,1)', 'rgba(255,160,60,0.8)'), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  private trailMat = new THREE.LineBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.55 });
  private clock = 0;

  constructor(private units: () => Unit[]) {
    const geo = new THREE.BoxGeometry(0.14, 0.14, 8); geo.translate(0, 0, -4);
    this.bulletMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xfff1c0, toneMapped: false, fog: false }), MAX_BULLETS);
    const gg = new THREE.BoxGeometry(0.55, 0.55, 12); gg.translate(0, 0, -6);
    this.tracerGlow = new THREE.InstancedMesh(gg, new THREE.MeshBasicMaterial({ color: 0xff9a2e, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }), MAX_BULLETS);
    this.tracerGlow.count = 0; this.tracerGlow.frustumCulled = false; this.tracerGlow.instanceMatrix = this.bulletMesh.instanceMatrix;
    this.bulletMesh.count = 0; this.bulletMesh.frustumCulled = false;
    this.group.add(this.bulletMesh, this.tracerGlow);
    for (let i = 0; i < MAX_FLARES; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.flareTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false; s.scale.setScalar(14); this.group.add(s);
      this.flares.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, sprite: s, active: false, owner: null as unknown as Unit });
    }
    for (let i = 0; i < MAX_BOOMS; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.boomTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.visible = false; this.group.add(s); this.booms.push({ sprite: s, age: 0, life: 1, size: 20, active: false });
    }
  }

  // --------------------------------------------------------------- guns
  /** Fires one cannon burst slice. Returns number of rounds actually fired (0 if empty / rate-limited). */
  fireGun(shooter: Unit, dt: number): number {
    if (!shooter.alive || shooter.gunAmmo <= 0) return 0;
    shooter.gunCooldown -= dt;
    let fired = 0;
    const interval = 1 / GUN_SPEC.roundsPerSecond;
    while (shooter.gunCooldown <= 0 && shooter.gunAmmo > 0 && this.bn < MAX_BULLETS) {
      shooter.gunCooldown += interval;
      const m = shooter.model;
      _a.set(shooter.cfg.gunMuzzle[0], shooter.cfg.gunMuzzle[1], shooter.cfg.gunMuzzle[2]).applyQuaternion(m.q).add(m.pos);
      m.forward(_b);
      _b.x += this.rng.signed() * GUN_SPEC.burstSpread; _b.y += this.rng.signed() * GUN_SPEC.burstSpread; _b.z += this.rng.signed() * GUN_SPEC.burstSpread;
      _b.normalize();
      const i = this.bn++;
      this.bp[i * 3] = _a.x; this.bp[i * 3 + 1] = _a.y; this.bp[i * 3 + 2] = _a.z;
      this.bv[i * 3] = m.vel.x + _b.x * GUN_SPEC.muzzleVelocity; this.bv[i * 3 + 1] = m.vel.y + _b.y * GUN_SPEC.muzzleVelocity; this.bv[i * 3 + 2] = m.vel.z + _b.z * GUN_SPEC.muzzleVelocity;
      this.bl[i] = GUN_SPEC.lifetime; this.bo[i] = shooter;
      shooter.gunAmmo--; shooter.shotsFired++; fired++;
    }
    if (shooter.gunCooldown < -0.2) shooter.gunCooldown = 0;   // don't bank a burst while the trigger is up
    if (fired) this.events.onGunFire?.(shooter);
    return fired;
  }
  releaseTrigger(shooter: Unit) { shooter.gunCooldown = Math.min(shooter.gunCooldown, 0); }

  get activeBullets() { return this.bn; }

  // --------------------------------------------------------------- missiles
  launch(owner: Unit, target: Unit | null, kind: 'IR' | 'RADAR'): Missile | null {
    if (!owner.alive) return null;
    if (kind === 'IR' ? owner.irMissiles <= 0 : owner.radarMissiles <= 0) return null;
    if (this.missiles.filter(m => m.owner === owner && m.mode !== 'DONE').length >= 4) return null;
    const spec = MISSILES[kind];
    if (kind === 'IR') owner.irMissiles--; else owner.radarMissiles--;
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(this.missileGeo, this.missileMat); body.castShadow = false; mesh.add(body);
    const flame = new THREE.Sprite(this.flameMat.clone()); flame.scale.setScalar(2.6); flame.position.z = 1.8; flame.name = 'flame'; mesh.add(flame);
    const N = 40, pts = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pts, 3)); g.setDrawRange(0, 0);
    const trail = new THREE.Line(g, this.trailMat); trail.frustumCulled = false;
    this.group.add(mesh, trail);
    const m = owner.model;
    const pos = new THREE.Vector3(0, -1.0, -2).applyQuaternion(m.q).add(m.pos);   // released below the fuselage
    const vel = m.vel.clone();
    const ms: Missile = { spec, owner, target, pos, vel, age: 0, speed: Math.max(m.vel.length(), 60), mode: 'GUIDED', active: false, mesh, trail, trailPts: pts, trailN: 0, lastSeek: -1, seekTarget: target ? target.pos.clone() : pos.clone(), lockedOnFlare: false, chaffBroke: false };
    this.missiles.push(ms);
    this.events.onMissileLaunch?.(ms);
    return ms;
  }

  /** Active missiles currently homing on `u` (for the missile-warning system). */
  threatsTo(u: Unit): Missile[] { return this.missiles.filter(m => m.mode === 'GUIDED' && m.target === u && m.owner !== u); }
  incoming(u: Unit) { return this.threatsTo(u); }

  // --------------------------------------------------------------- countermeasures
  /** `X` – dispenses flares (IR decoys) and chaff. Returns false when empty or on cooldown. */
  dropFlares(u: Unit, now: number): boolean {
    if (!u.alive || u.flares <= 0 || u.flareCooldown > 0) return false;
    u.flares = Math.max(0, u.flares - 2);
    u.flareCooldown = 0.7;
    u.chaffUntil = now + 4.5;
    for (let k = 0; k < 2; k++) {
      const f = this.flares.find(x => !x.active); if (!f) break;
      f.active = true; f.age = 0; f.owner = u;
      f.pos.copy(u.pos).addScaledVector(u.forward(_a), -9);
      f.vel.copy(u.vel).multiplyScalar(0.9);
      f.vel.x += this.rng.signed() * 22; f.vel.y += -12 + this.rng.signed() * 10; f.vel.z += this.rng.signed() * 22;
      f.sprite.visible = true;
    }
    this.events.onFlare?.(u);
    return true;
  }
  chaffActive(u: Unit, now: number) { return u.chaffUntil > now; }

  // --------------------------------------------------------------- damage
  applyDamage(target: Unit, dmg: number, by: Unit | null, kind: 'GUN' | 'IR' | 'RADAR') {
    if (!target.alive) return;
    const wasAlive = target.alive;
    target.lastDamagedBy = by;
    if (by) by.hits++;
    this.events.onHit?.(target, dmg, by, kind);
    target.model.damage(dmg * target.damageScale, 'ENEMY');
    if (wasAlive && !target.alive) { by && by.kills++; this.events.onKill?.(target, by); this.boom(target.pos, 70); }
  }

  boomAt(p: THREE.Vector3, size: number, life = 1.4) { this.boom(p, size, life); }
  private boom(p: THREE.Vector3, size: number, life = 1.1) {
    const b = this.booms.find(x => !x.active); if (!b) return;
    b.active = true; b.age = 0; b.life = life; b.size = size; b.sprite.position.copy(p); b.sprite.visible = true;
  }

  // --------------------------------------------------------------- update
  update(dt: number, now: number) {
    this.clock = now;
    this.updateBullets(dt);
    this.updateFlares(dt);
    this.updateMissiles(dt);
    for (const b of this.booms) if (b.active) {
      b.age += dt; const k = b.age / b.life;
      if (k >= 1) { b.active = false; b.sprite.visible = false; continue; }
      b.sprite.scale.setScalar(b.size * (0.4 + k * 1.6)); (b.sprite.material as THREE.SpriteMaterial).opacity = 1 - k;
    }
    for (const u of this.units()) if (u.flareCooldown > 0) u.flareCooldown -= dt;
  }

  private updateBullets(dt: number) {
    const us = this.units();
    let i = 0;
    while (i < this.bn) {
      const px = this.bp[i * 3], py = this.bp[i * 3 + 1], pz = this.bp[i * 3 + 2];
      this.bv[i * 3 + 1] -= G0 * dt;
      const nx = px + this.bv[i * 3] * dt, ny = py + this.bv[i * 3 + 1] * dt, nz = pz + this.bv[i * 3 + 2] * dt;
      this.bl[i] -= dt;
      let dead = this.bl[i] <= 0;
      if (!dead && ny < terrainHeight(nx, nz)) { dead = true; this.boom(_a.set(nx, ny, nz), 6, 0.35); }
      if (!dead) {
        _a.set(px, py, pz); _b.set(nx - px, ny - py, nz - pz);
        const L2 = _b.lengthSq();
        for (const u of us) {
          if (!u.alive || u === this.bo[i]) continue;
          const r = u.cfg.radius * GUN_SPEC.hitRadiusScale;
          _c.copy(u.pos).sub(_a);
          const t = clamp(_c.dot(_b) / (L2 || 1), 0, 1);
          _c.copy(_a).addScaledVector(_b, t).sub(u.pos);
          if (_c.lengthSq() < r * r) {
            this.applyDamage(u, GUN_SPEC.damage, this.bo[i], 'GUN');
            this.boom(_a.copy(u.pos).add(_c), 5, 0.3);
            dead = true; break;
          }
        }
      }
      if (dead) {   // swap-remove
        const l = this.bn - 1;
        if (i !== l) {
          for (let k = 0; k < 3; k++) { this.bp[i * 3 + k] = this.bp[l * 3 + k]; this.bv[i * 3 + k] = this.bv[l * 3 + k]; }
          this.bl[i] = this.bl[l]; this.bo[i] = this.bo[l];
        }
        this.bo[l] = null; this.bn--;
        continue;
      }
      this.bp[i * 3] = nx; this.bp[i * 3 + 1] = ny; this.bp[i * 3 + 2] = nz;
      i++;
    }
    for (let k = 0; k < this.bn; k++) {
      _a.set(this.bv[k * 3], this.bv[k * 3 + 1], this.bv[k * 3 + 2]).normalize();
      _q.setFromUnitVectors(FWD, _a);
      _m.compose(_b.set(this.bp[k * 3], this.bp[k * 3 + 1], this.bp[k * 3 + 2]), _q, _s);
      this.bulletMesh.setMatrixAt(k, _m);
    }
    this.bulletMesh.count = this.bn; this.tracerGlow.count = this.bn;
    this.bulletMesh.instanceMatrix.needsUpdate = true;
  }

  private updateFlares(dt: number) {
    for (const f of this.flares) if (f.active) {
      f.age += dt;
      f.vel.y -= 6 * dt; f.vel.multiplyScalar(1 - 0.35 * dt);
      f.pos.addScaledVector(f.vel, dt);
      if (f.age > 5.5) { f.active = false; f.sprite.visible = false; continue; }
      f.sprite.position.copy(f.pos);
      (f.sprite.material as THREE.SpriteMaterial).opacity = clamp(1.4 - f.age / 4, 0.1, 1);
      f.sprite.scale.setScalar(12 + Math.sin(f.age * 40) * 2);
    }
  }
  /** IR intensity of a flare (decays over ~5 s). */
  private flareHeat(f: Flare) { return 4.6 * clamp(1 - f.age / 5.2, 0, 1); }

  private updateMissiles(dt: number) {
    for (const m of this.missiles) {
      if (m.mode === 'DONE') continue;
      m.age += dt;
      const sp = m.spec;
      if (m.age > sp.life) { this.endMissile(m, null, 'FUEL'); continue; }
      // ---- guidance ----
      let guided = false;
      if (m.mode === 'GUIDED' && m.target && m.target.alive) {
        guided = this.seek(m, dt);
        if (!guided) { m.mode = 'LOST'; this.events.onMissileDefeated?.(m, m.chaffBroke ? 'CHAFF' : m.lockedOnFlare ? 'FLARE' : 'LOST TRACK'); }
      } else if (m.mode === 'GUIDED') { m.mode = 'LOST'; }
      if (guided) {
        // true proportional navigation: a = N * (Omega x V)
        _a.copy(m.seekTarget).sub(m.pos);
        const r2 = Math.max(_a.lengthSq(), 1);
        const vt = m.lockedOnFlare ? _b.set(0, 0, 0) : _b.copy(m.target!.vel);
        _c.copy(vt).sub(m.vel);
        const omega = _a.clone().cross(_c).multiplyScalar(1 / r2);
        const acc = omega.cross(m.vel).multiplyScalar(sp.navConstant);
        const maxA = sp.maxG * G0 * clamp(m.speed / 350, 0.35, 1);
        if (acc.length() > maxA) acc.setLength(maxA);
        // add gravity compensation so the missile does not sag
        m.vel.addScaledVector(acc, dt);
        m.vel.setLength(m.speed);
      }
      // ---- propulsion ----
      if (m.age < sp.boostTime) m.speed = Math.min(sp.maxSpeed, m.speed + sp.boostAccel * dt);
      else m.speed = Math.max(220, m.speed * (1 - (guided ? 0.06 : 0.03) * dt) - (m.vel.y / Math.max(m.speed, 1)) * G0 * dt * 0.4);
      if (m.mode === 'LOST') m.vel.y -= G0 * dt * 0.5;
      m.vel.setLength(m.speed);
      m.pos.addScaledVector(m.vel, dt);
      // ---- proximity / impact ----
      if (m.age > sp.armTime) {
        for (const u of this.units()) {
          if (!u.alive || u === m.owner && m.age < 3) continue;
          if (m.mode === 'GUIDED' && u !== m.target && u.side === m.owner.side) continue;
          const d = u.pos.distanceTo(m.pos);
          if (d < sp.proximity + u.cfg.radius * 0.5) { this.detonate(m, u); break; }
        }
      }
      if ((m.mode as string) !== 'DONE' && m.pos.y < terrainHeight(m.pos.x, m.pos.z) + 1) this.endMissile(m, null, 'TERRAIN');
      this.updateMissileVisual(m);
    }
    // cull finished missiles
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const m = this.missiles[i];
      if (m.mode === 'DONE') { this.group.remove(m.mesh, m.trail); m.trail.geometry.dispose(); this.missiles.splice(i, 1); }
    }
  }

  /** Returns true when the missile still has a valid track this frame. */
  private seek(m: Missile, dt: number): boolean {
    const sp = m.spec, t = m.target!;
    _a.copy(t.pos).sub(m.pos); const range = _a.length();
    const cosOff = _a.normalize().dot(_b.copy(m.vel).normalize());
    const off = Math.acos(clamp(cosOff, -1, 1));
    if (sp.id === 'IR') {
      // pick the brightest source in the seeker cone: target engine vs. live flares near the target
      m.seekTarget.copy(t.pos); m.lockedOnFlare = false;
      let best = t.heat(m.pos) / (1 + (range / 3000) ** 2);
      if (off > sp.seekerHalfAngle) best = 0;
      if (m.age - m.lastSeek > 0.15) {
        m.lastSeek = m.age;
        for (const f of this.flares) if (f.active) {
          _c.copy(f.pos).sub(m.pos); const fr = _c.length();
          if (Math.acos(clamp(_c.normalize().dot(_b), -1, 1)) > sp.seekerHalfAngle) continue;
          const fh = this.flareHeat(f) / (1 + (fr / 3000) ** 2) * (0.75 + this.rng.next() * 0.45);
          if (fh > best) { best = fh; m.lockedOnFlare = true; m.seekTarget.copy(f.pos); }
        }
        if (best < 0.05) return false;
      } else if (m.lockedOnFlare) {
        // follow the flare we locked
        const f = this.flares.find(x => x.active && x.pos.distanceToSquared(m.seekTarget) < 90000);
        if (f) m.seekTarget.copy(f.pos); else m.lockedOnFlare = false;
      }
      return best >= 0.05 || m.lockedOnFlare;
    }
    // radar: datalink from the launcher until the seeker goes active
    if (range < sp.activeRange) m.active = true;
    const shooter = m.owner;
    const guidanceOk = m.active || (shooter.alive && shooter.pos.distanceTo(t.pos) < 90000);
    if (!guidanceOk) return false;
    m.seekTarget.copy(t.pos);
    if (m.active) {
      if (off > sp.seekerHalfAngle) return false;
      // chaff + notching degrade the track (probabilistic, per second)
      const chaff = t.chaffUntil > this.clock ? 0.4 : 0;
      _c.copy(t.vel).normalize();
      const beam = Math.abs(_c.dot(_a.copy(t.pos).sub(m.pos).normalize())) < 0.2 && t.vel.length() > 120 ? 0.4 : 0;
      const q = chaff + beam;
      if (q > 0 && this.rng.next() < dt * q * 0.45) { m.chaffBroke = true; return false; }
    }
    return true;
  }

  private detonate(m: Missile, hit: Unit | null) {
    const sp = m.spec;
    m.mode = 'DONE';
    this.boom(m.pos, 55);
    this.events.onDetonate?.(m.pos.clone(), hit, m);
    for (const u of this.units()) {
      if (!u.alive) continue;
      const d = u.pos.distanceTo(m.pos);
      if (d > sp.blastRadius + u.cfg.radius) continue;
      const f = clamp(1 - 0.55 * (d / (sp.blastRadius + u.cfg.radius)), 0.45, 1);
      this.applyDamage(u, sp.damage * f * (u === hit ? 1.15 : 1) * (m.owner.side === 'hostile' ? 0.75 : 1), m.owner, sp.id);
    }
  }
  private endMissile(m: Missile, _hit: Unit | null, why: string) {
    m.mode = 'DONE';
    if (why === 'TERRAIN') this.boom(m.pos, 28, 0.6);
    this.events.onDetonate?.(m.pos.clone(), null, m);
  }
  private updateMissileVisual(m: Missile) {
    if (m.mode === 'DONE') return;
    m.mesh.position.copy(m.pos);
    _q.setFromUnitVectors(FWD, _a.copy(m.vel).normalize()); m.mesh.quaternion.copy(_q);
    (m.mesh.getObjectByName('flame') as THREE.Sprite).visible = m.age < m.spec.boostTime;
    const N = 40;
    if (m.trailN < N) { m.trailN++; } else m.trailPts.copyWithin(0, 3);
    const k = m.trailN - 1;
    m.trailPts[k * 3] = m.pos.x; m.trailPts[k * 3 + 1] = m.pos.y; m.trailPts[k * 3 + 2] = m.pos.z;
    const attr = m.trail.geometry.getAttribute('position') as THREE.BufferAttribute;
    attr.needsUpdate = true; m.trail.geometry.setDrawRange(0, m.trailN);
  }

  clear() {
    this.bn = 0; this.bulletMesh.count = 0;
    for (const f of this.flares) { f.active = false; f.sprite.visible = false; }
    for (const b of this.booms) { b.active = false; b.sprite.visible = false; }
    for (const m of this.missiles) { this.group.remove(m.mesh, m.trail); m.trail.geometry.dispose(); }
    this.missiles.length = 0;
  }
  /** Used by tests / debug: number of live flares. */
  get activeFlares() { return this.flares.filter(f => f.active).length; }
  /** Distance-weighted threat helper for HUD: the nearest guided missile aimed at u. */
  nearestThreat(u: Unit): Missile | null {
    let best: Missile | null = null, bd = 1e12;
    for (const m of this.threatsTo(u)) { const d = m.pos.distanceToSquared(u.pos); if (d < bd) { bd = d; best = m; } }
    return best;
  }
}
