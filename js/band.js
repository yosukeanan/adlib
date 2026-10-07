// Band arranger: walking bass and comping.
import {CHORDS} from './theory.js';

/**
 * Comping rhythms for the guitarist, as swung-eighth indices (0..7) within a bar, like Band.compHits().
 * ant: the hit on the "and" of 4 already plays the next bar's chord (anticipation).
 */
const COMP_RHYTHMS = {
  four:       {label:'フォー・ビート', hits:[0, 2, 4, 6], short:true, hint:'4分音符で毎拍。短く切って、ベースと一緒に拍を刻みます。'},
  two4:       {label:'2・4拍',        hits:[2, 6],       short:true, hint:'2拍目と4拍目だけ。スネアの位置です。'},
  charleston: {label:'チャールストン', hits:[0, 3],                   hint:'1拍目と2拍目の裏。コンピングの基本形です。'},
  reverse:    {label:'逆チャールストン', hits:[1, 4],                 hint:'1拍目の裏と3拍目。頭を抜いて弾きます。'},
  ant:        {label:'先取り',         hits:[3, 7], ant:true,          hint:'2拍目の裏と、4拍目の裏で次のコードを先に弾きます。'}
};

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

export {COMP_RHYTHMS, Band};
