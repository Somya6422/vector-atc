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
        "altitude": 15000,
        "target_altitude": 15000,
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
    global score, next_spawn, next_callsign
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
                    score += 1
                else:
                    score -= 1
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
    return {"aircraft": aircraft, "score": score, "gates": GATES}


@app.post("/api/command")
async def post_command(command: Command):
    global aircraft, score, next_callsign, next_spawn
    normalized = normalize_text(command.text)
    if re.search(r"\b(?:reset|restart)\s+(?:the\s+)?simulation\b", normalized):
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
                "altitude": 15000, "target_altitude": 15000,
                "ground_speed": 250, "target_speed": 250,
                "assigned_gate": "west", "in_conflict": False, "conflict_with": [],
            },
        ]
        score = 0
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
    speed = re.search(r"\b(?:speed|maintain)\s*(\d{2,3})\b", normalized)
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
    feedback_type = (
        "heading" if heading else "altitude" if flight_level or altitude
        else "speed" if speed else "gate" if gate else None
    )
    return {
        "normalized": normalized,
        "applied": applied,
        "callsign": plane["callsign"],
        "feedback": f"{feedback_type} Roger, {plane['callsign']}" if applied else None,
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
        canvas { position: fixed; inset: 0 var(--panel-width) 0 0; width: calc(100% - var(--panel-width)); height: 100%; border: 1px solid #315f40; background: radial-gradient(ellipse at center, #07150d 0%, #030a06 72%, #010402 100%); box-shadow: inset 0 0 70px 18px rgba(0, 0, 0, .82), inset 0 0 16px rgba(88, 255, 145, .1); }
        .label { position: fixed; top: 12px; left: 12px; color: var(--phosphor); font: 12px monospace; letter-spacing: .16em; text-shadow: 0 0 8px rgba(100, 255, 150, .55); }
        .score { position: fixed; top: 12px; right: calc(var(--panel-width) + 12px); color: var(--phosphor); font: 14px monospace; text-shadow: 0 0 8px rgba(100, 255, 150, .4); }
        .warning { display: none; position: fixed; z-index: 1; top: 12px; left: 50%; transform: translateX(-50%); padding: 8px 12px; border: 1px solid #ff5555; background: rgba(25, 5, 5, .92); color: #ff7777; font: bold 14px monospace; box-shadow: 0 0 16px rgba(255, 40, 40, .2); }
        .command-dock { position: fixed; z-index: 1; left: 12px; right: calc(var(--panel-width) + 12px); bottom: 12px; display: flex; align-items: center; gap: 12px; min-height: 44px; padding: 0 12px; border: 1px solid rgba(114, 255, 157, .55); border-radius: 3px; background: rgba(3, 14, 8, .94); box-shadow: 0 0 12px rgba(63, 255, 117, .12), inset 0 0 12px rgba(63, 255, 117, .05); }
        .voice-ready { flex: 0 0 auto; color: #78c990; font: 10px monospace; letter-spacing: .08em; white-space: nowrap; }
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
    </style>
</head>
<body>
    <canvas aria-label="Aircraft positions"></canvas>
    <div class="label">VECTOR</div>
    <div class="score">SCORE: 0</div>
    <div class="warning" role="alert">⚠ SEPARATION CONFLICT</div>
    <aside class="history" aria-label="Command history">
        <h2>COMMAND HISTORY</h2>
        <ol class="history-list"></ol>
    </aside>
    <div class="command-dock">
        <span class="voice-ready"><span class="voice-caret" aria-hidden="true">▍</span>READY FOR VOICE CLEARANCE</span>
        <input class="command" type="text" aria-label="Command" placeholder="Enter voice command...">
    </div>
    <script>
        const canvas = document.querySelector("canvas");
        const context = canvas.getContext("2d");
        const commandInput = document.querySelector(".command");
        const warningBanner = document.querySelector(".warning");
        const scoreDisplay = document.querySelector(".score");
        const historyList = document.querySelector(".history-list");
        let aircraft = [];
        let gates = {};
        let selectedCallsign = null;
        let bearingCursor = null;
        const trails = new Map();
        const commandHistory = [];
        let audioContext = null;
        let lastConflictPing = 0;

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

        function drawAircraft() {
            const width = window.innerWidth - 280;
            const height = window.innerHeight;
            const ratio = window.devicePixelRatio || 1;
            
            if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
                canvas.width = Math.round(width * ratio);
                canvas.height = Math.round(height * ratio);
            }
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            context.clearRect(0, 0, width, height);

            context.fillStyle = "#00ff66";
            context.strokeStyle = "#00ff66";
            context.font = "12px monospace";

            const centerX = width / 2;
            const centerY = height / 2;
            const pixelsPerNm = width / 60;
            context.strokeStyle = "rgba(0, 255, 102, 0.22)";
            context.fillStyle = "rgba(0, 255, 102, 0.65)";
            context.shadowColor = "rgba(0, 255, 102, 0.85)";
            context.shadowBlur = 8;
            context.textAlign = "left";
            for (const rangeNm of [15, 30, 45]) {
                context.beginPath();
                context.arc(centerX, centerY, rangeNm * pixelsPerNm, 0, Math.PI * 2);
                context.stroke();
                context.fillText(`${rangeNm} NM`, centerX + 5, centerY - rangeNm * pixelsPerNm + 14);
            }
            context.shadowBlur = 0;

            if (bearingCursor) {
                const angle = Math.atan2(bearingCursor.x - centerX, centerY - bearingCursor.y);
                context.save();
                context.strokeStyle = "#ffb347";
                context.fillStyle = "#ffcf70";
                context.shadowColor = "#ff9d24";
                context.shadowBlur = 9;
                context.lineWidth = 1.5;
                context.beginPath();
                context.moveTo(centerX, centerY);
                context.lineTo(bearingCursor.x, bearingCursor.y);
                context.stroke();
                const bearing = (Math.round((angle * 180 / Math.PI + 360) % 360) + 360) % 360;
                context.textAlign = "left";
                context.font = "11px monospace";
                context.fillText(`${String(bearing).padStart(3, "0")}°`, bearingCursor.x + 8, bearingCursor.y - 8);
                context.restore();
            }

            // Bearing ticks and labels around the outer 45 NM range ring.
            const compassRadius = 45 * pixelsPerNm;
            context.save();
            context.strokeStyle = "rgba(120, 255, 160, 0.38)";
            context.fillStyle = "rgba(150, 255, 180, 0.72)";
            context.lineWidth = 1;
            context.font = "9px monospace";
            context.textAlign = "center";
            context.textBaseline = "middle";
            for (let bearing = 0; bearing < 360; bearing += 10) {
                const angle = bearing * Math.PI / 180;
                const major = bearing % 30 === 0;
                const innerRadius = compassRadius - (major ? 10 : 5);
                context.beginPath();
                context.moveTo(centerX + Math.sin(angle) * innerRadius,
                    centerY - Math.cos(angle) * innerRadius);
                context.lineTo(centerX + Math.sin(angle) * compassRadius,
                    centerY - Math.cos(angle) * compassRadius);
                context.stroke();
                if (major) {
                    const labelRadius = compassRadius + 12;
                    context.fillText(String(bearing).padStart(3, "0"),
                        centerX + Math.sin(angle) * labelRadius,
                        centerY - Math.cos(angle) * labelRadius);
                }
            }
            context.setLineDash([2, 7]);
            context.strokeStyle = "rgba(100, 220, 135, 0.16)";
            context.beginPath();
            context.moveTo(centerX - compassRadius, centerY);
            context.lineTo(centerX + compassRadius, centerY);
            context.moveTo(centerX, centerY - compassRadius);
            context.lineTo(centerX, centerY + compassRadius);
            context.stroke();
            context.setLineDash([]);
            context.restore();

            context.fillStyle = "#00ff66";
            context.textAlign = "center";
            context.fillText("GATE NORTH · 5,000 FT", centerX, 20);
            context.fillText("GATE SOUTH · 15,000 FT", centerX, height - 10);
            context.save();
            context.translate(16, centerY);
            context.rotate(-Math.PI / 2);
            context.fillText("GATE WEST · 20,000 FT", 0, 0);
            context.restore();
            context.save();
            context.translate(width - 16, centerY);
            context.rotate(Math.PI / 2);
            context.fillText("GATE EAST · 10,000 FT", 0, 0);
            context.restore();
            context.textAlign = "left";

            const sweepAngle = (Date.now() % 4000) / 4000 * Math.PI * 2;
            const sweepRadius = Math.hypot(width, height);
            const sweepCanvasAngle = sweepAngle - Math.PI / 2;
            const coneGradient = context.createRadialGradient(
                centerX, centerY, 0, centerX, centerY, sweepRadius
            );
            coneGradient.addColorStop(0, "rgba(0, 255, 102, 0.2)");
            coneGradient.addColorStop(1, "rgba(0, 255, 102, 0.015)");
            context.fillStyle = coneGradient;
            context.beginPath();
            context.moveTo(centerX, centerY);
            context.arc(centerX, centerY, sweepRadius,
                sweepCanvasAngle - Math.PI / 12, sweepCanvasAngle);
            context.closePath();
            context.fill();
            context.strokeStyle = "rgba(0, 255, 102, 0.65)";
            context.shadowColor = "#00ff66";
            context.shadowBlur = 10;
            context.beginPath();
            context.moveTo(centerX, centerY);
            context.lineTo(centerX + Math.sin(sweepAngle) * sweepRadius,
                centerY - Math.cos(sweepAngle) * sweepRadius);
            context.stroke();
            context.shadowBlur = 0;
            context.strokeStyle = "#00ff66";

            for (const [callsign, positions] of trails) {
                for (let index = 0; index < positions.length; index++) {
                    const point = positions[index];
                    context.globalAlpha = (index + 1) / positions.length * 0.45;
                    context.shadowColor = "#00ff66";
                    context.shadowBlur = 9;
                    context.fillRect(point.x * width - 2, point.y * height - 2, 4, 4);
                }
            }
            context.globalAlpha = 1;
            context.shadowBlur = 0;

            const planesByCallsign = new Map(aircraft.map(plane => [plane.callsign, plane]));
            const conflictLines = new Set();
            let hasConflict = false;
            for (const plane of aircraft) {
                if (!plane.in_conflict) continue;
                hasConflict = true;
                for (const otherCallsign of plane.conflict_with || []) {
                    const key = [plane.callsign, otherCallsign].sort().join("|");
                    if (conflictLines.has(key)) continue;
                    conflictLines.add(key);
                    const other = planesByCallsign.get(otherCallsign);
                    if (!other) continue;
                    context.strokeStyle = "#ff3333";
                    context.beginPath();
                    context.moveTo(plane.x * width, plane.y * height);
                    context.lineTo(other.x * width, other.y * height);
                    context.stroke();
                }
            }
            warningBanner.style.display = hasConflict ? "block" : "none";
            if (hasConflict) playConflictPing();

            for (const plane of aircraft) {
                const x = plane.x * width;
                const y = plane.y * height;
                const safetyRadius = 3 * pixelsPerNm;
                context.save();
                context.beginPath();
                context.arc(x, y, safetyRadius, 0, Math.PI * 2);
                context.setLineDash([4, 4]);
                context.strokeStyle = plane.in_conflict ? "rgba(255, 55, 55, .8)" : "rgba(100, 220, 255, .35)";
                context.lineWidth = 1;
                context.stroke();
                context.setLineDash([]);
                context.restore();

                if (plane.callsign === selectedCallsign) {
                    const gatePoints = {
                        north: [x, 0], east: [width, y],
                        south: [x, height], west: [0, y],
                    };
                    const [gateX, gateY] = gatePoints[plane.assigned_gate] || [x, y];
                    context.save();
                    context.strokeStyle = "#65f6ff";
                    context.shadowColor = "#00eaff";
                    context.shadowBlur = 12;
                    context.setLineDash([7, 6]);
                    context.beginPath();
                    context.moveTo(x, y);
                    context.lineTo(gateX, gateY);
                    context.stroke();
                    context.setLineDash([]);
                    context.beginPath();
                    context.arc(x, y, 11, 0, Math.PI * 2);
                    context.lineWidth = 2;
                    context.stroke();
                    context.restore();
                }
                const heading = plane.heading * Math.PI / 180;
                const distancePixels = (plane.ground_speed / 60) * (width / 60);
                const conflicting = plane.in_conflict;
                const pulseOn = Math.floor(Date.now() / 400) % 2 === 0;
                const targetColor = conflicting
                    ? (pulseOn ? "#ff3333" : "#ff8888")
                    : "#00ff66";
                context.strokeStyle = targetColor;
                context.fillStyle = targetColor;
                context.shadowColor = conflicting ? "#ff2222" : "#00ff66";
                context.shadowBlur = conflicting && !pulseOn ? 8 : 12;

                // Velocity vector line
                context.beginPath();
                context.moveTo(x, y);
                context.lineTo(
                    x + Math.sin(heading) * distancePixels,
                    y - Math.cos(heading) * distancePixels
                );
                context.stroke();

                // ATC diamond target and offset data tag
                context.beginPath();
                context.moveTo(x, y - 5);
                context.lineTo(x + 5, y);
                context.lineTo(x, y + 5);
                context.lineTo(x - 5, y);
                context.closePath();
                context.stroke();
                const altitudeArrow = plane.altitude < plane.target_altitude
                    ? "↑"
                    : plane.altitude > plane.target_altitude ? "↓" : "";
                const gateCode = plane.assigned_gate[0].toUpperCase();
                const gateAltitude = gates[plane.assigned_gate];
                const gateAltitudeCode = Number.isFinite(gateAltitude) ? `${gateAltitude / 1000}K` : "—";
                const tag = `${plane.callsign} ${altitudeArrow}${plane.altitude} FT [gate ${gateCode} ${gateAltitudeCode}]`;
                const side = x > width - 230 ? -1 : 1;
                context.textAlign = side > 0 ? "left" : "right";
                context.beginPath();
                context.moveTo(x + side * 4, y - 3);
                context.lineTo(x + side * 9, y - 9);
                context.stroke();
                context.fillText(
                    tag,
                    x + side * 12,
                    y - 6
                );
                context.shadowBlur = 0;
            }
            context.textAlign = "left";
        }

        canvas.addEventListener("pointermove", (event) => {
            const rect = canvas.getBoundingClientRect();
            bearingCursor = { x: event.clientX - rect.left, y: event.clientY - rect.top };
            drawAircraft();
        });

        canvas.addEventListener("pointerleave", () => {
            bearingCursor = null;
            drawAircraft();
        });

        canvas.addEventListener("click", (event) => {
            const rect = canvas.getBoundingClientRect();
            const width = rect.width;
            const height = rect.height;
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;
            const plane = [...aircraft].reverse().find(item =>
                Math.hypot(item.x * width - x, item.y * height - y) <= 14
            );
            if (!plane) return;
            selectedCallsign = plane.callsign;
            commandInput.value = `${plane.callsign} `;
            commandInput.focus();
            commandInput.setSelectionRange(commandInput.value.length, commandInput.value.length);
            drawAircraft();
        });

        async function refreshAircraft() {
            try {
                const response = await fetch("/api/aircraft");
                if (!response.ok) throw new Error("Aircraft request failed");
                const state = await response.json();
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
                scoreDisplay.textContent = `SCORE: ${state.score}`;
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
            window.speechSynthesis.speak(utterance);
        }

        commandInput.addEventListener("keydown", async (event) => {
            if (event.key !== "Enter") return;
            const text = commandInput.value;
            commandInput.value = "";
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
                    if (result.reset) trails.clear();
                    speakPilotFeedback(result.feedback);
                    await refreshAircraft();
                }
            } catch (error) {
                console.error(error);
                addCommandHistory(text, false);
            }
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