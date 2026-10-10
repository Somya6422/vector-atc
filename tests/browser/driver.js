// Browser QA driver (dev server only): `const D = await import('/tests/browser/driver.js')`.
// It drives the REAL game session through its public state (fc fields + session.update) so the whole mission can be
// exercised even when the preview tab throttles requestAnimationFrame. No game state is faked: physics, AI, weapons and
// the mission director run exactly as in play.
import { Autopilot } from '/src/flight/Autopilot.ts';
import { cxMain, cxAlt, BLIZZARD, terrainHeight } from '/src/world/Heightfield.ts';
import { terrainAvoid } from '/src/ai/Maneuvers.ts';

export const wrap = a => ((a + 540) % 360) - 180;
export const ctx = () => { const g = window.__vz, s = g.session; return { g, s, m: s.player.model, d: s.director, fc: s.fc }; };

export async function drive(secs, fn, step = 1 / 60) {
  const { g, s } = ctx();
  s.fc.update = () => {};                           // bypass keyboard interpretation; we set stick values directly
  for (let t = 0; t < secs; t += step) {
    const stop = fn(t);
    s.update(step);
    if (stop === true) return t;
    if (g.fsm.state !== 'TAKEOFF' && g.fsm.state !== 'ACTIVE_MISSION') return -1;
  }
  return secs;
}

export async function launch(route, mission = 'm01') {
  for (let i = 0; i < 200 && !(window.__vz && window.__vz.fsm.state === 'MAIN_MENU'); i++) await new Promise(r => setTimeout(r, 100));
  const g = window.__vz;
  await g.debugLaunch(route, mission);
  return ctx();
}

export async function startEngines() {
  const { g, s, d } = ctx();
  g.input.inject('KeyF', true); s.update(1 / 60); g.input.inject('KeyF', false);
  await drive(9, () => d.startupProgress >= 1 && d.objectives.find(o => o.id === 'lineup')?.state === 'active');
}

export async function taxiToRunway() {
  const { m, fc } = ctx();
  const wps = [[-82, 1300], [-82, 1200], [-70, 1182], [-30, 1180], [-6, 1176]];
  let wi = 0;
  await drive(150, () => {
    const [tx, tz] = wps[wi]; const dx = tx - m.pos.x, dz = tz - m.pos.z, dist = Math.hypot(dx, dz);
    if (dist < 14 && wi < wps.length - 1) wi++;
    const err = wrap(Math.atan2(dx, -dz) * 180 / Math.PI - m.heading);
    fc.yaw = Math.max(-1, Math.min(1, err * 0.08)); fc.roll = 0; fc.pitch = 0;
    const sp = m.vel.length(), last = wi === wps.length - 1 && dist < 12;
    fc.throttle = (sp < 7 && !last) ? 0.32 : 0; fc.airbrake = sp > 9 || last;
    return last && sp < 0.6;
  });
  await drive(60, () => {
    const err = wrap(0 - m.heading); fc.yaw = Math.max(-1, Math.min(1, err * 0.05));
    const sp = m.vel.length(); fc.throttle = sp < 3.5 ? 0.3 : 0; fc.airbrake = sp > 5;
    return Math.abs(err) < 4 && sp < 4;
  });
  fc.throttle = 0; fc.airbrake = true; await drive(3, () => {});
}

export async function takeoffAndClimb(maxSecs = 120) {
  const { m, d, fc } = ctx();
  fc.airbrake = false; let rotated = false;
  return drive(maxSecs, () => {
    fc.throttle = 1;
    fc.yaw = m.onGround ? Math.max(-0.4, Math.min(0.4, -wrap(m.heading) * 0.05 - m.pos.x * 0.01)) : 0;
    fc.roll = m.onGround ? 0 : Math.max(-1, Math.min(1, -wrap(m.heading) * 0.05));
    if (m.iasKt >= 135) rotated = true;
    const agl = m.pos.y - 350;
    fc.pitch = rotated ? Math.max(-0.5, Math.min(0.7, (11 - m.pitchDeg) * 0.08)) : 0;
    if (!m.onGround && agl > 30) fc.gearDown = false;
    if (!m.onGround && agl > 400) fc.pitch = Math.max(-0.5, Math.min(0.5, (9 - m.pitchDeg) * 0.08));
    return d.phase !== 'P1_TAKEOFF';
  });
}

/** Fly with the autopilot along a path function z -> x (valley centre-line). `until(ctx)` ends the leg. */
export async function flyPath(centre, { dir = -1, alt = 1300, speed = 230, lookahead = 3500, until, maxSecs = 400, aglMin = 350, onTick, maxDown = 8 } = {}) {
  const c = ctx(); const { m, fc } = c; const ap = new Autopilot();
  return drive(maxSecs, (t) => {
    const lz = m.pos.z + dir * lookahead; const lx = centre(lz);
    const hdg = Math.atan2(lx - m.pos.x, -(lz - m.pos.z));
    // terrain-following altitude: stay above terrain ahead
    let ground = 0; for (let k = 0; k <= 8; k++) ground = Math.max(ground, terrainHeight(m.pos.x + (lx - m.pos.x) * k / 8, m.pos.z + (lz - m.pos.z) * k / 8));
    const wantAlt = Math.max(alt, ground + aglMin);
    const gam = Math.max(-maxDown, Math.min(12, (wantAlt - m.pos.y) * 0.02)) * Math.PI / 180;
    const ctl = ap.navigate(m, hdg, gam, speed, 1 / 60, { bankMax: 50 * Math.PI / 180 });
    fc.pitch = ctl.pitch; fc.roll = ctl.roll; fc.yaw = 0; fc.throttle = ctl.throttle; fc.gearDown = false; fc.airbrake = m.tas > speed + 15;
    const tav = terrainAvoid(m, ap, 1 / 60, 260);   // the test pilot keeps a GCAS-style safety net so a controller quirk cannot decide the run
    if (tav) { fc.pitch = tav.pitch; fc.roll = tav.roll; fc.throttle = tav.throttle; fc.airbrake = false; }
    onTick?.(t, c);
    return until?.(c, t) === true;
  });
}

export const valley = z => cxMain(z);
export const altRoute = z => cxAlt(z);
export const snapshot = () => {
  const { g, s, m, d } = ctx();
  return {
    state: g.fsm.state, phase: d.phase, t: +d.t.toFixed(0), pos: [m.pos.x | 0, m.pos.y | 0, m.pos.z | 0], iasKt: m.iasKt | 0, hdg: m.heading | 0, hull: s.player.health | 0, fuel: m.fuel | 0,
    obj: d.objectives.map(o => `${o.id}:${o.state}${o.detail ? '(' + o.detail + ')' : ''}`), wing: [s.wingAI.state, s.wingman.health | 0, s.wingAI.separation | 0],
    drones: s.drones.map(x => [x.id, x.dormant ? 'dormant' : x.alive ? 'alive' : 'dead', x.health | 0]), bandit: s.bandits.map(b => b.state),
    detect: +d.detect.toFixed(0), alerted: d.alerted, dlg: g.dialogue.history.slice(-3).map(h => `${h.speaker}: ${h.text}`), errors: g.errors.slice(-3),
  };
};
export { BLIZZARD };

/** Combat controller used by QA: select + lock + fire with the real input path, steer with the autopilot's pursuit law. */
export async function attack({ secs = 120, speed = 240, log = [], useFlares = true, preferWeapon = null } = {}) {
  const c = ctx(); const { g, s, m, fc } = c; const ts = s.targeting; const ap = new Autopilot();
  const press = k => { g.input.inject(k, true); g.input.inject(k, false); };
  let cd = 0;
  const THREE_dir = new (m.pos.constructor)();
  return drive(secs, (t) => {
    cd -= 1 / 60;
    if (!s.drones.some(d => d.alive)) return true;
    if ((!ts.selected || !ts.selected.alive) && cd <= 0) { press('KeyR'); cd = 0.5; }
    const tg = ts.selected; const con = ts.selectedContact;
    if (tg) {
      const range = tg.pos.distanceTo(m.pos);
      const want = preferWeapon ?? (range > 7000 ? 'RADAR' : range > 1300 ? 'IR' : 'GUN');
      if (ts.weapon !== want && cd <= 0) { press('KeyT'); cd = 0.3; }
      THREE_dir.copy(tg.pos).sub(m.pos);
      if (ts.weapon === 'GUN') { const l = ts.lead(); if (l) THREE_dir.copy(l.aim).sub(m.pos); }
      THREE_dir.normalize();
      const ctl = ap.pointAt(m, THREE_dir, 1, speed, 1 / 60, range > 12000);
      fc.pitch = ctl.pitch; fc.roll = ctl.roll; fc.yaw = ctl.yaw; fc.throttle = ctl.throttle; fc.gearDown = false; fc.airbrake = false;
      if (ts.weapon === 'GUN') {
        const off = con ? con.offBoresight * 57.3 : 99;
        if (range < 1100 && off < 6) g.input.inject('Space', true); else g.input.inject('Space', false);
      } else {
        g.input.inject('Space', false);
        if (cd <= 0 && ts.launchCheck().ok) { press('Space'); cd = 2.5; log.push(`t=${t.toFixed(0)} FIRE ${ts.weapon} range=${range | 0}`); }
      }
    } else {
      // nothing selected: turn toward the nearest live drone so it enters the radar scan sector
      const nd = s.drones.filter(x => x.alive).sort((a, b) => a.pos.distanceTo(m.pos) - b.pos.distanceTo(m.pos))[0];
      const hd = nd ? Math.atan2(nd.pos.x - m.pos.x, -(nd.pos.z - m.pos.z)) : m.heading * Math.PI / 180;
      const ctl = ap.navigate(m, hd, nd ? Math.max(-0.1, Math.min(0.1, (nd.pos.y - m.pos.y) * 0.0004)) : 0, speed, 1 / 60, { bankMax: 60 * Math.PI / 180 });
      fc.pitch = ctl.pitch; fc.roll = ctl.roll; fc.throttle = ctl.throttle; fc.yaw = 0;
    }
    const tav = terrainAvoid(m, ap, 1 / 60, 260);
    if (tav) { fc.pitch = tav.pitch; fc.roll = tav.roll; fc.throttle = tav.throttle; g.input.inject('Space', false); }
    if (useFlares && s.weapons.threatsTo(s.player).length && cd <= 0) { press('KeyX'); cd = 0.8; log.push(`t=${t.toFixed(0)} FLARES (missile inbound)`); }
    if (t % 8 < 1 / 60) log.push([t | 0, 'z' + (m.pos.z | 0), 'sel:' + (tg?.id || '-'), ts.weapon, ts.lock, 'hp' + (s.player.health | 0), 'drones:' + s.drones.map(x => x.alive ? x.health | 0 : 'X').join('/'), 'bandits:' + s.bandits.map(b => b.state).join('/'), 'msl:' + s.weapons.missiles.length, 'wing:' + s.wingAI.state + ':' + (s.wingman.health | 0)].join(' '));
    return !s.player.alive || m.crashed;
  });
}

/** Return-to-base: follow the valley south, capture the IAF, then fly a 3-degree ILS-style final and stop on the runway. */
export async function landFromNorth({ log = [], speedKt = 128 } = {}) {
  const { m, fc, s, d } = ctx(); const ap = new Autopilot(); const rad = Math.PI / 180;
  const FIELD = 350;
  // leg 1: valley south to z=-6500
  await flyPath(valley, { dir: 1, alt: 750, speed: 150, aglMin: 250, lookahead: 2500, maxDown: 14, until: c => c.m.pos.z > -9500 || c.s.player.model.crashed, maxSecs: 200 });
  // leg 2: IAF at 3.6 km before the threshold, gear down
  const iaf = { x: 0, z: -6400, alt: 680 };
  await drive(120, () => {
    const dx = iaf.x - m.pos.x, dz = iaf.z - m.pos.z; const hdg = Math.atan2(dx, -dz);
    const gam = Math.max(-5, Math.min(5, (iaf.alt - m.pos.y) * 0.02)) * rad;
    const c = ap.navigate(m, hdg, gam, 80, 1 / 60, { useIas: true, gearDown: true, bankMax: 35 * rad });
    fc.pitch = c.pitch; fc.roll = c.roll; fc.throttle = c.throttle; fc.yaw = 0; fc.gearDown = true; fc.airbrake = m.ias > 95;
    return Math.hypot(dx, dz) < 450 || m.crashed;
  });
  // leg 3: final
  let landedAt = null;
  await drive(260, (t) => {
    const dz = -1200 - m.pos.z; const lat = -m.pos.x;     // heading south: right = -x ; lateral(+right) = -x
    const lateral = -m.pos.x;
    const gsAlt = FIELD + Math.max(0, dz + 320) * Math.tan(3 * rad);
    const agl = m.pos.y - m.cfg.gearHeight - FIELD;
    if (!m.onGround) {
      const flare = agl < 16 && dz < 900;
      const gsErr = m.pos.y - gsAlt;
      const gam = flare ? -0.7 * rad : Math.max(-5 * rad, Math.min(-0.5 * rad, (-3 - gsErr * 0.07) * rad));
      const hdgCmd = (180 - Math.max(-30, Math.min(30, Math.atan(lateral / Math.max(600, dz * 0.6)) / rad))) * rad;
      const c = ap.navigate(m, hdgCmd, gam, flare ? 60 : (speedKt / 1.944), 1 / 60, { useIas: true, gearDown: true, bankMax: 25 * rad });
      fc.pitch = c.pitch; fc.roll = c.roll; fc.throttle = flare ? 0 : c.throttle; fc.yaw = 0; fc.gearDown = true; fc.airbrake = false;
    } else {
      fc.pitch = m.pitchDeg > 1 ? -0.25 : 0; fc.roll = 0; fc.yaw = Math.max(-0.3, Math.min(0.3, -lateral * 0.01)); fc.throttle = 0; fc.airbrake = true; landedAt ??= t;
    }
    if (t % 12 < 1 / 60) log.push([t | 0, 'dz' + (dz | 0), 'lat' + (lateral | 0), 'agl' + (agl | 0), 'kt' + (m.iasKt | 0), 'vs' + m.vel.y.toFixed(1), d.phase].join(' '));
    return d.phase === 'P6_DEBRIEF' || m.crashed;
  });
  return landedAt;
}

/** Launch and teleport the player into stable airborne flight (QA convenience for visual checks). */
export async function quickFlight(route = 'A_BOY_SU57', { x = -420, y = 900, z = -8000, kt = 200 } = {}) {
  const g = window.__vz; await launch(route); const s = g.session, m = s.player.model;
  g.input.inject('KeyF', true); await new Promise(r => setTimeout(r, 150)); g.input.inject('KeyF', false); await new Promise(r => setTimeout(r, 150));
  s.director.startupProgress = 1; m.startEngines(); m.engineN = 0.8; m.setHeadingPlace(x, y, z, 0, 2, kt / 1.944); m.gearPos = 0; s.fc.gearDown = false; s.fc.throttle = 0.7; m.onGround = false;
  const w = s.wingman.model; w.setHeadingPlace(x + 150, y - 10, z + 130, 0, 2, kt / 1.944); w.onGround = false; w.gearPos = 0; w.engineN = 0.8; s.wingAI.state = 'FORMATION';
  return { g, s, m };
}
