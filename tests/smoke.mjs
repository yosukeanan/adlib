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
function serve() {
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream'});
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
  } finally {
    await browser.close();
    srv.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
};

main().catch(e => { console.error(e); process.exit(1); });
