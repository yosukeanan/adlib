// Recorder: the band (after the master volume) and, optionally, the mic in one take.
// The take never leaves the device: only the last one is kept, in memory, until the page closes.
import {$} from './util.js';
import {Synth} from './synth.js';
import {Mic} from './mic.js';

const TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
const pickType = () => TYPES.find(t => MediaRecorder.isTypeSupported(t)) || '';
const extOf = type => /mp4|aac/.test(type) ? 'm4a' : /ogg/.test(type) ? 'ogg' : 'webm';
const pad = n => String(n).padStart(2, '0');
/** adlib-YYYYMMDD-HHMMSS.ext */
const fileName = (d, ext) => `adlib-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
const clock = ms => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };

const Recorder = {
  supported: typeof window.MediaRecorder === 'function',
  recording:false, rec:null, done:null, blob:null, url:null, name:'', startedAt:0, timer:0,
  init() {
    if (!this.supported) this.error('この表示環境では録音できません。');
    this.render();
  },
  toggle() { if (this.recording) this.stop(); else this.start(); },
  /** Mixes Synth.out and (if it is on now) the mic; the wiring stays as it was at the start. */
  start() {
    if (this.recording || !this.supported) return false;
    const ctx = Synth.init(); Synth.resume();
    const dest = ctx.createMediaStreamDestination(), links = [[Synth.out, dest]];
    Synth.out.connect(dest);
    if (Mic.on && Mic.src) {
      const g = ctx.createGain(); g.gain.value = 1.0;
      Mic.src.connect(g); g.connect(dest); links.push([Mic.src, g], [g, dest]);
    }
    const unlink = () => { for (const [a, b] of links) try { a.disconnect(b); } catch (e) {} };   // Mic.stop() may have cut the mic already
    let rec;
    try {
      const type = pickType();
      rec = type ? new MediaRecorder(dest.stream, {mimeType:type}) : new MediaRecorder(dest.stream);
      const chunks = [];
      rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
      this.done = new Promise(resolve => {
        rec.onstop = () => {
          unlink();
          this.keep(new Blob(chunks, {type: rec.mimeType || type || 'audio/webm'}));
          resolve(this.blob);
        };
      });
      rec.start();
    } catch (e) {
      unlink(); this.error('録音を始められませんでした。');
      return false;
    }
    Object.assign(this, {rec, recording:true, startedAt:performance.now()});
    this.error('');
    this.timer = setInterval(() => this.render(), 250);
    this.render();
    return true;
  },
  /** Resolves with the new take's Blob. */
  stop() {
    if (!this.recording) return Promise.resolve(this.blob);
    this.recording = false; clearInterval(this.timer);
    try { this.rec.stop(); } catch (e) {}
    this.render();
    return this.done;
  },
  /** Keep only this take: the previous one's URL is released. */
  keep(blob) {
    if (this.url) URL.revokeObjectURL(this.url);
    this.blob = blob; this.url = URL.createObjectURL(blob);
    this.name = fileName(new Date(), extOf(blob.type));
    $('recAudio').src = this.url;
    const a = $('recSave'); a.href = this.url; a.download = this.name;
    this.render();
  },
  error(msg) { const el = $('recErr'); el.textContent = msg; el.hidden = !msg; },
  render() {
    const b = $('recBtn'), on = this.recording;
    b.disabled = !this.supported;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', String(on));
    $('recLbl').textContent = !this.supported ? '録音（未対応）' : on ? `停止 ${clock(performance.now() - this.startedAt)}` : '録音';
    $('recTake').hidden = on || !this.url;
  }
};

export {Recorder};
