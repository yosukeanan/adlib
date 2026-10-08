// Web Audio synthesizer for the band.
const setAudioSession = type => { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (e) {} };
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

// Bus levels at 100% volume. The guide (example comping) is set to sound about as loud as the bass.
const BUS_LEVEL = {bass:0.95, comp:0.5, drums:0.75, guide:0.8};
const MASTER_LEVEL = 0.9;
/** Slider percent (0..100) → gain, on a squared curve so the slider feels even. */
const volGain = pct => Math.pow(Math.max(0, Math.min(100, pct)) / 100, 2);

const Synth = {
  ctx:null, master:null, out:null, bus:{}, noise:null, vol:null,
  init() {
    if (this.ctx) return this.ctx;
    setAudioSession('playback');
    return this.build(new (window.AudioContext || window.webkitAudioContext)({latencyHint:'interactive'}));
  },
  /** Wire buses → master (mute gate) → out (master volume) → compressor → destination. Also used by tests with an OfflineAudioContext. */
  build(ctx) {
    this.ctx = ctx; this.bus = {};
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.15;
    this.master = ctx.createGain(); this.master.gain.value = MASTER_LEVEL;
    this.out = ctx.createGain();
    this.master.connect(this.out); this.out.connect(comp); comp.connect(ctx.destination);
    for (const k in BUS_LEVEL) { const g = ctx.createGain(); g.connect(this.master); this.bus[k] = g; }
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    if (this.vol) this.setVolumes(this.vol, true);
    else for (const k in BUS_LEVEL) this.bus[k].gain.value = BUS_LEVEL[k];
    return ctx;
  },
  /** Apply mixer settings {master, bass, comp, drums, guide} in percent. */
  setVolumes(vol, now) {
    this.vol = vol;
    if (!this.ctx) return;
    const t = this.ctx.currentTime, set = (param, v) => { if (now) param.value = v; else param.setTargetAtTime(v, t, 0.03); };
    for (const k in BUS_LEVEL) set(this.bus[k].gain, BUS_LEVEL[k] * volGain(vol[k] ?? 100));
    set(this.out.gain, volGain(vol.master ?? 100));
  },
  resume() { return this.ctx && this.ctx.state !== 'running' ? this.ctx.resume() : Promise.resolve(); },
  latency() { const c = this.ctx; return c ? (c.outputLatency || 0) + (c.baseLatency || 0) : 0; },
  mute() { const t = this.ctx.currentTime; this.master.gain.cancelScheduledValues(t); this.master.gain.setTargetAtTime(0.0001, t, 0.02); },
  unmute() { const t = this.ctx.currentTime; this.master.gain.cancelScheduledValues(t); this.master.gain.setValueAtTime(MASTER_LEVEL, t); },
  env(g, t, peak, att, dur, sus) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + att);
    g.gain.exponentialRampToValueAtTime(Math.max(peak * sus, 0.0003), t + Math.max(att + 0.02, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  },
  osc(type, freq, t, dur, dest) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    o.connect(dest); o.start(t); o.stop(t + dur + 0.05); return o;
  },
  bass(t, midi, dur) {
    const ctx = this.ctx, f = midiHz(midi);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(1500, t); lp.frequency.exponentialRampToValueAtTime(380, t + 0.22);
    const g = ctx.createGain(); this.env(g, t, 0.42, 0.006, dur, 0.4);
    lp.connect(g); g.connect(this.bus.bass);
    this.osc('sawtooth', f, t, dur, lp); this.osc('sine', f, t, dur, lp);   // saw gives harmonics phone speakers can play
  },
  /**
   * Example comping on the guitar's register: a bright plucked tone, strummed low → high.
   * Sawtooth through a closing low-pass keeps harmonics a phone speaker can reproduce.
   */
  pluck(t, notes, dur) {
    const ctx = this.ctx, sorted = [...notes].sort((a, b) => a - b);
    sorted.forEach((m, i) => {
      const tt = t + i * 0.012, f = midiHz(m);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.2;
      lp.frequency.setValueAtTime(Math.min(9000, f * 14), tt); lp.frequency.exponentialRampToValueAtTime(Math.max(600, f * 3), tt + 0.25);
      const g = ctx.createGain(); this.env(g, tt, 0.3, 0.003, dur, 0.35);
      lp.connect(g); g.connect(this.bus.guide);
      this.osc('sawtooth', f, tt, dur, lp); this.osc('triangle', f * 2, tt, dur * 0.6, lp);
    });
  },
  keys(t, notes, dur) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    const g = ctx.createGain(); this.env(g, t, 0.2, 0.006, dur, 0.35);
    lp.connect(g); g.connect(this.bus.comp);
    for (const m of notes) {
      const f = midiHz(m);
      this.osc('triangle', f, t, dur, lp);
      const tine = ctx.createGain(); tine.gain.setValueAtTime(0.4, t); tine.gain.exponentialRampToValueAtTime(0.001, t + 0.16); tine.connect(lp);
      this.osc('sine', f * 2, t, dur, tine);
    }
  },
  noiseHit(t, hpf, vol, decay) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = hpf;
    const pk = ctx.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 8200; pk.gain.value = 5;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    s.connect(hp); hp.connect(pk); pk.connect(g); g.connect(this.bus.drums);
    s.start(t, Math.random() * 0.5); s.stop(t + decay + 0.02);
  },
  ride(t, accent, skip) { this.noiseHit(t, 4800, skip ? 0.05 : accent ? 0.12 : 0.09, skip ? 0.16 : 0.42); },
  hat(t) { this.noiseHit(t, 7500, 0.13, 0.05); },
  /** Unpitched click (filtered noise) for timing calibration, so the pitch detector cannot mistake it for a note. */
  tick(t, accent) {
    const ctx = this.ctx, s = ctx.createBufferSource(); s.buffer = this.noise;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const g = ctx.createGain(); g.gain.setValueAtTime(accent ? 0.9 : 0.6, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
    s.connect(hp); hp.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 0.5); s.stop(t + 0.05);
  },
  click(t, accent) {
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06); g.connect(this.master);
    this.osc('sine', accent ? 1600 : 1100, t, 0.03, g);
  }
};

export {setAudioSession, midiHz, volGain, BUS_LEVEL, Synth};
