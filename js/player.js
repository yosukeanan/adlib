// Look-ahead scheduler that drives the band and the practice load settings.
import {S, update, song, barRange, isLastBar, chordAt, chordAfter} from './state.js';
import {Synth} from './synth.js';
import {Band} from './band.js';
import {Stats} from './stats.js';
import {UI} from './ui.js';
import {Loop, Wake} from './frame.js';

function phraseAt(globalBar) {
  if (S.phrase === 'off') return null;
  const [play, rest] = S.phrase.split('-').map(Number);
  return globalBar % (play + rest) < play ? 'play' : 'rest';
}

const Player = {
  playing:false, timer:0, next:0, bar:0, beat:0, countIn:0, chorus:1, gBar:0,
  pendingKey:0, prevChord:null, guideDone:null,
  drop:{left:0, cool:0}, fx:{muted:false, hatOnly:false},
  queue:[], hist:[],

  toggle() { this.playing ? this.stop() : this.start(); },
  start() {
    const ctx = Synth.init(); Synth.resume(); Band.reset();
    Object.assign(this, {bar:barRange()[0], beat:0, countIn:4, chorus:1, gBar:0, prevChord:null, guideDone:null,
      drop:{left:0, cool:0}, fx:{muted:false, hatOnly:false}});
    this.queue.length = 0; this.hist.length = 0;
    this.pendingKey = this.keyFor(1);
    Synth.unmute();
    this.next = ctx.currentTime + 0.15;
    this.playing = true;
    this.timer = setInterval(() => this.pump(), 25);
    this.pump();
    Wake.on(); UI.onPlayState(); Loop.ensure();
  },
  stop() {
    this.playing = false; clearInterval(this.timer); this.queue.length = 0;
    Synth.mute(); Wake.off(); Stats.flush(); UI.onPlayState();
  },
  pump() {
    const ctx = Synth.ctx;
    while (this.playing && this.next < ctx.currentTime + 0.12) { this.schedule(this.next); this.advance(); }
  },
  keyFor(chorus) {
    if (S.rot === 'off' || chorus % S.rotEvery !== 0) return S.keyPc;
    if (S.rot === '4th') return (S.keyPc + 5) % 12;
    let k; do { k = Math.random() * 12 | 0; } while (k === S.keyPc); return k;
  },
  refreshPendingKey() { if (this.playing) this.pendingKey = this.keyFor(this.chorus); },

  startBar(t, bar, spb) {
    const d = this.drop;
    if (S.dropout === 'random' && this.gBar >= 4) {
      if (d.left === 0 && d.cool <= 0 && Math.random() < 0.18) { d.left = 2; d.cool = 6; }
    } else d.left = 0;
    this.fx = {muted: d.left > 0, hatOnly: S.dropout === '24'};
    if (d.left > 0) d.left--;
    if (d.cool > 0) d.cool--;
    if (S.mix.comp && !this.fx.muted && !this.fx.hatOnly) {
      for (const e of Band.compHits(song().bars[bar].length > 1)) {
        const b = e >> 1, tt = t + b * spb + (e & 1) * spb * S.swing / 100;
        Synth.keys(tt, Band.voicing(chordAt(bar, b)), spb * (0.45 + Math.random() * 0.55));
      }
    }
  },
  schedule(t) {
    const spb = 60 / S.bpm;
    if (this.countIn > 0) {
      const n = 5 - this.countIn; Synth.click(t, n === 1);
      const ch = chordAt(this.bar, 0);
      this.queue.push({t, spb, count:n, bar:this.bar, beat:n - 1, chord:ch, next:chordAfter(ch, this.pendingKey), id:'count', bpm:S.bpm, keyPc:S.keyPc});
      return;
    }
    const {bar, beat} = this;
    if (beat === 0) this.startBar(t, bar, spb);
    const ch = chordAt(bar, beat), nx = chordAfter(ch, this.pendingKey);
    const sig = ch.pc + ch.q, onset = beat === ch.start;
    const changed = onset && sig !== this.prevChord;
    if (onset) this.prevChord = sig;
    const {muted, hatOnly} = this.fx, offbeat = beat % 2 === 1;
    if (!muted) {
      if (S.mix.drums && !hatOnly) { Synth.ride(t, offbeat); if (offbeat) Synth.ride(t + spb * S.swing / 100, false, true); }
      if (offbeat && (S.mix.drums || hatOnly)) Synth.hat(t);
      if (S.mix.bass && !hatOnly) Synth.bass(t, Band.walk(ch, beat, nx), spb * 0.92);
    }
    this.queue.push({t, spb, count:0, bar, beat, chorus:this.chorus, chord:ch, next:nx, changed,
      id:`${this.chorus}-${bar}-${ch.start}`, muted, hatOnly, phrase:phraseAt(this.gBar),
      bpm:S.bpm, keyPc:S.keyPc, lastBar:isLastBar(bar), pendingKey:this.pendingKey});
  },
  advance() {
    this.next += 60 / S.bpm;
    if (this.countIn > 0) { this.countIn--; return; }
    if (++this.beat < 4) return;
    this.beat = 0; this.gBar++;
    if (isLastBar(this.bar)) { this.bar = barRange()[0]; this.endChorus(); }
    else this.bar++;
  },
  endChorus() {
    this.chorus++;
    const patch = {keyPc:this.pendingKey};
    if (S.rampStep > 0) patch.bpm = Math.min(S.rampMax, S.bpm + S.rampStep);
    update(patch);
    this.refreshPendingKey();
  },
  /** Move beats whose (audible) time has passed into history; return the latest one. */
  consume(now) {
    let cur = null;
    while (this.queue.length && this.queue[0].t <= now) {
      cur = this.queue.shift(); this.hist.push(cur);
      if (this.hist.length > 64) this.hist.shift();
    }
    return cur;
  },
  beatAt(t) { for (let i = this.hist.length - 1; i >= 0; i--) if (this.hist[i].t <= t) return this.hist[i]; return null; }
};

export {phraseAt, Player};
