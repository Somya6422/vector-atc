import type { Route } from '../persistence/SaveManager';
import type { Speaker } from './DialogueSystem';

/**
 * Original dialogue. Roles: BOY = Specter-1 (practical, instinctive, observant, a little mischievous);
 * GIRL = Specter-2 (analytical, decisive, funny, one year older, treats him as an equal);
 * GC = Ground Control. 'P'/'W' resolve to the player's / wingman's character for the chosen route.
 * The girl's face is never described or shown – her character is carried by voice, decisions and body language.
 */
export type Role = 'GC' | 'BOY' | 'GIRL' | 'P' | 'W';
export interface ScriptLine { role: Role; text: string; priority?: 0 | 1 | 2 | 3 }

export function resolveRole(role: Role, route: Route): Speaker {
  const playerIsBoy = route === 'A_BOY_SU57';
  switch (role) {
    case 'GC': return 'Ground Control';
    case 'BOY': return 'Specter-1';
    case 'GIRL': return 'Specter-2';
    case 'P': return playerIsBoy ? 'Specter-1' : 'Specter-2';
    case 'W': return playerIsBoy ? 'Specter-2' : 'Specter-1';
  }
}

const L = (role: Role, text: string, priority: 0 | 1 | 2 | 3 = 1): ScriptLine => ({ role, text, priority });

export const SCRIPT: Record<string, ScriptLine[]> = {
  // ------------------------------------------------------------ phase 1
  engine_start: [L('GC', 'Specter flight, Ground. Scramble authorised. Start engines and taxi to runway three-six.', 2)],
  startup_done: [L('BOY', 'Both engines stable, systems green.'), L('GIRL', 'Hydraulics, avionics, sensors. All green on my side too.')],
  startup_done_f35: [L('GIRL', 'Single engine stable. Sensors aligning. All green.'), L('BOY', 'Same here. Rolling when you are.')],
  lineup: [L('GC', 'Specter flight, cleared for immediate departure, runway three-six. Wind two-seven-zero at fifteen.', 2)],
  lineup_banter_A: [L('GIRL', 'Lined up on your right, One. Try to leave me some runway this time.'), L('BOY', 'No promises, Two. Brakes off in three.')],
  lineup_banter_B: [L('BOY', 'Lined up on your left, Two. You call it. I\'ll follow your rotation.'), L('GIRL', 'Then try to keep up. Brakes off. Go.')],
  rotate: [L('GC', 'Rotate. One-three-five knots.', 2)],
  gear_up: [L('GC', 'Positive rate. Gear up.', 1)],
  climb_done: [L('GC', 'Specter flight, you are clear of the field. Turn north into the Halcyon valley and stay low. The ridge radars lose you if the mountains are between you and them.', 2)],
  // ------------------------------------------------------------ phase 2
  transit_A: [L('GIRL', 'Radar sites Alpha and Bravo sit in the east pass. If the ridge is between us and them, they are blind. I will tell you if the picture changes.'), L('BOY', 'Staying on the deck. Tell me if I get too friendly with the pines.')],
  transit_B: [L('BOY', 'Alpha and Bravo sit in the east pass. Stay in the shadow of the ridge and they cannot see us.'), L('GIRL', 'Good. I am planning the route around their sight lines. Stay low, One, and follow my line.')],
  wp1: [L('GC', 'Halcyon Gate behind you. Red Bridge is next. Contacts have been spotted beyond the lake.', 1)],
  wp2: [L('GC', 'Red Bridge. Stand by for the intercept. Two unidentified contacts, no transponders, north of Cinder Lake.', 2)],
  detected: [L('GC', 'Specter flight, you have been painted by the ridge radar. Expect them to react.', 3)],
  masked: [L('GC', 'Radar lost your track. Terrain is covering you. Good flying.', 1)],
  // ------------------------------------------------------------ phase 3
  contact: [L('W', 'Two contacts, bearing north. Small signature, no transponder. Cleaner than any fighter I know.', 2)],
  id_hostile: [L('GC', 'Specter flight, contacts identified as hostile unmanned stealth drones. Weapons free.', 3)],
  hint_lr: [L('GIRL', 'They are outside gun range but inside your long-range missile envelope. Let the radar missile do the long work.', 1)],
  hint_lr_B: [L('BOY', 'Long-range missile is your best opening move. Lock, then Space.', 1)],
  sabre_away: [L('P', 'Sabre away!', 2)],
  fox2_away: [L('P', 'Fox-two!', 2)],
  splash1: [L('P', 'Splash one.', 2), L('W', 'Good kill.', 1)],
  splash2: [L('P', 'Splash two. Sky is clear.', 2)],
  wing_splash: [L('W', 'Splash one! Target destroyed.', 2)],
  missile_p: [L('W', 'Missile, missile! Break and flare, now!', 3)],
  missile_w: [L('W', 'Missile launch on me! Flaring!', 3)],
  drone_escaped: [L('GC', 'One drone has fled north out of range. Do not pursue. Intercept complete.', 2)],
  intercept_done: [L('GC', 'Both contacts down. Well done, Specter flight.', 2)],
  // ------------------------------------------------------------ phase 4
  front_warning: [L('GC', 'Specter flight, a weather front is closing the main valley south of Cinder Lake. Visibility near zero and building.', 3)],
  interference_W_A: [L('GIRL', 'My radar is full of snow. Interference on every band. I cannot trust my picture, and I will stay glued to your wing.', 3)],
  interference_W_B: [L('BOY', 'My sensors are swamped by the interference. I am flying visual off your lights. Do not lose me, Two.', 3)],
  route_choice: [L('GC', 'Two ways home: the main valley is closed by the blizzard. The east pass past Signal Spur beacon is clear. Your call.', 2)],
  route_choice_hint: [L('W', 'Beacon at Signal Spur, east side. The pass behind it looks clear to me.', 1)],
  entered_storm: [L('W', 'Visibility is gone. Staying tight on you. Watch your altitude.', 2)],
  alt_route_ok: [L('GC', 'East pass confirmed. You are clear of the weather. Turn for home.', 2)],
  main_route_ok: [L('GC', 'You are through the front. That was a bold line. Turn for home.', 2)],
  lost_visual: [L('W', 'I have lost visual in this soup. Say your heading!', 3)],
  visual_regain: [L('W', 'Visual regained. Rejoining.', 2)],
  // ------------------------------------------------------------ phase 5
  rtb: [L('GC', 'Specter flight, return to base. Runway is clear. Wind two-seven-zero, fifteen knots.', 2)],
  gear_down: [L('GC', 'Gear down and locked. Target one-one-five knots over the threshold.', 1)],
  final_A: [L('GIRL', 'Gear down, right behind you, One. Do not float it.'), L('BOY', 'Wouldn\'t dream of it.')],
  final_B: [L('BOY', 'Gear down. I am right behind you, Two.'), L('GIRL', 'Good. Flare, hold the nose, and let the runway come to you.')],
  touchdown_good: [L('GC', 'Smooth touchdown. Brakes, brakes.', 1)],
  touchdown_hard: [L('GC', 'Hard contact. Check your aircraft. Brakes.', 2)],
  stopped: [L('GC', 'Specter, welcome home. Taxi to the hangar.', 2)],
  wing_landed: [L('W', 'Specter two-one is down and stopped.', 1)],
  // ------------------------------------------------------------ generic callouts
  bingo: [L('GC', 'Specter, fuel is low. Bingo. Recommend return to base.', 3)],
  gcas: [L('GC', 'Terrain ahead! Pull up!', 3)],
  wingman_hit: [L('W', 'I am hit! Systems degraded, still flying.', 3)],
  wingman_lost: [L('GC', 'Specter-two is down. Mission failed.', 3)],
  cmd_cover: [L('P', 'Cover me.', 1), L('W', 'Covering.', 1)],
  cmd_engage: [L('P', 'Engage my target.', 1), L('W', 'Engaging.', 1)],
  cmd_rejoin: [L('P', 'Rejoin.', 1), L('W', 'Rejoining formation.', 1)],
  cmd_formation: [L('W', 'Changing formation.', 0)],
  rtb_call: [L('W', 'Heading home.', 1)],
  threat_w: [L('W', 'Contact, bearing north. Hostile.', 1)],
};

/** Debrief + hangar dialogue per outcome. Chosen from real mission stats, never from a timer. */
export type OutcomeKind = 'FLAWLESS' | 'DAMAGED_RETURN' | 'RESCUE' | 'STORM_RUN' | 'CLOSE_CALL' | 'FAIL_CRASH' | 'FAIL_WING' | 'FAIL_FUEL';
export const HANGAR_SCRIPT: Record<OutcomeKind, ScriptLine[]> = {
  FLAWLESS: [
    L('BOY', 'Clean sheet. Not a scratch on either jet.'),
    L('GIRL', 'Which is statistically suspicious, but I will take it.'),
    L('GC', 'Command is calling it a textbook intercept. Get some rest, Specter flight.'),
  ],
  DAMAGED_RETURN: [
    L('BOY', 'The jet looks like it argued with a mountain. And lost.'),
    L('GIRL', 'It brought us home. The maintenance crew will have opinions about it.'),
    L('GC', 'Aircraft is grounded for repairs. Both pilots cleared. Good work getting it down.'),
  ],
  RESCUE: [
    L('GIRL', 'You were right on my wing when that missile came. I noticed.'),
    L('BOY', 'I noticed you noticing. Do not make it weird.'),
    L('GC', 'Debrief at nineteen hundred. Specter-two, I am told you owe your wingman a coffee.'),
  ],
  STORM_RUN: [
    L('BOY', 'I think I left a little of my nerves back in that blizzard.'),
    L('GIRL', 'You flew by the instruments and the sound of my voice. It worked. Do not tell the instructors.'),
    L('GC', 'Weather section says nobody should have flown that corridor. Remarkable.'),
  ],
  CLOSE_CALL: [
    L('GIRL', 'We were closer to the edge than I like. Next time I plan the margin before we need it.'),
    L('BOY', 'Next time I listen to your margin before I need it.'),
    L('GC', 'Mission complete. Debrief in thirty minutes.'),
  ],
  FAIL_CRASH: [L('GC', 'Specter-one lost. Mission failed. Standby for review.')],
  FAIL_WING: [L('GC', 'Specter-two is down. The mission is lost. Return to base for a review.')],
  FAIL_FUEL: [L('GC', 'Fuel exhausted. Aircraft lost. Mission failed.')],
};
