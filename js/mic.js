// Microphone: pitch detection (YIN), note onsets and judging against the chord.
import {CHORDS, interval, classify} from './theory.js';
import {clamp} from './util.js';
import {S, update} from './state.js';
import {Synth, setAudioSession} from './synth.js';
import {Player} from './player.js';
import {Stats} from './stats.js';
import {Board} from './board.js';
import {UI} from './ui.js';
import {Loop} from './frame.js';

const Mic = {
  on:false, stream:null, src:null, an:null,
  raw:new Float32Array(2048), x:new Float32Array(1024), d:new Float32Array(700),
  cand:null, candN:0, last:null, lastAt:0, silent:0, low:1,
  gate() { return 0.002 + (61 - S.gate) * 0.0009; },          // sensitivity 1..60 → RMS threshold
  async start() {
    if (this.on) return true;
    const fail = msg => { UI.micError(msg); return false; };
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)
      return fail('この表示環境ではマイクを使えません。SafariかChromeでページを開いてください。');
    Synth.init(); setAudioSession('play-and-record');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true, noiseSuppression:false, autoGainControl:false}});
      await Synth.resume();
      const src = Synth.ctx.createMediaStreamSource(stream), an = Synth.ctx.createAnalyser();
      an.fftSize = 2048; src.connect(an);
      Object.assign(this, {on:true, stream, src, an, cand:null, candN:0, last:null, silent:0, low:1});
      UI.micError(''); UI.micState(); Loop.ensure();
      return true;
    } catch (e) {
      setAudioSession('playback');
      return fail(e && e.name === 'NotAllowedError'
        ? 'マイクの使用が許可されませんでした。ブラウザの設定で許可してから、もう一度オンにしてください。'
        : 'マイクを開けませんでした。この表示環境で制限されている可能性があります。SafariかChromeでページを開いてください。');
    }
  },
  stop() {
    if (!this.on) return;
    this.on = false;
    try { this.stream.getTracks().forEach(t => t.stop()); this.src.disconnect(); } catch (e) {}
    setAudioSession('playback'); UI.micState();
    if (Calib.active) { Calib.active = false; UI.calibMsg('マイクがオフになったため中断しました。'); }
    if (LatCalib.active) { LatCalib.active = false; UI.latState({running:false, msg:'マイクがオフになったため中断しました。'}); }
  },
  toggle() { this.on ? this.stop() : this.start(); },
  /** YIN on a 2x-downsampled frame. Returns {rms, f} (f = -1 when no pitch). */
  detect() {
    this.an.getFloatTimeDomainData(this.raw);
    const x = this.x, n = x.length; let rms = 0;
    for (let i = 0; i < n; i++) { const v = (this.raw[2 * i] + this.raw[2 * i + 1]) * 0.5; x[i] = v; rms += v * v; }
    rms = Math.sqrt(rms / n);
    if (rms < this.gate()) return {rms, f:-1};
    const sr = Synth.ctx.sampleRate / 2;
    const minLag = Math.floor(sr / 1400), maxLag = Math.min(Math.floor(sr / 72), n - 200, this.d.length - 2), W = n - maxLag;
    const d = this.d; d[0] = 1; let run = 0;
    for (let tau = 1; tau <= maxLag; tau++) {
      let s = 0; for (let i = 0; i < W; i++) { const df = x[i] - x[i + tau]; s += df * df; }
      run += s; d[tau] = run > 0 ? s * tau / run : 1;
    }
    let found = -1;
    for (let tau = minLag; tau <= maxLag; tau++) {
      if (d[tau] < 0.15) { while (tau + 1 <= maxLag && d[tau + 1] < d[tau]) tau++; found = tau; break; }
    }
    if (found < 0) { let mv = 0.3; for (let tau = minLag; tau <= maxLag; tau++) if (d[tau] < mv) { mv = d[tau]; found = tau; } }
    if (found < 1) return {rms, f:-1};
    const a = d[found - 1], b = d[found], c = found + 1 <= maxLag ? d[found + 1] : b;
    const den = a - 2 * b + c, shift = den !== 0 ? (a - c) / (2 * den) : 0;
    return {rms, f: sr / (found + (Math.abs(shift) < 1 ? shift : 0))};
  },
  tick() {
    const r = this.detect();
    UI.meter(r.rms, this.gate());
    if (Calib.active) { Calib.sample(r.rms); return; }
    if (LatCalib.active) LatCalib.poll();
    this.low = Math.min(this.low, r.rms);
    if (r.f < 0) { if (++this.silent >= 3) this.last = null; this.cand = null; this.candN = 0; return; }
    this.silent = 0;
    const midi = Math.round(69 + 12 * Math.log2(r.f / 440));
    if (midi < 38 || midi > 92) return;
    this.candN = midi === this.cand ? this.candN + 1 : 1; this.cand = midi;
    const now = performance.now();
    const reattack = midi === this.last && r.rms > this.low * 2.6 && now - this.lastAt > 140;
    if ((this.candN === 2 && midi !== this.last) || (this.candN >= 2 && reattack)) {
      this.last = midi; this.lastAt = now; this.low = r.rms;
      if (LatCalib.active) LatCalib.onset(); else onNote(midi);
    }
  }
};

const Calib = {
  active:false, max:0, until:0,
  async run() {
    if (!(await Mic.start()) || LatCalib.active) return;
    if (Player.playing) Player.stop();
    this.active = true; this.max = 0; this.until = performance.now() + 1500;
    UI.calibMsg('弾かずに静かにしてください…');
  },
  sample(rms) {
    this.max = Math.max(this.max, rms);
    if (performance.now() < this.until) return;
    this.active = false;
    const target = Math.max(0.004, this.max * 2.2);
    const g = clamp(Math.round(61 - (target - 0.002) / 0.0009), 1, 60);
    update({gate:g});
    UI.calibMsg(`周りの雑音に合わせて感度を ${g} にしました。`);
  }
};

/**
 * Timing calibration: play unpitched clicks, the player plucks one note per click,
 * and the median of (detection time - click time) becomes the judging offset.
 * It covers output latency, input latency and detection lag in one number.
 */
// maxSpread: detection runs every other frame (~33ms), so even perfect timing scatters ~±18ms; tune on real devices.
const LAT = {bpm:80, lead:4, count:8, min:5, maxSpread:0.04};
const LatCalib = {
  active:false, clicks:[], hits:[], endAt:0,
  async run() {
    if (!(await Mic.start()) || Calib.active) return;
    if (Player.playing) Player.stop();
    Synth.unmute();
    const ctx = Synth.ctx, spb = 60 / LAT.bpm, t0 = ctx.currentTime + 0.4, n = LAT.lead + LAT.count;
    this.clicks = []; this.hits = [];
    for (let i = 0; i < n; i++) {
      const t = t0 + i * spb;
      Synth.tick(t, i % 4 === 0);
      if (i >= LAT.lead) this.clicks.push(t);
    }
    this.endAt = t0 + n * spb + 0.5;
    this.active = true;
    UI.latState({running:true, hits:0, total:LAT.count, msg:`最初の${LAT.lead}回は聞くだけ。続く${LAT.count}回のクリックに合わせて、単音を短く弾いてください。`});
    Loop.ensure();
  },
  /** A note onset during calibration: pair it with the click it answers (at most one per click). */
  onset() {
    const now = Synth.ctx.currentTime;
    const i = this.clicks.findIndex(t => now - t > -0.1 && now - t < 0.5);
    if (i < 0 || this.hits.some(h => h.i === i)) return;
    this.hits.push({i, d: now - this.clicks[i]});
    UI.latState({running:true, hits:this.hits.length, total:LAT.count});
  },
  poll() {
    if (Player.playing) { this.active = false; UI.latState({running:false, msg:'再生が始まったため中断しました。'}); return; }
    if (Synth.ctx.currentTime < this.endAt) return;
    this.active = false;
    const res = LatCalib.evaluate(this.hits.map(h => h.d));
    if (res.ok) update({latency: res.median});
    UI.latState({running:false, msg:res.msg});
  },
  /** Pure: turn the measured offsets into a verdict. Exposed for tests. */
  evaluate(ds) {
    if (ds.length < LAT.min)
      return {ok:false, msg:`検出できたのは ${ds.length} 回でした（${LAT.min}回以上必要）。感度を上げるか、少し強く弾いてやり直してください。`};
    const sorted = [...ds].sort((a, b) => a - b), mid = a => a[a.length >> 1];
    const median = mid(sorted), spread = mid(sorted.map(d => Math.abs(d - median)).sort((a, b) => a - b));
    const ms = x => Math.round(x * 1000);
    if (spread > LAT.maxSpread)
      return {ok:false, median, spread, msg:`ばらつきが大きすぎました（±${ms(spread)}ms）。クリックをよく聴いて、もう一度測ってください。`};
    return {ok:true, median, spread, msg:`ずれは約 ${ms(median)}ms（ばらつき ±${ms(spread)}ms）でした。判定に反映しました。`};
  }
};

/** Seconds between a note's sounding beat (scheduled time) and its detection. */
const judgeOffset = () => S.latency != null ? S.latency : 0.07 + Synth.latency();   // fallback: detection lag + output latency

/** A new note was played: judge it against the chord that was sounding. */
function onNote(midi) {
  const t = Synth.ctx.currentTime - judgeOffset();
  let e = null, chord = null;
  if (Player.playing) { e = Player.beatAt(t); if (e && !e.count) chord = e.chord; }
  else chord = UI.view.chord;
  let cls = null, iv = null;
  if (chord) { iv = interval(midi % 12, chord.pc); cls = classify(chord.q, iv); }
  if (e && !e.count && chord) {
    const frac = (t - e.t) / e.spb;
    const strong = (e.beat === 0 || e.beat === 2) && frac < 0.3;
    const guideTry = e.changed && e.beat === chord.start && frac < 0.8 && Player.guideDone !== e.id;
    if (guideTry) Player.guideDone = e.id;
    Stats.record({q:chord.q, cls, strong, guideTry, guideHit: guideTry && CHORDS[chord.q].guide.includes(iv), rest: e.phrase === 'rest', keyPc: e.keyPc});
  }
  UI.showNote(midi, chord, cls, iv, !!(e && !e.count));
  Board.flash(midi);
}

export {Mic, Calib, LatCalib, judgeOffset, onNote};
