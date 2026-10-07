// Guitar voicings for comping: shell shapes and voice-led choice along a progression.
import {CHORDS, TUNING, interval, ivLabel} from './theory.js';
import {SONGS, POSITIONS} from './songs.js';

/** Intervals (above the root) of the two upper shell voices: [3rd slot, 7th slot]. */
function shellTones(q) {
  if (q === 'm7b5') return [6, 10];          // ♭5 replaces the ♭3 so the shell is not just m7
  return CHORDS[q].guide;                    // 3rd and 7th (6th for 6 / m6, °7 for dim7)
}

// Strings: 0 = low E … 5 = high e. Slot order is low → high.
// Adding drop-2 / drop-3 later means adding entries with more strings and slots.
const TEMPLATES = [
  {id:'6-R73', root:'6', strings:[0, 2, 3], slots:['R', '7', '3']},   // e.g. Cmaj7 8x99xx
  {id:'6-R37', root:'6', strings:[0, 1, 2], slots:['R', '3', '7']},   // e.g. Cmaj7 879xxx
  {id:'5-R37', root:'5', strings:[1, 2, 3], slots:['R', '3', '7']},   // e.g. Cmaj7 x324xx
  {id:'5-R73', root:'5', strings:[1, 3, 4], slots:['R', '7', '3']}    // e.g. Cmaj7 x3x45x
];
const MAX_SPAN = 3;        // highest minus lowest fretted note: a four-fret hand
const MAX_ROOT_FRET = 15;

/** Every playable shape of one template for a chord. */
function shapesOf(tpl, pc, q) {
  const [third, seventh] = shellTones(q), out = [];
  const ivOf = slot => slot === 'R' ? 0 : slot === '3' ? third : seventh;
  for (let rf = 0; rf <= MAX_ROOT_FRET; rf++) {
    if ((TUNING[tpl.strings[0]] + rf) % 12 !== pc) continue;
    const notes = tpl.strings.map((st, i) => {
      const iv = ivOf(tpl.slots[i]), want = (pc + iv) % 12;
      let best = null;                                   // fret on this string nearest the root fret
      for (let f = Math.max(0, rf - 5); f <= rf + 5; f++)
        if ((TUNING[st] + f) % 12 === want && (best === null || Math.abs(f - rf) < Math.abs(best - rf))) best = f;
      return {string:st, fret:best, iv, label:ivLabel(q, iv), midi:TUNING[st] + best};
    });
    if (notes.some(n => n.fret === null)) continue;
    const fr = notes.map(n => n.fret), lo = Math.min(...fr), hi = Math.max(...fr);
    if (hi - lo > MAX_SPAN) continue;
    out.push({tpl:tpl.id, root:tpl.root, notes, lo, hi, center:(lo + hi) / 2,
      name:`${tpl.root}弦ルート ${notes.map(n => n.label).join('-')}`});
  }
  return out;
}

/** All shell shapes for a chord, optionally limited to one root string ('6' | '5'). */
function shapes(pc, q, rootString = 'auto') {
  return TEMPLATES.filter(t => rootString === 'auto' || t.root === rootString).flatMap(t => shapesOf(t, pc, q));
}

// Cost of a path: hand movement between consecutive shapes plus distance from the chosen position.
const W_MOVE = 1, W_STRINGSET = 0.75, W_CENTER = 0.35, W_OUTSIDE = 4;
function placeCost(sh, [a, b]) {
  const c = (a + b) / 2, outside = Math.max(0, a - sh.lo) + Math.max(0, sh.hi - b);
  return W_CENTER * Math.abs(sh.center - c) + W_OUTSIDE * outside;
}
function moveCost(p, n) {
  return W_MOVE * Math.abs(n.center - p.center) + (p.root !== n.root ? W_STRINGSET : 0);
}

/**
 * Voice-led choice for a chord sequence (dynamic programming over all shapes,
 * so 'auto' is never worse than a fixed root string under the same cost).
 * @param chords [{pc, q}]  @param range [loFret, hiFret]
 * @returns {path: shape[], cost}
 */
function lead(chords, rootString, range) {
  if (!chords.length) return {path:[], cost:0};
  const layers = chords.map(c => shapes(c.pc, c.q, rootString));
  let prev = layers[0].map(sh => ({sh, cost:placeCost(sh, range), back:null}));
  const hist = [prev];
  for (let i = 1; i < layers.length; i++) {
    prev = layers[i].map(sh => {
      let best = null;
      for (const p of prev) {
        const cost = p.cost + moveCost(p.sh, sh) + placeCost(sh, range);
        if (!best || cost < best.cost) best = {sh, cost, back:p};
      }
      return best;
    });
    hist.push(prev);
  }
  let end = prev.reduce((a, b) => (b.cost < a.cost ? b : a));
  const path = [], cost = end.cost;
  for (let n = end; n; n = n.back) path.unshift(n.sh);
  return {path, cost};
}

/** Chords of one chorus of a song in a key, in order: [{bar, start, pc, q}]. */
function chorusChords(song, keyPc) {
  const shift = interval(keyPc, song.keyPc);
  return song.bars.flatMap((bar, i) => bar.map(c => ({bar:i, start:c.start, pc:(c.pc + shift) % 12, q:c.q})));
}

// Plans are cached per song / key / root-string setting / position.
const cache = new Map();
function planFor(songId, keyPc, rootString, pos) {
  const k = `${songId}|${keyPc}|${rootString}|${pos}`;
  if (!cache.has(k)) {
    const song = SONGS.find(s => s.id === songId), chords = chorusChords(song, keyPc);
    const {path} = lead(chords, rootString, POSITIONS[pos].r);
    const m = new Map();
    chords.forEach((c, i) => m.set(`${c.bar}-${c.start}`, path[i]));
    if (cache.size > 64) cache.clear();
    cache.set(k, m);
  }
  return cache.get(k);
}

/** The planned shape for a chord from chordAt() ({bar, start, key}). */
function voicingFor(ch, S) {
  if (!ch) return null;
  return planFor(S.prog, ch.key, S.compVoicing, S.pos).get(`${ch.bar}-${ch.start}`) || null;
}

export {TEMPLATES, shellTones, shapes, lead, chorusChords, voicingFor};
