// Frame loop (runs only while playing or listening) and screen wake lock.
import {Synth} from './synth.js';
import {Player} from './player.js';
import {Mic} from './mic.js';
import {UI} from './ui.js';

const Loop = {
  id:0, n:0,
  ensure() { if (!this.id) this.id = requestAnimationFrame(() => this.frame()); },
  frame() {
    this.id = 0; this.n++;
    if (Player.playing) {
      const cur = Player.consume(Synth.ctx.currentTime - Synth.latency());
      if (cur) UI.onBeat(cur);
    }
    if (Mic.on && this.n % 2 === 0) Mic.tick();
    if (Player.playing || Mic.on) this.ensure();
  }
};

const Wake = {
  lock:null,
  async on() { try { if ('wakeLock' in navigator && !this.lock) { this.lock = await navigator.wakeLock.request('screen'); this.lock.addEventListener('release', () => { this.lock = null; }); } } catch (e) {} },
  off() { try { if (this.lock) this.lock.release(); } catch (e) {} this.lock = null; }
};

export {Loop, Wake};
