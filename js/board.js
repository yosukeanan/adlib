// Fretboard renderer (SVG).
import {TUNING, STRING_NAMES, CHORDS, interval, classify, ivLabel} from './theory.js';
import {POSITIONS} from './songs.js';
import {S} from './state.js';
import {$} from './util.js';

const Board = {
  g:null,
  layout() {
    const [f0, f1] = POSITIONS[S.pos].r, n = f1 - f0 + 1, wide = S.pos === 'all', big = S.boardSize === 'large';
    const k = big ? 1.25 : 1;                                     // dot / label scale
    const fw = (wide ? 44 : 58) + (big ? 8 : 0), L = 22, T = big ? 22 : 18, sh = big ? 31 : 25, W = L + n * fw + 6, H = T + sh * 5 + 34;
    this.g = {f0, f1, n, fw, L, T, sh, W, H, k};
    const svg = $('board');
    svg.classList.toggle('large', big);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.style.width = wide ? W + 'px' : '100%';
    svg.style.minWidth = wide ? W + 'px' : '0';
    svg.classList.toggle('wide', wide);
    const top = T - 11, h = sh * 5 + 22;
    let s = `<rect class="b-bg" x="${L}" y="${top}" width="${n * fw}" height="${h}" rx="4"/>`;
    if (f0 === 0) s += `<rect class="b-bg2" x="${L}" y="${top}" width="${fw}" height="${h}" rx="4"/>`;
    for (let i = 0; i < n; i++) {
      const f = f0 + i, cx = L + (i + 0.5) * fw, xr = L + (i + 1) * fw;
      if ([3,5,7,9,15].includes(f)) s += `<circle class="b-inlay" cx="${cx}" cy="${T + sh * 2.5}" r="5"/>`;
      if (f === 12) s += `<circle class="b-inlay" cx="${cx}" cy="${T + sh * 1.5}" r="5"/><circle class="b-inlay" cx="${cx}" cy="${T + sh * 3.5}" r="5"/>`;
      s += `<line class="${f === 0 ? 'b-nut' : 'b-fret'}" x1="${xr}" y1="${T - 10}" x2="${xr}" y2="${T + sh * 5 + 10}"/>`;
      s += `<text class="b-num" x="${cx}" y="${H - 5}">${f === 0 ? '開放' : f}</text>`;
    }
    if (f0 > 0) s += `<line class="b-fret" x1="${L}" y1="${T - 10}" x2="${L}" y2="${T + sh * 5 + 10}"/>`;
    for (let st = 0; st < 6; st++) {
      const y = this.y(st);
      s += `<line class="b-str" x1="${L}" y1="${y}" x2="${L + n * fw}" y2="${y}" style="stroke-width:${(0.7 + (5 - st) * 0.3).toFixed(2)}"/>`;
      s += `<text class="b-sname" x="${L - 10}" y="${y + 3.5}">${STRING_NAMES[st]}</text>`;
    }
    $('gBoard').innerHTML = s;
    $('gDet').innerHTML = '';
  },
  x(f) { return this.g.L + (f - this.g.f0 + 0.5) * this.g.fw; },
  y(st) { return this.g.T + (5 - st) * this.g.sh; },
  each(fn) { for (let st = 0; st < 6; st++) for (let f = this.g.f0; f <= this.g.f1; f++) fn(st, f, TUNING[st] + f); },
  dot(x, y, cls, label, r, small) {
    const k = this.g.k;
    return `<g class="${cls}"><circle cx="${x}" cy="${y}" r="${r * k}"/><text class="lbl${small ? ' s' : ''}" x="${x}" y="${(y + (small ? 2.7 : 3.4) * k).toFixed(1)}">${label}</text></g>`;
  },
  drawNotes(view) {
    const c = view && view.chord;
    if (!c || !this.g || S.mode === 'hidden') { $('gNotes').innerHTML = ''; return; }
    const nx = view.next, q = CHORDS[c.q], nq = nx && CHORDS[nx.q];
    let s = '';
    this.each((st, f, midi) => {
      const pc = midi % 12, iv = interval(pc, c.pc), cls = classify(c.q, iv), lab = ivLabel(c.q, iv);
      const x = this.x(f), y = this.y(st);
      if (S.mode === 'chord') {
        if (cls === 'chord') s += this.dot(x, y, iv === 0 ? 'd-root' : 'd-ct', lab, 10.5);
      } else if (S.mode === 'guide') {
        if (nq && nq.guide.includes(interval(pc, nx.pc))) s += `<circle class="d-next" cx="${x}" cy="${y}" r="${12 * this.g.k}"/>`;
        if (q.guide.includes(iv)) s += this.dot(x, y, 'd-ct', lab, 9.5);
        else if (cls === 'chord') s += this.dot(x, y, iv === 0 ? 'd-root d-faint' : 'd-faint', lab, 6.5, true);
      } else if (S.mode === 'scale') {
        if (cls === 'chord') s += this.dot(x, y, iv === 0 ? 'd-root' : 'd-ct', lab, 10.5);
        else if (cls === 'tension') s += this.dot(x, y, 'd-ten', lab, 10.5);
        else if (cls === 'avoid') s += this.dot(x, y, 'd-av', lab, 7.5, true);
      }
    });
    $('gNotes').innerHTML = s;
  },
  flash(midi) {
    if (!this.g) return;
    let s = '';
    this.each((st, f, m) => { if (m === midi) s += `<circle class="d-det" cx="${this.x(f)}" cy="${this.y(st)}" r="${13 * this.g.k}"/>`; });
    const g = $('gDet'); g.innerHTML = ''; g.innerHTML = s;
    clearTimeout(this.flashT); this.flashT = setTimeout(() => { g.innerHTML = ''; }, 1300);
  }
};

export {Board};
