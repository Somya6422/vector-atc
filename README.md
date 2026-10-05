
---

# VECTOR ✈️🎙️

> **A voice-built, voice-played Air Traffic Control radar simulator.**  
> Built entirely using voice dictation via [Wispr Flow](https://ref.wisprflow.ai/hhg).

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11%2B-blue.svg)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110%2B-009688.svg)](https://fastapi.tiangolo.com/)

---

## 💡 The Premise

Air traffic control is one of the only professions on Earth that runs almost exclusively on voice. **VECTOR** embraces that constraint end-to-end:

1. **Voice-Built:** Every line of backend logic, regex parsing, Canvas math, and CRT styling was constructed on camera using **Wispr Flow** push-to-talk dictation. The keyboard was strictly reserved for `Enter`, `Tab`, and window navigation.
2. **Voice-Played:** Once built, aircraft on the scope are guided exclusively through spoken ATC phraseology and callsigns.

---

## 🌟 Key Features

- **Cathode Ray Tube (CRT) Scope Display:** High-contrast tactical radar scope featuring a 15° fading conical sweep beam, phosphor trails, concentric range rings (15/30/45 NM), and dogleg data blocks.
- **Realistic Kinematics & Time Compression:** Runs at 12× real-world speed (6 seconds of simulated flight time per 0.5s tick) with realistic turn limits (9°/tick) and vertical climb/descent ceilings (150 ft/tick).
- **Separation Assurance & Conflict Detection:** Automatically flags aircraft violating standard radar separation minima (< 3 NM horizontal and < 1,000 FT vertical) with flashing data blocks, visual conflict vectors, and an 800 Hz CRT audio ping.
- **Forgiving Voice Normalizer & Parser:** Robustly cleans spoken input, maps numbers (`niner`, `to/two`), stitches spaced digits (`"4 2 1"` → `421`), and handles Flight Levels (`FL 120` → `12,000 FT`).
- **Scored Exit Gates:** Perimeter exit gates with strict altitude arrival gates (`Gate North @ 5,000 FT`, `Gate East @ 10,000 FT`, `Gate South @ 15,000 FT`, `Gate West @ 20,000 FT`).
- **Pilot Voice Readback:** Emits real-time auditory confirmation using the browser's native Web Speech synthesis API.

---

## 🛠️ Architecture & Tech Stack

- **Backend:** Python 3.11+, [FastAPI](https://fastapi.tiangolo.com/), and [Uvicorn](https://www.uvicorn.org/).
- **Simulation Loop:** Asynchronous background loop running non-blocking dead reckoning and pair-wise collision math.
- **Frontend:** Single-file zero-dependency HTML5 Canvas, Web Audio API, and Web Speech API.
- **Voice Ingestion:** [Wispr Flow](https://ref.wisprflow.ai/hhg).

---

## 🚀 Quickstart

### 1. Prerequisites
- Python 3.11 or newer
- [Wispr Flow](https://ref.wisprflow.ai/hhg) installed and configured to **Push-to-Talk**.

### 2. Installation
```bash
# Clone the repository
git clone 'https://github.com/Somya6422/vector-atc.git'
cd vector-atc

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

```

### 3. Run the Simulator

```bash
uvicorn app:app --reload --host 127.0.0.1 --port 8000

```

Open **`http://localhost:8000`** in your browser.

*(Note: Click anywhere on the radar scope once to unlock browser audio for conflict alarm pings).*

---

## 🎙️ Spoken ATC Clearances

Click into the command bar (or leave it focused) and hold your Wispr Flow push-to-talk hotkey:

| Desired Action | Spoken ATC Phraseology Example |
| --- | --- |
| **Heading Change** | *"Indigo 421, turn left heading 270"* |
| **Flight Level** | *"Vistara 60, climb flight level 240"* |
| **Direct Altitude** | *"Vector 2, descend 5000"* |
| **Speed Adjustment** | *"Speedbird 11, maintain speed 220"* |
| **Gate Clearance** | *"Indigo 421, proceed gate east"* |
| **Compound Clearance** | *"Indigo 421, heading 180, climb flight level 150"* |


---

## 📄 License

Distributed under the [MIT License](https://www.google.com/search?q=LICENSE).

```
