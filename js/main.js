// Entry point: event wiring, startup and service worker registration.
import {S, update, setBpm, selectSong} from './state.js';
import {$, storage} from './util.js';
import {Player} from './player.js';
import {Stats, applyPreset} from './stats.js';
import {Mic, Calib, LatCalib} from './mic.js';
import {Seg, UI} from './ui.js';
import {Wake} from './frame.js';
import {Synth} from './synth.js';
import {MicSetup} from './setup.js';
import * as Voicing from './voicing.js';
import {COMP_RHYTHMS} from './band.js';
import {SONGS} from './songs.js';

const taps = [];
const ACTIONS = {
  play:      () => Player.toggle(),
  tab:       b => UI.switchTab(b.dataset.tab),
  song:      b => selectSong(b.dataset.id),
  bar:       b => UI.tapBar(+b.dataset.bar),
  loopClear: () => UI.clearLoop(),
  mix:       b => update({mix:{...S.mix, [b.dataset.part]: !S.mix[b.dataset.part]}}),
  mic:       () => { if (!Mic.on && !S.micReady) MicSetup.open(true); else Mic.toggle(); },
  calib:     () => Calib.run(),
  latCalib:  () => LatCalib.run(),
  micSetup:  () => MicSetup.open(false),
  msOut:     b => MicSetup.pickOut(b.dataset.out),
  msNext:    () => MicSetup.next(),
  msBack:    () => MicSetup.back(),
  msClose:   () => MicSetup.close(),
  introMore: () => $('intro').classList.add('open'),
  advice:    b => applyPreset(UI.advice[+b.dataset.i].apply),
  intro:     () => { $('intro').hidden = true; storage.set('jit-intro-done', true); },
  reset:     () => { if (confirm('これまでの判定記録を消しますか？')) { Stats.reset(); UI.renderLog(); UI.renderMetrics(); } },
  tap:       () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now); if (taps.length > 5) taps.shift();
    if (taps.length >= 2) setBpm(60000 / ((taps[taps.length - 1] - taps[0]) / (taps.length - 1)));
  }
};
document.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  const seg = b.closest('[data-seg]');
  if (seg && b.dataset.i != null) { Seg.pick(seg.dataset.seg, +b.dataset.i); return; }
  const fn = ACTIONS[b.dataset.action]; if (fn) fn(b);
});

/** Tap = one step, hold = repeat. */
function holdToRepeat(btn, step) {
  let t1 = 0, t2 = 0, repeated = false;
  const end = () => { clearTimeout(t1); clearInterval(t2); };
  btn.addEventListener('pointerdown', () => { repeated = false; t1 = setTimeout(() => { repeated = true; t2 = setInterval(() => setBpm(S.bpm + step), 110); }, 420); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, end));
  btn.addEventListener('contextmenu', e => e.preventDefault());
  btn.addEventListener('click', () => { if (repeated) { repeated = false; return; } setBpm(S.bpm + step); });
}
holdToRepeat($('tDown'), -5);
holdToRepeat($('tUp'), 5);

$('bpmRange').addEventListener('input', e => setBpm(+e.target.value));
$('swRange').addEventListener('input', e => update({swing:+e.target.value}));
$('gateRange').addEventListener('input', e => update({gate:+e.target.value}));

// Space / page-turner pedals (PageDown, PageUp, arrows) toggle playback.
document.addEventListener('keydown', e => {
  if ($('micSetup').open) return;
  if (e.target.closest && e.target.closest('input,select,textarea')) return;
  const onButton = e.target.closest && e.target.closest('button');
  const pedal = ['PageDown', 'PageUp', 'ArrowRight', 'ArrowLeft'].includes(e.key);
  if (pedal || (e.code === 'Space' && !onButton)) { e.preventDefault(); Player.toggle(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) Stats.flush();
  else if (Player.playing) { Wake.on(); Synth.resume(); }
});

$('micSetup').addEventListener('close', () => MicSetup.onClosed());

UI.init();

// Test seam: an automated test can pre-define window.__adlibTest to reach the internals.
if (window.__adlibTest) Object.assign(window.__adlibTest, {S, update, Player, Mic, Calib, LatCalib, Synth, Stats, UI, MicSetup, Voicing, COMP_RHYTHMS, SONGS});

// Offline support when served over HTTPS (GitHub Pages). Silently skipped elsewhere.
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
