// Smoke test: serves the app over HTTP and drives it in headless Chromium.
// Run: npm test   (or: node tests/smoke.mjs)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {execSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadPlaywright() {
  try { return await import('playwright'); } catch (e) {
    const req = createRequire(path.join(execSync('npm root -g').toString().trim(), 'noop.js'));
    return req('playwright');
  }
}

const TYPES = {'.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.webmanifest':'application/manifest+json', '.png':'image/png'};
// Files the test swaps in to simulate publishing a new version (path → content).
const OVERRIDES = new Map();
function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    // GitHub Pages lets browsers reuse files for 10 minutes; mimic it so stale-cache bugs show up here.
    const headers = {'Cache-Control':'max-age=600'};
    if (OVERRIDES.has(p)) {
      res.writeHead(200, {...headers, 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream'});
      res.end(OVERRIDES.get(p)); return;
    }
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {...headers, 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream'});
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

// Replaces the microphone with a stream from the app's own AudioContext, so the test can
// "pluck" notes at exact AudioContext times. Installed before the app loads.
function installFakeMic() {
  window.__adlibTest = {};
  navigator.mediaDevices.getUserMedia = async () => {
    const ctx = window.__adlibTest.Synth.ctx;
    const dest = ctx.createMediaStreamDestination();
    window.__pluck = (t, hz) => {
      const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = 'sawtooth'; o.frequency.value = hz; lp.type = 'lowpass'; lp.frequency.value = 1800;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(lp); lp.connect(g); g.connect(dest); o.start(t); o.stop(t + 0.32);
    };
    return dest.stream;
  };
}

async function newPage(browser, w, h, {introDone = true} = {}) {
  const page = await browser.newPage({viewport:{width:w, height:h}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.g/.test(m.location().url || '')) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  await page.addInitScript(installFakeMic);
  if (introDone) await page.addInitScript(() => { try { localStorage.setItem('jit-intro-done', 'true'); } catch (e) {} });
  return {page, errors};
}

const main = async () => {
  // --- static checks ---
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const need = ['./css/app.css', ...fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js')).map(f => './js/' + f)];
  const missing = need.filter(f => !sw.includes(`'${f}'`));
  check('sw.js precaches every module', !missing.length, missing.join(', '));

  const {chromium} = await loadPlaywright();
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});

  try {
    // --- portrait: load, play, tabs, board size ---
    {
      const {page, errors} = await newPage(browser, 390, 844);
      await page.goto(base);
      await page.waitForFunction(() => document.getElementById('curChord').textContent !== '—');
      check('loads and shows the first chord', true, await page.textContent('#curChord'));

      await page.click('#playBtn');
      await page.waitForFunction(() => /コーラス目/.test(document.getElementById('chorusLabel').textContent), null, {timeout:5000});
      check('playback advances past the count-in', true);
      check('body.playing set while playing', await page.evaluate(() => document.body.classList.contains('playing')));
      await page.click('#playBtn');
      check('body.playing cleared on stop', !(await page.evaluate(() => document.body.classList.contains('playing'))));

      const chipH = await page.$eval('[data-seg="pos"] button', b => b.getBoundingClientRect().height);
      check('position buttons are at least 44px tall', chipH >= 44, chipH + 'px');

      for (const tab of ['setup', 'log', 'play']) {
        await page.click(`[data-tab="${tab}"]`);
        check(`tab ${tab} shows its view`, await page.isVisible('#view-' + tab));
      }

      const labelPx = () => page.evaluate(() => {
        const t = document.querySelector('#board text.lbl:not(.s)');
        return parseFloat(getComputedStyle(t).fontSize) * t.getScreenCTM().a;
      });
      const before = await labelPx();
      await page.click('[data-tab="setup"]');
      await page.click('[data-seg="boardSize"] button[data-i="1"]');
      await page.click('[data-tab="play"]');
      const after = await labelPx();
      check('large board labels render at 12px or more', after >= 12, `${before.toFixed(1)}px → ${after.toFixed(1)}px`);
      await page.reload();
      check('board size persists', await page.evaluate(() => document.getElementById('board').classList.contains('large')));

      check('no page errors (portrait)', !errors.length, errors.join(' | '));
      await page.close();
    }

    // --- landscape: compact intro, header hidden while playing ---
    {
      const {page, errors} = await newPage(browser, 844, 390, {introDone:false});
      await page.goto(base);
      check('landscape intro is one line', await page.isVisible('.intro-short') && !(await page.isVisible('#intro ol')));
      await page.click('[data-action="introMore"]');
      check('"詳しく" expands the intro', await page.isVisible('#intro ol'));
      await page.click('[data-action="intro"]');

      const boardH = () => page.$eval('#board', b => b.getBoundingClientRect().height);
      const idleH = await boardH();
      await page.click('#playBtn');
      await wait(300);
      check('header hidden while playing (landscape)', !(await page.isVisible('header.tabs')));
      const playH = await boardH();
      check('board gets taller while playing (landscape)', playH > idleH, `${idleH.toFixed(0)}px → ${playH.toFixed(0)}px`);
      await page.click('#playBtn');
      check('header back after stop', await page.isVisible('header.tabs'));
      check('no page errors (landscape)', !errors.length, errors.join(' | '));
      await page.close();
    }

    // --- mic setup guide with a fake microphone ---
    {
      const {page, errors} = await newPage(browser, 390, 844);
      await page.goto(base);

      await page.click('#micOff [data-action="mic"]');
      check('first mic-on opens the setup guide', await page.evaluate(() => document.getElementById('micSetup').open));
      check('step 1 has no "次へ" until answered', !(await page.isVisible('#msNext')));
      await page.click('[data-out="ear"]');
      check('choosing output moves to step 2', await page.isVisible('[data-step="2"]'));

      await page.click('[data-step="2"] [data-action="calib"]');
      await page.waitForFunction(() => /感度を \d+ にしました/.test(document.querySelector('[data-step="2"] [data-calib-msg]').textContent), null, {timeout:5000});
      check('noise measurement sets the sensitivity', true, await page.evaluate(() => 'gate=' + window.__adlibTest.S.gate));

      await page.click('#msNext');
      check('step 3 shown', await page.isVisible('[data-step="3"]'));
      const LAG = 0.1;   // the simulated player answers each click 100ms late
      await page.click('#latBtn');
      await page.evaluate(lag => {
        const {LatCalib} = window.__adlibTest;
        for (const t of LatCalib.clicks) window.__pluck(t + lag, 196);
      }, LAG);
      await page.waitForFunction(() => !window.__adlibTest.LatCalib.active, null, {timeout:15000});
      const lat = await page.evaluate(() => ({lat: window.__adlibTest.S.latency, msg: document.querySelector('[data-step="3"] [data-lat-msg]').textContent}));
      check('timing calibration measures the offset', lat.lat != null && lat.lat >= LAG && lat.lat < LAG + 0.2,
        `${lat.lat == null ? 'null' : Math.round(lat.lat * 1000) + 'ms'} — ${lat.msg}`);

      await page.click('#msNext');   // 完了
      await wait(100);               // the dialog's close event is async
      const st = await page.evaluate(() => ({open: document.getElementById('micSetup').open, ready: window.__adlibTest.S.micReady, on: window.__adlibTest.Mic.on}));
      check('closing the guide marks it done and leaves the mic on', !st.open && st.ready && st.on, JSON.stringify(st));
      check('setup tab shows the measured timing', /実測/.test(await page.textContent('#latLbl')), await page.textContent('#latLbl'));

      // second mic-on goes straight to the mic, no guide
      await page.click('#micOn [data-action="mic"]');
      await page.click('#micOff [data-action="mic"]');
      await wait(200);
      check('later mic-on skips the guide', !(await page.evaluate(() => document.getElementById('micSetup').open)) && await page.evaluate(() => window.__adlibTest.Mic.on));

      // verdict rules of the calibration
      const v = await page.evaluate(() => {
        const ev = window.__adlibTest.LatCalib.evaluate;
        return [ev([0.1, 0.1, 0.1]).ok, ev([0.1, 0.3, 0.05, 0.25, 0.15, 0.4]).ok, ev([0.11, 0.12, 0.1, 0.13, 0.12, 0.11]).ok];
      });
      check('calibration rejects too few hits and large spread', v[0] === false && v[1] === false && v[2] === true, JSON.stringify(v));

      // a note judged during playback lands in the stats
      await page.click('#playBtn');
      await page.waitForFunction(() => /コーラス目/.test(document.getElementById('chorusLabel').textContent), null, {timeout:5000});
      await page.evaluate(() => { const c = window.__adlibTest.Synth.ctx; for (let i = 0; i < 4; i++) window.__pluck(c.currentTime + 0.1 + i * 0.4, 174.6); });
      await wait(2200);
      const n = await page.evaluate(() => window.__adlibTest.Stats.session.total);
      check('notes played during playback are recorded', n >= 2, `${n} notes`);
      await page.click('#playBtn');

      check('no page errors (mic)', !errors.length, errors.join(' | '));
      await page.close();
    }

    // --- comping mode: shell voicings, voice leading, rhythm, piano off ---
    {
      const {page, errors} = await newPage(browser, 390, 844);
      await page.goto(base);

      const shells = await page.evaluate(() => {
        const {Voicing} = window.__adlibTest, TUN = [40, 45, 50, 55, 59, 64], errs = [];
        let count = 0;
        for (const q of ['maj7', '6', 'm7', 'm6', '7', '7alt', 'm7b5', 'dim7']) for (let pc = 0; pc < 12; pc++) for (const t of Voicing.TEMPLATES) {
          const list = Voicing.shapes(pc, q).filter(sh => sh.tpl === t.id);
          // m7♭5 on 5-R73 would be R-♭7-♭5 on strings 5/3/2: a five-fret stretch, so it has no shape by design.
          const expectNone = q === 'm7b5' && t.id === '5-R73';
          if (!list.length && !expectNone) errs.push(`no shape ${q} pc${pc} ${t.id}`);
          if (list.length && expectNone) errs.push(`unexpected shape ${q} pc${pc} ${t.id}`);
          for (const sh of list) {
            count++;
            const want = [0, ...Voicing.shellTones(q)].map(i => (pc + i) % 12).sort().join();
            const got = sh.notes.map(n => n.midi % 12).sort().join();
            const fr = sh.notes.map(n => n.fret), low = sh.notes.reduce((a, b) => (a.midi < b.midi ? a : b));
            if (got !== want) errs.push(`${q} pc${pc} ${t.id}: notes ${got} != ${want}`);
            if (Math.max(...fr) - Math.min(...fr) > 3) errs.push(`${q} pc${pc} ${t.id}: span`);
            if (fr.some(f => f < 0 || f > 19)) errs.push(`${q} pc${pc} ${t.id}: fret range`);
            if (low.midi % 12 !== pc) errs.push(`${q} pc${pc} ${t.id}: root not lowest`);
            if (sh.notes.some(n => TUN[n.string] + n.fret !== n.midi)) errs.push(`${q} pc${pc} ${t.id}: midi`);
          }
        }
        // shapes guitarists know, written low string → high (x = muted)
        const tab = sh => [0, 1, 2, 3, 4, 5].map(st => { const n = sh.notes.find(m => m.string === st); return n ? n.fret : 'x'; }).join('');
        const has = (pc, q, t) => Voicing.shapes(pc, q).some(sh => tab(sh) === t);
        const known = {'Cmaj7 8x99xx': has(0, 'maj7', '8x99xx'), 'Cmaj7 879xxx': has(0, 'maj7', '879xxx'),
          'Cmaj7 x324xx': has(0, 'maj7', 'x324xx'), 'Cmaj7 x3x45x': has(0, 'maj7', 'x3x45x'),
          'G7 3x34xx': has(7, '7', '3x34xx'), 'Bm7b5 787xxx': has(11, 'm7b5', '787xxx')};
        return {count, errs, known};
      });
      check('every shell shape has the right notes, root at the bottom, four-fret span', !shells.errs.length,
        `${shells.count} shapes${shells.errs.length ? ' — ' + shells.errs.slice(0, 3).join('; ') : ''}`);
      const missingKnown = Object.entries(shells.known).filter(([, v]) => !v).map(([k]) => k);
      check('standard shell shapes are generated', !missingKnown.length, missingKnown.join(', ') || Object.keys(shells.known).join(' / '));

      const lead = await page.evaluate(() => {
        const {Voicing, SONGS} = window.__adlibTest, bad = [];
        let n = 0;
        for (const song of SONGS) for (let key = 0; key < 12; key++) for (const range of [[5, 9], [0, 4], [0, 15]]) {
          const chords = Voicing.chorusChords(song, key);
          // pure voice leading (no forced variation): searching both root strings can only help
          const o = {vary:false};
          const auto = Voicing.lead(chords, 'auto', range, o), six = Voicing.lead(chords, '6', range, o), five = Voicing.lead(chords, '5', range, o);
          n++;
          if (auto.path.length !== chords.length || auto.path.some(p => !p)) bad.push(`${song.id} key${key}: missing shape`);
          if (auto.cost > Math.min(six.cost, five.cost) + 1e-9) bad.push(`${song.id} key${key} ${range}: auto ${auto.cost.toFixed(2)} > fixed`);
        }
        return {n, bad};
      });
      check('voice leading: "auto" never costs more than a fixed root string', !lead.bad.length, `${lead.n} cases${lead.bad.length ? ' — ' + lead.bad.slice(0, 3).join('; ') : ''}`);

      // UI: switch to comping
      await page.click('[data-seg="practice"] button[data-i="1"]');
      const ui = await page.evaluate(() => ({
        card: !document.getElementById('compCard').hidden, mic: !document.getElementById('micCard').hidden,
        modeSeg: !document.getElementById('modeSeg').hidden, dots: document.querySelectorAll('#gNotes > g').length,
        tag: document.getElementById('voicingTag').textContent, hits: document.querySelectorAll('#rhythm i.hit').length}));
      check('comping shows its card and hides the mic card and display modes', ui.card && !ui.mic && !ui.modeSeg, JSON.stringify(ui));
      check('fretboard shows exactly the three shell notes', ui.dots === 3, `${ui.dots} dots, ${ui.tag}`);
      check('Charleston lights two rhythm cells', ui.hits === 2);

      await page.evaluate(() => {
        const {Synth} = window.__adlibTest, origKeys = Synth.keys, origPluck = Synth.pluck;
        window.__keys = 0; window.__plucks = 0;
        Synth.keys = function (...a) { window.__keys++; return origKeys.apply(this, a); };
        Synth.pluck = function (...a) { window.__plucks++; return origPluck.apply(this, a); };
      });
      const keysWhilePlaying = async ms => {
        await page.evaluate(() => { window.__keys = 0; });
        await page.click('#playBtn'); await wait(ms); await page.click('#playBtn');
        return page.evaluate(() => window.__keys);
      };
      check('piano is silent in comping mode', (await keysWhilePlaying(3000)) === 0);
      await page.click('[data-seg="compGuide"] button[data-i="1"]');
      await page.evaluate(() => { window.__plucks = 0; });
      const pianoWithGuide = await keysWhilePlaying(3000);
      check('"お手本" plays the shells with its own tone, piano stays silent', pianoWithGuide === 0 && await page.evaluate(() => window.__plucks) > 0);

      const labels = await page.$$eval('[data-seg="compRhythm"] button', bs => bs.map(b => b.textContent));
      check('rhythm buttons keep the declared order', labels[0] === 'フォー・ビート' && labels[1] === '2・4拍', labels.join(' / '));
      await page.click('[data-seg="compRhythm"] button[data-i="0"]');
      check('four-beat lights four rhythm cells', (await page.$$('#rhythm i.hit')).length === 4);

      await page.click('[data-seg="practice"] button[data-i="0"]');
      const solo = await page.evaluate(() => ({card: !document.getElementById('compCard').hidden, mic: !document.getElementById('micCard').hidden}));
      check('back to solo restores the mic card', !solo.card && solo.mic, JSON.stringify(solo));
      check('piano plays again in solo mode', (await keysWhilePlaying(3000)) > 0);

      check('no page errors (comping)', !errors.length, errors.join(' | '));
      await page.close();
    }

    // --- volume mixer and fret movement (roadmap A, B, C) ---
    {
      const {page, errors} = await newPage(browser, 390, 844);
      await page.goto(base);

      // A1: the guide sounds about as loud as the bass where a phone speaker plays (above 300 Hz)
      const lv = await page.evaluate(async () => {
        const {Synth} = window.__adlibTest, saved = Synth.ctx;
        const render = async (fn, vol) => {
          const sr = 48000, oc = new OfflineAudioContext(1, sr, sr);
          Synth.vol = vol || null; Synth.build(oc); fn(0.05);
          const x = (await oc.startRendering()).getChannelData(0);
          let y = 0, px = 0, hs = 0; const a = 1 / (1 + 2 * Math.PI * 300 / sr);
          for (const v of x) { y = a * (y + v - px); px = v; hs += y * y; }
          return 10 * Math.log10(hs / x.length + 1e-20);
        };
        const bass = await render(t => Synth.bass(t, 41, 0.46));
        const guides = [];
        for (const notes of [[45, 55, 65], [43, 53, 59], [48, 59, 64]]) guides.push(await render(t => Synth.pluck(t, notes, 0.45)));
        const muted = await render(t => Synth.pluck(t, [45, 55, 65], 0.45), {master:100, bass:100, comp:100, drums:100, guide:0});
        Synth.ctx = saved; Synth.vol = null;
        return {bass, guides, muted};
      });
      const diffs = lv.guides.map(g => g - lv.bass);
      check('guide is within ±3 dB of the bass above 300 Hz', diffs.every(d => Math.abs(d) <= 3), diffs.map(d => d.toFixed(1) + 'dB').join(', '));
      check('guide volume 0 is silent', lv.muted < -90, lv.muted.toFixed(0) + 'dB');

      // A2/A3: both guide sliders drive the same setting
      await page.evaluate(() => { const el = document.querySelector('#compCard [data-vol="guide"]'); el.value = 50; el.dispatchEvent(new Event('input', {bubbles:true})); });
      const sl = await page.evaluate(() => ({s: window.__adlibTest.S.vol.guide, other: document.querySelector('#view-setup [data-vol="guide"]').value,
        lbl: document.querySelector('#view-setup [data-vol-lbl="guide"]').textContent}));
      check('guide slider updates the setting and the other slider', sl.s === 50 && sl.other === '50' && sl.lbl === '50%', JSON.stringify(sl));

      // B2: a repeated chord never keeps the identical shape
      const rep = await page.evaluate(() => {
        const {Voicing, SONGS} = window.__adlibTest, bad = [];
        for (const song of SONGS) for (let key = 0; key < 12; key++) for (const range of [[5, 9], [0, 4], [0, 15]]) {
          const ch = Voicing.chorusChords(song, key), {path} = Voicing.lead(ch, 'auto', range);
          for (let i = 1; i < ch.length; i++) {
            const same = ch[i].pc === ch[i - 1].pc && ch[i].q === ch[i - 1].q && path[i].tpl === path[i - 1].tpl && path[i].lo === path[i - 1].lo;
            // repeating is allowed only when every other shape is 3+ frets outside the window (e.g. open Emaj7 in 開放〜4)
            const near = Voicing.shapes(ch[i].pc, ch[i].q).filter(v => !(v.tpl === path[i].tpl && v.lo === path[i].lo))
              .some(v => Math.max(0, range[0] - v.lo) + Math.max(0, v.hi - range[1]) <= 2);
            if (same && near) bad.push(`${song.id} key${key} ${range} #${i}`);
          }
        }
        return bad;
      });
      check('repeated chords change shape when another shape is within 2 frets', !rep.length, rep.slice(0, 3).join('; '));

      // B1: with position moves the shells travel at least 10 frets over 40 bars
      const travel = await page.evaluate(() => {
        const {Voicing, SONGS} = window.__adlibTest, out = {};
        for (const song of SONGS) {
          const S = {prog:song.id, compVoicing:'auto', pos:'5-9', posMove:'2'};
          let lo = 99, hi = 0;
          for (let g = 0; g < 40; g++) for (const c of song.bars[g % song.bars.length]) {
            const v = Voicing.voicingFor({bar:g % song.bars.length, start:c.start, key:song.keyPc, g}, S);
            lo = Math.min(lo, v.lo); hi = Math.max(hi, v.hi);
          }
          // the most the song's chords could ever travel with shells (a one-chord tune has few shapes)
          const all = song.bars.flat().flatMap(c => Voicing.shapes(c.pc, c.q));
          const inventory = Math.max(...all.map(v => v.hi)) - Math.min(...all.map(v => v.lo));
          out[song.id] = {travel: hi - lo, need: Math.min(10, inventory)};
        }
        return out;
      });
      const short = Object.entries(travel).filter(([, t]) => t.travel < t.need);
      check('position moves spread comping over 10+ frets (or every shell the chords have)', !short.length,
        Object.entries(travel).map(([k, t]) => `${k}:${t.travel}${t.need < 10 ? '/' + t.need : ''}`).join(' '));

      // B4: comping keeps the whole shell on screen (G7 sits at fret 10 when the position is 5〜9)
      await page.click('[data-seg="practice"] button[data-i="1"]');
      const b4 = await page.evaluate(() => {
        const {UI, Board} = window.__adlibTest;
        UI.setView({pc:7, q:'7', beats:4, start:0, bar:1, key:0, g:0}, null, 'test');
        return {dots: document.querySelectorAll('#gNotes > g').length, range: [Board.g.f0, Board.g.f1], tag: document.getElementById('voicingTag').textContent};
      });
      check('board slides to keep the shell visible', b4.dots === 3 && b4.range[1] >= 10, JSON.stringify(b4));
      await page.click('[data-seg="practice"] button[data-i="0"]');

      // C1: solo window moves while playing, with a notice the bar before
      await page.evaluate(() => window.__adlibTest.update({posMove:'2', bpm:300}));
      const seen = new Set(); let notice = '';
      await page.click('#playBtn');
      for (let i = 0; i < 30; i++) {
        await wait(200);
        const st = await page.evaluate(() => ({f0: window.__adlibTest.Board.g.f0, txt: document.getElementById('status').textContent}));
        seen.add(st.f0); if (/^次は .* フレットへ$/.test(st.txt)) notice = st.txt;
      }
      await page.click('#playBtn');
      check('solo fret window moves every 2 bars', seen.size >= 2, [...seen].join(' → '));
      check('the move is announced a bar ahead', !!notice, notice);

      // C2: string limit shows only that string, over the whole neck
      await page.evaluate(() => window.__adlibTest.update({posMove:'off', strSet:'1'}));
      const c2 = await page.evaluate(() => {
        const {Board} = window.__adlibTest, ys = [...document.querySelectorAll('#gNotes circle')].map(c => +c.getAttribute('cy'));
        return {n: ys.length, onlyE: ys.every(y => y === Board.y(5)), range: [Board.g.f0, Board.g.f1]};
      });
      check('string limit shows chord tones on the 1st string only, whole neck', c2.n > 0 && c2.onlyE && c2.range[0] === 0 && c2.range[1] === 15, JSON.stringify(c2));
      check('position chips hidden while strings are limited', !(await page.isVisible('#posChips')));
      await page.evaluate(() => window.__adlibTest.update({strSet:'all', bpm:120}));
      check('position chips back with all strings', await page.isVisible('#posChips'));

      check('no page errors (volume / movement)', !errors.length, errors.join(' | '));
      await page.close();
    }

    // --- settings saved by an older version (on/off mixer) ---
    {
      const page = await browser.newPage({viewport:{width:390, height:844}});
      await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await page.addInitScript(installFakeMic);
      await page.addInitScript(() => localStorage.setItem('jit-settings', JSON.stringify({mix:{bass:true, comp:false, drums:true}, bpm:140})));
      await page.goto(base);
      const m = await page.evaluate(() => ({vol: window.__adlibTest.S.vol, mix: window.__adlibTest.S.mix, bpm: window.__adlibTest.S.bpm,
        lbl: document.querySelector('[data-vol-lbl="comp"]').textContent}));
      check('old "piano off" becomes piano volume 0', m.vol.comp === 0 && m.vol.bass === 100 && m.mix === undefined && m.bpm === 140 && m.lbl === 'オフ', JSON.stringify(m));
      await page.close();
    }

    // --- offline start through the service worker ---
    {
      const ctx = await browser.newContext({viewport:{width:390, height:844}});
      const page = await ctx.newPage();
      await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await page.goto(base);
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await ctx.setOffline(true);
      await page.reload();
      const chord = await page.textContent('#curChord');
      check('starts offline from the service worker cache', chord && chord !== '—', chord);
      await ctx.close();
    }

    // --- publishing a new version reaches an open app ---
    {
      const ctx = await browser.newContext({viewport:{width:390, height:844}});
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
      await page.addInitScript(() => { try { localStorage.setItem('jit-intro-done', 'true'); } catch (e) {} });
      await page.goto(base);
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);

      // "deploy" the next version: new cache name, a marker in the page and in a module
      const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
      OVERRIDES.set('/sw.js', read('sw.js').replace(/const CACHE = '[^']+';/, "const CACHE = 'adlib-test-next';"));
      OVERRIDES.set('/index.html', read('index.html').replace('<head>', '<head><meta name="adlib-test" content="next">'));
      OVERRIDES.set('/js/util.js', read('js/util.js') + '\n// adlib-test-next\n');

      await page.click('#playBtn');                       // an update must not cut off playback
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));   // app comes back to the foreground
      await wait(2500);
      const midPlay = await page.evaluate(() => ({marker: !!document.querySelector('meta[name="adlib-test"]'),
        playing: document.getElementById('playBtn').getAttribute('aria-label') === '停止'}));
      check('update waits while playing', !midPlay.marker && midPlay.playing, JSON.stringify(midPlay));
      await page.click('#playBtn');
      await page.waitForFunction(() => !!document.querySelector('meta[name="adlib-test"]'), null, {timeout:10000})
        .then(() => check('new version loads after stopping', true),
              () => check('new version loads after stopping', false, 'page still shows the old version'));
      const cached = await page.evaluate(async () => {
        const keys = await caches.keys(), c = await caches.open('adlib-test-next');
        const util = await c.match('js/util.js', {ignoreSearch:true});
        return {keys, util: util ? (await util.text()).includes('adlib-test-next') : false};
      });
      check('the new cache holds the new files (not the HTTP-cached old ones)', cached.util && cached.keys.length === 1, JSON.stringify(cached));
      check('no page errors (update)', !errors.length, errors.join(' | '));
      OVERRIDES.clear();
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
