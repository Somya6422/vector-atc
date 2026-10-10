# VANTAGE: ZERO

**Play it live:** https://vantage-zero.vercel.app (Chrome or Edge, keyboard and mouse; press **/** in flight for every key and voice command)

Cinematic 3D fighter-aircraft combat — **Mission 01: Operation Cold Threshold** is fully playable from the main menu to the hangar.

Browser game: **Vite + TypeScript + Three.js + Web Audio API**. Everything (terrain, aircraft, audio, dialogue) is generated locally – no external assets, no network and no API keys are needed to play.

> Status: **Phase 2 vertical slice** (see `PROJECT_STATE.json` for the authoritative, honest state of every module, test and known issue).

## Prerequisites (checked on the development machine)

| Tool | Version used |
|------|--------------|
| Node.js | 24.x (any current LTS/stable should work) |
| npm | 11.x |
| Browser | Current Chrome / Edge / Firefox with WebGL2 (hardware acceleration on) |

## Install, run, build, test

```bash
npm install          # one time
npm run dev          # development server → http://localhost:5173
npm run build        # type-check (tsc --noEmit) + production bundle in dist/
npm run preview      # serve the production build
npm test             # unit / simulation tests (vitest, headless)
npm run typecheck    # TypeScript only
```

Click once inside the page so the browser lets the game start audio (Web Audio needs a user gesture). Subtitles work with audio muted or unavailable.

## Playing the vertical slice

1. **New Campaign → choose a pilot**
   * **Route A – Specter-1 (boy) flies the Su-57**, wingman Specter-2 (girl) flies the F-35 as an AI.
   * **Route B – Specter-2 (girl) flies the F-35**, wingman Specter-1 (boy) flies the Su-57 as an AI.
   * Pilots are colour-coded: Specter-1 (boy) wears an orange flight suit and helmet, Specter-2 (girl) a teal suit and helmet with auburn hair. The girl no longer wears a mask or mirrored visor; the cat has been removed from the game.
2. **Hangar** – walk around (WASD, Q/E camera). Then **Mission Briefing → Launch**, or pick **Missions** for Mission 02 and 03.
3. **Mission 01** (all six phases, driven by real state – no timed cut-scenes):
   1. *Takeoff & scramble* – press **F** to start engines, taxi to runway 36, line up, full power, rotate near 135 kt, gear up, climb through 4,000 ft.
   2. *Low-altitude transit* – fly the Halcyon valley. A fictional radar network (sites in the east pass) detects you only when it has terrain line-of-sight; the HUD shows the detection meter. Staying low is rewarded; climbing above the ridge exposes you and alerts the drones.
   3. *Interception* – two hostile stealth drones. R selects contacts, they must be **identified** (inside 12 km and 30° of the nose for ~2 s) before weapons release. Use the long-range LR-9 radar missile first, then IR-7 (Fox-2) or the 20 mm cannon. Drones fire IR missiles back: use **X** flares and break.
   4. *Blizzard & electronic interference* – a weather front forms ahead of you on the main valley. Wingman sensors degrade (her radar picture, formation keeping and radio are really affected). Choose: the **east pass** (clear, via the Signal Spur beacon) or push **through the blizzard** (visibility ~260 m, turbulence).
   5. *Return & landing* – lower the gear, follow the ILS-style cue on the HUD, touch down near the target speed (115 kt Su-57 / 128 kt F-35 – the F-35 model stalls higher), roll out and stop on the runway.
   6. *Debrief & hangar* – graded from real events (kills, wingman survival, aircraft condition, landing quality, detection, route…), different dialogue per outcome, hangar scene, campaign saved.

## Voice control (Wispr Flow or the browser microphone)
Everything you can do with keyboard and mouse can also be done by voice or typed text. Press **Enter** (rebindable) to focus the *command line* at the bottom of the screen.

* **Wispr Flow:** Wispr Flow has no public API – it types dictated text into whatever field has focus. Focus the game's command line (Enter, or click it), hold your Wispr Flow hotkey and speak; dictation that arrives as one burst is sent automatically (Settings → *auto-send*), otherwise press Enter. Turn on *Voice-only mode* in Settings to keep the field focused for hands-free play.
* **Built-in microphone:** the **MIC** button (key **Y**) uses the browser's speech recognition (Chrome/Edge, needs internet). It feeds the same parser.
* Several commands per sentence work: *"gear up and throttle eighty percent, then climb to five thousand feet"*. Spoken numbers ("two seven zero", "four thousand five hundred") are understood.

| Area | Examples |
|---|---|
| Engines & ground | "start engines", "taxi to the runway", "take off", "stop", "apply brakes" |
| Throttle & systems | "throttle eighty percent", "full power", "afterburner off", "gear down", "deploy flares" |
| Autopilot | "heading two seven zero", "turn left 45 degrees", "bank right 30", "climb to four thousand feet", "descend 1000 feet", "nose up 10 degrees", "hold speed 300 knots", "level the wings", "fly to the next waypoint", "autopilot off" |
| Landing | "land the aircraft" / "take me home" (autoland: **−300 score penalty**) |
| Combat | "select radar missiles", "next target", "fire" / "fox two", "fire the guns", "cease fire" |
| Wingman | "cover me", "engage my target", "rejoin", "line abreast formation", "wingman report" |
| Information | "bogey dope", "status report", "fuel status", "where is the airfield", "what is my altitude" |
| Radio | "tell ground I am heading home", "Specter two, check in" |
| Views & panels | "cockpit view", "next camera angle", "mouse aim on", "open the map", "objectives", "hint", "pause", "resume" |
| Menus | "new campaign", "select specter one", "launch the mission", "hangar", "settings", "controls" |

Voice commands that fly the aircraft (heading/altitude/speed hold, taxi, take-off, autoland) are real control laws on the same flight model; any manual stick input hands control straight back, and the autopilot has automatic terrain-collision recovery.

## Built with Wispr Flow (hhgoa-2026 task)

This project was built for the Wispr Flow shortlisting task (hhgoa-2026), which asks participants to build a project using Wispr Flow and their voice.

- **Building:** the game was developed by directing an AI coding assistant (Claude Code), with requests dictated through Wispr Flow. The recorded video shows this process.
- **Playing:** the game also takes voice commands. Dictate into the in-game command line (press Enter), and Wispr Flow types the text and the game parses it. See *Voice control* above.
- **Account:** Wispr Flow account created through https://ref.wisprflow.ai/hhg.
- **Demo:** the recording script is in [DEMO_SCRIPT.md](DEMO_SCRIPT.md).

Note: Wispr Flow has no public API, and the in-game voice commands have not been tested with a real Wispr Flow session. They were tested with scripts.

## Easy mode: on-screen buttons and quick-start guide

In flight a button bar (bottom left) shows the next step and the actions that make sense right now: START ENGINES, AUTO-TAXI, AUTO-TAKEOFF, AUTOPILOT (also key **P**), NEXT WAYPOINT, GEAR, AUTOLAND, CAMERA, HINT. A quick-start guide opens automatically on the first flight; reopen it with **I** or the ? GUIDE button. Buttons run the same commands as typed or spoken ones.

## Difficulty, trails and enemies

- **Settings → Difficulty** (easy / normal / hard) changes how much damage your jet takes (×0.55 / ×1 / ×1.35) and how fast the enemy re-fires (slower on easy, quicker on hard). It applies from the next mission.
- Wingtip **vapor trails** appear when any aircraft pulls more than about 3 g above 600 m.
- Pilots look into turns and their heads sag under g. Hostile UCAVs have a glowing red sensor eye, canted twin tails and weapon pods so they stand out.

## Aircraft skills (press / for the full commands sheet)

| Jet | Skill | Key | Voice |
|---|---|---|---|
| Su-57 | Pugachev's Cobra: thrust-vectoring post-stall manoeuvre (200–470 kt, wings level) | U | "cobra" |
| Su-57 | Kulbit: 360° somersault (220–480 kt) | O | "kulbit" |
| Su-57 | Supercruise: about Mach 1.3 at military power (lower transonic drag) | – | – |
| F-35 | STOVL: hover, vertical take-off and landing, hover-taxi (convert below 300 kt) | J | "hover", "vertical take-off", "forward flight" |
| F-35 | Sensor fusion + DAS: +20 % radar range, 2× faster identification, 360° missile display | – | – |
| Both | Electronic jammer: 8 s, radar missiles may lose lock | 6 | "jammer on" |
| Both | Internal weapons bays: doors open briefly at each launch | – | – |

## Flight feel (keyboard)

A tap of A/D gives a small, precise bank. Holding it banks to about 70° and stops there; hold past 1.2 s for a full roll. When you let go, the bank holds. Small banks settle back to wings level. In a banked turn with no pitch input, fly-by-wire pulls just enough to keep the turn nearly level. Before this fix, a 0.8 s tap rolled the jet to 148° (almost inverted).

## Commands sheet

Press **/** (or the ⌨ KEYS button, or "Commands & Shortcuts" in the main or pause menu) for every key, generated from your current bindings, plus all aircraft skills and example voice commands.

## Glass cockpit HUD (key K: full MFDs / clean HUD)

- **Adaptive contrast:** the HUD samples the brightness of the rendered scene a few times a second. Over snow glare or bright haze it switches to a deeper green with a dark halo; at night it goes back to a soft glow.
- **TSA MFD (bottom right):** heading-up topographic map built from the terrain heights, ground radar/SAM envelopes, waypoints, supply drops, inbound missiles, contacts with a 20-second vector prediction, and your own predicted 30-second track.
- **DMS MFD (bottom left):** wireframe of the jet coloured by structural health, G load against its limit, exhaust gas temperature, throttle, fuel, gear, missile hardpoints and gun rounds, weapon/lock state and the fly-by-wire mode.
- **COMMS MFD (top right):** wingman state, formation and separation, the last radio calls, and a waveform that animates while someone is transmitting. It is driven by the radio line, not by recorded audio. The COVER / ENGAGE / REJOIN / RTB buttons under it are clickable.
- **Reticles:** lerped flight-path marker with an energy caret, lead-computing gun pipper with a range bar, smoothed target boxes and a +2 s predicted-position marker on the selected target.

## Flight assists

- **Panic recovery (L, RECOVER button, or say "recover"):** rolls wings level the shortest way (inverted included), unloads a stall, then climbs and hands over to the holding autopilot. Automated tests recover an inverted, 25° nose-down Su-57 and F-35 in under 20 s, staying more than 100 m above the terrain.
- **Fly-by-wire (Settings, on by default):** the stick is trimmed when the angle of attack nears the stall, and auto-GCAS takes the controls when the predicted path hits terrain, then gives them back. It never acts while an autopilot mode or the landing configuration is active.
- **Action dial (Tab or the ⦿ ACTIONS button):** large buttons for start engine, auto-taxi, auto-takeoff, flares, wingman engage, camera, autoland and recover.

## Theatres and Wave Survival

- Missions now pick a theatre (`src/world/Biomes.ts`): **Arctic Fjord** (Mission 01, Flight School), **Desert Badlands** (Mission 02) and **Neon Megacity – Midnight Canyon** (Mission 03, Wave Survival). A theatre re-colours the same real terrain and changes the sky, light, fog, reflections, vegetation and weather particles. The neon theatre adds solid towers along the canyon floor; flying into one is a crash.
- The atmosphere uses height fog: thicker in the valleys, thinner with altitude, brighter towards the sun, and dithered so distant ridges don't band.
- **Arcade: Wave Survival** starts airborne with your wingman. There are four waves of 2, 3, 3 and 4 drones. A supply canister appears after each wave and refills missiles, flares, fuel, gun and some hull. Losing the wingman doesn't end the run.

## Effects

Afterburner bloom sprites, a transonic vapour cone between about Mach 0.93 and 1.04 below 7,500 m, wingtip vapour above about 3 g, and glowing two-layer tracers. The F-35 uses a matte radar-absorbent finish, and the Su-57 uses metallic paint with panel seams.

## Missions

| Mission | What it adds |
|---|---|
| 01 Operation Cold Threshold | The original six-phase sortie: valley run, two drones, blizzard, landing. Bonus task: cannon kill. |
| 02 Operation Iron Veil | Four drones in two waves (the second wave arrives about 30 s after contact), clear skies, no blizzard. |
| 03 Operation Ember Gate | Four glowing valley gates to fly through (bonus points), three drones, then the blizzard. |
| Arcade — Wave Survival | Airborne start, four escalating waves, supply drops between waves. |
| Flight School | Free practice, no hostiles. |

Bonus tasks appear in the objective list. Mission data lives in `src/missions/MissionSpecs.ts`.

## Cameras (key 5 cycles them)

Chase, cockpit, wing, tail (low rear), orbit, front, target (lock-on, frames the selected contact), tactical (overhead), tower (fixed near the airfield), cinematic (slow orbiting drone shot) and flyby. Voice: "tactical view", "tail camera", "cinematic view", "next camera".

## Pilot characters

The hangar pilots are the two textured Meshy characters you supplied as .blend files: the bearded pilot is Specter-1 (boy) and the blonde pilot is Specter-2 (girl). `tools/blend_export.py` converts a .blend with Blender (joins meshes, decimates to about 20k triangles, shrinks textures to 1024 px, exports .glb and renders a preview):

```
blender -b model.blend --python tools/blend_export.py -- out.glb preview.png 20000
```

The results live in `public/models/pilot_boy.glb` and `pilot_girl.glb`. `tools/pose_pilot.py` relaxes their A-pose arms to the sides in Blender. The meshes are static, so they move only by sway and bob. They wear the textured olive flight suits from the source files, which replaces the orange and teal colour coding in the hangar; the in-cockpit helmets keep orange and teal.

## Mouse-aim (key N)

Mouse-aim now flies the nose onto a world-fixed aim point. Move the mouse and the amber aim cursor moves; the jet banks and pulls until its nose cross sits on the cursor. Click once in the game and the pointer is captured, so it never runs into the screen edge; Esc releases it and pauses. Pressing any flight key snaps the aim point back to the nose. The aim point cannot swing more than 100 degrees from the nose. In a scripted test the nose settled within 1 degree of the aim point about 5 s after a 60 degree move.

## Jet details

Jets use clear-coated paint with fine panel seams and glossy tinted canopies. Every aircraft also has squadron-coloured wingtips, visible under-wing missiles that disappear as they are fired, blinking anti-collision strobes, and a hot white core in the afterburner flame.

## Controls

| Action | Input | Notes |
|---|---|---|
| Throttle / afterburner | **Ctrl+W** up, **Ctrl+S** down (hold) | Above 90 % the afterburner lights. **Browsers close the tab on Ctrl+W** – rebind it (Controls / Keyboard) or use a fullscreen/kiosk window |
| Pitch | **W** (or ↑) nose up, **S** (or ↓) nose down | "Invert pitch" in Settings. Rate-command: neutral stick holds attitude |
| Roll / yaw | **A/D** (or ←/→), **Q/E** | On the ground A/D and Q/E steer the nose wheel |
| Mouse-aim flight | **N** toggles (also in Settings) | The nose follows the cursor: up/down = pitch, left/right = bank + yaw |
| Engine start | **F** | After start-up the aircraft rolls forward by itself; wheel brakes hold taxi speed |
| Airbrake / wheel brakes | **B** (hold) | Wheel brakes on the ground |
| Landing gear | **G** | Cannot retract with weight on wheels |
| Camera | **5** (or C) cycles chase → cockpit → wing → orbit → front → flyby; **V** head-look (mouse) | |
| Map & objectives | **M** | Pauses while open |
| Pause | **Esc** | Resume · Objectives · Map · Controls · Settings · Briefing · Restart · Return to Hangar |
| Select target | **R** | Cycles radar contacts (scan ±60°, lock cone ±30°) |
| Select weapon | **T** | GUN → IR-7 → LR-9 (shown on the HUD) |
| Fire | **Space** (selected weapon), **Left mouse** = cannon | Missiles need identification, range and a steady LOCK tone |
| Countermeasures | **X** | Flares + chaff, with cooldown |
| Interact | **F** | Context prompt on screen: engine start on the ramp. **F never launches missiles.** |
| Wingman | **1** cover · **2** engage target · **3** rejoin · **4** cycle formation | Echelon Right / Line Abreast / Trail |
| Radar range / hint | **Z** / **H** | H cycles Ground Control hints 1-3 (auto hints per Settings) |
| Debug | `` ` `` overlay, F8 teleport, F9 refuel/repair, F10 kill drones | Only when *Debug mode* is enabled in Settings |

Every function above is rebindable in **Main Menu → Controls / Keyboard** (or Esc → Controls). Combinations such as Ctrl+key are supported; conflicting keys swap; only your changes are stored.

## Terrain
Mountains come from **real Greater Caucasus elevation** (centred on 42.40 N 44.35 E, including the Kazbek massif): `node tools/fetch-dem.mjs [lat lon]` downloads public AWS/Mapzen terrain tiles (SRTM-derived) and bakes `public/models/dem.bin` (80 m grid, 40 x 52 km, ~0.6 MB). The airfield plateau, the main valley, the east pass and the lake are carved into that relief so the mission stays flyable; without the file the game falls back to procedural mountains. It is *not* DCS terrain.

## Models
The Su-57 (`su57.stl`), F-35 (3MF) and pilot (3MF) meshes you supplied are converted by `node tools/convert-models.mjs <folder> [su57|f35|pilot|pilot2]` into `public/models/*.bin` (merged, decimated, oriented nose -Z / up +Y, scaled to real size, pilot base removed) and loaded at start. If a file is missing the procedural fallback meshes are used. The girl's pilot always gets the closed mirrored-gold visor over the sculpt's head.

## Architecture

```
src/
  main.ts                  entry, WebGL check
  game/        Game.ts (lifecycle, UI wiring, loop) · GameState.ts (explicit state machine) · FlightSession.ts (one mission run)
               SceneManager.ts · CameraRig.ts · Input.ts · Entity.ts · HangarScene.ts
  flight/      FlightModel.ts (6-DOF) · AircraftConfig.ts · FlightController.ts · Autopilot.ts · AircraftMesh.ts
  avionics/    HUD.ts (all displays + warnings)
  combat/      TargetingSystem.ts · Weapons.ts · WeaponSpecs.ts
  ai/          BanditAI.ts · WingmanAI.ts · Maneuvers.ts
  missions/    MissionDirector.ts (authored mission, scoring, hints)
  world/       Heightfield.ts (shared terrain/valleys/weather) · Terrain.ts · Airfield.ts · Sky.ts · Landing.ts
  audio/       AudioEngine.ts (fully synthesised Web Audio)
  story/       DialogueSystem.ts · Script.ts
  characters/  Avatar.ts (coloured pilots)
  ui/          UI.ts · Settings.ts · MapView.ts
  persistence/ SaveManager.ts
tests/         vitest suites + tests/browser/driver.js (QA driver for the dev server)
```

### Flight model (simplified, arcade-accessible – **not** full aerodynamic fidelity)
* Fixed 120 Hz semi-implicit integration; SI units internally, converted to kt/ft at the UI boundary.
* Position, velocity, quaternion orientation, body rates. ISA-style density, `q = ½ρV²`, `L = qS·C_L`, `C_D = C_D0 + k·C_L² + wave drag (Mach 0.85-1.6) + gear + airbrake`, side force, thrust with spool/afterburner/altitude lapse, fuel burn, gravity.
* Stall onset at ~22° AoA (lift loss, control degradation, nose-drop moment); control authority degrades below ~110 kt; g-limited rate commands.
* Rotational dynamics are a *rate-command model* with first-order response, weathervane yaw damping and a stall nose-drop moment – not a full inertia-tensor model.
* Ground model: gear/belly contact, weight-on-wheels friction, brakes, nose-wheel steering, crash/hard-landing rules.
* The Su-57 gets a thrust-vectoring-inspired low-speed authority floor; the F-35 has a smoother, more stable profile. Aircraft use the supplied models (procedural fallbacks exist).

### AI
* Bandits: `PATROL → INTERCEPT → DOGFIGHT → DEFENSIVE_BREAK` driven by detection, range, threat, damage and ammunition; they obey the same flight model (no teleporting, no free speed). Manoeuvres: high-rate turn, defensive break, barrel roll, split-S, Immelmann, energy climb.
* Wingman: takeoff, formation (Echelon Right / Line Abreast / Trail), engage, cover, rejoin, defensive manoeuvres + flares, damage/threat callouts, interference-degraded perception, RTB and landing (with go-around). The wingman is built 40 % sturdier than the player (`damageScale 0.6`) so the story is about protecting her, not babysitting.

## Known limitations (honest list)
* Flight model, weapons and AI are gameplay approximations; tuning is based on automated tests and scripted flights, **not** on extended human playtesting.
* Terrain is procedural value-noise (visible banding on distant slopes). No weather effect on lift beyond turbulence and visibility.
* Voice uses the browser's speech synthesis when available (voices vary by OS) with a synthesised radio-babble fallback; subtitles are always shown.
* Replay Studio, Persian Gulf/Black Sea regions, time-of-day, dynamic reinforcement events, cosmetics beyond three liveries: **not implemented** (Phase 3+).
* No automated visual-regression tests; rendering was checked manually in the Claude desktop built-in browser (Intel UHD).
* Frame rate was not benchmarked across hardware. On the dev machine the GPU spent ~19 ms/frame at *Medium* in the built-in browser.

See `PROJECT_STATE.json` for the tracked status.
