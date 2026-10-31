// Backup: write settings, my progressions and practice stats to a JSON file, and read such a file back.
import {$, storage} from './util.js';
import {Stats} from './stats.js';
import {Player} from './player.js';

const FORMAT = 'adlib-backup', VERSION = 1;
const KEYS = {settings:'jit-settings', stats:'jit-stats', customSongs:'jit-custom-songs'};
const isObj = v => v != null && typeof v === 'object' && !Array.isArray(v);
const pad = n => String(n).padStart(2, '0');
const fileName = d => `adlib-backup-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.json`;

/** What is saved on this device now, as a backup object. */
function snapshot(now = new Date()) {
  Stats.flush();   // stats reach storage a moment after each note
  return {format:FORMAT, version:VERSION, exportedAt:now.toISOString(),
    settings: storage.get(KEYS.settings, {}),
    stats: storage.get(KEYS.stats, null) || Stats.all,
    customSongs: storage.get(KEYS.customSongs, [])};
}

/** Check a file's text and return the backup object; throws an Error with a message for the user. */
function parse(text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { throw new Error('ファイルを読み取れませんでした。中身が壊れているか、JSON ファイルではありません。'); }
  if (!isObj(o) || o.format !== FORMAT) throw new Error('adlib で書き出したファイルではありません。');
  if (o.version !== VERSION) throw new Error(`このファイルの形式（version ${o.version}）には対応していません。`);
  if (!isObj(o.settings) || !isObj(o.stats) || !Array.isArray(o.customSongs)) throw new Error('ファイルの中身が欠けているか、壊れています。');
  return o;
}

/** Replace the three saved items; on failure, put the old ones back so nothing is half-written. */
function write(o) {
  const before = Object.values(KEYS).map(k => [k, localStorage.getItem(k)]);
  try {
    localStorage.setItem(KEYS.settings, JSON.stringify(o.settings));
    localStorage.setItem(KEYS.stats, JSON.stringify(o.stats));
    localStorage.setItem(KEYS.customSongs, JSON.stringify(o.customSongs));
  } catch (e) {
    for (const [k, v] of before) try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e2) {}
    throw new Error('保存できませんでした。端末の空き容量を確認してください。');
  }
}

const Backup = {
  snapshot, parse,
  error(msg) { const el = $('bkErr'); el.textContent = msg; el.hidden = !msg; },
  export() {
    this.error('');
    const now = new Date();
    const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot(now), null, 2)], {type:'application/json'}));
    const a = document.createElement('a');
    a.href = url; a.download = fileName(now);
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },
  pick() { this.error(''); $('bkFile').click(); },
  /** The file input changed: check the file, ask before overwriting, then restart with the new data. */
  async load(input) {
    const file = input.files && input.files[0];
    input.value = '';   // choosing the same file again still fires "change"
    if (!file) return;
    let o;
    try { o = parse(await file.text()); } catch (e) { this.error(e.message); return; }
    if (!confirm('今の設定・マイ進行・練習記録を、このファイルの内容で上書きしますか？')) return;
    if (Player.playing) Player.stop();   // stopping saves the session; it must not land after the import
    try { write(o); } catch (e) { this.error(e.message); return; }
    location.reload();                   // every module reads its saved data at startup
  }
};

export {Backup};
