import * as THREE from 'three';
import { Rng, clamp } from '../util/math';

/**
 * Nyx – the protected companion. A real state machine with movement (not a label):
 *   IDLE_GROOM → STRETCH_PAWS → PERCH_JACKET (sleep on the boy's flight jacket) → FOLLOW_ACTOR
 * Nyx is only ever placed in the hangar. She never flies and is never a target (see `isProtected`).
 */
export type NyxState = 'IDLE_GROOM' | 'STRETCH_PAWS' | 'PERCH_JACKET' | 'FOLLOW_ACTOR';
export type NyxAnim = 'sit' | 'walk' | 'run' | 'groom' | 'stretch' | 'sleep';
export interface V2 { x: number; z: number; }

export interface NyxContext {
  boy: V2;              // the boy pilot (player or NPC)
  player: V2;           // player-controlled actor
  playerIsBoy: boolean;
  jacket: V2;           // flight jacket location
}

export type NyxEvent = 'meow' | 'purr_start' | 'purr_stop' | 'state' | 'greet';

export class NyxBrain {
  readonly isProtected = true as const;
  state: NyxState = 'PERCH_JACKET';
  anim: NyxAnim = 'sleep';
  pos: V2;
  heading = 0;
  stateTime = 0;
  purring = false;
  bond = 20;
  tailSwish = 0;
  readonly history: NyxState[] = [];
  private nextIdle = 7;
  private groomCount = 0;
  private lastMeow = -99;
  private clock = 0;
  private rng: Rng;
  private greetRun = 0;
  private forcedFollow = 0;
  private purrFor = 0;
  onEvent?: (e: NyxEvent, detail?: string) => void;

  constructor(start: V2, seed = 3, bond = 20) {
    this.pos = { ...start }; this.rng = new Rng(seed); this.bond = bond; this.history.push(this.state);
  }

  private setState(s: NyxState) {
    if (s === this.state) return;
    this.state = s; this.stateTime = 0; this.history.push(s);
    if (this.history.length > 50) this.history.shift();
    if (s === 'IDLE_GROOM') { this.anim = 'sit'; this.groomCount = 0; this.nextIdle = this.rng.range(4, 8); }
    if (s === 'STRETCH_PAWS') this.anim = 'stretch';
    if (s === 'PERCH_JACKET') this.anim = 'walk';
    if (s === 'FOLLOW_ACTOR') this.anim = 'walk';
    this.onEvent?.('state', s);
  }

  /** The player pressed F near the cat. Returns a short description for the UI/dialogue. */
  interact(playerIsBoy: boolean): string {
    this.lastMeow = this.clock; this.onEvent?.('meow');
    this.bond = clamp(this.bond + (playerIsBoy ? 3 : 1), 0, 100);
    if (playerIsBoy) {
      this.purring = true; this.purrFor = 8; this.onEvent?.('purr_start');
      if (this.state === 'PERCH_JACKET' || this.state === 'IDLE_GROOM') this.setState('STRETCH_PAWS');
      this.forcedFollow = 25;
      return 'Nyx wakes, stretches and trots after you.';
    }
    // the girl: a polite head-bump and a brief purr – but Nyx still prefers the boy
    this.purring = true; this.purrFor = 3; this.onEvent?.('purr_start');
    if (this.state === 'PERCH_JACKET') this.setState('STRETCH_PAWS');
    this.forcedFollow = 25;
    return 'Nyx purrs for a moment... then pads off toward the boy.';
  }

  /** Mission return: run to the boy and make a fuss. */
  greetReturn() { this.greetRun = 6; this.forcedFollow = 30; this.onEvent?.('greet'); this.onEvent?.('meow'); if (this.state === 'PERCH_JACKET' || this.state === 'IDLE_GROOM') this.setState('STRETCH_PAWS'); }

  distanceTo(p: V2) { return Math.hypot(p.x - this.pos.x, p.z - this.pos.z); }

  private moveToward(t: V2, speed: number, dt: number, stop: number): boolean {
    const dx = t.x - this.pos.x, dz = t.z - this.pos.z, d = Math.hypot(dx, dz);
    if (d <= stop) return true;
    const step = Math.min(speed * dt, d - stop);
    this.pos.x += (dx / d) * step; this.pos.z += (dz / d) * step;
    const want = Math.atan2(dx, dz);
    let diff = want - this.heading; while (diff > Math.PI) diff -= 2 * Math.PI; while (diff < -Math.PI) diff += 2 * Math.PI;
    this.heading += diff * Math.min(1, dt * 8);
    return false;
  }

  update(dt: number, ctx: NyxContext) {
    this.clock += dt; this.stateTime += dt;
    if (this.purrFor > 0) { this.purrFor -= dt; if (this.purrFor <= 0 && this.state !== 'PERCH_JACKET') { this.purring = false; this.onEvent?.('purr_stop'); } }
    if (this.forcedFollow > 0) this.forcedFollow -= dt;
    if (this.greetRun > 0) this.greetRun -= dt;
    const dBoy = this.distanceTo(ctx.boy);
    const boyNear = dBoy < 9;
    this.tailSwish += dt * (this.state === 'FOLLOW_ACTOR' ? 7 : this.anim === 'sleep' ? 0.6 : 2.4);

    switch (this.state) {
      case 'PERCH_JACKET': {
        const arrived = this.moveToward(ctx.jacket, 1.4, dt, 0.25);
        if (!arrived) { this.anim = 'walk'; break; }
        if (this.anim !== 'sleep') { this.anim = 'sleep'; this.purring = true; this.onEvent?.('purr_start'); }
        // the cat recognises the boy and wakes for him
        if (boyNear && dBoy < 6 || this.forcedFollow > 0) { this.purring = false; this.onEvent?.('purr_stop'); this.setState('STRETCH_PAWS'); }
        break;
      }
      case 'STRETCH_PAWS': {
        this.anim = 'stretch';
        if (this.stateTime > 2.6) this.setState(boyNear || this.forcedFollow > 0 ? 'FOLLOW_ACTOR' : 'IDLE_GROOM');
        break;
      }
      case 'IDLE_GROOM': {
        this.anim = this.stateTime % 6 < 3.5 ? 'groom' : 'sit';
        if (boyNear && dBoy < 7 || this.forcedFollow > 0) { this.setState('FOLLOW_ACTOR'); break; }
        if (this.stateTime > this.nextIdle) {
          this.groomCount++;
          if (this.groomCount >= 2 || this.rng.next() < 0.4) { this.setState(this.rng.next() < 0.5 ? 'STRETCH_PAWS' : 'PERCH_JACKET'); }
          else { this.stateTime = 0; this.nextIdle = this.rng.range(4, 8); }
        }
        break;
      }
      case 'FOLLOW_ACTOR': {
        const fast = this.greetRun > 0 || dBoy > 5;
        const arrived = this.moveToward(ctx.boy, fast ? 3.6 : 1.7, dt, 1.1);
        this.anim = arrived ? 'sit' : fast ? 'run' : 'walk';
        if (arrived) {
          // purr and rub against the boy's leg
          if (!this.purring) { this.purring = true; this.purrFor = 4; this.onEvent?.('purr_start'); }
          if (this.clock - this.lastMeow > 9 && this.rng.next() < dt * 0.3) { this.lastMeow = this.clock; this.onEvent?.('meow'); }
        }
        // lose interest if the boy leaves for long, or settles for a while
        if (dBoy > 16 && this.forcedFollow <= 0) this.setState('PERCH_JACKET');
        else if (arrived && this.stateTime > 30 && this.forcedFollow <= 0) this.setState('IDLE_GROOM');
        break;
      }
    }
  }
}

// ---------------------------------------------------------------- visual actor

export class NyxActor {
  readonly group = new THREE.Group();
  private body: THREE.Mesh; private head: THREE.Group; private tail: THREE.Mesh[] = [];
  private earL: THREE.Mesh; private earR: THREE.Mesh; private eyes: THREE.Mesh[] = [];
  private legs: THREE.Mesh[] = [];
  private frontPawL: THREE.Mesh;
  private t = 0;
  constructor(readonly brain: NyxBrain) {
    this.group.name = 'NYX';
    const fur = new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.9 });
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffb71a, emissive: 0xff9a00, emissiveIntensity: 1.4, roughness: 0.3 });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.28, 6, 12), fur); this.body.rotation.x = Math.PI / 2; this.body.position.set(0, 0.17, 0); this.group.add(this.body);
    this.head = new THREE.Group(); this.head.position.set(0, 0.26, 0.24); this.group.add(this.head);
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 12), fur); this.head.add(skull);
    const snout = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), fur); snout.position.set(0, -0.02, 0.07); this.head.add(snout);
    const earGeo = new THREE.ConeGeometry(0.035, 0.07, 4);
    this.earL = new THREE.Mesh(earGeo, fur); this.earL.position.set(-0.05, 0.085, 0); this.earR = new THREE.Mesh(earGeo, fur); this.earR.position.set(0.05, 0.085, 0);
    this.head.add(this.earL, this.earR);
    for (const sx of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), eyeMat); e.scale.set(1, 1.25, 0.6); e.position.set(sx * 0.035, 0.02, 0.07); this.head.add(e); this.eyes.push(e);
    }
    for (const [x, z] of [[-0.06, 0.15], [0.06, 0.15], [-0.06, -0.15], [0.06, -0.15]]) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.02, 0.16, 6), fur); l.position.set(x, 0.08, z); this.group.add(l); this.legs.push(l);
    }
    this.frontPawL = this.legs[0];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.022 - i * 0.001, 6, 6), fur);
      s.position.set(0, 0.2, -0.3 - i * 0.05); this.group.add(s); this.tail.push(s);
    }
    this.group.traverse(o => { o.castShadow = true; });
    this.group.scale.setScalar(1.25);
  }
  update(dt: number) {
    this.t += dt;
    const b = this.brain;
    this.group.position.set(b.pos.x, 0, b.pos.z);
    this.group.rotation.y = b.heading;
    const sleeping = b.anim === 'sleep';
    const walking = b.anim === 'walk' || b.anim === 'run';
    const k = b.anim === 'run' ? 14 : 8;
    const bob = walking ? Math.sin(this.t * k) * 0.012 : sleeping ? Math.sin(this.t * 1.6) * 0.004 : 0;
    // body pose
    this.body.position.y = (sleeping ? 0.1 : b.anim === 'sit' || b.anim === 'groom' ? 0.15 : 0.17) + bob;
    this.body.rotation.x = Math.PI / 2 + (b.anim === 'sit' || b.anim === 'groom' ? -0.35 : b.anim === 'stretch' ? 0.25 : 0);
    this.body.scale.set(1, 1, sleeping ? 0.8 : 1);
    this.head.position.set(0, sleeping ? 0.12 : b.anim === 'stretch' ? 0.2 : b.anim === 'sit' || b.anim === 'groom' ? 0.3 : 0.26, sleeping ? 0.22 : 0.24 + (b.anim === 'stretch' ? 0.1 : 0));
    this.head.rotation.x = sleeping ? 0.5 : b.anim === 'groom' ? 0.6 + Math.sin(this.t * 8) * 0.12 : b.anim === 'stretch' ? 0.45 : 0;
    this.head.rotation.y = b.anim === 'sit' ? Math.sin(this.t * 0.8) * 0.4 : 0;
    // ears twitch
    this.earL.rotation.z = 0.3 + Math.sin(this.t * 5.3) * (sleeping ? 0.02 : 0.12);
    this.earR.rotation.z = -0.3 - Math.sin(this.t * 4.7 + 1) * (sleeping ? 0.02 : 0.12);
    // eyes: closed when asleep
    for (const e of this.eyes) e.scale.y = sleeping ? 0.08 : 1.25;
    // legs
    this.legs.forEach((l, i) => {
      const ph = (i === 0 || i === 3) ? 0 : Math.PI;
      l.rotation.x = walking ? Math.sin(this.t * k + ph) * 0.7 : 0;
      l.visible = !sleeping;
    });
    if (b.anim === 'stretch') { this.frontPawL.position.z = 0.25; this.legs[1].position.z = 0.25; this.body.position.y = 0.12; this.head.position.y = 0.12; } else { this.legs[0].position.z = 0.15; this.legs[1].position.z = 0.15; }
    // tail chain
    this.tail.forEach((s, i) => { s.position.x = Math.sin(b.tailSwish + i * 0.6) * 0.03 * (i + 1) * 0.5; s.position.y = (sleeping ? 0.08 : 0.2 + i * 0.012); });
  }
}
