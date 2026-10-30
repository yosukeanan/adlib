// My progressions: a dialog to create, edit and delete the user's own chord charts.
import {S, loop, barRange, selectSong} from './state.js';
import {$} from './util.js';
import {SONGS, saveCustomSong, deleteCustomSong, isCustomSong} from './songs.js';
import {Player} from './player.js';
import {UI} from './ui.js';

const SongEditor = {
  id:null,   // the progression being edited; null = a new one
  /** @param id a saved progression to edit, or nothing to start a new one. */
  open(id) {
    const dlg = $('songEditor');
    if (dlg.open) return;
    const s = id && isCustomSong(id) ? SONGS.find(x => x.id === id) : null;
    this.id = s ? s.id : null;
    $('seTitle').textContent = s ? 'マイ進行を編集' : 'マイ進行を作る';
    $('seName').value = s ? s.name : '';
    $('seChart').value = s ? s.chart : '';
    $('seDelete').hidden = !s;
    this.error('');
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  },
  error(msg) { const el = $('seErr'); el.textContent = msg; el.hidden = !msg; },
  save() {
    let s;
    try { s = saveCustomSong({id:this.id, name:$('seName').value, chart:$('seChart').value}); }
    catch (e) { this.error(e.message); return; }
    this.close();
    if (s.id !== S.prog) selectSong(s.id);
    else {                                    // the chart of the current song changed under it
      Object.assign(loop, {a:null, b:null});
      if (Player.playing) { Player.bar = barRange()[0]; Player.prevChord = null; }
      UI.render(new Set(['prog']));
    }
    UI.renderSongs();
  },
  remove() {
    const id = this.id;
    if (!id || !confirm('このマイ進行を削除しますか？')) return;
    if (id === S.prog) selectSong(SONGS.find(s => !isCustomSong(s.id)).id);
    deleteCustomSong(id);
    this.close();
    UI.renderSongs();
  },
  /** Closes without saving (cancel, ×, Esc all end up here or in the native close). */
  close() {
    const dlg = $('songEditor');
    if (!dlg.open) return;
    if (dlg.close) dlg.close(); else dlg.removeAttribute('open');
  }
};

export {SongEditor};
