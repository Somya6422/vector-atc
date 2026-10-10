/**
 * Natural-language command parser for voice (Wispr Flow dictation or the browser microphone) and typed commands.
 * Pure and deterministic so it is unit-tested. One utterance may hold several commands ("gear up and throttle eighty percent").
 */
export type Cmd =
  | { t: 'throttle'; set?: number; delta?: number }
  | { t: 'gear'; down: boolean } | { t: 'brake'; on: boolean } | { t: 'airbrake'; on: boolean } | { t: 'flares' }
  | { t: 'ap_off' } | { t: 'level' } | { t: 'hold_alt' } | { t: 'hold_hdg' } | { t: 'hold_speed'; kt: number }
  | { t: 'alt'; meters: number } | { t: 'alt_rel'; meters: number }
  | { t: 'turn'; dir: 'left' | 'right'; deg: number } | { t: 'bank'; dir: 'left' | 'right'; deg: number }
  | { t: 'heading'; deg: number } | { t: 'pitch'; deg: number }
  | { t: 'goto_nav' } | { t: 'goto_home' } | { t: 'autoland' } | { t: 'autotakeoff' } | { t: 'taxi' } | { t: 'stop' }
  | { t: 'weapon'; w: 'GUN' | 'IR' | 'RADAR' } | { t: 'target' } | { t: 'fire'; w?: 'GUN' | 'IR' | 'RADAR' } | { t: 'cease' }
  | { t: 'recover' } | { t: 'cobra' } | { t: 'kulbit' } | { t: 'stovl' } | { t: 'ecm' }
  | { t: 'wing'; cmd: 'cover' | 'engage' | 'rejoin' | 'formation' | 'rtb'; f?: 'ECHELON_RIGHT' | 'LINE_ABREAST' | 'TRAIL' } | { t: 'wing_report' }
  | { t: 'report'; what: 'status' | 'fuel' | 'altitude' | 'speed' | 'heading' | 'enemies' | 'airfield' }
  | { t: 'camera'; view?: 'chase' | 'cockpit' | 'wing' | 'tail' | 'orbit' | 'front' | 'target' | 'tactical' | 'tower' | 'cinematic' | 'flyby'; next?: boolean } | { t: 'mouse'; on?: boolean } | { t: 'radar_range'; km: number }
  | { t: 'pause' } | { t: 'resume' } | { t: 'map' } | { t: 'objectives' } | { t: 'hint' } | { t: 'start_engines' } | { t: 'restart' } | { t: 'hangar' } | { t: 'menu' }
  | { t: 'new_campaign' } | { t: 'pick_route'; route: 'A_BOY_SU57' | 'B_GIRL_F35' } | { t: 'launch' } | { t: 'briefing' } | { t: 'continue' } | { t: 'settings' } | { t: 'controls' } | { t: 'credits' } | { t: 'back' } | { t: 'interact' }
  | { t: 'radio'; to: 'ground' | 'wingman'; text: string }
  | { t: 'unknown'; raw: string };

const FT = 0.3048;
const UNITS: Record<string, number> = { zero: 0, oh: 0, one: 1, two: 2, three: 3, tree: 3, four: 4, five: 5, fife: 5, six: 6, seven: 7, eight: 8, nine: 9, niner: 9 };
const TEENS: Record<string, number> = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const isNum = (w: string) => w in UNITS || w in TEENS || w in TENS || w === 'hundred' || w === 'thousand';

function evalWords(ws: string[]): string {
  // "two seven zero" -> 270 (digit-by-digit); "four thousand five hundred" -> 4500; "fifteen hundred" -> 1500
  if (ws.every(w => w in UNITS) && ws.length >= 2) return ws.map(w => UNITS[w]).join('');
  let total = 0, cur = 0;
  for (const w of ws) {
    if (w in UNITS) cur += UNITS[w]; else if (w in TEENS) cur += TEENS[w]; else if (w in TENS) cur += TENS[w];
    else if (w === 'hundred') cur = (cur || 1) * 100; else if (w === 'thousand') { total += (cur || 1) * 1000; cur = 0; }
  }
  return String(total + cur);
}

/** Lower-cases, strips punctuation and converts spoken numbers to digits. */
export function normalize(text: string): string {
  let s = text.toLowerCase().replace(/[“”"',.!?;:()]/g, ' ').replace(/%/g, ' percent ').replace(/\bper cent\b/g, 'percent').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  const toks = s.split(' '), out: string[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (!isNum(toks[i])) { out.push(toks[i]); continue; }
    const run: string[] = [];
    while (i < toks.length && (isNum(toks[i]) || (toks[i] === 'and' && run.length && i + 1 < toks.length && isNum(toks[i + 1]) && run.some(r => r === 'hundred' || r === 'thousand')))) { if (toks[i] !== 'and') run.push(toks[i]); i++; }
    i--; out.push(evalWords(run));
  }
  return out.join(' ');
}

const num = (m: RegExpMatchArray | null, i: number) => (m && m[i] !== undefined ? parseFloat(m[i]) : undefined);
const side = (s: string): 'left' | 'right' => (/\bleft\b/.test(s) ? 'left' : 'right');

/** Parses one already-normalised clause. */
function parseClause(s: string, raw: string): Cmd[] {
  let m: RegExpMatchArray | null;
  const has = (re: RegExp) => re.test(s);

  // ---- game / menu level ----
  if (has(/\b(new campaign|new game|start a new game)\b/)) return [{ t: 'new_campaign' }];
  if ((m = s.match(/\b(?:select|choose|pick|fly as|play as|be|take)\s+(?:the\s+)?(?:specter\s+)?(one|1|two|2|boy|girl|su ?57|f ?35)\b/)) && !has(/\btarget\b/)) {
    const v = m[1]; return [{ t: 'pick_route', route: /^(one|1|boy|su)/.test(v) ? 'A_BOY_SU57' : 'B_GIRL_F35' }];
  }
  if (has(/\b(launch|begin|start|fly)( the)?( mission| operation)\b|\blet'?s go\b|\bscramble\b/) && !has(/engine/)) return [{ t: 'launch' }];
  if (has(/\b(continue campaign|load (my )?game|continue game)\b/)) return [{ t: 'continue' }];
  if (has(/\bbriefing\b/)) return [{ t: 'briefing' }];
  if (has(/\b(go|back|return) (to )?(the )?hangar\b|\bhangar\b/)) return [{ t: 'hangar' }];
  if (has(/\b(main menu|exit to menu|quit to menu|go to menu)\b/)) return [{ t: 'menu' }];
  if (has(/\bsettings\b|\boptions\b/)) return [{ t: 'settings' }];
  if (has(/\b(controls|keyboard|key bindings?|keybinds?|shortcuts?|commands list|show (the )?commands|what can i say|help me with (the )?keys)\b/)) return [{ t: 'controls' }];
  if (has(/\bcredits\b/)) return [{ t: 'credits' }];
  if (has(/^interact$/)) return [{ t: 'interact' }];
  if (has(/^(go )?back$|^close( this| it)?$|^cancel$|^never ?mind$/)) return [{ t: 'back' }];

  // ---- pause / resume / panels ----
  if (has(/\b(pause|hold on|time out|freeze)\b/) && !has(/\bhold (altitude|heading|speed)\b/)) return [{ t: 'pause' }];
  if (has(/\b(resume|unpause|carry on|back to (the )?(game|flight)|continue flying)\b/)) return [{ t: 'resume' }];
  if (has(/\b(map|chart)\b/) && !has(/\bwaypoint\b/)) return [{ t: 'map' }];
  if (has(/\b(objectives?|mission status|what is the mission)\b/)) return [{ t: 'objectives' }];
  if (has(/\b(hint|help me|what should i do|what do i do|what now|advice|guide me)\b/)) return [{ t: 'hint' }];
  if (has(/\b(restart|retry)\b( the)?( mission)?/)) return [{ t: 'restart' }];
  if (has(/\b(start|spool|fire up|light)( up)?( the| my| both)?( engines?| engine start)\b|\bengine start\b|\bstart up\b/)) return [{ t: 'start_engines' }];
  if ((m = s.match(/\bradar range (\d+)/))) return [{ t: 'radar_range', km: parseInt(m[1]) }];

  // ---- reports / questions ----
  if (has(/\b(bogey dope|where (are|is) the (enemy|enemies|bandits?|hostiles?|drones?|contacts?|bogeys?)|threat report|threats|what('?s| is) out there|picture)\b/)) return [{ t: 'report', what: 'enemies' }];
  if (has(/\b(where|which way|how far|bearing)\b.*\b(runway|airfield|home|base|field)\b|\bnearest airfield\b/)) return [{ t: 'report', what: 'airfield' }];
  if (has(/\b(fuel|gas)\b.*\b(status|state|check|level|remaining|left)\b|\bhow much (fuel|gas)\b/)) return [{ t: 'report', what: 'fuel' }];
  if (has(/\bwhat('?s| is) my (altitude|height)\b|\baltitude (check|status)\b/)) return [{ t: 'report', what: 'altitude' }];
  if (has(/\bwhat('?s| is) my (speed|airspeed)\b|\b(speed|airspeed) (check|status)\b/)) return [{ t: 'report', what: 'speed' }];
  if (has(/\bwhat('?s| is) my heading\b|\bheading (check|status)\b/)) return [{ t: 'report', what: 'heading' }];
  if (has(/\b(wingman|specter (one|two|1|2)|two|one)\b.*\b(report|status|check in)\b|\bcheck in\b|\bwingman status\b/)) return [{ t: 'wing_report' }];
  if (has(/\b(status|report|systems check|how are we)\b/)) return [{ t: 'report', what: 'status' }];

  // ---- wingman commands ----
  if (has(/\b(wingman|wing man|specter (one|two|1|2))\b/) && has(/\b(rtb|return to base|go home|head home|bug out|go back)\b/)) return [{ t: 'wing', cmd: 'rtb' }];
  if (has(/\b(cover me|defensive|protect me|defend me|watch my (six|back)|stay close)\b/)) return [{ t: 'wing', cmd: 'cover' }];
  if (has(/\b(rejoin|re join|form up|on my wing|regroup|join (up )?(on )?me)\b/)) return [{ t: 'wing', cmd: 'rejoin' }];
  if ((m = s.match(/\b(echelon|line abreast|abreast|trail)\b/)) && has(/formation|form|go|switch|change|fly|\bbe\b/)) return [{ t: 'wing', cmd: 'formation', f: m[1] === 'echelon' ? 'ECHELON_RIGHT' : m[1] === 'trail' ? 'TRAIL' : 'LINE_ABREAST' }];
  if (has(/\b(engage|attack|go get|go after|take out|kill)\b/) && has(/\b(my target|the target|bandit|bogey|enemy|hostile|drone|him|them|that)\b|^engage$|wingman|specter/) && !has(/autopilot|auto pilot/)) return [{ t: 'wing', cmd: 'engage' }];

  // ---- weapons ----
  if (has(/\b(cease fire|stop firing|hold fire|stop shooting|check fire)\b/)) return [{ t: 'cease' }];
  if (has(/\b(next|cycle|change|another|switch)( to)?( the)? (target|bandit|bogey|contact)\b|\btarget (next|cycle)\b|\b(select|designate|acquire)( the)?( nearest| closest)? (target|bandit|bogey|enemy|contact)\b|\block( on)?( the)?( target| bandit| bogey| enemy| contact)?\b/)) return [{ t: 'target' }];
  const weapon = has(/\b(guns?|cannon|vulcan|20 ?mm)\b/) ? 'GUN' : has(/\b(ir|infrared|heat( seeker)?|fox two|fox 2|sidewinder|short range)\b/) ? 'IR' : has(/\b(radar|long range|sabre|saber|fox three|fox 3|lr ?9?|bvr)\b/) ? 'RADAR' : null;
  if (has(/\b(fire|shoot|launch|fox|open fire|engage with|send it)\b/) && !has(/\b(autopilot|flares?|engines?)\b/)) return [{ t: 'fire', w: weapon ?? undefined }];
  if (weapon && has(/\b(select|switch|arm|use|go to|change to|weapon|missiles?|selected)\b|^(guns?|cannon|ir|radar)$/)) return [{ t: 'weapon', w: weapon }];
  if (has(/\b(flares?|countermeasures?|chaff|decoys?)\b/)) return [{ t: 'flares' }];

  // ---- autopilot / navigation assists ----
  if (has(/\b(auto ?land|land (the )?(aircraft|plane|jet|for me)|request landing|land now|land (on|at) (the )?runway|bring (it|me) in)\b|^land$/)) return [{ t: 'autoland' }];
  if (!has(/\bvertical\b/) && has(/\b(auto ?takeoff|take ?off|depart|take off now)\b/)) return [{ t: 'autotakeoff' }];
  if (has(/\btaxi\b/)) return [{ t: 'taxi' }];
  if (has(/\b(take me|fly me|go|head|return|rtb|bring me)\b.*\b(home|back to base|the airfield|base)\b|\b(rtb|return to base)\b/)) return [{ t: 'goto_home' }];
  if (has(/\b(fly|go|head|navigate|proceed)( to| toward| towards)?( the)?( next)?( waypoint| nav point| nav| objective)\b|\bnext waypoint\b/)) return [{ t: 'goto_nav' }];
  if (has(/\b(autopilot|auto pilot)\b.*\b(off|disengage|cancel)\b|\b(disengage|cancel|kill) (the )?(autopilot|auto pilot|assist)\b|\bmanual( control)?\b|\bi have (control|the aircraft)\b|\bstand down autopilot\b/)) return [{ t: 'ap_off' }];
  if (has(/\b(cobra|pugachev)\b/)) return [{ t: 'cobra' }];
  if (has(/\b(kulbit|kulbeet|somersault|backflip|back flip)\b/)) return [{ t: 'kulbit' }];
  if (has(/\b(hover|stovl|vtol|vertical (take ?off|landing|lift)|lift fan|convert to (hover|forward flight)|transition( to forward flight)?|forward flight)\b/)) return [{ t: 'stovl' }];
  if (has(/\b(ecm|jammer|jamming|jam (them|the radar|radar)|electronic (warfare|attack|countermeasures))\b/)) return [{ t: 'ecm' }];
  if (has(/\b(recover|auto ?recover(y)?|panic|save me|spin recovery|i ?a?m lost|i ?a?m spinning|unusual attitude)\b/)) return [{ t: 'recover' }];
  if (has(/\b(level (the )?wings|wings level|level (out|off)|straight and level|fly level)\b/)) return [{ t: 'level' }];
  if (has(/\b(hold|maintain|keep)( this| the| current)? (altitude|height)\b/)) return [{ t: 'hold_alt' }];
  if (has(/\b(hold|maintain|keep)( this| the| current)? (heading|course)\b/)) return [{ t: 'hold_hdg' }];
  if ((m = s.match(/\b(?:hold|maintain|keep|set|speed|airspeed)\b.*?\b(\d{2,3})( knots?| kt| kts)?\b/)) && has(/\b(speed|airspeed|knots?)\b/)) return [{ t: 'hold_speed', kt: parseInt(m[1]) }];

  // ---- throttle ----
  if (has(/\b(afterburners?|burners?)\b/)) return [{ t: 'throttle', set: has(/\b(off|disengage|cancel|stop)\b/) ? 0.85 : 1 }];
  if ((m = s.match(/\b(?:throttle|power|thrust)\b.*?(\d{1,3})( percent)?/)) || (m = s.match(/\b(?:set|give me|go to)\b.*?(\d{1,3}) percent\b/))) return [{ t: 'throttle', set: Math.min(100, parseInt(m[1])) / 100 }];
  if (has(/\b(full|maximum|max)\b.*\b(throttle|power|thrust)\b|\bfull (afterburner|send)\b|\bmax(imum)? (power|thrust)\b/)) return [{ t: 'throttle', set: 1 }];
  if (has(/\bmilitary power\b|\bcruise (power|throttle)\b/)) return [{ t: 'throttle', set: has(/cruise/) ? 0.65 : 0.9 }];
  if (has(/\b(idle|throttle (back|off)|cut (the )?(throttle|power)|power off)\b/)) return [{ t: 'throttle', set: 0 }];
  if (has(/\b(increase|more|add|up)\b.*\b(power|throttle|thrust)\b|\bfaster\b|\bspeed up\b/)) return [{ t: 'throttle', delta: 0.2 }];
  if (has(/\b(reduce|less|decrease|lower|cut|down)\b.*\b(power|throttle|thrust)\b|\bslower\b|\bslow down\b/)) return [{ t: 'throttle', delta: -0.2 }];

  // ---- gear / brakes ----
  if ((m = s.match(/\b(?:gear|landing gear|wheels?)\b.*\b(up|down|in|out)\b/)) || (m = s.match(/\b(raise|retract|lower|extend|drop|stow)\b.*\b(gear|wheels?)\b/))) {
    const w = m[1]; return [{ t: 'gear', down: /^(down|out|lower|extend|drop)$/.test(w) }];
  }
  if (has(/\bair ?brakes?\b|\bspeed ?brakes?\b/)) return [{ t: 'airbrake', on: !has(/\b(off|release|retract|in)\b/) }];
  if (has(/\b(wheel )?brakes?\b|\bbrake\b/)) return [{ t: 'brake', on: !has(/\b(off|release|let go)\b/) }];

  // ---- attitude / heading / altitude ----
  if ((m = s.match(/\b(?:climb|ascend|go up|rise)\b(?: to| up to)?\s*(\d{2,6})\s*(feet|foot|ft|meters?|metres?|m)?\b/)) || (m = s.match(/\b(?:descend|go down|drop|lower)\b(?: to| down to)?\s*(\d{2,6})\s*(feet|foot|ft|meters?|metres?|m)?\b/))) {
    const rel = !/\bto\b/.test(s.slice(0, s.indexOf(m[1]))) && /\b(\d+)\s*(feet|foot|ft|meters?|metres?)\b/.test(s) && !/\bflight level\b/.test(s);
    const unit = (m[2] ?? 'feet'); const v = parseFloat(m[1]) * (/^(m|met)/.test(unit) ? 1 : FT);
    const down = /\b(descend|go down|drop|lower)\b/.test(s);
    return [rel ? { t: 'alt_rel', meters: down ? -v : v } : { t: 'alt', meters: v }];
  }
  if (has(/\b(climb|ascend|gain altitude)\b/)) return [{ t: 'alt_rel', meters: 600 }];
  if (has(/\b(descend|lose altitude|go lower)\b/)) return [{ t: 'alt_rel', meters: -600 }];
  if ((m = s.match(/\b(?:heading|course|steer|come to|fly)\s+(\d{1,3})\b/))) return [{ t: 'heading', deg: parseInt(m[1]) % 360 }];
  if (has(/\b(?:fly )?(north|south|east|west)\b/) && !has(/\b(report|where)\b/)) { const d = s.match(/\b(north|south|east|west)\b/)![1]; return [{ t: 'heading', deg: { north: 0, east: 90, south: 180, west: 270 }[d as 'north'] }]; }
  if ((m = s.match(/\bturn\b.*\b(left|right)\b(?:.*?(\d{1,3}))?/)) || (m = s.match(/\b(left|right)\b.*\bturn\b(?:.*?(\d{1,3}))?/))) return [{ t: 'turn', dir: side(m[1]), deg: m[2] ? Math.min(180, parseInt(m[2])) : 30 }];
  if ((m = s.match(/\b(?:bank|roll)\b.*\b(left|right)\b(?:.*?(\d{1,3}))?/))) return [{ t: 'bank', dir: side(m[1]), deg: m[2] ? Math.min(80, parseInt(m[2])) : 30 }];
  if ((m = s.match(/\b(?:pitch|nose)\b.*\b(up|down)\b(?:.*?(\d{1,2}))?/))) return [{ t: 'pitch', deg: (m[1] === 'up' ? 1 : -1) * (m[2] ? Math.min(30, parseInt(m[2])) : 8) }];

  // ---- camera / view ----
  if (has(/\b(next|change|switch|cycle)( the)?( camera| view| angle)\b|\bnext (camera|view|angle)\b/)) return [{ t: 'camera', next: true }];
  if ((m = s.match(/\b(chase|cockpit|wing|side|orbit|front|flyby|fly by|external|tail|rear|tactical|overhead|top down|tower|target|cinematic|movie)\b/)) && has(/\b(camera|view|angle|show|switch|look|go to)\b|^(chase|cockpit|orbit|flyby|tail|tactical|tower|cinematic)$/)) {
    const v = m[1]; const map: Record<string, 'chase' | 'cockpit' | 'wing' | 'tail' | 'orbit' | 'front' | 'target' | 'tactical' | 'tower' | 'cinematic' | 'flyby'> = { chase: 'chase', external: 'chase', tail: 'tail', rear: 'tail', tactical: 'tactical', overhead: 'tactical', 'top down': 'tactical', tower: 'tower', target: 'target', cinematic: 'cinematic', movie: 'cinematic', cockpit: 'cockpit', wing: 'wing', side: 'wing', orbit: 'orbit', front: 'front', flyby: 'flyby', 'fly by': 'flyby' };
    return [{ t: 'camera', view: map[v] }];
  }
  if (has(/\bmouse (aim|flight|control)\b/)) return [{ t: 'mouse', on: has(/\boff\b|\bdisable\b|\bstop\b/) ? false : has(/\bon\b|\benable\b|\bturn on\b|\bstart\b/) ? true : undefined }];

  // ---- stop / hold on the ground ----
  if (has(/^(stop|halt|hold position|park|whoa|stay)( here| there| now)?$/)) return [{ t: 'stop' }];

  // ---- free radio messages ----
  if ((m = raw.match(/^\s*(?:tell|ask|radio|say to|message|broadcast to)\s+(ground|wingman|specter (?:one|two|1|2)|two|one)[, ]*(?:that |to )?(.*)$/i))) {
    return [{ t: 'radio', to: /ground/i.test(m[1]) ? 'ground' : 'wingman', text: m[2] || raw }];
  }
  if (/\b(ground|tower|control)\b/.test(s)) return [{ t: 'radio', to: 'ground', text: raw.replace(/^\s*(ground|tower|control)[, ]*/i, '') }];
  if (/\b(specter|wingman|two|one)\b/.test(s)) return [{ t: 'radio', to: 'wingman', text: raw.replace(/^\s*(specter (one|two|1|2)|wingman|two|one)[, ]*/i, '') }];
  void num;
  return [{ t: 'unknown', raw }];
}

/** Splits an utterance into clauses ("…and then…", "…then…", commas) and parses each. */
export function parseCommands(text: string): Cmd[] {
  const raw = text.trim();
  if (!raw) return [];
  const norm = normalize(raw);
  // a message addressed to somebody is one command, never split
  if (/^(tell|ask|radio|say to|message|broadcast to)\b/.test(norm)) return parseClause(norm, raw);
  const parts = norm.split(/\b(?:and then|then|and also|after that|and)\b/).map(p => p.trim()).filter(Boolean);
  const out: Cmd[] = [];
  for (const p of parts.length ? parts : [norm]) out.push(...parseClause(p, parts.length > 1 ? p : raw));
  // "turn left and descend" style leftovers: drop unknown fragments when something else was understood
  const known = out.filter(c => c.t !== 'unknown');
  return known.length ? known : out;
}

export function describe(c: Cmd): string {
  switch (c.t) {
    case 'throttle': return c.set !== undefined ? `throttle ${Math.round(c.set * 100)}%` : `throttle ${c.delta! > 0 ? '+' : '−'}20%`;
    case 'gear': return `gear ${c.down ? 'down' : 'up'}`;
    case 'alt': return `climb/descend to ${Math.round(c.meters / FT)} ft`;
    case 'alt_rel': return `${c.meters > 0 ? 'climb' : 'descend'} ${Math.round(Math.abs(c.meters) / FT)} ft`;
    case 'turn': return `turn ${c.dir} ${c.deg}°`;
    case 'bank': return `bank ${c.dir} ${c.deg}°`;
    case 'heading': return `heading ${String(c.deg).padStart(3, '0')}`;
    case 'hold_speed': return `hold ${c.kt} kt`;
    case 'fire': return `fire${c.w ? ' ' + c.w : ''}`;
    case 'wing': return `wingman: ${c.cmd}${c.f ? ' ' + c.f : ''}`;
    case 'radio': return `radio → ${c.to}`;
    case 'unknown': return 'not understood';
    default: return c.t.replace(/_/g, ' ');
  }
}
