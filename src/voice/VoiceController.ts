import { parseCommands, describe, type Cmd } from './CommandParser';
import type { Settings } from '../ui/Settings';
import { bindings, keyName } from '../game/Bindings';

export interface VoiceHost {
  settings: Settings;
  /** menu / game-level commands (pause, map, launch, pick pilot…). Return feedback text, or null if the command is not a global one. */
  handleGlobal(cmd: Cmd): string | null;
  /** in-flight commands; null when there is no active (unpaused) flight */
  flightExec(cmd: Cmd): string | null;
  resetInput(): void;
  click(): void;
}

const GLOBAL_TYPES = new Set(['pause', 'resume', 'map', 'objectives', 'restart', 'hangar', 'menu', 'new_campaign', 'pick_route', 'launch', 'briefing', 'continue', 'settings', 'controls', 'credits', 'back', 'interact']);
type SR = { start(): void; stop(): void; onresult: ((e: unknown) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null; continuous: boolean; interimResults: boolean; lang: string };

/**
 * Voice / text command line.
 *  - Wispr Flow (or any dictation tool) types into the focused command field; the game then parses and executes the text.
 *    Wispr Flow has no public API, so this text field is the integration point: press Enter (rebindable) to focus it,
 *    hold your Wispr hotkey and speak. Dictation that arrives as one burst is sent automatically.
 *  - Optional built-in browser speech recognition (Chrome/Edge) feeds the very same parser.
 */
export class VoiceController {
  readonly root: HTMLElement;
  private input: HTMLInputElement;
  private log: HTMLElement;
  private micBtn: HTMLButtonElement;
  private rec: SR | null = null;
  private micOn = false;
  private sendTimer = 0;
  private lastLen = 0;
  private lastInputAt = 0;
  private burst = 0;
  readonly history: { text: string; feedback: string[] }[] = [];

  constructor(host: HTMLElement, private h: VoiceHost) {
    this.root = document.createElement('div'); this.root.id = 'voice';
    this.root.innerHTML = `
      <div class="vlog" aria-live="polite"></div>
      <div class="vrow">
        <span class="vmic" title="Voice commands">🎙</span>
        <input type="text" class="vin" autocomplete="off" spellcheck="false" aria-label="Voice or text command" />
        <button class="vbtn vsend" title="Send">↵</button>
        <button class="vbtn vmicbtn" title="Browser microphone (speech recognition)">MIC</button>
      </div>
      <div class="vhint"></div>`;
    host.appendChild(this.root);
    this.input = this.root.querySelector('.vin')!; this.log = this.root.querySelector('.vlog')!; this.micBtn = this.root.querySelector('.vmicbtn')!;
    this.root.querySelector('.vsend')!.addEventListener('click', () => this.sendNow());
    this.micBtn.addEventListener('click', () => this.toggleMic());
    this.input.addEventListener('focus', () => { h.resetInput(); this.root.classList.add('focus'); this.updateHint(); });
    this.input.addEventListener('blur', () => { h.resetInput(); this.root.classList.remove('focus'); this.updateHint(); });
    this.input.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.sendNow(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.input.value = ''; this.input.blur(); }
    });
    this.input.addEventListener('keyup', e => e.stopPropagation());
    this.input.addEventListener('input', e => this.onInput(e as InputEvent));
    this.updateHint();
  }

  private updateHint() {
    const key = keyName(bindings.code('voice'));
    (this.root.querySelector('.vhint') as HTMLElement).textContent = this.root.classList.contains('focus')
      ? 'Speak with Wispr Flow now (or type) · Enter sends · Esc cancels'
      : `Press ${key} to speak or type a command · try “gear down and throttle eighty percent”`;
  }

  focus() { this.input.focus(); this.input.select(); }
  get focused() { return document.activeElement === this.input; }
  setVisible(v: boolean) { this.root.style.display = v ? 'block' : 'none'; }

  /** Dictation (Wispr Flow) arrives as one pasted burst or as very fast typing; ordinary typing waits for Enter. */
  private onInput(e: InputEvent) {
    const now = performance.now(), len = this.input.value.length, grew = len - this.lastLen;
    if (now - this.lastInputAt < 60) this.burst += Math.max(1, grew); else this.burst = Math.max(0, grew);
    const dictated = grew >= 6 || e.inputType === 'insertFromPaste' || e.inputType === 'insertReplacementText' || this.burst >= 8;
    this.lastLen = len; this.lastInputAt = now;
    clearTimeout(this.sendTimer);
    if (dictated && this.h.settings.data.voiceAutoSend && len > 1) this.sendTimer = window.setTimeout(() => this.sendNow(), 650);
  }

  sendNow() {
    clearTimeout(this.sendTimer);
    const text = this.input.value.trim();
    this.input.value = ''; this.lastLen = 0;
    if (text) this.submit(text, 'typed');
    if (!this.h.settings.data.voiceKeepFocus) this.input.blur();
  }

  /** source: 'typed' covers keyboard and Wispr Flow dictation; 'mic' is the browser recogniser. */
  submit(text: string, source: 'typed' | 'mic') {
    let cmds = parseCommands(text);
    if (source === 'mic') cmds = cmds.filter(c => c.t !== 'unknown' && (c.t !== 'radio' || /^\s*(tell|ask|radio|ground|specter|wingman)/i.test(text)));
    if (!cmds.length) return;
    const out: string[] = [];
    for (const c of cmds) {
      if (c.t === 'unknown') { out.push('✗ Not understood. Try “gear down”, “heading 270”, “climb to 4000 feet”, “cover me”, “land”.'); continue; }
      let fb: string | null = null;
      if (GLOBAL_TYPES.has(c.t)) fb = this.h.handleGlobal(c);
      if (fb === null) fb = this.h.flightExec(c);
      out.push(`✓ ${describe(c)} — ${fb ?? 'not available in this screen'}`);
    }
    this.h.click();
    this.history.push({ text, feedback: out }); if (this.history.length > 50) this.history.shift();
    this.show(text, out, source);
  }

  say(text: string) { this.show('', [text], 'typed'); }

  private show(heard: string, lines: string[], source: string) {
    const frag = document.createDocumentFragment();
    if (heard) { const d = document.createElement('div'); d.className = 'vheard'; d.textContent = `${source === 'mic' ? '🎙' : '›'} ${heard}`; frag.append(d); }
    for (const l of lines) { const d = document.createElement('div'); d.className = 'vfb' + (l.startsWith('✗') ? ' bad' : ''); d.textContent = l; frag.append(d); }
    this.log.append(frag);
    while (this.log.children.length > 7) this.log.firstElementChild!.remove();
    this.root.classList.add('active'); clearTimeout(this.fade);
    this.fade = window.setTimeout(() => this.root.classList.remove('active'), 7000);
  }
  private fade = 0;

  // ------------------------------------------------------------------ browser speech recognition
  get micSupported() { const w = window as unknown as Record<string, unknown>; return !!(w.SpeechRecognition || w.webkitSpeechRecognition); }
  toggleMic() {
    if (this.micOn) { this.stopMic(); return; }
    const w = window as unknown as Record<string, new () => SR>;
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) { this.say('✗ This browser has no built-in speech recognition. Use Wispr Flow (dictate into the command field) or Chrome/Edge.'); return; }
    const rec = this.rec = new Ctor(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
    rec.onresult = (ev: unknown) => {
      const e = ev as { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> };
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) { this.input.placeholder = ''; this.submit(r[0].transcript, 'mic'); } else this.input.placeholder = '🎙 ' + r[0].transcript;
      }
    };
    rec.onerror = e => { if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { this.say('✗ Microphone permission was denied.'); this.stopMic(); } else if (e.error === 'network') { this.say('✗ Speech service unreachable (needs internet). Wispr Flow dictation still works.'); this.stopMic(); } };
    rec.onend = () => { if (this.micOn) window.setTimeout(() => { try { rec.start(); } catch { /* already running */ } }, 250); };
    try { rec.start(); this.micOn = true; this.micBtn.classList.add('on'); this.micBtn.textContent = 'MIC ●'; this.say('🎙 Listening (browser microphone).'); } catch { this.say('✗ Could not start the microphone.'); }
  }
  /** true while the browser speech recogniser is listening */
  get listening() { return this.micOn; }
  stopMic() { this.micOn = false; try { this.rec?.stop(); } catch { /* ignore */ } this.rec = null; this.micBtn.classList.remove('on'); this.micBtn.textContent = 'MIC'; this.input.placeholder = ''; }
}
