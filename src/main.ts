import './style.css';
import { Game } from './game/Game';

const host = document.getElementById('app')!;

function fatal(msg: string) {
  host.innerHTML = `<div class="fatal"><h1>VANTAGE: ZERO</h1><p>${msg}</p></div>`;
}

function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; }
}

if (!webglAvailable()) {
  fatal('WebGL is not available in this browser, so the 3D game cannot start. Try a current Chrome, Edge or Firefox with hardware acceleration enabled.');
} else {
  try {
    const game = new Game(host);
    (window as unknown as { __vz?: unknown }).__vz = game;   // debug/automation handle
    void game.start();
  } catch (e) {
    console.error(e);
    fatal('Startup failed: ' + String(e));
  }
}
