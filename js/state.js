// Settings state, persistence and song-position helpers.
import {interval} from './theory.js';
import {SONGS, POSITIONS} from './songs.js';
import {storage, clamp} from './util.js';
import {Player} from './player.js';
import {UI} from './ui.js';

const DEFAULTS = {prog:'251', keyPc:0, bpm:120, swing:62, mode:'guide', pos:'5-9',
  rampStep:0, rampMax:240, rot:'off', rotEvery:1, dropout:'off', phrase:'off',
  mix:{bass:true, comp:true, drums:true}, gate:40,
  boardSize:'std',      // fretboard size: 'std' | 'large'
  audioOut:null,        // 'ear' | 'speaker', answered in the mic setup guide
  latency:null,         // measured play-to-detect offset in seconds; null = estimate
  micReady:false};      // mic setup guide finished (or skipped) once
const S = Object.assign({}, DEFAULTS, storage.get('jit-settings', {}));
S.mix = Object.assign({}, DEFAULTS.mix, S.mix);
if (!SONGS.some(s => s.id === S.prog)) S.prog = DEFAULTS.prog;
if (!POSITIONS[S.pos]) S.pos = DEFAULTS.pos;

/** Apply a settings patch, persist it and re-render what changed. */
function update(patch) {
  const changed = new Set();
  for (const k in patch) if (S[k] !== patch[k]) { S[k] = patch[k]; changed.add(k); }
  if (!changed.size) return;
  storage.set('jit-settings', S);
  if (changed.has('keyPc') || changed.has('rot') || changed.has('rotEvery')) Player.refreshPendingKey();
  UI.render(changed);
}
const setBpm = v => update({bpm: clamp(Math.round(v), 40, 300)});

/* =========================================================
   4. Song position helpers
   ========================================================= */
const song = () => SONGS.find(s => s.id === S.prog) || SONGS[0];
const loop = {a:null, b:null};
const loopActive = () => loop.a != null && loop.b != null;
function barRange() {
  const n = song().bars.length;
  return loopActive() ? [Math.min(loop.a, n - 1), Math.min(loop.b, n - 1)] : [0, n - 1];
}
const isLastBar = bar => { const [a, b] = barRange(); return bar >= b || bar < a; };
const nextBar = bar => isLastBar(bar) ? barRange()[0] : bar + 1;

function chordAt(bar, beat, keyPc = S.keyPc) {
  const s = song();
  const shift = interval(keyPc, s.keyPc);
  const chords = s.bars[bar] || s.bars[0];
  const c = chords.find(c => beat < c.start + c.beats) || chords[chords.length - 1];
  return {pc: (c.pc + shift) % 12, q: c.q, beats: c.beats, start: c.start, bar};
}
/** The chord that follows `ch`; `keyAfterWrap` is used when the chorus wraps (key rotation). */
function chordAfter(ch, keyAfterWrap = S.keyPc) {
  const end = ch.start + ch.beats;
  if (end < 4) return chordAt(ch.bar, end);
  return chordAt(nextBar(ch.bar), 0, isLastBar(ch.bar) ? keyAfterWrap : S.keyPc);
}
function selectSong(id) {
  if (id === S.prog) return;
  Object.assign(loop, {a:null, b:null});
  update({prog:id, keyPc: SONGS.find(s => s.id === id).keyPc});
  if (Player.playing) { Player.bar = barRange()[0]; Player.prevChord = null; }
}

export {DEFAULTS, S, update, setBpm, song, loop, loopActive, barRange, isLastBar, nextBar, chordAt, chordAfter, selectSong};
