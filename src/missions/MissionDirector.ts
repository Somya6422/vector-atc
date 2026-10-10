import type { Unit } from '../game/Entity';
import type { Route, Grade } from '../persistence/SaveManager';
import { BLIZZARD, placeBlizzard, FIELD_ELEV, RADAR_SITES, WAYPOINTS, WORLD, ALT_ROUTE_POINT, lineOfSight, radarSiteAlt, terrainHeight, blizzardAt, RUNWAY } from '../world/Heightfield';
import { approachInfo } from '../world/Landing';
import type { OutcomeKind } from '../story/Script';
import { DEG, FT, KT, clamp } from '../util/math';

export type MissionId = 'm01' | 'school';
export type Phase = 'P1_TAKEOFF' | 'P2_TRANSIT' | 'P3_INTERCEPT' | 'P4_BLIZZARD' | 'P5_RTB' | 'P6_DEBRIEF' | 'FAILED';
export type ObjState = 'pending' | 'active' | 'done' | 'failed';
export interface Objective { id: string; text: string; state: ObjState; detail?: string; }
export interface NavPoint { id: string; name: string; x: number; y: number; z: number; kind: 'wp' | 'field' | 'beacon' | 'main' | 'alt'; }
export type FailReason = 'CRASH' | 'WINGMAN_LOST' | 'FUEL' | null;

export interface MissionStats {
  time: number; kills: number; bvrKills: number; gunKills: number; irKills: number; escaped: number;
  maxDetect: number; detected: boolean; maskedTime: number; exposedTime: number;
  missileHitsTaken: number; flaresUsed: number; rescues: number;
  route: 'NONE' | 'MAIN' | 'ALT'; stormTime: number; wingmanSeparatedTime: number;
  touchdownSink: number; touchdownKt: number; hardLanding: boolean; landed: boolean;
  fuelAtEnd: number; healthAtEnd: number; wingHealthAtEnd: number; wingLanded: boolean; bingo: boolean;
  shotsFired: number; hits: number; friendlyDamage: number; assistLanding: boolean;
}
export interface MissionResult {
  completed: boolean; failReason: FailReason; score: number; maxScore: number; grade: Grade;
  breakdown: { label: string; points: number }[]; stats: MissionStats; kind: OutcomeKind; title: string;
}

/** Everything the director needs from the running game. */
export interface MissionHost {
  route: Route;
  player: Unit; wingman: Unit; drones: Unit[];
  say(key: string): void;
  sayRole(role: 'GC' | 'BOY' | 'GIRL' | 'P' | 'W', text: string, priority?: 0 | 1 | 2 | 3, key?: string): void;
  getFront(): number; setFront(f: number): void;
  activateDrones(alerted: boolean): void;
  alertDrones(): void;
  setWingmanRtb(on: boolean): void;
  wingmanLanded(): boolean;
  wingmanSeparation(): number;
  setInterference(v: number): void;
  onPhase?(p: Phase): void;
  onObjective?(o: Objective): void;
}

const GRADES: [number, Grade][] = [[0.9, 'S'], [0.78, 'A'], [0.62, 'B'], [0.46, 'C'], [0.3, 'D']];
const CLIMB_ALT = 4000 / FT;          // metres (MSL) – the 4,000 ft initial climb objective

/** Authored mission logic for Operation Cold Threshold. Dynamic events live in DynamicEvents.ts and cannot alter this flow. */
export class MissionDirector {
  phase: Phase = 'P1_TAKEOFF';
  t = 0;
  objectives: Objective[] = [];
  nav: NavPoint[] = [];
  detect = 0;               // 0..100 radar-network detection meter
  alerted = false;
  masked = true;
  startupProgress = 0;      // 0..1
  engineStartRequested = false;
  leaderRolling = false;
  result: MissionResult | null = null;
  readonly stats: MissionStats = {
    time: 0, kills: 0, bvrKills: 0, gunKills: 0, irKills: 0, escaped: 0, maxDetect: 0, detected: false, maskedTime: 0, exposedTime: 0,
    missileHitsTaken: 0, flaresUsed: 0, rescues: 0, route: 'NONE', stormTime: 0, wingmanSeparatedTime: 0, touchdownSink: 0, touchdownKt: 0,
    hardLanding: false, landed: false, fuelAtEnd: 0, healthAtEnd: 0, wingHealthAtEnd: 0, wingLanded: false, bingo: false, shotsFired: 0, hits: 0, friendlyDamage: 0, assistLanding: false,
  };
  private step = {
    lineup: false, rotateCall: false, gearCall: false, climbCall: false, wp1: false, wp2: false, contact: false, idCall: false, frontWarn: 0, interf: false, routeMsg: false,
    storm: false, rtbCall: false, gearDownCall: false, finalCall: false, touchCall: false, stoppedCall: false, wingLandCall: false, detectedCall: false, maskCall: false, lrHint: false, bingoCall: false, startupCall: false,
  };
  private p3Start = 0;
  private p4Start = 0;
  private lastHint = 0;
  private lastProgress = 0;
  private minStormDist = 1e9;
  private completeAt = 0;
  private radarTimer = 0;
  private hintCooldown = 0;

  constructor(private host: MissionHost, readonly id: MissionId = 'm01') {
    this.setObjectives([
      { id: 'start', text: 'Start engines (press F)', state: 'active' },
      { id: 'lineup', text: 'Taxi to Runway 36 and line up', state: 'pending' },
      { id: 'takeoff', text: 'Take off (rotate at 135 kt)', state: 'pending' },
      { id: 'climb', text: 'Retract gear and climb to 4,000 ft', state: 'pending' },
    ]);
    this.nav = [{ id: 'field', name: 'RUNWAY 36', x: 0, y: FIELD_ELEV, z: 1100, kind: 'field' }];
  }

  // ----------------------------------------------------------------- helpers
  private obj(id: string) { return this.objectives.find(o => o.id === id); }
  private setObjectives(list: Objective[]) { this.objectives = list; list.forEach(o => this.host.onObjective?.(o)); }
  private addObjective(o: Objective) { this.objectives.push(o); this.host.onObjective?.(o); }
  private setState(id: string, st: ObjState, detail?: string) {
    const o = this.obj(id); if (!o) return;
    if (o.state === st && o.detail === detail) return;
    o.state = st; if (detail !== undefined) o.detail = detail; this.host.onObjective?.(o);
    this.lastProgress = this.t;
  }
  private enter(p: Phase) { this.phase = p; this.lastProgress = this.t; this.host.onPhase?.(p); }
  get lineupDone() { return this.step.lineup; }
  get lineupPending() { return this.obj('lineup')?.state === 'active'; }
  get activeObjective(): Objective | undefined { return this.objectives.find(o => o.state === 'active'); }

  /** F pressed on the ramp. */
  requestEngineStart() {
    if (this.engineStartRequested || this.phase !== 'P1_TAKEOFF') return false;
    this.engineStartRequested = true; this.host.say('engine_start'); return true;
  }
  /** Reported by the weapons/combat layer. */
  notifyKill(victim: Unit, by: Unit | null, kind: 'GUN' | 'IR' | 'RADAR') {
    if (!victim.id.startsWith('drone')) return;
    if (by === this.host.player) {
      this.stats.kills++;
      if (kind === 'RADAR') this.stats.bvrKills++; else if (kind === 'IR') this.stats.irKills++; else this.stats.gunKills++;
      this.host.say(this.stats.kills >= 2 ? 'splash2' : 'splash1');
    } else if (by === this.host.wingman) { this.host.say('wing_splash'); }
  }
  notifyMissileHit(target: Unit, hostileOwner: boolean) {
    if (target === this.host.player && hostileOwner) this.stats.missileHitsTaken++;
  }
  notifyFlare() { this.stats.flaresUsed++; }
  notifyRescue() { this.stats.rescues++; }

  // ----------------------------------------------------------------- per-frame
  update(dt: number) {
    if (this.phase === 'P6_DEBRIEF' || this.phase === 'FAILED') return;
    this.t += dt; this.stats.time = this.t;
    const h = this.host, p = h.player, pm = p.model, w = h.wingman;

    // ---- global failure conditions ----
    if (pm.crashed) return this.fail(pm.fuel <= 0 && pm.crashCause === 'TERRAIN' ? 'FUEL' : 'CRASH');
    if (!w.alive) { h.say('wingman_lost'); return this.fail('WINGMAN_LOST'); }
    // fuel: flameout is not instant failure – the player may still glide to the runway
    const fuelFrac = pm.fuel / p.cfg.fuelCapacity;
    if (fuelFrac < 0.22 && !this.step.bingoCall) { this.step.bingoCall = true; this.stats.bingo = true; h.say('bingo'); }

    this.updateRadarNetwork(dt);
    this.updateInterference();
    // wingman separation (affects score + callouts)
    if (this.phase === 'P4_BLIZZARD' || this.phase === 'P5_RTB') if (h.wingmanSeparation() > 2800) this.stats.wingmanSeparatedTime += dt;

    switch (this.phase) {
      case 'P1_TAKEOFF': this.p1(dt); break;
      case 'P2_TRANSIT': this.p2(); break;
      case 'P3_INTERCEPT': this.p3(); break;
      case 'P4_BLIZZARD': this.p4(dt); break;
      case 'P5_RTB': this.p5(); break;
    }
  }

  // ----------------------------------------------------------------- phase 1
  private p1(dt: number) {
    const h = this.host, pm = h.player.model, s = this.step;
    if (this.engineStartRequested && this.startupProgress < 1) {
      this.startupProgress = Math.min(1, this.startupProgress + dt / 7);
      if (this.startupProgress >= 1 && !s.startupCall) { s.startupCall = true; h.say(h.route === 'A_BOY_SU57' ? 'startup_done' : 'startup_done_f35'); this.setState('start', 'done'); this.setState('lineup', 'active'); }
    }
    const onRunwayStrip = Math.abs(pm.pos.x) < RUNWAY.halfWid && Math.abs(pm.pos.z) < RUNWAY.halfLen;
    const hdg = pm.heading;
    const aligned = hdg < 20 || hdg > 340;
    if (!s.lineup && this.startupProgress >= 1 && onRunwayStrip && aligned && pm.pos.z > 600 && pm.vel.length() < 30) {
      s.lineup = true; this.setState('lineup', 'done'); this.setState('takeoff', 'active');
      h.say('lineup'); h.say(h.route === 'A_BOY_SU57' ? 'lineup_banter_A' : 'lineup_banter_B');
    }
    this.leaderRolling = s.lineup && pm.onGround && pm.vel.length() > 12;
    if (s.lineup && pm.onGround && pm.iasKt >= 135 && !s.rotateCall) { s.rotateCall = true; h.say('rotate'); }
    if (s.lineup && !pm.onGround && this.obj('takeoff')?.state === 'active') {
      this.setState('takeoff', 'done'); this.setState('climb', 'active', 'Gear UP, altitude 4,000 ft');
    }
    if (!pm.onGround && !pm.gearDown && !s.gearCall && s.rotateCall) { s.gearCall = true; h.say('gear_up'); }
    if (this.obj('climb')?.state === 'active') {
      const alt = pm.pos.y * FT;
      this.obj('climb')!.detail = `Gear ${pm.gearDown ? 'DOWN' : 'UP'} · ${Math.round(alt)} / 4,000 ft`;
      if (!pm.gearDown && pm.pos.y >= CLIMB_ALT) {
        this.setState('climb', 'done'); s.climbCall = true; h.say('climb_done');
        h.say(h.route === 'A_BOY_SU57' ? 'transit_A' : 'transit_B');
        this.p2Begin();
      }
    }
  }

  private p2Begin() {
    this.enter('P2_TRANSIT');
    this.addObjective({ id: 'wp1', text: `Fly the valley low to ${WAYPOINTS.W1.name.replace('WP1 ', '')}`, state: 'active' });
    if (this.id !== 'school') this.addObjective({ id: 'wp2', text: `Continue to ${WAYPOINTS.W2.name.replace('WP2 ', '')} – stay terrain-masked`, state: 'pending' });
    this.nav = [
      { id: 'wp1', name: WAYPOINTS.W1.name, x: WAYPOINTS.W1.x, y: 700, z: WAYPOINTS.W1.z, kind: 'wp' },
      ...(this.id === 'school' ? [] : [{ id: 'wp2', name: WAYPOINTS.W2.name, x: WAYPOINTS.W2.x, y: 800, z: WAYPOINTS.W2.z, kind: 'wp' as const }]),
    ];
  }

  // ----------------------------------------------------------------- phase 2
  private reached(wp: { x: number; z: number }, r = 2800) { const pm = this.host.player.model; return Math.hypot(pm.pos.x - wp.x, pm.pos.z - wp.z) < r; }
  private p2() {
    const h = this.host, s = this.step;
    if (!s.wp1 && this.reached(WAYPOINTS.W1)) {
      s.wp1 = true; this.setState('wp1', 'done'); h.say('wp1');
      // Flight School: practise the circuit only – turn around at Halcyon Gate and land
      if (this.id === 'school') { this.setState('wp2', 'done'); this.p5Begin(); return; }
      this.setState('wp2', 'active');
    }
    if (s.wp1 && !s.wp2 && this.reached(WAYPOINTS.W2, 3200)) {
      s.wp2 = true; this.setState('wp2', 'done'); h.say('wp2'); this.p3Begin();
    }
  }

  // ----------------------------------------------------------------- phase 3
  private p3Begin() {
    this.enter('P3_INTERCEPT'); this.p3Start = this.t;
    this.host.activateDrones(this.alerted);
    this.addObjective({ id: 'find', text: 'Detect and identify the unknown contacts (R to select)', state: 'active' });
    this.addObjective({ id: 'kill', text: 'Neutralise both hostile drones', state: 'pending', detail: '0 / 2' });
    this.nav = [{ id: 'wp3', name: WAYPOINTS.W3.name, x: WAYPOINTS.W3.x, y: 1800, z: WAYPOINTS.W3.z, kind: 'wp' }];
  }
  private p3() {
    const h = this.host, s = this.step;
    const live = h.drones.filter(d => d.alive && !d.removed);
    // contact call when the first drone is within radar range of the player
    if (!s.contact && h.drones.some(d => d.alive && d.pos.distanceTo(h.player.pos) < 38000 && lineOfSight(h.player.pos.x, h.player.pos.y, h.player.pos.z, d.pos.x, d.pos.y, d.pos.z, 400))) { s.contact = true; h.say('contact'); }
    if (!s.idCall && h.drones.some(d => d.identified)) { s.idCall = true; this.setState('find', 'done'); this.setState('kill', 'active'); h.say('id_hostile'); }
    if (s.idCall && !s.lrHint && h.drones.some(d => d.alive && d.pos.distanceTo(h.player.pos) > 12000 && d.pos.distanceTo(h.player.pos) < 36000)) { s.lrHint = true; h.say(h.route === 'A_BOY_SU57' ? 'hint_lr' : 'hint_lr_B'); }
    // escaped drones (fled out of the play area) are removed – the intercept still resolves
    for (const d of h.drones) if (d.alive && !d.removed && d.pos.z < WORLD.minZ + 2200) { d.removed = true; this.stats.escaped++; h.say('drone_escaped'); }
    const dead = h.drones.filter(d => !d.alive).length;
    this.setState('kill', this.obj('kill')!.state === 'pending' ? 'pending' : 'active', `${dead} / ${h.drones.length}`);
    if (live.length === 0) {
      this.setState('find', 'done'); this.setState('kill', 'done', `${dead} / ${h.drones.length}`);
      if (this.stats.escaped === 0) h.say('intercept_done');
      this.p4Begin();
    }
  }

  // ----------------------------------------------------------------- phase 4
  private p4Begin() {
    this.enter('P4_BLIZZARD'); this.p4Start = this.t;
    // the front forms ahead of the formation on the main valley (never on top of it)
    placeBlizzard(this.host.player.pos.z + 5600);
    this.addObjective({ id: 'storm', text: 'Weather front ahead – choose a route and get through it', state: 'active', detail: 'Main valley (blizzard) or east pass (clear)' });
    const mainY = 1300;
    this.nav = [
      { id: 'main', name: 'MAIN VALLEY – BLIZZARD', x: BLIZZARD.x, y: mainY, z: BLIZZARD.z, kind: 'main' },
      { id: 'alt', name: 'EAST PASS – SIGNAL SPUR', x: ALT_ROUTE_POINT.x, y: 1500, z: ALT_ROUTE_POINT.z, kind: 'alt' },
    ];
    this.host.setWingmanRtb(false);
  }
  private p4(dt: number) {
    const h = this.host, s = this.step, pm = h.player.model;
    const tt = this.t - this.p4Start;
    // front builds over ~50 s – timed for ramp only, the resolution depends on where the player flies
    h.setFront(clamp(tt / 50, 0, 1));
    if (tt > 2 && s.frontWarn === 0) { s.frontWarn = 1; h.say('front_warning'); }
    if (tt > 9 && !s.interf) { s.interf = true; h.say(h.route === 'A_BOY_SU57' ? 'interference_W_A' : 'interference_W_B'); }
    if (tt > 17 && !s.routeMsg) { s.routeMsg = true; h.say('route_choice'); h.say('route_choice_hint'); }
    const d = Math.hypot(pm.pos.x - BLIZZARD.x, pm.pos.z - BLIZZARD.z);
    this.minStormDist = Math.min(this.minStormDist, d);
    const local = blizzardAt(pm.pos.x, pm.pos.z, h.getFront());
    if (local > 0.25) { this.stats.stormTime += dt; if (!s.storm) { s.storm = true; h.say('entered_storm'); } }
    // crossed the front: south of the cell
    if (pm.pos.z > BLIZZARD.z + BLIZZARD.radius + 600) {
      this.stats.route = this.minStormDist < BLIZZARD.radius * 0.7 ? 'MAIN' : 'ALT';
      this.setState('storm', 'done', this.stats.route === 'MAIN' ? 'Through the blizzard' : 'East pass');
      h.say(this.stats.route === 'MAIN' ? 'main_route_ok' : 'alt_route_ok');
      this.p5Begin();
    }
  }

  // ----------------------------------------------------------------- phase 5
  private p5Begin() {
    this.enter('P5_RTB');
    this.addObjective({ id: 'rtb', text: 'Return to the airfield', state: 'active' });
    this.addObjective({ id: 'land', text: `Land on the runway: gear down, ~${this.host.player.cfg.touchdownKt} kt touchdown`, state: 'pending' });
    this.addObjective({ id: 'stop', text: 'Roll out and stop on the runway', state: 'pending' });
    this.nav = [{ id: 'field', name: 'AIRFIELD', x: 0, y: FIELD_ELEV, z: 0, kind: 'field' }];
    this.host.setWingmanRtb(true);
    this.host.say('rtb');
  }
  /** Called by the game on every real wheel contact event. */
  notifyTouchdown(sink: number, iasKt: number, hard: boolean, paved: boolean) {
    if (this.phase !== 'P5_RTB' || !paved) return;
    if (this.stats.landed) return;
    this.stats.landed = true; this.stats.touchdownSink = sink; this.stats.touchdownKt = iasKt; this.stats.hardLanding = hard;
    this.setState('rtb', 'done'); this.setState('land', 'done', `${Math.round(iasKt)} kt, sink ${sink.toFixed(1)} m/s`); this.setState('stop', 'active');
    this.host.say(hard ? 'touchdown_hard' : 'touchdown_good');
  }
  private p5() {
    const h = this.host, s = this.step, pm = h.player.model;
    const dist = Math.hypot(pm.pos.x, pm.pos.z);
    if (pm.gearDown && !s.gearDownCall && dist < 14000) { s.gearDownCall = true; h.say('gear_down'); }
    if (!s.finalCall && pm.gearDown && dist < 7000) { s.finalCall = true; h.say(h.route === 'A_BOY_SU57' ? 'final_A' : 'final_B'); }
    if (this.obj('rtb')?.state === 'active') {
      const info = approachInfo(pm.pos.x, pm.pos.y, pm.pos.z, pm.pos.z > 0);
      this.obj('rtb')!.detail = `${(dist / 1000).toFixed(1)} km${pm.gearDown ? '' : ' · GEAR UP'}`;
      if (info.dz < 6000 && !pm.gearDown) this.obj('land')!.detail = 'Extend landing gear (G)';
      else if (this.stats.landed === false) this.obj('land')!.detail = `Speed ${Math.round(pm.iasKt)} kt · target ${h.player.cfg.touchdownKt} kt at touchdown`;
      if (this.obj('land')!.state === 'pending' && dist < 9000) this.setState('land', 'active');
    }
    if (this.stats.landed && pm.onGround && pm.vel.length() < 1.5) {
      if (!s.stoppedCall) { s.stoppedCall = true; this.setState('stop', 'done'); h.say('stopped'); this.completeAt = this.t; }
      // wait briefly for the wingman to land (or be lost) before closing out – bounded so we never hang
      if (h.wingmanLanded() || this.t - this.completeAt > 150) {
        if (h.wingmanLanded() && !s.wingLandCall) { s.wingLandCall = true; h.say('wing_landed'); }
        this.finish();
      }
    }
  }

  // ----------------------------------------------------------------- radar network
  private updateRadarNetwork(dt: number) {
    if (this.phase === 'P1_TAKEOFF' || this.phase === 'P6_DEBRIEF' || this.phase === 'FAILED') return;
    this.radarTimer -= dt; if (this.radarTimer > 0) { this.applyDetect(dt); return; }
    this.radarTimer = 0.25;
    const p = this.host.player.pos;
    let visible = false;
    for (const s of RADAR_SITES) {
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d > s.range) continue;
      if (lineOfSight(s.x, radarSiteAlt(s), s.z, p.x, p.y, p.z, 300)) { visible = true; break; }
    }
    this.masked = !visible;
    this.applyDetect(0.25 * 0 + dt);
  }
  private applyDetect(dt: number) {
    if (this.phase === 'P5_RTB' || this.phase === 'P4_BLIZZARD') { this.masked = true; return; }   // network only matters on ingress
    const agl = this.host.player.pos.y - terrainHeight(this.host.player.pos.x, this.host.player.pos.z);
    if (!this.masked) {
      this.detect = Math.min(100, this.detect + dt * (100 / 14) * (0.6 + agl / 900));
      this.stats.exposedTime += dt;
    } else { this.detect = Math.max(0, this.detect - dt * 6); this.stats.maskedTime += dt; }
    this.stats.maxDetect = Math.max(this.stats.maxDetect, this.detect);
    if (this.detect >= 100 && !this.alerted) {
      this.alerted = true; this.stats.detected = true; this.host.alertDrones(); this.host.say('detected');
    }
    if (this.alerted && this.detect < 25 && !this.step.maskCall) { this.step.maskCall = true; this.host.say('masked'); }
  }

  /** Electronic interference level for the wingman's sensors (0..1). */
  private updateInterference() {
    const f = this.host.getFront();
    if (f <= 0 || this.phase === 'P6_DEBRIEF') { this.host.setInterference(0); return; }
    const w = this.host.wingman.pos;
    const local = blizzardAt(w.x, w.z, f);
    const dist = Math.hypot(w.x - BLIZZARD.x, w.z - BLIZZARD.z);
    const regional = f * clamp(1 - (dist - BLIZZARD.radius) / 7000, 0.35, 1) * 0.5;
    this.host.setInterference(clamp(regional + local * 0.55, 0, 1));
  }

  // ----------------------------------------------------------------- end
  private fail(reason: FailReason) {
    if (this.phase === 'FAILED') return;
    this.enter('FAILED');
    for (const o of this.objectives) if (o.state === 'active' || o.state === 'pending') this.setState(o.id, 'failed');
    this.result = this.score(false, reason);
  }
  private finish() {
    this.enter('P6_DEBRIEF');
    this.result = this.score(true, null);
  }

  /** Mission grade from real events only. */
  score(completed: boolean, failReason: FailReason): MissionResult {
    const h = this.host, st = this.stats;
    st.fuelAtEnd = h.player.model.fuel / h.player.cfg.fuelCapacity;
    st.healthAtEnd = h.player.healthFrac; st.wingHealthAtEnd = h.wingman.healthFrac; st.wingLanded = h.wingmanLanded();
    st.shotsFired = h.player.shotsFired; st.hits = h.player.hits;
    const b: { label: string; points: number }[] = [];
    const add = (label: string, points: number) => { b.push({ label, points: Math.round(points) }); };
    const school = this.id === 'school';
    const MAX = school ? 2400 : 5600;
    if (completed) add('Mission complete', 1200);
    if (!school) add(`Hostile drones destroyed (${st.kills}/${h.drones.length})`, st.kills * 500);
    if (st.bvrKills) add('Long-range missile kill', st.bvrKills * 200);
    if (st.gunKills) add('Cannon kill', st.gunKills * 100);
    if (completed || h.wingman.alive) add('Wingman survived', h.wingman.alive ? 300 + 600 * st.wingHealthAtEnd : 0);
    if (completed) add('Aircraft condition', 500 * st.healthAtEnd);
    if (completed && st.landed) {
      const q = st.touchdownSink < 1.8 ? 450 : st.touchdownSink < 3 ? 300 : st.touchdownSink < 4.5 ? 150 : 40;
      add('Landing quality', q);
      add(`Touchdown speed (target ${h.player.cfg.touchdownKt} kt)`, Math.max(0, 150 - Math.abs(st.touchdownKt - h.player.cfg.touchdownKt) * 5));
    }
    if (school) { /* no radar network exercise in flight school */ }
    else if (!st.detected && st.exposedTime + st.maskedTime > 0) add('Stayed undetected by the radar network', 300);
    else if (st.maskedTime + st.exposedTime > 0) add('Terrain masking (partial)', 300 * clamp(st.maskedTime / (st.maskedTime + st.exposedTime), 0, 1) * 0.5);
    if (st.route === 'ALT') add('Blizzard: east pass (safe)', 250);
    if (st.route === 'MAIN') add('Blizzard: main valley run', 450);
    if (completed && !school) add('Time bonus', clamp(1 - (st.time - 600) / 600, 0, 1) * 400);
    if (st.rescues) add('Wingman rescues', st.rescues * 150);
    if (st.missileHitsTaken) add('Missile hits taken', -st.missileHitsTaken * 120);
    if (st.assistLanding) add('Autoland assist used (voice)', -300);
    if (st.fuelAtEnd < 0.08 && completed) add('Fuel margin penalty', -150);
    const score = Math.max(0, b.reduce((s, x) => s + x.points, 0));
    let grade: Grade = 'F';
    if (completed) { grade = 'D'; for (const [th, g] of GRADES) if (score / MAX >= th) { grade = g; break; } }
    // narrative outcome variant – decided from real stats
    let kind: OutcomeKind;
    if (!completed) kind = failReason === 'WINGMAN_LOST' ? 'FAIL_WING' : failReason === 'FUEL' ? 'FAIL_FUEL' : 'FAIL_CRASH';
    else if (st.rescues > 0 || st.wingHealthAtEnd < 0.5) kind = 'RESCUE';
    else if (st.healthAtEnd < 0.5) kind = 'DAMAGED_RETURN';
    else if (st.route === 'MAIN') kind = 'STORM_RUN';
    else if (st.healthAtEnd >= 0.9 && st.wingHealthAtEnd >= 0.9 && st.missileHitsTaken === 0) kind = 'FLAWLESS';
    else kind = 'CLOSE_CALL';
    const titles: Record<OutcomeKind, string> = {
      FLAWLESS: 'Flawless Intercept', DAMAGED_RETURN: 'Damaged But Home', RESCUE: 'Wingman Saved', STORM_RUN: 'Through the Storm', CLOSE_CALL: 'Mission Complete',
      FAIL_CRASH: 'Aircraft Lost', FAIL_WING: 'Wingman Lost', FAIL_FUEL: 'Fuel Exhausted',
    };
    void KT; void DEG;
    return { completed, failReason, score, maxScore: MAX, grade, breakdown: b, stats: { ...st }, kind, title: titles[kind] };
  }

  // ----------------------------------------------------------------- guidance + hints
  /** Ground Control hint for the current objective at level 1 (subtle), 2 (helpful) or 3 (direct). */
  hint(level: 1 | 2 | 3): string {
    const h = this.host, pm = h.player.model;
    const o = this.activeObjective?.id ?? '';
    const T: Record<string, [string, string, string]> = {
      start: ['Ground: Engines are cold.', 'Ground: Press F on the ramp to begin the engine start sequence.', 'Ground: Press F now. Wait for both engines to stabilise, then taxi along the yellow line to the runway.'],
      lineup: ['Ground: Taxiway leads to the runway threshold.', 'Ground: Follow the taxiway north, turn right at the connector, then turn left onto runway 36 and stop on the centreline, nose north. Use A/D or Q/E to steer, B brakes.', 'Ground: The aircraft rolls forward by itself once the engines run; steer with the roll or yaw keys, brake with the brake key. Follow the blue lights, turn left at the connector onto the runway centreline facing north and hold.'],
      takeoff: ['Ground: Runway is clear.', 'Ground: Push the throttle to maximum (hold the throttle-up key), rotate at 135 knots with a gentle pull (nose-up key).', 'Ground: Hold the throttle-up key for full power. At 135 kt gently hold the nose-up key until the nose is about 10 degrees up. Do not over-rotate.'],
      climb: ['Ground: Positive rate, clean up.', 'Ground: Raise the landing gear with G and keep climbing through 4,000 feet.', 'Ground: Press G to retract the gear, hold the nose at 10 degrees up and climb to 4,000 feet.'],
      wp1: ['Ground: The valley will hide you from the ridge radars.', 'Ground: Fly north along the valley floor; keep the mountains between you and the radar sites (detection meter on the HUD).', `Ground: Fly north to Halcyon Gate (${Math.round(Math.hypot(WAYPOINTS.W1.x - pm.pos.x, WAYPOINTS.W1.z - pm.pos.z) / 1000)} km). Stay below the ridge line.`],
      wp2: ['Ground: Red Bridge is next.', 'Ground: Follow the valley to the red bridge. Watch your terrain clearance.', 'Ground: Continue north to Red Bridge and stay low in the valley.'],
      find: ['Ground: Watch your radar for contacts ahead.', 'Ground: Keep your nose toward the north. Press R to select a contact. Hold it within 30 degrees and under 12 km to identify it.', 'Ground: Press R to select the nearest contact and keep it in front of you until the ID bar fills.'],
      kill: ['Ground: Weapons are free.', 'Ground: Press T to select a weapon. LR for long range, IR for close. Wait for a steady LOCK tone, then press Space. Guns inside 1000 m.', 'Ground: Press T until LR is selected, hold the target inside 30 degrees until LOCK, then press Space. Use X for flares if a missile is launched at you.'],
      storm: ['Ground: Weather is closing the valley.', 'Ground: The main valley is blocked by the blizzard. The east pass is clear: head for the beacon at Signal Spur.', 'Ground: Turn east toward the beacon on the HUD (EAST PASS) and follow the valley south, staying clear of the snow.'],
      rtb: ['Ground: Fuel and weather are clear at base.', 'Ground: Turn for the airfield. Extend the gear (G) about 8 km out and line up with the runway.', 'Ground: Fly to the field, lower the gear with G, hold 140 kt on a three-degree glideslope and touch down at about the target speed.'],
      land: ['Ground: Gear, speed, glideslope.', 'Ground: Use the glide-slope cue on the HUD. Reduce throttle and flare gently over the threshold.', 'Ground: Follow the HUD glideslope marker, gear down, 130 kt on final, ease the nose up just before touchdown, then throttle idle and hold B to brake.'],
      stop: ['Ground: Slow down on the runway.', 'Ground: Throttle idle and hold B to brake to a stop.', 'Ground: Hold B to apply the wheel brakes until the aircraft has stopped.'],
    };
    return (T[o] ?? ['Ground: Stay alert.', 'Ground: Check your objectives (M).', 'Ground: Follow the mission objectives on the HUD.'])[level - 1];
  }

  /** Auto-hint driver: if the player stalls on an objective, Ground Control offers hints of the configured level. */
  autoHint(dt: number, maxLevel: number): string | null {
    if (maxLevel <= 0) return null;
    this.hintCooldown -= dt; if (this.hintCooldown > 0) return null;
    const idle = this.t - this.lastProgress;
    let level: 1 | 2 | 3 | 0 = 0;
    if (idle > 30) level = 1; if (idle > 60) level = 2; if (idle > 100) level = 3;
    if (!level) return null;
    this.hintCooldown = 25;
    return this.hint(Math.min(level, maxLevel) as 1 | 2 | 3);
  }
}
