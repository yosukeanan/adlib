// Practice statistics and weakness advice.
import {NOTE, CHORDS} from './theory.js';
import {storage, pct} from './util.js';
import {S, update, selectSong} from './state.js';
import {UI} from './ui.js';

const blankRow = () => ({n:0, chord:0, tension:0, avoid:0, other:0, sn:0, sct:0, gn:0, gh:0});
function blankStats() { const q = {}; for (const k in CHORDS) q[k] = blankRow(); return {q, k:{}, rest:0, total:0}; }
function reviveStats(o) {
  const b = blankStats(); if (!o || !o.q) return b;
  for (const k in b.q) Object.assign(b.q[k], o.q[k]);
  for (const k in (o.k || {})) b.k[k] = Object.assign(blankRow(), o.k[k]);
  b.rest = o.rest || 0; b.total = o.total || 0; return b;
}
function bump(r, ev) {
  r.n++; r[ev.cls]++;
  if (ev.strong) { r.sn++; if (ev.cls === 'chord') r.sct++; }
  if (ev.guideTry) { r.gn++; if (ev.guideHit) r.gh++; }
}
const Stats = {
  all: reviveStats(storage.get('jit-stats', null)), session: blankStats(), dirty:false, saveT:0, renderT:0,
  record(ev) {
    for (const st of [this.all, this.session]) {
      bump(st.q[ev.q], ev); bump(st.k[ev.keyPc] || (st.k[ev.keyPc] = blankRow()), ev);
      st.total++; if (ev.rest) st.rest++;
    }
    this.dirty = true;
    clearTimeout(this.saveT); this.saveT = setTimeout(() => this.flush(), 2000);
    if (UI.tab === 'log' && !this.renderT) this.renderT = setTimeout(() => { this.renderT = 0; UI.renderLog(); }, 600);
  },
  flush() { if (this.dirty) { storage.set('jit-stats', this.all); this.dirty = false; } },
  reset() { this.all = blankStats(); this.session = blankStats(); this.dirty = true; this.flush(); },
  sum(st) {
    const s = blankRow();
    for (const r of Object.values(st.q)) for (const k in s) s[k] += r[k];
    return s;
  },
  advice(st) {
    const out = [], s = this.sum(st);
    if (st.total < 30) return [{text:`判定データは ${st.total} 音です。30音を超えると弱点の傾向を出します。`, fix:'「練習」画面でマイク判定をオンにして、数コーラス弾いてください。'}];
    if (s.gn >= 8 && s.gh / s.gn < 0.45)
      out.push({text:`コードが変わった瞬間に3rd・7thへ着地できた割合は ${pct(s.gh / s.gn)}。スケールの上下だけで、チェンジが聴こえにくい状態かもしれません。`,
        fix:'ガイド表示＋循環（2拍チェンジ）で、緑の輪の音を狙う', apply:{prog:'circle', mode:'guide', bpm:Math.min(S.bpm, 110)}, score:0.6 - s.gh / s.gn});
    for (const [k, r] of Object.entries(st.q)) {
      if (r.n >= 15 && CHORDS[k].av.length && r.avoid / r.n > 0.1)
        out.push({text:`${CHORDS[k].ja} の上でアヴォイド（${CHORDS[k].avName}）が ${pct(r.avoid / r.n)}。`,
          fix:'スケール表示で赤い音の位置を確認し、経過音として通り抜ける', apply:{prog:(k === '7alt' || k === 'm7b5') ? '251m' : '251', mode:'scale'}, score:r.avoid / r.n});
      if (r.sn >= 10 && r.sct / r.sn < 0.5)
        out.push({text:`${CHORDS[k].ja} の1・3拍目でコードトーンに乗った割合は ${pct(r.sct / r.sn)}。`,
          fix:'コード音表示・テンポを20落として、強拍にコードトーンを置く', apply:{mode:'chord', bpm:Math.max(60, S.bpm - 20)}, score:0.6 - r.sct / r.sn});
    }
    const keys = Object.entries(st.k).filter(([, r]) => r.sn >= 8).map(([k, r]) => ({k:+k, rate:r.sct / r.sn}));
    if (keys.length >= 2) {
      keys.sort((a, b) => a.rate - b.rate);
      const lo = keys[0], hi = keys[keys.length - 1];
      if (hi.rate - lo.rate >= 0.15)
        out.push({text:`キー ${NOTE[lo.k]} の強拍コードトーン率は ${pct(lo.rate)}（得意なキー ${NOTE[hi.k]} は ${pct(hi.rate)}）。`,
          fix:'キー回転を止めて、このキーだけで練習する', apply:{keyPc:lo.k, rot:'off'}, score:hi.rate - lo.rate});
    }
    if (st.rest >= 15)
      out.push({text:`「休み」の小節で ${st.rest} 音弾いています。フレーズの終わりを作るのが課題かもしれません。`,
        fix:'フレーズ区切り 2／2 で、休みを守る', apply:{phrase:'2-2'}, score:0.15});
    out.sort((a, b) => b.score - a.score);
    if (out.length > 3) { const more = out.length - 3; out.length = 3; out.push({text:`ほかに ${more} 件あります。上の課題が改善すると表示されます。`}); }
    if (!out.length)
      out.push({text:'今の設定では目立った弱点は出ていません。負荷を上げて、崩れる所を探しましょう。',
        fix:'テンポ自動アップ＋キー自動回転（4度進行）', apply:{rampStep:4, rot:'4th', rotEvery:1}});
    return out;
  }
};
function applyPreset(p) {
  const {prog, ...rest} = p;
  if (prog) selectSong(prog);
  update(rest);
  UI.switchTab('play');
}

export {Stats, applyPreset};
