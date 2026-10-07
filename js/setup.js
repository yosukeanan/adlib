// Mic setup guide: output → noise → timing, shown the first time the mic is turned on.
import {S, update} from './state.js';
import {$} from './util.js';
import {Mic, Calib, LatCalib} from './mic.js';
import {UI} from './ui.js';

const STEPS = 3;

const MicSetup = {
  step:1, startMic:false,
  /** @param startMic turn the mic on when the guide closes (it was opened by the mic button). */
  open(startMic) {
    const dlg = $('micSetup');
    if (dlg.open) return;
    this.startMic = startMic;
    UI.calibMsg(''); UI.latState({running:false, msg:''});
    this.go(1);
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  },
  go(n) {
    this.step = n;
    const dlg = $('micSetup');
    dlg.querySelectorAll('[data-step]').forEach(el => { el.hidden = +el.dataset.step !== n; });
    dlg.querySelectorAll('.ms-steps li').forEach(li => {
      const s = +li.dataset.s;
      li.className = s === n ? 'cur' : s < n ? 'done' : '';
      if (s === n) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
    });
    dlg.querySelectorAll('[data-out]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.out === S.audioOut)));
    $('msBack').hidden = n === 1;
    $('msNext').hidden = n === 1 && !S.audioOut;          // step 1 advances by picking an answer
    $('msNext').textContent = n === STEPS ? '完了' : '次へ';
  },
  pickOut(out) { update({audioOut:out}); this.go(2); },
  next() { if (this.step < STEPS) this.go(this.step + 1); else this.close(); },
  back() { if (this.step > 1) this.go(this.step - 1); },
  /** Closing in any way counts as done: the guide can be reopened from the setup tab. */
  close() {
    const dlg = $('micSetup');
    if (!dlg.open) return;
    if (dlg.close) dlg.close(); else { dlg.removeAttribute('open'); this.onClosed(); }
  },
  /** Runs for every way of closing (buttons, Esc). */
  onClosed() {
    if (LatCalib.active || Calib.active) Mic.stop();   // aborts a measurement in progress
    update({micReady:true});
    if (this.startMic && !Mic.on) Mic.start();
    this.startMic = false;
  }
};

export {MicSetup};
