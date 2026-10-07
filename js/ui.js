// Screen rendering: stage, lead sheet, setup and log views.
import {NOTE, CHORDS, CLASS_JA, interval, ivLabel, chordName} from './theory.js';
import {SONGS, POSITIONS} from './songs.js';
import {storage, pct, $} from './util.js';
import {S, update, song, loop, loopActive, barRange, chordAt, chordAfter} from './state.js';
import {Player} from './player.js';
import {Stats} from './stats.js';
import {Mic, judgeOffset} from './mic.js';
import {Board} from './board.js';
import {COMP_RHYTHMS} from './band.js';
import {voicingFor} from './voicing.js';

const SEGS = {
  mode:     {key:'mode',     opts:() => [['chord','コード音'],['guide','ガイド'],['scale','スケール'],['hidden','かくす']]},
  pos:      {key:'pos',      opts:() => Object.entries(POSITIONS).map(([k, v]) => [k, v.label])},
  key:      {key:'keyPc',    opts:() => NOTE.map((n, i) => [i, n + (song().minor ? 'm' : '')])},
  rampStep: {key:'rampStep', opts:() => [[0,'オフ'],[2,'+2'],[4,'+4'],[8,'+8']]},
  rampMax:  {key:'rampMax',  opts:() => [[160,'160'],[200,'200'],[240,'240'],[300,'300']]},
  rot:      {key:'rot',      opts:() => [['off','オフ'],['4th','4度進行'],['rand','ランダム']]},
  rotEvery: {key:'rotEvery', opts:() => [[1,'毎回'],[2,'2回ごと'],[4,'4回ごと']]},
  dropout:  {key:'dropout',  opts:() => [['off','オフ'],['24','2・4拍だけ'],['random','ときどき無音']]},
  phrase:   {key:'phrase',   opts:() => [['off','オフ'],['1-1','1／1'],['2-2','2／2'],['4-4','4／4']]},
  boardSize:{key:'boardSize',opts:() => [['std','標準'],['large','大きく']]},
  practice: {key:'practice', opts:() => [['solo','ソロ'],['comp','コンピング']]},
  compRhythm:{key:'compRhythm',opts:() => Object.entries(COMP_RHYTHMS).map(([k, r]) => [k, r.label])},
  compVoicing:{key:'compVoicing',opts:() => [['auto','自動'],['6','6弦ルート'],['5','5弦ルート']]},
  compGuide:{key:'compGuide', opts:() => [[false,'オフ'],[true,'鳴らす']]}
};
const Seg = {
  els: name => document.querySelectorAll(`[data-seg="${name}"]`),
  build(name) {
    const html = SEGS[name].opts().map(([, label], i) => `<button type="button" data-i="${i}">${label}</button>`).join('');
    this.els(name).forEach(el => { el.innerHTML = html; });
    this.sync(name);
  },
  sync(name) {
    const cfg = SEGS[name], opts = cfg.opts();
    this.els(name).forEach(el => el.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(opts[+b.dataset.i][0] === S[cfg.key]))));
  },
  pick(name, i) { const cfg = SEGS[name]; update({[cfg.key]: cfg.opts()[i][0]}); }
};

/* =========================================================
   12. UI
   ========================================================= */
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4.5" height="14" rx="1"/><rect x="13.5" y="5" width="4.5" height="14" rx="1"/></svg>';
const LEGENDS = {
  chord: '<span><i style="background:var(--root)"></i>ルート</span><span><i style="background:var(--ct)"></i>3rd・5th・7th</span><span>強拍でここに着地</span>',
  guide: '<span><i style="background:var(--ct)"></i>今の3rd・7th</span><span><i class="ring"></i>次のコードの3rd・7th</span><span>薄い点はR・5th</span>',
  scale: '<span><i style="background:var(--ct)"></i>コードトーン</span><span><i style="background:var(--ten)"></i>テンション</span><span><i style="background:var(--avoid)"></i>アヴォイド</span>',
  hidden:'<span>指板を隠して、耳とコード名だけで弾きます。マイク判定は続きます。</span>',
  comp:  '<span><i style="background:var(--root)"></i>ルート</span><span><i style="background:var(--ct)"></i>3rd・7th</span><span><i class="ring"></i>次のシェル</span>'
};

const UI = {
  view:{chord:null, next:null, id:null}, tab:'play',

  init() {
    Object.keys(SEGS).forEach(n => Seg.build(n));
    this.renderSongs(); this.renderSongLabel(); this.renderSheet(); this.renderTempo();
    this.renderSwing(); this.renderMix(); this.renderGate(); this.renderDeps(); this.renderPractice();
    this.micState(); this.renderLatency(); this.renderMetrics(); this.onPlayState();
    Board.layout(); this.preview();
    if (!storage.get('jit-intro-done', false)) $('intro').hidden = false;
  },

  /** Re-render only what a settings change affects. */
  render(changed) {
    const has = k => changed.has(k);
    Object.keys(SEGS).forEach(n => Seg.sync(n));
    if (has('prog')) { Seg.build('key'); this.renderSongs(); }
    if (has('prog') || has('keyPc')) { this.renderSongLabel(); this.renderSheet(); if (!Player.playing) this.preview(); }
    if (has('bpm')) this.renderTempo();
    if (has('swing')) this.renderSwing();
    if (has('mix')) this.renderMix();
    if (has('gate')) this.renderGate();
    if (has('rampStep') || has('rot')) this.renderDeps();
    if (has('mode')) { this.renderLegend(); Board.drawNotes(this.view); }
    if (has('practice') || has('compRhythm')) this.renderPractice();
    else if (has('compVoicing')) { Board.drawNotes(this.view); this.renderVoicingTag(); }
    if (has('pos') || has('boardSize')) { Board.layout(); Board.drawNotes(this.view); }
    if (has('latency')) this.renderLatency();
    if (has('audioOut')) this.micState();
  },

  switchTab(tab) {
    this.tab = tab;
    document.querySelectorAll('[role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    for (const t of ['play', 'setup', 'log']) $('view-' + t).hidden = t !== tab;
    if (tab === 'log') this.renderLog();
    window.scrollTo(0, 0);
  },

  /* ----- stage ----- */
  setView(chord, next, id) {
    this.view = {chord, next, id};
    $('curChord').textContent = chord ? chordName(chord) : '—';
    $('nextChord').textContent = next ? chordName(next) : '—';
    Board.drawNotes(this.view);
    this.renderVoicingTag();
  },
  preview() {
    const ch = chordAt(barRange()[0], 0);
    this.setView(ch, chordAfter(ch), 'preview');
    this.status(null);
  },
  renderSongLabel() { const s = song(); $('songLabel').textContent = `${s.name}／Key ${NOTE[S.keyPc]}${s.minor ? 'm' : ''}`; },
  setBeats(i) { document.querySelectorAll('#beats i').forEach((el, k) => el.classList.toggle('on', k === i)); },
  onPlayState() {
    const p = Player.playing;
    document.body.classList.toggle('playing', p);
    $('playBtn').innerHTML = p ? ICON_STOP : ICON_PLAY;
    $('playBtn').setAttribute('aria-label', p ? '停止' : '再生');
    if (p) return;
    this.setBeats(-1); this.markBar(-1); this.markRhythm(-1); $('nextBox').classList.remove('soon');
    $('chorusLabel').textContent = S.bpm + ' BPM';
    this.preview(); this.renderLog();
  },
  onBeat(e) {
    if (e.id !== this.view.id) this.setView(e.chord, e.next, e.id);
    this.setBeats(e.count ? e.count - 1 : e.beat);
    this.markBar(e.count ? -1 : e.bar);
    this.markRhythm(e.count ? -1 : e.beat);
    $('nextBox').classList.toggle('soon', !e.count && e.beat === e.chord.start + e.chord.beats - 1);
    $('chorusLabel').textContent = e.count ? `${e.bpm} BPM` : `${e.chorus}コーラス目・${e.bpm} BPM`;
    this.status(e);
  },
  status(e) {
    let kind = '', text;
    const s = song(), [a, b] = barRange();
    if (!e) text = loopActive() ? `${a + 1}〜${b + 1}小節をループします` : '再生で1小節カウント後にスタート';
    else if (e.count) { kind = 'count'; text = `カウント ${e.count}`; }
    else if (e.muted) { kind = 'drop'; text = 'バンドが消えました。拍を数え続けて'; }
    else if (e.lastBar && e.pendingKey !== e.keyPc) { kind = 'info'; text = `次のコーラスは Key ${NOTE[e.pendingKey]}${s.minor ? 'm' : ''}`; }
    else if (e.phrase === 'rest') { kind = 'rest'; text = '休み。次のフレーズを準備'; }
    else if (e.phrase === 'play') { kind = 'play'; text = '弾く'; }
    else if (e.hatOnly) { kind = 'info'; text = 'ハイハットだけ。スウィングは自分で出す'; }
    else text = `${e.bar + 1} / ${s.bars.length} 小節`;
    const el = $('status'); el.className = 'status ' + kind; el.textContent = text;
  },

  /* ----- lead sheet ----- */
  renderSheet() {
    const s = song(), [a, b] = barRange(), shift = interval(S.keyPc, s.keyPc), on = loopActive();
    $('sheet').innerHTML = s.bars.map((bar, i) => {
      let cls = 'bar';
      if (on && i >= a && i <= b) cls += ' inloop';
      if (!on && loop.a === i) cls += ' pick';
      const names = bar.map(c => `<span>${NOTE[(c.pc + shift) % 12]}${CHORDS[c.q].sym}</span>`).join('');
      return `<button type="button" class="${cls}" data-action="bar" data-bar="${i}" aria-label="${i + 1}小節目"><em>${i + 1}</em>${names}</button>`;
    }).join('');
    $('loopClear').hidden = loop.a == null;
    $('loopHint').textContent = on ? `${a + 1}〜${b + 1}小節をループ中です。`
      : loop.a != null ? `${loop.a + 1}小節目から。終わりの小節をタップしてください（同じ小節なら1小節ループ）。`
      : '苦手な区間は、始まりと終わりの小節をタップしてループ。';
    if (Player.playing) this.markBar(Player.hist.length ? Player.hist[Player.hist.length - 1].bar : -1);
  },
  markBar(i) { document.querySelectorAll('#sheet .bar').forEach(el => el.classList.toggle('cur', +el.dataset.bar === i)); },
  tapBar(i) {
    if (loopActive()) Object.assign(loop, {a:i, b:null});
    else if (loop.a == null) loop.a = i;
    else Object.assign(loop, {a:Math.min(loop.a, i), b:Math.max(loop.a, i)});
    this.renderSheet();
    if (!Player.playing) this.preview();
  },
  clearLoop() { Object.assign(loop, {a:null, b:null}); this.renderSheet(); if (!Player.playing) this.preview(); },

  /* ----- setup ----- */
  renderSongs() {
    $('songList').innerHTML = SONGS.map(s =>
      `<button type="button" class="song" data-action="song" data-id="${s.id}" aria-pressed="${s.id === S.prog}"><b>${s.name}</b><span class="lvl">${s.lvl}</span><small>${s.desc}</small></button>`).join('');
  },
  renderTempo() {
    $('bpmVal').textContent = S.bpm; $('bpmRange').value = S.bpm; $('bpmLbl').textContent = S.bpm + ' BPM';
    if (!Player.playing) $('chorusLabel').textContent = S.bpm + ' BPM';
  },
  renderSwing() { $('swRange').value = S.swing; $('swLbl').textContent = S.swing + '%' + (S.swing >= 66 ? '（3連符）' : S.swing <= 52 ? '（イーブン）' : ''); },
  renderMix() { document.querySelectorAll('[data-part]').forEach(b => b.setAttribute('aria-pressed', String(!!S.mix[b.dataset.part]))); },
  renderGate() { $('gateRange').value = S.gate; $('gateLbl').textContent = S.gate; },
  renderDeps() { $('fRampMax').classList.toggle('off', S.rampStep === 0); $('fRotEvery').classList.toggle('off', S.rot === 'off'); },
  renderLegend() { $('legend').innerHTML = LEGENDS[S.practice === 'comp' ? 'comp' : S.mode]; },

  /* ----- comping ----- */
  renderPractice() {
    const comp = S.practice === 'comp';
    $('compStage').hidden = !comp; $('compCard').hidden = !comp;
    $('micCard').hidden = comp; $('modeSeg').hidden = comp;
    if (comp) { $('stageDet').hidden = true; if (Mic.on) Mic.stop(); }   // single-note judging does not fit chords
    this.renderLegend(); this.renderRhythm(); this.renderVoicingTag();
    Board.drawNotes(this.view);
  },
  renderRhythm() {
    const r = COMP_RHYTHMS[S.compRhythm], names = ['1', '&', '2', '&', '3', '&', '4', '&'];
    $('rhythm').innerHTML = names.map((n, i) =>
      `<i class="${r.hits.includes(i) ? 'hit' : ''}${r.ant && i === 7 ? ' ant' : ''}">${n}</i>`).join('');
    $('rhythm').setAttribute('aria-label', `リズム：${r.label}`);
    $('rhythmHint').textContent = r.hint;
  },
  /** Highlight the two eighths of the sounding beat (-1 clears). */
  markRhythm(beat) {
    document.querySelectorAll('#rhythm i').forEach((el, i) => el.classList.toggle('cur', beat >= 0 && i >> 1 === beat));
  },
  renderVoicingTag() {
    const v = S.practice === 'comp' && voicingFor(this.view.chord, S);
    $('voicingTag').textContent = v ? v.name : '';
  },
  calibMsg(t) { document.querySelectorAll('[data-calib-msg]').forEach(el => { el.textContent = t; }); },
  renderLatency() {
    const ms = Math.round(judgeOffset() * 1000);
    $('latLbl').textContent = S.latency != null ? `${ms}ms（実測）` : '未測定';
    $('latHint').textContent = S.latency != null
      ? 'クリックに合わせて弾いて測った値です。イヤホンや端末を変えたら測り直してください。'
      : '端末から読み取った推定値を使っています。「マイクの準備をやり直す」から実測できます。';
  },
  /** Timing calibration progress: {running, hits, total, msg}. */
  latState({running, hits = 0, total = 0, msg}) {
    $('latBtn').disabled = !!running;
    $('latBtn').textContent = running ? '測定中…' : S.latency != null ? 'もう一度測る' : 'タイミングを測る';
    $('latDots').innerHTML = running ? Array.from({length:total}, (_, i) => `<i class="${i < hits ? 'on' : ''}"></i>`).join('') : '';
    if (msg != null) document.querySelectorAll('[data-lat-msg]').forEach(el => { el.textContent = msg; });
  },

  /* ----- mic ----- */
  micState() {
    $('micOff').hidden = Mic.on; $('micOn').hidden = !Mic.on; if (!Mic.on) $('stageDet').hidden = true;
    $('spkHint').hidden = !(Mic.on && S.audioOut === 'speaker');
  },
  micError(msg) { const el = $('micErr'); el.textContent = msg; el.hidden = !msg; },
  meter(rms, gate) {
    $('meterBar').style.width = Math.min(100, rms / 0.08 * 100) + '%';
    $('gateMark').style.left = Math.min(99, gate / 0.08 * 100) + '%';
  },
  showNote(midi, chord, cls, iv, recorded) {
    $('detNote').textContent = NOTE[midi % 12];
    $('detText').textContent = chord ? `${chordName(chord)} に対して ${ivLabel(chord.q, iv)}${recorded ? '' : '（記録なし）'}` : 'カウント中';
    const b = $('detBadge'); b.hidden = !cls;
    if (cls) { b.className = 'badge ' + cls; b.textContent = CLASS_JA[cls]; }
    const sd = $('stageDet');   // compact echo in the stage so feedback is visible without scrolling
    sd.hidden = false; sd.className = 'badge ' + (cls || ''); sd.textContent = NOTE[midi % 12] + (chord ? ' ' + ivLabel(chord.q, iv) : '');
    const hd = $('histDots'), i = document.createElement('i');
    if (cls) i.className = cls;
    hd.appendChild(i); while (hd.children.length > 40) hd.removeChild(hd.firstChild);
    if (recorded) this.renderMetrics();
  },
  metricsHTML(st) {
    const s = Stats.sum(st);
    const cell = (label, num, den) => `<div><small>${label}</small><b>${den ? pct(num / den) : '—'}</b></div>`;
    return cell('強拍CT率', s.sct, s.sn) + cell('3rd/7th着地', s.gh, s.gn) + cell('アヴォイド', s.avoid, s.n);
  },
  renderMetrics() { $('liveMetrics').innerHTML = this.metricsHTML(Stats.session); },

  /* ----- log ----- */
  renderLog() {
    $('sessionStats').innerHTML = this.metricsHTML(Stats.session);
    const adv = Stats.advice(Stats.all);
    $('advice').innerHTML = adv.map((a, i) =>
      `<div class="adv"><p>${a.text}</p>${a.fix ? `<p class="fix">${a.fix}</p>` : ''}${a.apply ? `<button class="btn ghost" data-action="advice" data-i="${i}">この練習にする</button>` : ''}</div>`).join('');
    this.advice = adv;
    const rows = Object.entries(Stats.all.q).filter(([, r]) => r.n > 0);
    const bar = (v, den, bad) => den
      ? `<div class="mbar${bad ? ' bad' : ''}"><i><u style="width:${Math.round(v / den * 100)}%"></u></i><span>${pct(v / den)}</span></div>`
      : '<span class="muted">—</span>';
    $('report').innerHTML = rows.length
      ? `<table class="rtable"><thead><tr><th>コード</th><th>音数</th><th>強拍CT</th><th>3rd/7th着地</th><th>アヴォイド</th></tr></thead><tbody>${
          rows.map(([k, r]) => `<tr><td>${CHORDS[k].ja.replace('（ドミナント）','')}</td><td>${r.n}</td><td>${bar(r.sct, r.sn)}</td><td>${bar(r.gh, r.gn)}</td><td>${bar(r.avoid, r.n, true)}</td></tr>`).join('')}</tbody></table>`
      : '<p class="small muted" style="margin:6px 0 0">まだ記録がありません。再生中にマイク判定をオンにして弾くと、ここに貯まります。</p>';
  }
};

export {SEGS, Seg, UI};
