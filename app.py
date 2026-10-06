import asyncio
from contextlib import asynccontextmanager
import math
import os
import random
import re
import string

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

# Aircraft coordinates are normalized to the canvas (0.0 to 1.0)
aircraft = [
    {
        "callsign": "Indigo 421",
        "x": 0.01,
        "y": 0.5,
        "heading": 90,
        "target_heading": 90,
        "altitude": 10000,
        "target_altitude": 10000,
        "ground_speed": 250,
        "target_speed": 250,
        "assigned_gate": "east",
        "in_conflict": False,
        "conflict_with": [],
    },
    {
        "callsign": "Vistara 60",
        "x": 0.99,
        "y": 0.5,
        "heading": 270,
        "target_heading": 270,
        "altitude": 10000,
        "target_altitude": 10000,
        "ground_speed": 250,
        "target_speed": 250,
        "assigned_gate": "west",
        "in_conflict": False,
        "conflict_with": [],
    },
]

SIMULATION_TICK_SECONDS = 0.5
SIMULATED_SECONDS_PER_TICK = 6
CANVAS_WIDTH_NM = 60
MAX_TURN_DEGREES_PER_TICK = 9
MAX_ALTITUDE_CHANGE_PER_TICK = 150
MAX_SPEED_CHANGE_PER_TICK = 10
HORIZONTAL_SEPARATION_NM = 6
VERTICAL_SEPARATION_FT = 1000
GATES = {"north": 5000, "east": 10000, "south": 15000, "west": 20000}
SPAWN_INTERVAL_SECONDS = 40
score = 0
streak = 0
mission_completed = False
mission_previous_x_gap = aircraft[0]["x"] - aircraft[1]["x"]
next_spawn = 0
next_callsign = 2
simulation_task = None


class Command(BaseModel):
    text: str


def normalize_text(text: str) -> str:
    text = text.lower().translate(str.maketrans("", "", string.punctuation))
    number_words = {
        "zero": "0", "one": "1", "two": "2", "three": "3",
        "four": "4", "five": "5", "six": "6", "seven": "7",
        "eight": "8", "nine": "9", "niner": "9",
    }
    text = re.sub(
        r"\b(?:zero|one|two|three|four|five|six|seven|eight|nine|niner)\b",
        lambda match: number_words[match.group(0)],
        text,
    )
    return re.sub(r"\b\d(?:\s+\d)+\b", lambda match: re.sub(r"\s+", "", match.group(0)), text)


async def run_simulation():
    global score, streak, next_spawn, next_callsign, mission_completed
    next_spawn = asyncio.get_running_loop().time() + SPAWN_INTERVAL_SECONDS
    while True:
        await asyncio.sleep(SIMULATION_TICK_SECONDS)
        now = asyncio.get_running_loop().time()
        if now >= next_spawn:
            edge = random.choice(tuple(GATES))
            gate = random.choice(tuple(GATES))
            positions = {
                "north": (random.random(), 0.01, 180),
                "east": (0.99, random.random(), 270),
                "south": (random.random(), 0.99, 0),
                "west": (0.01, random.random(), 90),
            }
            x, y, heading = positions[edge]
            aircraft.append({
                "callsign": f"VECTOR{next_callsign}", "x": x, "y": y,
                "heading": heading, "target_heading": heading,
                "altitude": GATES[gate], "target_altitude": GATES[gate],
                "ground_speed": 250, "target_speed": 250,
                "assigned_gate": gate, "in_conflict": False, "conflict_with": [],
            })
            next_callsign += 1
            next_spawn = now + SPAWN_INTERVAL_SECONDS

        for plane in aircraft:
            heading_change = (plane["target_heading"] - plane["heading"] + 180) % 360 - 180
            heading_change = max(
                -MAX_TURN_DEGREES_PER_TICK,
                min(MAX_TURN_DEGREES_PER_TICK, heading_change),
            )
            plane["heading"] = (plane["heading"] + heading_change) % 360

            altitude_change = plane["target_altitude"] - plane["altitude"]
            altitude_change = max(
                -MAX_ALTITUDE_CHANGE_PER_TICK,
                min(MAX_ALTITUDE_CHANGE_PER_TICK, altitude_change),
            )
            plane["altitude"] += altitude_change

            speed_change = plane["target_speed"] - plane["ground_speed"]
            speed_change = max(
                -MAX_SPEED_CHANGE_PER_TICK,
                min(MAX_SPEED_CHANGE_PER_TICK, speed_change),
            )
            plane["ground_speed"] += speed_change

            distance_nm = plane["ground_speed"] * SIMULATED_SECONDS_PER_TICK / 3600
            heading = math.radians(plane["heading"])
            plane["x"] += distance_nm * math.sin(heading) / CANVAS_WIDTH_NM
            plane["y"] -= distance_nm * math.cos(heading) / CANVAS_WIDTH_NM

        if not mission_completed:
            indigo = next((p for p in aircraft if p["callsign"] == "Indigo 421"), None)
            vistara = next((p for p in aircraft if p["callsign"] == "Vistara 60"), None)
            if indigo and vistara:
                x_gap = indigo["x"] - vistara["x"]
                crossed_horizontally = mission_previous_x_gap < 0 <= x_gap
                close_on_crossing = math.hypot(
                    (indigo["x"] - vistara["x"]) * CANVAS_WIDTH_NM,
                    (indigo["y"] - vistara["y"]) * CANVAS_WIDTH_NM,
                ) <= HORIZONTAL_SEPARATION_NM
                if (crossed_horizontally and close_on_crossing
                        and abs(indigo["altitude"] - vistara["altitude"]) >= VERTICAL_SEPARATION_FT):
                    score += 300
                    mission_completed = True
                mission_previous_x_gap = x_gap

        departed = []
        for plane in aircraft:
            if plane["x"] < 0 or plane["x"] > 1 or plane["y"] < 0 or plane["y"] > 1:
                if plane["x"] < 0:
                    exit_gate = "west"
                elif plane["x"] > 1:
                    exit_gate = "east"
                elif plane["y"] < 0:
                    exit_gate = "north"
                else:
                    exit_gate = "south"
                if (exit_gate == plane["assigned_gate"]
                        and abs(plane["altitude"] - GATES[exit_gate]) <= 500):
                    score += 100
                    streak += 1
                else:
                    score -= 100
                    streak = 0
                departed.append(plane)
        for plane in departed:
            aircraft.remove(plane)

        for plane in aircraft:
            plane["in_conflict"] = False
            plane["conflict_with"] = []

        for index, first in enumerate(aircraft):
            for second in aircraft[index + 1:]:
                horizontal_distance_nm = math.hypot(
                    (first["x"] - second["x"]) * CANVAS_WIDTH_NM,
                    (first["y"] - second["y"]) * CANVAS_WIDTH_NM,
                )
                vertical_distance_ft = abs(first["altitude"] - second["altitude"])
                if (
                    horizontal_distance_nm < HORIZONTAL_SEPARATION_NM
                    and vertical_distance_ft < VERTICAL_SEPARATION_FT
                ):
                    first["in_conflict"] = True
                    second["in_conflict"] = True
                    first["conflict_with"].append(second["callsign"])
                    second["conflict_with"].append(first["callsign"])

@asynccontextmanager
async def lifespan(app: FastAPI):
    global simulation_task
    simulation_task = asyncio.create_task(run_simulation())
    yield
    if simulation_task:
        simulation_task.cancel()
        try:
            await simulation_task
        except asyncio.CancelledError:
            pass


app = FastAPI(lifespan=lifespan)


@app.get("/api/aircraft")
async def get_aircraft():
    return {"aircraft": aircraft, "score": score, "streak": streak, "gates": GATES,
            "mission_completed": mission_completed}


@app.post("/api/command")
async def post_command(command: Command):
    global aircraft, score, streak, next_callsign, next_spawn, mission_completed, mission_previous_x_gap
    normalized = normalize_text(command.text)
    camera_command = re.search(r"\bcamera\s+(top|side|reset)\b", normalized)
    if camera_command:
        view = camera_command.group(1)
        return {
            "normalized": normalized,
            "applied": True,
            "camera_view": view,
            "feedback": {
                "top": "Camera set to top-down view",
                "side": "Camera set to eye-level view",
                "reset": "Camera restored to isometric view",
            }[view],
        }
    if (re.search(r"\bvector\s+reset\b", normalized)
            or re.search(r"\b(?:reset|restart)\s+(?:the\s+)?simulation\b", normalized)):
        aircraft = [
            {
                "callsign": "Indigo 421", "x": 0.01, "y": 0.5,
                "heading": 90, "target_heading": 90,
                "altitude": 10000, "target_altitude": 10000,
                "ground_speed": 250, "target_speed": 250,
                "assigned_gate": "east", "in_conflict": False, "conflict_with": [],
            },
            {
                "callsign": "Vistara 60", "x": 0.99, "y": 0.5,
                "heading": 270, "target_heading": 270,
                "altitude": 10000, "target_altitude": 10000,
                "ground_speed": 250, "target_speed": 250,
                "assigned_gate": "west", "in_conflict": False, "conflict_with": [],
            },
        ]
        score = 0
        streak = 0
        mission_completed = False
        mission_previous_x_gap = aircraft[0]["x"] - aircraft[1]["x"]
        next_callsign = 2
        next_spawn = asyncio.get_running_loop().time() + SPAWN_INTERVAL_SECONDS
        return {
            "normalized": normalized,
            "applied": True,
            "reset": True,
            "feedback": "Simulation reset. Indigo 421 and Vistara 60",
        }

    match = re.search(r"\b(?:vector|indigo|vistara|speedbird)\s*(\d+)\b", normalized)
    if match:
        callsign_digits = match.group(1)
    else:
        callsign_digits = next(
            (token for token in re.findall(r"\b\d+\b", normalized)
             if any(re.search(r"\d+$", p["callsign"]).group() == token for p in aircraft)),
            None,
        )
    if callsign_digits is None:
        return {"normalized": normalized, "applied": False}
    plane = next(
        (p for p in aircraft if re.search(r"\d+$", p["callsign"]).group() == callsign_digits),
        None,
    )
    if not plane:
        return {"normalized": normalized, "applied": False}

    heading = re.search(r"\bheading\s*(\d{1,3})\b", normalized)
    flight_level = re.search(r"\b(?:flight\s+level|fl)\s*(\d{1,3})\b", normalized)
    altitude = re.search(r"\b(?:altitude|climb|descend)\s*(\d{3,5})\b", normalized)
    speed = re.search(
        r"\b(?:increase\s+speed\s+to|reduce\s+speed\s+to|maintain\s+speed|speed)\s*(\d{2,3})(?:\s*knots?)?\b",
        normalized,
    )
    gate = re.search(r"\b(north|east|south|west)\s+gate\b|\bgate\s+(north|east|south|west)\b", normalized)
    if heading:
        plane["target_heading"] = int(heading.group(1)) % 360
    if flight_level:
        plane["target_altitude"] = int(flight_level.group(1)) * 100
    elif altitude:
        plane["target_altitude"] = int(altitude.group(1))
    if speed:
        plane["target_speed"] = int(speed.group(1))
    if gate:
        selected_gate = gate.group(1) or gate.group(2)
        plane["target_heading"] = {"north": 0, "east": 90, "south": 180, "west": 270}[selected_gate]
        plane["target_altitude"] = GATES[selected_gate]
    applied = bool(heading or flight_level or altitude or speed or gate)
    readback = []
    digit_words = dict(enumerate((
        "zero", "one", "two", "three", "four",
        "five", "six", "seven", "eight", "niner",
    )))

    def spoken_digits(value, width=0):
        return " ".join(digit_words[int(digit)] for digit in str(value).zfill(width))

    if heading or gate:
        readback.append(f"heading {spoken_digits(plane['target_heading'], 3)}")
    if flight_level or altitude or gate:
        readback.append(f"altitude {spoken_digits(plane['target_altitude'])}")
    if speed:
        readback.append(f"speed {spoken_digits(plane['target_speed'], 3)}")
    feedback = f"{', '.join(readback)}, Roger, {plane['callsign']}" if applied else None
    return {
        "normalized": normalized,
        "applied": applied,
        "callsign": plane["callsign"],
        "feedback": feedback,
    }


@app.get("/", response_class=HTMLResponse)
async def index():
    return """<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>VECTOR</title>
    <style>
        * { box-sizing: border-box; }
        html, body { margin: 0; width: 100%; height: 100%; background: #050b08; overflow: hidden; }
        :root { --panel-width: 280px; --phosphor: #8cffb0; }
        #radar { position: fixed; inset: 0 var(--panel-width) 0 0; border: 1px solid #315f40; background: radial-gradient(ellipse at center, #07150d 0%, #030a06 72%, #010402 100%); box-shadow: inset 0 0 70px 18px rgba(0, 0, 0, .82), inset 0 0 16px rgba(88, 255, 145, .1); }
        #radar canvas { display: block; width: 100%; height: 100%; }
        .label { position: fixed; top: 12px; left: 12px; color: var(--phosphor); font: 12px monospace; letter-spacing: .16em; text-shadow: 0 0 8px rgba(100, 255, 150, .55); }
        .score { position: fixed; top: 12px; right: calc(var(--panel-width) + 12px); color: var(--phosphor); font: 14px monospace; text-shadow: 0 0 8px rgba(100, 255, 150, .4); }
        .celebration { position: fixed; z-index: 2; left: calc((100% - var(--panel-width)) / 2); top: 50%; color: #00ff66; font: bold 25px monospace; text-shadow: 0 0 8px #00ff66, 0 0 22px #00ff66; pointer-events: none; transform: translate(-50%, -50%); animation: score-float 1.25s ease-out forwards; }
        @keyframes score-float { from { opacity: 1; transform: translate(-50%, 0); } to { opacity: 0; transform: translate(-50%, -100px); } }
        .command-guide { position: fixed; left: 12px; bottom: 68px; padding: 9px 11px; border: 1px solid rgba(114, 255, 157, .4); background: rgba(3, 14, 8, .88); color: #9fe8b2; font: 10px/1.5 monospace; text-shadow: 0 0 6px rgba(100, 255, 150, .25); pointer-events: none; }
        .command-guide strong { display: block; margin-bottom: 3px; color: var(--phosphor); font-weight: normal; letter-spacing: .1em; }
        .warning { display: none; position: fixed; z-index: 1; top: 12px; left: 50%; transform: translateX(-50%); padding: 8px 12px; border: 1px solid #ff5555; background: rgba(25, 5, 5, .92); color: #ff7777; font: bold 14px monospace; box-shadow: 0 0 16px rgba(255, 40, 40, .2); }
        .mission { position: fixed; z-index: 2; top: 42px; left: 12px; max-width: min(460px, calc(100% - var(--panel-width) - 24px)); padding: 9px 12px; border: 1px solid #40dfff; background: rgba(3, 14, 24, .9); color: #a8f4ff; font: 11px/1.45 monospace; box-shadow: 0 0 15px #00c8ff35; }
        .mission strong { display: block; color: #57e7ff; letter-spacing: .1em; }
        .command-dock { position: fixed; z-index: 1; left: 12px; right: calc(var(--panel-width) + 12px); bottom: 12px; display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 12px; border: 1px solid rgba(114, 255, 157, .55); border-radius: 3px; background: rgba(3, 14, 8, .94); box-shadow: 0 0 12px rgba(63, 255, 117, .12), inset 0 0 12px rgba(63, 255, 117, .05); }
        .voice-ready { flex: 0 0 auto; color: #78c990; font: 10px monospace; letter-spacing: .08em; white-space: nowrap; }
        .voice-toggle { flex: 0 0 auto; padding: 6px 9px; border: 1px solid #3b7650; border-radius: 2px; background: #0a1b10; color: var(--phosphor); font: 10px monospace; letter-spacing: .06em; cursor: pointer; }
        .voice-toggle:hover, .voice-toggle[aria-pressed="true"] { border-color: #8cffb0; background: #153522; box-shadow: 0 0 12px rgba(63, 255, 117, .25); }
        .voice-toggle[aria-pressed="true"] { color: #fff; }
        .voice-caret { display: inline-block; margin-right: 6px; color: #9bffb7; animation: caret-pulse 1.2s steps(2, start) infinite; text-shadow: 0 0 8px #65ff91; }
        @keyframes caret-pulse { to { visibility: hidden; } }
        .command { flex: 1; min-width: 0; padding: 10px 0; border: 0; background: transparent; color: var(--phosphor); font: 13px monospace; outline: none; }
        .command::placeholder { color: #668a70; }
        .command-dock:focus-within { border-color: rgba(143, 255, 174, .9); box-shadow: 0 0 16px rgba(63, 255, 117, .2), inset 0 0 14px rgba(63, 255, 117, .07); }
        .history { position: fixed; top: 0; right: 0; width: var(--panel-width); height: 100%; padding: 18px 14px; overflow: auto; border-left: 1px solid #315f40; background: linear-gradient(160deg, #0b1710, #050b07 68%); color: var(--phosphor); font: 13px monospace; box-shadow: -12px 0 28px rgba(0, 0, 0, .45); }
        .history h2 { margin: 0 0 16px; color: #a3e9b5; font-size: 14px; font-weight: normal; letter-spacing: .12em; }
        .history-list { list-style: none; margin: 0; padding: 0; }
        .history-list li { padding: 10px 0; border-top: 1px solid #1b3825; overflow-wrap: anywhere; }
        .understood { color: #00ff66; }
        .not-understood { color: #ff6666; }
        .help-button { position: fixed; z-index: 2; top: 9px; left: 104px; padding: 4px 8px; border: 1px solid rgba(140, 255, 176, .55); border-radius: 2px; background: rgba(3, 14, 8, .9); color: var(--phosphor); font: 11px monospace; cursor: pointer; }
        .help-button:hover, .briefing-button:hover { background: #153522; box-shadow: 0 0 12px rgba(63, 255, 117, .28); }
        .briefing-overlay { position: fixed; z-index: 10; inset: 0; display: grid; place-items: center; padding: 20px; overflow-y: auto; background: rgba(0, 0, 0, .82); }
        .briefing-modal { position: relative; width: min(720px, 100%); max-height: 100%; overflow-y: auto; padding: 25px 28px; border: 1px solid #72ff9d; background: repeating-linear-gradient(0deg, rgba(0, 255, 102, .035) 0 1px, transparent 1px 4px), radial-gradient(ellipse at center, #0b2012, #030a06 78%); color: #c5f5d0; font: 13px/1.6 monospace; box-shadow: 0 0 30px rgba(0, 255, 102, .22), inset 0 0 30px rgba(0, 255, 102, .08); text-shadow: 0 0 5px rgba(100, 255, 150, .2); }
        .briefing-modal h1 { margin: 0 0 5px; color: var(--phosphor); font-size: 18px; letter-spacing: .12em; }
        .briefing-kicker { margin: 0 0 18px; color: #78c990; font-size: 10px; letter-spacing: .16em; }
        .briefing-modal section { padding: 12px 0; border-top: 1px solid rgba(114, 255, 157, .25); }
        .briefing-modal h2 { margin: 0 0 6px; color: #a3e9b5; font-size: 13px; letter-spacing: .08em; }
        .briefing-modal p { margin: 5px 0; }
        .briefing-modal ul { margin: 5px 0 0; padding-left: 20px; }
        .briefing-modal li { margin: 3px 0; }
        .briefing-modal code { color: #b8ffc9; font: inherit; }
        .briefing-button { display: block; margin: 16px auto 0; padding: 11px 18px; border: 1px solid #72ff9d; border-radius: 2px; background: #0b2714; color: var(--phosphor); font: bold 12px monospace; letter-spacing: .08em; cursor: pointer; }
        @media (max-width: 600px) { .briefing-modal { padding: 20px 16px; font-size: 12px; } .help-button { left: 92px; } }
    </style>
</head>
<body>
    <div id="radar" role="img" aria-label="Interactive three-dimensional tactical radar volume"></div>
    <div class="label">VECTOR</div>
    <button class="help-button" type="button" aria-label="Reopen controller briefing">[?] BRIEFING</button>
    <div class="score">SCORE: 0 · STREAK: 0 · BEST: 0</div>
    <div class="mission"><strong>ACTIVE MISSION // ONE: SCISSOR CROSSING</strong>Separate Indigo 421 and Vistara 60 vertically while maintaining forward headings — earn +300 points.</div>
    <div class="warning" role="alert">⚠ SEPARATION CONFLICT</div>
    <div class="command-guide" aria-label="Command examples">
        <strong>COMMAND GUIDE</strong>
        Heading: Indigo 421 heading 090<br>
        Flight level: Indigo 421 flight level 100<br>
        Speed: Vistara 60 speed 250<br>
        Gate: Vistara 60 west gate<br>
        Reset: VECTOR reset
    </div>
    <aside class="history" aria-label="Command history">
        <h2>COMMAND HISTORY</h2>
        <ol class="history-list"></ol>
    </aside>
    <div class="command-dock">
        <span class="voice-ready" role="status" aria-live="polite"><span class="voice-caret" aria-hidden="true">▍</span>VOICE STANDBY</span>
        <button class="voice-toggle" type="button" aria-pressed="false">🎙 START VOICE</button>
        <input class="command" type="text" aria-label="Command" placeholder="Enter voice command...">
    </div>
    <div class="briefing-overlay" role="presentation">
        <article class="briefing-modal" role="dialog" aria-modal="true" aria-labelledby="briefing-title">
            <h1 id="briefing-title">TACTICAL PREFLIGHT BRIEFING</h1>
            <p class="briefing-kicker">VECTOR ATC // CONTROLLER ORIENTATION</p>
            <section>
                <h2>01 // THE GOLDEN RULE</h2>
                <p><strong>Strict zero typing.</strong> Speak every clearance using Wispr Flow voice detection. Keyboard use is limited to pressing <strong>Enter</strong> to submit recognized speech; do not type commands.</p>
            </section>
            <section>
                <h2>02 // YOUR OBJECTIVE</h2>
                <p>Vector each aircraft safely to its assigned perimeter gate at that gate's required altitude. Maintain at least <strong>3 nautical miles</strong> of horizontal separation and <strong>1,000 ft</strong> of vertical separation at all times.</p>
            </section>
            <section>
                <h2>03 // APPROVED PHRASEBOOK</h2>
                <ul>
                    <li>Heading: <code>“Indigo 421 heading 090”</code></li>
                    <li>Flight level: <code>“Vistara 60 flight level 150”</code></li>
                    <li>Altitude: <code>“Indigo 421 climb 12000”</code> or <code>“Vistara 60 descend 9000”</code></li>
                    <li>Speed: <code>“Indigo 421 speed 220”</code></li>
                    <li>Direct gate clearance: <code>“Vistara 60 west gate”</code> (automatically assigns gate heading and altitude)</li>
                    <li>Vector reset: <code>“VECTOR reset”</code></li>
                </ul>
            </section>
            <section>
                <h2>04 // PROFESSIONAL CONTROLLER SECRETS</h2>
                <ul>
                    <li>Altitude separates planes five times faster than turns.</li>
                    <li>Flight levels avoid preposition speech errors.</li>
                    <li>Orbit the camera in 3D to verify vertical clearance.</li>
                    <li>Say callsign followed by gate name to automatically lock gate heading and altitude.</li>
                </ul>
            </section>
            <button class="briefing-button" type="button">ACKNOWLEDGE AND BEGIN</button>
        </article>
    </div>
    <script type="importmap">
        {"imports": {"three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"}}
    </script>
    <script type="module">
        import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
        import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js";
        const radar = document.querySelector("#radar");
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(radar.clientWidth, radar.clientHeight);
        renderer.setClearColor(0x030a06, 1);
        radar.append(renderer.domElement);
        const scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x030a06, 0.006);
        const camera = new THREE.PerspectiveCamera(48, radar.clientWidth / radar.clientHeight, 0.1, 250);
        camera.position.set(49, 42, 58);
        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, 10, 0);
        controls.enableDamping = true;
        controls.dampingFactor = 0.06;
        controls.minDistance = 24;
        controls.maxDistance = 120;
        let cameraAnimationFrame = null;
        function animateCamera(view) {
            const destinations = {
                top: new THREE.Vector3(0, 88, 0.01),
                side: new THREE.Vector3(0, 12, 88),
                reset: new THREE.Vector3(49, 42, 58),
            };
            const destination = destinations[view];
            if (!destination) return;
            if (cameraAnimationFrame !== null) cancelAnimationFrame(cameraAnimationFrame);
            const startPosition = camera.position.clone();
            const startTarget = controls.target.clone();
            const endTarget = new THREE.Vector3(0, 10, 0);
            const startedAt = performance.now();
            controls.enabled = false;
            const step = now => {
                const progress = Math.min((now - startedAt) / 1100, 1);
                const eased = progress * progress * (3 - 2 * progress);
                camera.position.lerpVectors(startPosition, destination, eased);
                controls.target.lerpVectors(startTarget, endTarget, eased);
                camera.lookAt(controls.target);
                if (progress < 1) cameraAnimationFrame = requestAnimationFrame(step);
                else {
                    cameraAnimationFrame = null;
                    controls.enabled = true;
                }
            };
            cameraAnimationFrame = requestAnimationFrame(step);
        }
        scene.add(new THREE.AmbientLight(0x8bdca2, 1.5));
        const keyLight = new THREE.PointLight(0x55ff99, 50, 100);
        keyLight.position.set(0, 30, 0);
        scene.add(keyLight);
        const movingLight = new THREE.PointLight(0x70ffd0, 95, 42, 1.7);
        movingLight.position.set(-22, 14, -18);
        scene.add(movingLight);
        const movingLightMarker = new THREE.Mesh(
            new THREE.SphereGeometry(.38, 12, 10),
            new THREE.MeshBasicMaterial({ color: 0x9bffe0 })
        );
        scene.add(movingLightMarker);
        const dynamicLayer = new THREE.Group();
        scene.add(dynamicLayer);
        function line(points, color, opacity = 1) {
            const geometry = new THREE.BufferGeometry().setFromPoints(points);
            const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
            return new THREE.Line(geometry, material);
        }
        function buildRadarVolume() {
            const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60),
                new THREE.MeshBasicMaterial({ color: 0x06120b, side: THREE.DoubleSide }));
            ground.rotation.x = -Math.PI / 2;
            ground.position.y = -0.04;
            scene.add(ground);
            const grid = new THREE.GridHelper(60, 60, 0x277344, 0x153b25);
            grid.position.y = 0;
            scene.add(grid);
            const volume = new THREE.Mesh(
                new THREE.BoxGeometry(60, 24, 60),
                new THREE.MeshBasicMaterial({ color: 0x38c978, wireframe: true, transparent: true, opacity: .035 })
            );
            volume.position.y = 12;
            scene.add(volume);
            scene.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(60, 24, 60)),
                new THREE.LineBasicMaterial({ color: 0x38c978, transparent: true, opacity: .55 })));
            for (const [altitude, label] of [[5, "FL050"], [10, "FL100"], [15, "FL150"], [20, "FL200"]]) {
                const plane = new THREE.PlaneGeometry(60, 60);
                const mesh = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ color: 0x45d889, wireframe: true, transparent: true, opacity: .09, side: THREE.DoubleSide }));
                mesh.rotation.x = -Math.PI / 2;
                mesh.position.y = altitude;
                scene.add(mesh);
                const tick = line([new THREE.Vector3(-30, altitude, -30), new THREE.Vector3(30, altitude, -30)], 0x55e997, .65);
                scene.add(tick);
                addText(label, -29, altitude + .15, -30, "#8cffb0");
            }
            const gateFrameMaterial = new THREE.MeshStandardMaterial({
                color: 0x39d9e8, emissive: 0x087c88, emissiveIntensity: 1.4,
                metalness: .35, roughness: .3
            });
            const gateLightMaterial = new THREE.MeshBasicMaterial({ color: 0x9cffff });
            for (const [name, altitude, x, z, rotation] of [
                ["NORTH", 5, 0, -29.45, 0], ["EAST", 10, 29.45, 0, Math.PI / 2],
                ["SOUTH", 15, 0, 29.45, 0], ["WEST", 20, -29.45, 0, Math.PI / 2]
            ]) {
                const gate = new THREE.Group();
                gate.position.set(x, altitude, z);
                gate.rotation.y = rotation;
                for (const side of [-1, 1]) {
                    const post = new THREE.Mesh(new THREE.BoxGeometry(.34, 4.8, .42), gateFrameMaterial);
                    post.position.set(side * 4, 0, 0);
                    gate.add(post);
                    const footing = new THREE.Mesh(new THREE.BoxGeometry(1.05, .22, .9), gateFrameMaterial);
                    footing.position.set(side * 4, -2.42, 0);
                    gate.add(footing);
                    const beacon = new THREE.Mesh(new THREE.SphereGeometry(.23, 10, 8), gateLightMaterial);
                    beacon.position.set(side * 4, 2.5, 0);
                    gate.add(beacon);
                }
                const lintel = new THREE.Mesh(new THREE.BoxGeometry(8.35, .3, .42), gateFrameMaterial);
                lintel.position.y = 2.4;
                gate.add(lintel);
                const threshold = new THREE.Mesh(new THREE.BoxGeometry(7.7, .08, .7), gateLightMaterial);
                threshold.position.y = -2.45;
                gate.add(threshold);
                scene.add(gate);

                const approach = new THREE.Group();
                approach.position.set(x, .07, z);
                approach.rotation.y = rotation;
                const centerline = line([
                    new THREE.Vector3(0, 0, -18), new THREE.Vector3(0, 0, -4.5)
                ], 0x48eaff, .6);
                approach.add(centerline);
                for (let distance = 6; distance <= 18; distance += 4) {
                    for (const side of [-1, 1]) {
                        const marker = new THREE.Mesh(new THREE.BoxGeometry(.24, .08, .8), gateLightMaterial);
                        marker.position.set(side * 1.6, 0, -distance);
                        approach.add(marker);
                    }
                }
                scene.add(approach);
                addText(`GATE ${name} · ${altitude * 1000} FT`, x, altitude + 3.4, z, "#6befff");
            }
        }
        function addText(text, x, y, z, color) {
            const canvas = document.createElement("canvas");
            canvas.width = 512; canvas.height = 64;
            const ctx = canvas.getContext("2d");
            ctx.font = "bold 28px monospace"; ctx.fillStyle = color; ctx.textAlign = "center";
            ctx.shadowColor = color; ctx.shadowBlur = 12; ctx.fillText(text, 256, 42);
            const texture = new THREE.CanvasTexture(canvas);
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
            sprite.position.set(x, y, z); sprite.scale.set(9, 1.125, 1); scene.add(sprite);
        }
        buildRadarVolume();
        function animate(now = 0) {
            requestAnimationFrame(animate);
            const time = now * .00035;
            movingLight.position.set(Math.cos(time) * 23, 13 + Math.sin(time * 1.7) * 5,
                Math.sin(time * .72) * 23);
            movingLightMarker.position.copy(movingLight.position);
            controls.update();
            renderer.render(scene, camera);
        }
        animate();
        window.addEventListener("resize", () => {
            const width = radar.clientWidth;
            const height = radar.clientHeight;
            camera.aspect = width / Math.max(height, 1);
            camera.updateProjectionMatrix();
            renderer.setSize(width, height);
        });
        const commandInput = document.querySelector(".command");
        const voiceStatus = document.querySelector(".voice-ready");
        const voiceToggle = document.querySelector(".voice-toggle");
        const warningBanner = document.querySelector(".warning");
        const scoreDisplay = document.querySelector(".score");
        const historyList = document.querySelector(".history-list");
        const briefingOverlay = document.querySelector(".briefing-overlay");
        const briefingButton = document.querySelector(".briefing-button");
        const helpButton = document.querySelector(".help-button");
        let aircraft = [];
        let gates = {};
        let missionComplete = false;
        let selectedCallsign = null;
        let bearingCursor = null;
        const trails = new Map();
        const commandHistory = [];
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        let recognition = null;
        let voiceActive = false;
        let voiceSubmitTimer = null;
        let audioContext = null;
        let lastConflictPing = 0;
        let previousScore = null;
        let bestScore = Number.parseInt(localStorage.getItem("vectorBestScore") || "0", 10);
        if (!Number.isFinite(bestScore) || bestScore < 0) bestScore = 0;

        function enableAudio() {
            if (!audioContext) {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                if (!AudioContext) return;
                audioContext = new AudioContext();
            }
            if (audioContext.state === "suspended") audioContext.resume();
        }

        window.addEventListener("pointerdown", enableAudio);
        window.addEventListener("keydown", enableAudio);

        function openBriefing() {
            briefingOverlay.style.display = "grid";
            briefingButton.focus();
        }

        function acknowledgeBriefing() {
            enableAudio();
            briefingOverlay.style.display = "none";
            commandInput.focus();
        }

        briefingButton.addEventListener("click", acknowledgeBriefing);
        helpButton.addEventListener("click", openBriefing);

        function updateVoiceBeacon(message, active = voiceActive) {
            voiceStatus.lastChild.textContent = message || (active ? "LISTENING FOR CLEARANCE" : "VOICE STANDBY");
            voiceToggle.setAttribute("aria-pressed", String(active));
            voiceToggle.textContent = active ? "■ STOP VOICE" : "🎙 START VOICE";
        }

        if (SpeechRecognition) {
            recognition = new SpeechRecognition();
            recognition.lang = "en-US";
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.onstart = () => { voiceActive = true; updateVoiceBeacon(); };
            recognition.onresult = event => {
                let transcript = "";
                let hasFinal = false;
                for (let index = event.resultIndex; index < event.results.length; index++) {
                    transcript += event.results[index][0].transcript;
                    hasFinal ||= event.results[index].isFinal;
                }
                if (transcript.trim()) commandInput.value = transcript.trim();
                if (hasFinal) {
                    clearTimeout(voiceSubmitTimer);
                    voiceSubmitTimer = setTimeout(() => {
                        if (commandInput.value.trim()) submitCommand();
                    }, 700);
                }
            };
            recognition.onerror = event => {
                if (event.error === "not-allowed" || event.error === "service-not-allowed") {
                    voiceActive = false;
                    updateVoiceBeacon("MICROPHONE ACCESS DENIED", false);
                } else if (event.error !== "aborted" && event.error !== "no-speech") {
                    updateVoiceBeacon("VOICE INPUT ERROR", false);
                }
            };
            recognition.onend = () => {
                voiceActive = false;
                updateVoiceBeacon();
            };
            voiceToggle.addEventListener("click", () => {
                if (voiceActive) {
                    recognition.stop();
                    return;
                }
                try {
                    recognition.start();
                    updateVoiceBeacon("REQUESTING MICROPHONE", true);
                } catch (error) {
                    updateVoiceBeacon("VOICE INPUT UNAVAILABLE", false);
                }
            });
        } else {
            voiceToggle.disabled = true;
            voiceToggle.textContent = "VOICE UNSUPPORTED";
            updateVoiceBeacon("USE TEXT COMMAND", false);
        }

        function playConflictPing() {
            if (!audioContext || audioContext.state !== "running") return;
            const now = audioContext.currentTime;
            if (now - lastConflictPing < 1) return;
            lastConflictPing = now;

            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();
            oscillator.type = "sine";
            oscillator.frequency.setValueAtTime(800, now);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
            oscillator.connect(gain);
            gain.connect(audioContext.destination);
            oscillator.start(now);
            oscillator.stop(now + 0.18);
        }

        function playClearanceChime() {
            if (!audioContext || audioContext.state !== "running") return;
            const now = audioContext.currentTime;
            for (const [offset, frequency] of [[0, 660], [0.16, 990]]) {
                const oscillator = audioContext.createOscillator();
                const gain = audioContext.createGain();
                oscillator.type = "sine";
                oscillator.frequency.setValueAtTime(frequency, now + offset);
                gain.gain.setValueAtTime(0.0001, now + offset);
                gain.gain.exponentialRampToValueAtTime(0.16, now + offset + 0.025);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.22);
                oscillator.connect(gain);
                gain.connect(audioContext.destination);
                oscillator.start(now + offset);
                oscillator.stop(now + offset + 0.23);
            }
        }

        function showClearancePulse() {
            const pulse = document.createElement("div");
            pulse.className = "celebration";
            pulse.textContent = "+100";
            document.body.append(pulse);
            pulse.addEventListener("animationend", () => pulse.remove(), { once: true });
            playClearanceChime();
        }

        function drawAircraft() {
            while (dynamicLayer.children.length) {
                const object = dynamicLayer.children.pop();
                object.parent = null;
                object.traverse(child => {
                    child.geometry?.dispose();
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material?.dispose();
                });
            }
            let hasConflict = false;
            for (const plane of aircraft) {
                const x = (plane.x - .5) * 60;
                const z = (plane.y - .5) * 60;
                const altitude = plane.altitude / 1000;
                const conflict = plane.in_conflict;
                hasConflict ||= conflict;
                const color = conflict ? 0xff2929 : 0x49ff86;
                const pulse = conflict && Math.floor(Date.now() / 300) % 2 === 0;
                const group = new THREE.Group();
                group.position.set(x, altitude, z);
                const arrow = new THREE.Mesh(new THREE.ConeGeometry(.62, 2.1, 4), new THREE.MeshBasicMaterial({ color: pulse ? 0xff9999 : color }));
                arrow.rotation.x = Math.PI / 2;
                arrow.rotation.y = -plane.heading * Math.PI / 180;
                group.add(arrow);
                dynamicLayer.add(group);
                const positions = trails.get(plane.callsign) || [];
                if (positions.length > 1) {
                    const trailPoints = positions.map(position => new THREE.Vector3(
                        (position.x - .5) * 60, altitude + .08, (position.y - .5) * 60
                    ));
                    const trail = line(trailPoints, color, conflict ? .75 : .42);
                    dynamicLayer.add(trail);
                }
                const headingRadians = plane.heading * Math.PI / 180;
                const vectorEnd = new THREE.Vector3(
                    x + Math.sin(headingRadians) * 4,
                    altitude + .12,
                    z - Math.cos(headingRadians) * 4
                );
                dynamicLayer.add(line([new THREE.Vector3(x, altitude + .12, z), vectorEnd], pulse ? 0xff5555 : 0x8cffb0, .8));
                const drop = line([new THREE.Vector3(x, 0, z), new THREE.Vector3(x, altitude, z)], pulse ? 0xff2020 : 0x54eaff, .8);
                dynamicLayer.add(drop);
                const shadow = new THREE.Mesh(new THREE.CircleGeometry(.65, 20), new THREE.MeshBasicMaterial({ color: pulse ? 0xff2222 : 0x62eaff, transparent: true, opacity: .8, side: THREE.DoubleSide }));
                shadow.rotation.x = -Math.PI / 2; shadow.position.set(x, .035, z); dynamicLayer.add(shadow);
                const halo = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 1, 32, 1, true), new THREE.MeshBasicMaterial({ color: pulse ? 0xff2222 : 0x55dfff, wireframe: true, transparent: true, opacity: conflict ? .9 : .28 }));
                halo.position.set(x, altitude, z); dynamicLayer.add(halo);
                addDynamicLabel(plane, x, altitude + 1.5, z, pulse ? "#ff7777" : "#9dffc0");
                if (plane.callsign === selectedCallsign) {
                    const selection = new THREE.Mesh(new THREE.SphereGeometry(.9, 16, 12), new THREE.MeshBasicMaterial({ color: 0x54eaff, wireframe: true }));
                    selection.position.set(x, altitude, z); dynamicLayer.add(selection);
                }
            }
            warningBanner.style.display = hasConflict ? "block" : "none";
            if (hasConflict) playConflictPing();
        }

        function addDynamicLabel(plane, x, y, z, color) {
            const canvas = document.createElement("canvas"); canvas.width = 512; canvas.height = 64;
            const ctx = canvas.getContext("2d"); ctx.font = "bold 26px monospace"; ctx.fillStyle = color;
            ctx.shadowColor = color; ctx.shadowBlur = 10;
            ctx.fillText(`${plane.callsign} · ${Math.round(plane.altitude)} FT · ${plane.ground_speed} KT`, 8, 42);
            const texture = new THREE.CanvasTexture(canvas);
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
            sprite.position.set(x + 2, y, z); sprite.scale.set(10, 1.25, 1); dynamicLayer.add(sprite);
        }
        const raycaster = new THREE.Raycaster();
        const pointer = new THREE.Vector2();
        radar.addEventListener("click", event => {
            const rect = radar.getBoundingClientRect();
            pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
            raycaster.setFromCamera(pointer, camera);
            const picks = raycaster.intersectObjects(dynamicLayer.children, true);
            const picked = picks.find(hit => hit.object.parent?.position && aircraft.some(p =>
                Math.hypot((p.x - .5) * 60 - hit.object.parent.position.x, (p.y - .5) * 60 - hit.object.parent.position.z) < 2));
            if (!picked) return;
            const p = aircraft.find(item => Math.hypot((item.x - .5) * 60 - picked.object.parent.position.x, (item.y - .5) * 60 - picked.object.parent.position.z) < 2);
            if (!p) return;
            selectedCallsign = p.callsign;
            commandInput.value = `${p.callsign} `; commandInput.focus();
            commandInput.setSelectionRange(commandInput.value.length, commandInput.value.length);
            drawAircraft();
        });

        async function refreshAircraft() {
            try {
                const response = await fetch("/api/aircraft");
                if (!response.ok) throw new Error("Aircraft request failed");
                const state = await response.json();
                if (previousScore !== null && state.score > previousScore) {
                    const clearances = Math.floor((state.score - previousScore) / 100);
                    for (let index = 0; index < clearances; index++) showClearancePulse();
                }
                previousScore = state.score;
                if (state.score > bestScore) {
                    bestScore = state.score;
                    localStorage.setItem("vectorBestScore", String(bestScore));
                }
                aircraft = state.aircraft;
                gates = state.gates;
                if (!aircraft.some(plane => plane.callsign === selectedCallsign)) selectedCallsign = null;
                const activeCallsigns = new Set(aircraft.map(plane => plane.callsign));
                for (const callsign of trails.keys()) {
                    if (!activeCallsigns.has(callsign)) trails.delete(callsign);
                }
                for (const plane of aircraft) {
                    const positions = trails.get(plane.callsign) || [];
                    positions.push({ x: plane.x, y: plane.y });
                    if (positions.length > 5) positions.shift();
                    trails.set(plane.callsign, positions);
                }
                scoreDisplay.textContent = `SCORE: ${state.score} · STREAK: ${state.streak} · BEST: ${bestScore}`;
                drawAircraft();
            } catch (error) {
                console.error(error);
            }
        }

        function addCommandHistory(text, understood) {
            commandHistory.unshift({ text, understood });
            commandHistory.length = Math.min(commandHistory.length, 8);
            historyList.replaceChildren(...commandHistory.map(command => {
                const item = document.createElement("li");
                item.textContent = command.text || "(empty command)";
                const status = document.createElement("div");
                status.className = command.understood ? "understood" : "not-understood";
                status.textContent = command.understood ? "UNDERSTOOD" : "NOT UNDERSTOOD";
                item.append(status);
                return item;
            }));
        }

        function speakPilotFeedback(text) {
            if (!text || !("speechSynthesis" in window)) return;
            window.speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 1;
            const squelch = () => {
                if (!audioContext || audioContext.state !== "running") return;
                const duration = 0.04;
                const frameCount = Math.floor(audioContext.sampleRate * duration);
                const buffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
                const samples = buffer.getChannelData(0);
                for (let i = 0; i < frameCount; i++) samples[i] = Math.random() * 2 - 1;
                const source = audioContext.createBufferSource();
                const filter = audioContext.createBiquadFilter();
                const gain = audioContext.createGain();
                const now = audioContext.currentTime;
                source.buffer = buffer;
                filter.type = "highpass";
                filter.frequency.setValueAtTime(900, now);
                gain.gain.setValueAtTime(0.0001, now);
                gain.gain.exponentialRampToValueAtTime(0.16, now + 0.006);
                gain.gain.setValueAtTime(0.16, now + 0.028);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
                source.connect(filter);
                filter.connect(gain);
                gain.connect(audioContext.destination);
                source.start(now);
                source.stop(now + duration);
            };
            squelch();
            utterance.onend = squelch;
            utterance.onerror = squelch;
            window.speechSynthesis.speak(utterance);
        }

        async function submitCommand() {
            const text = commandInput.value.trim();
            if (!text) return;
            commandInput.value = "";
            updateVoiceBeacon();
            try {
                const response = await fetch("/api/command", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text })
                });
                if (!response.ok) throw new Error("Command request failed");
                const result = await response.json();
                addCommandHistory(text, result.applied);
                if (result.applied) {
                    if (result.camera_view) animateCamera(result.camera_view);
                    if (result.reset) trails.clear();
                    speakPilotFeedback(result.feedback);
                    await refreshAircraft();
                }
            } catch (error) {
                console.error(error);
                addCommandHistory(text, false);
            }
        }

        commandInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") submitCommand();
        });

        window.addEventListener("resize", drawAircraft);
        refreshAircraft();
        window.setInterval(refreshAircraft, 250);
    </script>
</body>
</html>"""


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app:app",
        host="127.0.0.1",
        port=8000,
        reload=True,
    )