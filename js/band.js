// Band arranger: walking bass and comping.
import {CHORDS} from './theory.js';

const Band = {
  prevBass:40, prevAvg:60,
  reset() { this.prevBass = 40; this.prevAvg = 60; },
  walk(ch, beat, nx) {
    const i = beat - ch.start;
    let pc;
    if (i === 0) pc = ch.pc;
    else if (i === ch.beats - 1 && nx) {                     // approach the next root
      const r = Math.random();
      pc = r < 0.4 ? (nx.pc + 1) % 12 : r < 0.8 ? (nx.pc + 11) % 12 : (nx.pc + 7) % 12;
    } else {
      const ct = CHORDS[ch.q].ct.slice(1);
      pc = (ch.pc + ct[Math.random() * ct.length | 0]) % 12;
    }
    let best = null;
    for (let m = 28; m <= 50; m++) if (m % 12 === pc && (best === null || Math.abs(m - this.prevBass) < Math.abs(best - this.prevBass))) best = m;
    return this.prevBass = best;
  },
  voicing(c) {
    const iv = CHORDS[c.q].voice;
    let best = null, bestD = Infinity;
    for (const base of [36, 48, 60]) {
      const notes = iv.map(x => base + c.pc + x);
      if (notes[0] < 50 || notes[0] > 64) continue;
      const avg = notes.reduce((a, b) => a + b, 0) / notes.length;
      const d = Math.abs(avg - this.prevAvg) + 0.35 * Math.abs(avg - 62);   // smooth voice leading, stay mid-register
      if (d < bestD) { bestD = d; best = notes; }
    }
    best = best || iv.map(x => 48 + c.pc + x);
    this.prevAvg = best.reduce((a, b) => a + b, 0) / best.length;
    return best;
  },
  /** Comping hits as swung-eighth indices (0..7) within a bar. */
  compHits(twoChords) {
    const P = twoChords ? [[0,4],[1,5],[0,5],[1,4]] : [[0,3],[3,7],[0,4],[2,5],[1,4],[0,3,6]];
    return P[Math.random() * P.length | 0];
  }
};

export {Band};
