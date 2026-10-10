import * as THREE from 'three';
import type { Unit } from './Entity';
import type { CameraView } from '../avionics/HUD';
import { Rng, clamp, lerp } from '../util/math';

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _p = new THREE.Vector3(), _t = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _r = new THREE.Vector3();
export const VIEWS: CameraView[] = ['chase', 'cockpit', 'wing', 'orbit', 'front', 'flyby'];
export const VIEW_LABEL: Record<CameraView, string> = { chase: 'CHASE', cockpit: 'COCKPIT', wing: 'WING (side)', orbit: 'ORBIT', front: 'FRONT (looking back)', flyby: 'FLYBY' };

/** Chase (velocity-aware, lagged), cockpit (eye point + head-look) and flyby (spectator) cameras. */
export class CameraRig {
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.3, 90000);
  view: CameraView = 'chase';
  freeLook = false;
  private pos = new THREE.Vector3();
  private offset = new THREE.Vector3();
  private orbitA = 0;
  private lastView: CameraView = 'chase';
  private lookUp = new THREE.Vector3(0, 1, 0);
  private yawOff = 0; private pitchOff = 0;
  private flybyPos = new THREE.Vector3();
  private flybyTimer = 0;
  private flybyBlend = 1;
  private fov = 62;
  private shake = new Rng(5);
  private initialized = false;
  private tmpQuat = new THREE.Quaternion();

  cycle() { this.view = VIEWS[(VIEWS.indexOf(this.view) + 1) % VIEWS.length]; this.flybyTimer = 0; this.flybyBlend = 0; return this.view; }
  setView(v: CameraView) { this.view = v; this.flybyTimer = 0; }
  resize(w: number, h: number) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  snap() { this.initialized = false; }

  update(dt: number, p: Unit, mouseDX: number, mouseDY: number) {
    const m = p.model, cam = this.camera;
    // head-look
    if (this.freeLook) {
      this.yawOff = clamp(this.yawOff - mouseDX * 0.004, -2.4, 2.4);
      this.pitchOff = clamp(this.pitchOff - mouseDY * 0.004, -1.0, 1.2);
    } else { const k = 1 - Math.exp(-dt * 6); this.yawOff = lerp(this.yawOff, 0, k); this.pitchOff = lerp(this.pitchOff, 0, k); }

    const abAmt = m.afterburner ? 1 : 0;
    const targetFov = (this.view === 'cockpit' ? 74 : 62) + abAmt * 9 + clamp(m.mach - 0.6, 0, 0.8) * 8;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(cam.fov - this.fov) > 0.01) { cam.fov = this.fov; cam.updateProjectionMatrix(); }

    const g = Math.abs(m.gLoad), shakeAmt = (Math.max(0, g - 4.5) * 0.012 + abAmt * 0.006 + m.turbulence * 0.06) * (this.view === 'flyby' ? 0 : 1);

    if (this.view === 'cockpit' && p.visual) {
      _p.set(p.cfg.eye[0], p.cfg.eye[1], p.cfg.eye[2]).applyQuaternion(m.q).add(m.pos);
      cam.position.copy(_p);
      _q.copy(m.q);
      _r.set(this.pitchOff, this.yawOff, 0);
      this.tmpQuat.setFromEuler(new THREE.Euler(this.pitchOff, this.yawOff, 0, 'YXZ'));
      cam.quaternion.copy(_q).multiply(this.tmpQuat);
      this.addShake(shakeAmt);
      this.initialized = true;
      return;
    }
    if (this.view === 'chase') {
      m.forward(_f); _u.set(0, 1, 0).applyQuaternion(m.q);
      const speed = m.vel.length();
      // blend nose direction with velocity direction for a stable, velocity-aware follow
      const velDir = speed > 40 ? _t.copy(m.vel).normalize() : _f;
      const dir = new THREE.Vector3().copy(_f).lerp(velDir, 0.55).normalize();
      const dist = 27 + clamp(speed / 300, 0, 1) * 8 + abAmt * 3;
      const yaw = this.yawOff, pit = this.pitchOff;
      const back = new THREE.Vector3().copy(dir).multiplyScalar(-dist);
      back.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
      back.applyAxisAngle(side, -pit);
      const desired = new THREE.Vector3().copy(m.pos).add(back).addScaledVector(_u, 5.5).addScaledVector(new THREE.Vector3(0, 1, 0), 2);
      // spring in the aircraft's frame: translation never lags (so the jet keeps its size), only the offset swings with attitude changes
      desired.sub(m.pos);
      if (!this.initialized) { this.offset.copy(desired); this.lookUp.set(0, 1, 0); }
      this.offset.lerp(desired, 1 - Math.exp(-dt * (m.onGround ? 12 : 3.4)));
      this.pos.copy(m.pos).add(this.offset);
      this.lookUp.lerp(_u, 1 - Math.exp(-dt * 2.2)).normalize();
      cam.position.copy(this.pos);
      _t.copy(m.pos).addScaledVector(dir, 22).addScaledVector(_u, 1.5);
      _m.lookAt(cam.position, _t, this.lookUp);
      cam.quaternion.setFromRotationMatrix(_m);
      this.addShake(shakeAmt);
      this.initialized = true;
      return;
    }
    if (this.view === 'wing' || this.view === 'front' || this.view === 'orbit') {
      let desired: THREE.Vector3;
      if (this.view === 'orbit') { this.orbitA += dt * 0.35; desired = new THREE.Vector3(Math.cos(this.orbitA) * 46, 9, Math.sin(this.orbitA) * 46); }
      else {
        desired = (this.view === 'wing' ? new THREE.Vector3(30, 3.5, -3) : new THREE.Vector3(2.5, 4.5, -38)).applyQuaternion(m.q);   // aircraft-frame offsets (-Z = ahead)
      }
      if (!this.initialized || this.lastView !== this.view) this.offset.copy(desired);
      this.offset.lerp(desired, 1 - Math.exp(-dt * (this.view === 'orbit' ? 8 : 5)));
      cam.position.copy(m.pos).add(this.offset);
      _u.set(0, 1, 0).applyQuaternion(m.q); this.lookUp.lerp(this.view === 'orbit' ? _t.set(0, 1, 0) : _u, 1 - Math.exp(-dt * 2)).normalize();
      _m.lookAt(cam.position, m.pos, this.lookUp); cam.quaternion.setFromRotationMatrix(_m);
      this.lastView = this.view; this.initialized = true;
      return;
    }
    // flyby
    this.flybyTimer -= dt;
    const dist = this.flybyPos.distanceTo(m.pos);
    if (this.flybyTimer <= 0 || dist > 1800 || !this.initialized) {
      m.forward(_f);
      const speed = Math.max(40, m.vel.length());
      const ahead = Math.min(420, speed * 2.5);
      this.flybyPos.copy(m.pos).addScaledVector(_f, ahead);
      const side = new THREE.Vector3().crossVectors(_f, new THREE.Vector3(0, 1, 0)).normalize();
      this.flybyPos.addScaledVector(side, (Math.random() < 0.5 ? -1 : 1) * 70).y += 10 + Math.random() * 25;
      this.flybyPos.y = Math.max(this.flybyPos.y, m.pos.y - 40);
      this.flybyTimer = 6;
    }
    cam.position.lerp(this.flybyPos, this.initialized ? 1 - Math.exp(-dt * 4) : 1);
    _m.lookAt(cam.position, m.pos, new THREE.Vector3(0, 1, 0));
    cam.quaternion.slerp(this.tmpQuat.setFromRotationMatrix(_m), this.initialized ? 1 - Math.exp(-dt * 6) : 1);
    this.initialized = true;
  }

  private addShake(a: number) {
    if (a <= 0.0005) return;
    this.camera.position.x += this.shake.signed() * a; this.camera.position.y += this.shake.signed() * a; this.camera.position.z += this.shake.signed() * a;
  }
}
