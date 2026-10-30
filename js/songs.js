// Chord progressions (written in their default key), the user's own progressions and fretboard positions.
import {NOTE, CHORDS, PC} from './theory.js';
import {storage} from './util.js';

const SONGS = [
  {id:'251',    name:'Ⅱ-Ⅴ-Ⅰ（メジャー）',          key:'C',  minor:false, lvl:'入門',  desc:'最小単位。3rd→7thのつながりを体に入れる',        chart:'Dm7 | G7 | Cmaj7 | Cmaj7'},
  {id:'251m',   name:'Ⅱ-Ⅴ-Ⅰ（マイナー）',          key:'C',  minor:true,  lvl:'入門',  desc:'オルタードと♭9の扱いに慣れる',                   chart:'Dm7b5 | G7alt | Cm6 | Cm6'},
  {id:'modal',  name:'ワンコード（ドリアン）',         key:'D',  minor:true,  lvl:'入門',  desc:'コードチェンジを忘れて、音色とリズムに集中',       chart:'Dm7 | Dm7 | Dm7 | Dm7'},
  {id:'circle', name:'循環（2拍チェンジ）',            key:'C',  minor:false, lvl:'反応',  desc:'2拍ごとのチェンジに遅れずに反応する',             chart:'Cmaj7 A7 | Dm7 G7 | Em7 A7 | Dm7 G7'},
  {id:'blues',  name:'ジャズ・ブルース',              key:'F',  minor:false, lvl:'定番',  desc:'セッションの定番。ドミナントの連続を歌う',         chart:'F7 | Bb7 | F7 | Cm7 F7 | Bb7 | Bdim7 | F7 | Am7b5 D7alt | Gm7 | C7 | F7 D7 | Gm7 C7'},
  {id:'mblues', name:'マイナー・ブルース',            key:'C',  minor:true,  lvl:'定番',  desc:'♭Ⅵ7→Ⅴ7の緊張感を弾き分ける',                    chart:'Cm7 | Fm7 | Cm7 | Cm7 | Fm7 | Fm7 | Cm7 | Cm7 | Ab7 | G7alt | Cm7 | G7alt'},
  {id:'mcycle', name:'マイナー・ダイアトニック循環',   key:'G',  minor:true,  lvl:'定番',  desc:'平行調のメジャーとマイナーを行き来する',           chart:'Cm7 | F7 | Bbmaj7 | Ebmaj7 | Am7b5 | D7alt | Gm6 | Gm6'},
  {id:'rhythm', name:'リズム・チェンジ（A）',          key:'Bb', minor:false, lvl:'上級',  desc:'速いチェンジの総合練習',                          chart:'Bb6 G7 | Cm7 F7 | Dm7 G7 | Cm7 F7 | Fm7 Bb7 | Ebmaj7 Edim7 | Dm7 G7 | Cm7 F7'}
];
function parseChart(str) {
  return str.split('|').map(bar => {
    const toks = bar.trim().split(/\s+/);
    const beats = 4 / toks.length;
    return toks.map((tok, i) => {
      const m = tok.match(/^([A-G][b#]?)(.*)$/);
      const q = m[2] || 'maj7';
      if (!CHORDS[q]) throw new Error('Unknown chord: ' + tok);
      return {pc: PC[m[1]], q, beats, start: i * beats};
    });
  });
}
SONGS.forEach(s => { s.bars = parseChart(s.chart); s.keyPc = PC[s.key]; });

/* ----- my progressions: saved on this device only (localStorage) ----- */
const CUSTOM_KEY = 'jit-custom-songs';
const MAX_BARS = 32, MAX_NAME = 40;
let custom = [];   // [{id, name, chart}] that passed validation

/** A song object shaped like the built-in ones; throws when the chart does not parse. */
function customSong({id, name, chart}) {
  const bars = parseChart(chart);
  if (bars.length < 1 || bars.length > MAX_BARS) throw new Error('Bar count out of range: ' + bars.length);
  const first = bars[0][0];
  return {id, name, key:NOTE[first.pc], minor:['m7', 'm6', 'm7b5'].includes(first.q),
    lvl:'マイ進行', desc:'自作の進行', chart, bars, keyPc:first.pc};
}
for (const item of storage.get(CUSTOM_KEY, [])) {
  try {
    if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.chart !== 'string') continue;
    if (SONGS.some(s => s.id === item.id)) continue;
    SONGS.push(customSong(item));
    custom.push({id:item.id, name:item.name, chart:item.chart});
  } catch (e) { /* a broken saved chart is skipped silently */ }
}

/** Check a chart bar by bar and return it tidied up; throws an Error that names the bad spot. */
function checkChart(chart) {
  const text = String(chart == null ? '' : chart).trim();
  if (!text) throw new Error('進行を入力してください');
  const bars = text.split('|').map(bar => bar.trim());
  if (bars.length > MAX_BARS) throw new Error(`小節は${MAX_BARS}個までです（今は${bars.length}小節）`);
  return bars.map((bar, i) => {
    const toks = bar ? bar.split(/\s+/) : [];
    if (!toks.length) throw new Error(`${i + 1}小節目：コードがありません`);
    if (toks.length > 4) throw new Error(`${i + 1}小節目：コードは1小節に4個までです`);
    for (const tok of toks) {
      const m = tok.match(/^([A-G][b#]?)(.*)$/);
      if (!m || !CHORDS[m[2] || 'maj7']) throw new Error(`${i + 1}小節目：「${tok}」は使えないコードです`);
    }
    return toks.join(' ');
  }).join(' | ');
}

const isCustomSong = id => custom.some(c => c.id === id);

/** Save a new progression (no id) or replace an existing one. Returns the song object. */
function saveCustomSong({id, name, chart}) {
  const nm = String(name == null ? '' : name).trim();
  if (!nm) throw new Error('名前を入力してください');
  if ([...nm].length > MAX_NAME) throw new Error(`名前は${MAX_NAME}文字までです`);
  const item = {id: id && isCustomSong(id) ? id : 'u' + Date.now().toString(36), name:nm, chart:checkChart(chart)};
  const song = customSong(item);
  const ci = custom.findIndex(c => c.id === item.id);
  if (ci >= 0) custom[ci] = item; else custom.push(item);
  const si = SONGS.findIndex(s => s.id === item.id);
  if (si >= 0) SONGS[si] = song; else SONGS.push(song);
  storage.set(CUSTOM_KEY, custom);
  return song;
}

function deleteCustomSong(id) {
  if (!isCustomSong(id)) return;
  custom = custom.filter(c => c.id !== id);
  const si = SONGS.findIndex(s => s.id === id);
  if (si >= 0) SONGS.splice(si, 1);
  storage.set(CUSTOM_KEY, custom);
}

const POSITIONS = {
  'all':  {r:[0,15],  label:'全体'},
  '0-4':  {r:[0,4],   label:'開放〜4'},
  '2-6':  {r:[2,6],   label:'2〜6'},
  '5-9':  {r:[5,9],   label:'5〜9'},
  '7-11': {r:[7,11],  label:'7〜11'},
  '9-13': {r:[9,13],  label:'9〜13'},
  '12-16':{r:[12,16], label:'12〜16'}
};

// Position moves walk up the neck and back down, one window per step.
const REGION_SEQ = ['0-4', '2-6', '5-9', '7-11', '9-13', '12-16', '9-13', '7-11', '5-9', '2-6'];
/**
 * The fret window for global bar g when the position moves every `every` bars, starting at `startPos`.
 * startPos 'all' starts at the bottom of the neck.
 */
function regionAt(g, startPos, every) {
  const start = Math.max(0, REGION_SEQ.indexOf(startPos));
  return REGION_SEQ[(start + Math.floor(Math.max(0, g) / every)) % REGION_SEQ.length];
}

export {SONGS, POSITIONS, REGION_SEQ, regionAt, parseChart, saveCustomSong, deleteCustomSong, isCustomSong};
