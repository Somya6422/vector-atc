export type MissionId = 'm01' | 'm02' | 'm03' | 'school';

export interface MissionSpec {
  id: MissionId;
  name: string;            // short title, e.g. "Operation Cold Threshold"
  label: string;           // menu row title
  menu: string;            // one-line description for the mission list
  brief: string;           // briefing paragraph
  tips: string[];          // briefing bullets
  drones: number;          // hostile drones (school: 0)
  storm: boolean;          // weather front on the way home
  gates: number;           // optional low-level valley gates (bonus task)
}

export const MISSIONS: Record<MissionId, MissionSpec> = {
  m01: {
    id: 'm01', name: 'Operation Cold Threshold', label: 'Mission 01 — Operation Cold Threshold',
    menu: 'Intercept unidentified hostile drones, survive a blizzard and electronic interference, protect the formation, and return to base.',
    brief: 'Two unidentified stealth contacts are crossing the northern ridge beyond Cinder Lake. Scramble from the mountain airfield, run the Halcyon valley low to stay masked from the ridge radars, identify and destroy the intercepts, and bring the formation home.',
    tips: ['Taxi, take off (rotate 135 kt) and climb to 4,000 ft with the gear up.', 'Fly the valley low: terrain hides you from the radar network.', 'Identify the contacts (R) before weapons release. Use the long-range LR-9 first, then IR-7 or guns.', 'A weather front may close the valley. Pick a route and keep your wingman close.'],
    drones: 2, storm: true, gates: 0,
  },
  m02: {
    id: 'm02', name: 'Operation Iron Veil', label: 'Mission 02 — Operation Iron Veil',
    menu: 'Two waves of hostile drones, four in all, clear skies. A pure air-combat test: manage missiles, flares and your wingman.',
    brief: 'Intelligence expects a second, larger drone push behind the first. Two contacts will appear first; two more follow about half a minute later from the same ridge. There is no weather cover this time, so your missiles, flares and wingman decide the fight.',
    tips: ['Same departure as Mission 01: climb to 4,000 ft, then run the valley.', 'Four hostiles in two waves. Save a long-range missile for the second wave.', 'Use flares (X) when you hear the missile warning, then break across it.', 'Bonus task: score a cannon kill. Clear skies mean a faster trip home.'],
    drones: 4, storm: false, gates: 0,
  },
  m03: {
    id: 'm03', name: 'Operation Ember Gate', label: 'Mission 03 — Operation Ember Gate',
    menu: 'Thread four glowing gates down the valley, face three drones, then beat the blizzard home. Precision flying first, combat second.',
    brief: 'Ground Control has strung four marker gates along the valley between Halcyon Gate and Red Bridge as a low-level precision course. Fly them at speed to prove the terrain-masked route works, then deal with three hostile drones and race the weather home.',
    tips: ['Four green gates sit in the valley between WP1 and WP2. Fly through the rings for bonus points.', 'The gates are low. Watch your terrain clearance and your radar warning.', 'Three drones this time, and the blizzard still closes the valley behind them.', 'Bonus tasks: all four gates, and a cannon kill.'],
    drones: 3, storm: true, gates: 4,
  },
  school: {
    id: 'school', name: 'Flight School', label: 'Flight School',
    menu: 'Free practice: takeoff, valley navigation, landing and wingman commands. No hostiles.',
    brief: 'Practice the full circuit: start up, taxi, takeoff, retract the gear, climb to 4,000 ft, fly to Halcyon Gate through the valley, then return and land on runway 36/18.',
    tips: [], drones: 0, storm: false, gates: 0,
  },
};
