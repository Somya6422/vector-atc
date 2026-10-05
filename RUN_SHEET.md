
---

# VECTOR — Recording Run Sheet

> **Keep this document visible on a secondary monitor or phone during recording.**  
> Nothing here is typed code — the code must come out of your mouth on camera using Wispr Flow.

---

## 🎙️ The Pitch (First 20 Seconds)

> *"Air traffic control is the one job on earth that runs entirely on voice. So I'm going to build an ATC radar simulator — using only my voice — and then play it with my voice. I won't type a single character of content. Keyboard is for Enter, Tab, and mouse clicks only."*

**Why this framing works:**
1. States the technical constraint immediately.
2. Explains why the simulation genre naturally fits voice dictation.
3. Sets up the live closing gameplay demo.

---

## ✈️ Pre-Flight Checklist (Before Hitting Record)

- [ ] **Wispr Flow Account:** Verified created via [`ref.wisprflow.ai/hhg`](https://ref.wisprflow.ai/hhg).
- [ ] **Push-to-Talk (PTT):** Wispr Flow set strictly to **Push-to-Talk** (NOT always-on).
- [ ] **Dictionary Primed:** Added to Wispr dictionary:
  - `FastAPI`, `uvicorn`, `callsign`, `VECTOR`, `Indigo`, `Vistara`, `Speedbird`.
- [ ] **Environment Ready:** Python virtual environment pre-created with `pip install fastapi uvicorn` completed off-camera.
- [ ] **Three-Pane Screen Layout:**
  - **Left Pane:** Code Editor (VS Code / Cursor).
  - **Top-Right Pane:** Browser radar scope (`http://127.0.0.1:8000`).
  - **Bottom-Right Pane:** Terminal running `uvicorn app:app --reload`.
- [ ] **Audio Check:** Mic levels verified (no clipping) and Wispr indicator badge clearly visible in frame.

---

## 🧱 The Build Beats (Spoken Prompts)

Speak intent and behavior to your AI agent. Release PTT before narrating your thoughts to the camera.

---

### Beat 1 — Scaffold (5 min)
**Spoken Prompt:**
> *"Create a FastAPI project with a single Python file named app dot py. It should serve one static HTML page at the root. The page needs a full screen black canvas with a thin green border, and the word VECTOR in small monospace text in the top left corner. Run it with uvicorn on port eight thousand with auto reload. Keep it minimal — no extra folders, no config files."*
- **Target:** Black radar screen loads in browser; Uvicorn running cleanly.
- **Fallback:** If auto-reload glitches on camera, restart Uvicorn manually.

---

### Beat 2 — One Aircraft on the Scope (8 min)
**Spoken Prompt:**
> *"Add an aircraft to the server as a simple in-memory object. It has a callsign, an x and y position, a heading in degrees, an altitude in feet, and a ground speed in knots. Add an endpoint that returns all aircraft as JSON. On the page, poll that endpoint four times a second and draw each aircraft as a small filled square with its callsign and altitude in green monospace text next to it."*
- **Target:** Stationary green blip with data tag visible on canvas.

---

### Beat 3 — Make It Move (8 min)
**Spoken Prompt:**
> *"Add a background task on the server that ticks twice a second. On each tick, move every aircraft forward along its current heading based on its ground speed, but advance the simulation by six seconds of simulated time per tick so the game runs twelve times faster than real life. Treat the canvas as sixty nautical miles across. Also draw a short line ahead of each aircraft showing where it will be in one minute."*
- **Narrate to Camera:** Explain why 12× time compression matters (a jet at 400 knots takes 9 minutes to cross 60 NM; at 12×, it takes 45 seconds).

---

### Beat 4 — The Command Box & Number Normalizer (10 min)
**Spoken Prompt:**
> *"Add a text input pinned to the bottom of the page. When I press Enter, send its contents to a new endpoint on the server and clear the box. On the server, before anything else, normalize the text: lowercase it, strip all punctuation, and convert spoken number words into digits. Handle zero through nine, handle niner meaning nine, and stitch spaced digits together. Accept both spoken words and digits."*
- **Narrate to Camera:** Explain that Wispr outputs numbers sometimes as words and sometimes as digits, so normalizer tolerance is essential.

---

### Beat 5 — The Parser (12 min) [Syntax Showpiece]
*Dictate raw logic directly or guide your coding agent with strict parsing rules:*
**Spoken Prompt:**
> *"In the post command endpoint, build a forgiving ATC command parser. Match target aircraft by callsign name or by trailing digits. Parse heading changes with turn left heading or heading followed by degrees. Parse altitude with flight level multiplied by one hundred, or direct climb and descend commands. Also extract speed commands. Return whether the command was applied."*
- **Key Principle:** Forgiveness over strictness. Match on callsign digits so imperfect transcriptions still find the plane.

---

### Beat 6 — Gradual Turns & Climbs (8 min)
**Spoken Prompt:**
> *"Aircraft shouldn't snap to their new heading. Give each one a target heading, target altitude, and target speed. On every tick, turn at most nine degrees toward the target taking the shorter way round the compass, climb or descend at most one hundred and fifty feet, and change speed gradually. The data tag should show an up or down arrow while altitude is changing."*
- **Narrate to Camera:** 150 ft/tick at 6 simulated seconds is 1,500 ft/min (realistic jet climb rate); 9°/tick is 1.5°/second.

---

### Beat 7 — Separation & Conflict Alert (10 min)
**Spoken Prompt:**
> *"After every tick, check every pair of aircraft. If they are within three nautical miles horizontally and within one thousand feet vertically, mark both aircraft in conflict. Draw a flashing red line between them, flash their data tags red, display a warning banner, and trigger an eighty-hertz radar alarm ping using Web Audio."*
- **Action:** Point out this is the core stakes mechanic that transforms a visualization into a game.

---

### Beat 8 — Gates, Score & Spawn Loop (10 min)
**Spoken Prompt:**
> *"Add four exit gates, one on each edge of the scope, each with a required altitude. Gate North at five thousand, Gate East at ten thousand, Gate South at fifteen thousand, and Gate West at twenty thousand. When an aircraft exits through its assigned gate within five hundred feet of the gate altitude, add a point; otherwise lose a point. Spawn new aircraft every forty seconds and display the score."*
- **Cut-Line Check:** If time is tight, stop here. Beats 1–8 represent a fully playable, demonstrable game.

---

### Beat 9 — Polish & CRT Aesthetics (8 min) [Optional]
**Spoken Prompt:**
> *"Add CRT phosphor radar polish: a rotating conical sweep fan, fading phosphor position trails, dogleg leader lines for data tags, range rings at fifteen, thirty, and forty-five nautical miles, and a command log panel on the right. When a command succeeds, use browser speech synthesis to speak a short pilot readback."*

---

## 🎬 The Closing Demo (Final 2 Minutes — Unbroken Shot)

1. **Clean Start:** Refresh `http://localhost:8000` (click canvas once to unlock Web Audio).
2. **Initial Clearance:** Hold PTT and speak:
   > *"Indigo four two one, turn left heading two seven zero, descend flight level one two zero."*
   - Point out the blip banking, the `↓` arrow, and the pilot readback audio.
3. **Trigger Deliberate Conflict:**
   - Vector `Indigo 421` and `Vistara 60` toward each other at the same altitude until the red vector line connects them and the alarm sounds.
4. **Resolve Live on Camera:** Hold PTT and speak:
   > *"Vistara six zero, climb flight level two four zero."*
   - Watch Vistara climb and the conflict line disappear once 1,000 FT separation is restored.
5. **Score a Departure:**
   - Guide a plane across its perimeter gate at the correct altitude → watch the score tick up.
6. **Closing Line to Camera:**
   > *"Every line of that was dictated. So was every command I just used to fly it. I never typed a character."*

---

## ⚠️ Voice Traps to Avoid

- **The Homophone Trap:** Controllers say *"descend flight level one two zero"*, not *"descend to two thousand"*. Avoid prepositions.
- **PTT Discipline:** Press & hold → Speak intent → Release PTT → Talk to camera. Never narrate to the camera while holding PTT.
- **Callsign Cadence:** Say *"Indigo four two one"*, not *"Indigo four-hundred-twenty-one"*.

```