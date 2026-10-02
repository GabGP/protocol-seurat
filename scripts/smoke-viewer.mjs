#!/usr/bin/env node
// Real-browser smoke test of the viewer against a running server. Offline, no dependencies:
// Node >= 22 (global WebSocket) drives headless Chrome/Edge over the DevTools protocol.
//
//   node scripts/smoke-viewer.mjs --work <id> [--url http://localhost:8180] [--seconds 20]
//                                [--zoom 3] [--pan 0] [--shot .seurat/smoke-viewer.png]
//                                [--max-refused-pct 2] [--max-resent-pct 25] [--size 1600x900] [--cap 362] [--dpr 1] [--scale auto|1|0.75|0.5]
//                                [--max-tab-mib N] [--lose-context restore|giveup] [--sample S] [--breakdown 1]
//                                [--throttle off|3g] [--settle-cap S] [--quiet S]
//
// --throttle 3g applies DevTools' 3G (400 kbps down/up, 2000 ms latency; scripts/smoke/throttle.mjs) before the page loads,
// waits for the seed before the first input, settles for up to 180 s with 10 s of quiet (--settle-cap / --quiet override
// both, in either mode) and passes with the seed plus one sketch stratum. Every run reports the static load (HTTP bytes,
// encoding, DOMContentLoaded / load), the Telemetry link rows and first brush, the WebSocket rate over the delivery (a
// throttled run says loudly when DevTools did not throttle the socket) and the finest stratum at 30 / 60 / 120 s.
// --dpr N sets the emulated device pixel ratio (default 1). --scale sets the render scale through the viewer's own
// `?render=scale:X` override (default: the viewer's setting, auto); the run also switches the frame meter on and prints
// the canvas backing size, the effective scale and the fps / p95 it read.
// --size WxH sets the viewport in CSS px (default 1600x900); the "held" line is the settled number of brushes the viewer holds,
// read from the Telemetry panel after the run. Console errors/warnings the page logs are listed and fail the run.
// The "re-sent" line reads the Eviction telemetry (brushes Horizon evicted that the server sent again within 60 s, share
// of the evicted, median delay) and the re-sent bytes against every flow byte received; above --max-resent-pct it fails.
// The "memory:" line is what a reviewer reads in the browser: after the run the page's JS heap is collected (CDP
// HeapProfiler.collectGarbage) and `performance.measureUserAgentSpecificMemory()` (the tab total, page vs workers; the server
// serves the page cross-origin isolated and Chrome runs with ForceEagerMeasureMemory so it resolves at once) is read next to the
// viewer's own "Estimate (sum)" telemetry row. --max-tab-mib N fails the run when the measured tab total exceeds N MiB (off by default).
// --lose-context restore|giveup also loses the WebGL context once the run settled (WEBGL_lose_context.loseContext). `restore`
// restores it and checks the recovery; `giveup` never restores it, so the viewer falls back to Canvas2D. Either way the viewer must
// draw again (the screenshot is not blank), the bitmaps it released on the GPU are rebuilt from bands, and that sent no RECIBO. The
// page's own "context lost / restored / not restored" console lines are expected then, other issues still fail.
// --sample S adds a "curve:" line: every S seconds during the run the tab measured (page + workers), the renderer and GPU
// process private bytes and the JS heap in use, to see whether memory plateaus on a long pan loop (--seconds 200 --pan 90).
// --breakdown 1 lists what `measureUserAgentSpecificMemory` attributes the tab total to, by type and scope.
// On Windows an `os:` line adds what Task Manager shows for the smoke's own browser: the private bytes of its renderer, GPU and
// browser processes (what `measureUserAgentSpecificMemory` cannot see: bitmap pixels and the GPU process).
// Opens #/visor/<id>, zooms in at the centre, then drags the view `--pan` times, and counts the Seurat/1 traffic the page sends
// and receives. Fails on a page exception, an ERROR frame, a decode/CRC release (SOLTAR 2/6),
// no refinement past the first strata, or too many deliveries refused on arrival (SOLTAR 4).
// Reports the finest stratum reached and the bands delivered there.
// Use a large work (1.6-31 GP): small ones never leave the sketch.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linkLog } from './smoke/link.mjs';
import { applyThrottle, throttlePreset, timeline, waitForSeed } from './smoke/throttle.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const k = process.argv[i];
  if (k.startsWith('--')) args[k.slice(2)] = process.argv[++i];
}
if (!args.work) {
  console.error('usage: node scripts/smoke-viewer.mjs --work <id> [--url http://localhost:8180] [--seconds 20] [--zoom 3]');
  process.exit(2);
}
const base = args.url ?? 'http://localhost:8180';
const seconds = Number(args.seconds ?? 20);
const zoomSteps = Number(args.zoom ?? 3);
const panSteps = Number(args.pan ?? 0);
const maxRefusedPct = Number(args['max-refused-pct'] ?? 2);
const maxResentPct = Number(args['max-resent-pct'] ?? 25);
const maxTabMiB = args['max-tab-mib'] === undefined ? Infinity : Number(args['max-tab-mib']);
const [W, H] = (args.size ?? '1600x900').split('x').map(Number);
const dpr = Number(args.dpr ?? 1);
const sampleEvery = Number(args.sample ?? 0);
const loseContext = args['lose-context'] !== undefined;
const throttle = throttlePreset(args.throttle);
const tl = timeline(throttle, args);
const RECOVER_MS = 60000; // the software renderer is slow: the rebuild of every released bitmap may take a while
const BLANK_RATIO = 0.5; // a recovered screenshot must weigh at least this share of the one before the loss
const RECIBO = `0:${0x26}`;
const renderSwitches = ['fps', args.scale && `scale:${args.scale}`].filter(Boolean).join(',');
const SETTLE_MS = 4000;
const PORT = 9333;
const ERROR = 0x05;
const SOLTAR = 0x27;
const RELEASE = { lru: 1, decode: 2, refused: 4, crc: 6 };

const browsers = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
const exe = browsers.find((p) => existsSync(p));
if (!exe) {
  console.error('no Chrome/Edge found: set CHROME to its executable');
  process.exit(2);
}
const profile = mkdtempSync(join(tmpdir(), 'seurat-smoke-'));
const chrome = spawn(exe, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--no-first-run',
  '--enable-blink-features=ForceEagerMeasureMemory',
  'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Installed before the app loads: counts control frames per type and channel, delivery strata,
// SOLTAR reasons, and failed syntheses, in window.__smoke.
const hook = `(() => {
  const vi = (b, o) => { const n = 1 << (b[o] >> 6); let v = b[o] & 0x3f;
    for (let i = 1; i < n; i++) v = v * 256 + b[o + i]; return [v, o + n]; };
  const S = window.__smoke = { in: {}, out: {}, strata: {}, s0bands: {}, soltar: {}, synthFail: 0, flowBytes: 0, wsBytes: 0 };
  const bump = (m, k) => { m[k] = (m[k] || 0) + 1; };
  S.synth = {}; // by kind: count, worker ms, round trip ms (queue + work)
  const sent = new Map();
  const acc = (k, f, v) => { const e = S.synth[k] ||= { n: 0, work: 0, trip: 0 }; e[f] += v; };
  const NativeWS = window.WebSocket;
  window.WebSocket = function (...a) {
    const s = new NativeWS(...a);
    s.addEventListener('message', (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      const b = new Uint8Array(e.data);
      S.wsBytes += b.length;
      if (b[0] === 1) { S.flowBytes += b.length; S.lastFlow = performance.now(); S.firstFlow ??= S.lastFlow; let o = 1; for (let i = 0; i < 3; i++) o = vi(b, o)[1]; bump(S.strata, b[o]);
        if (b[o] === 0) bump(S.s0bands, b[o + 8] & 0x0f); }
      else bump(S.in, b[1]);
    });
    const send = s.send.bind(s);
    s.send = (d) => {
      const b = new Uint8Array(ArrayBuffer.isView(d) ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d);
      bump(S.out, b[0] + ':' + b[1]);
      if (b[0] === 0 && b[1] === ${SOLTAR}) { let o = vi(b, 2)[1]; o = vi(b, o)[1]; bump(S.soltar, b[o]); }
      return send(d);
    };
    return s;
  };
  window.WebSocket.prototype = NativeWS.prototype;
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  const NativeWorker = window.Worker;
  window.Worker = function (...a) {
    const w = new NativeWorker(...a);
    const post = w.postMessage.bind(w);
    w.postMessage = (d, t) => {
      if (d && d.synthesisId !== undefined) sent.set(d.synthesisId, { t: performance.now(), k: d.restore ? 'restore' : d.planesOnly ? 'planes' : 'synth' });
      return post(d, t);
    };
    w.addEventListener('message', (e) => {
      if (e.data && e.data.ok === false && e.data.error !== 'stale-parent') S.synthFail++;
      const q = e.data && sent.get(e.data.synthesisId);
      if (q && e.data.ok) { sent.delete(e.data.synthesisId); acc(q.k, 'n', 1); acc(q.k, 'work', e.data.elapsedMs || 0); acc(q.k, 'trip', performance.now() - q.t); }
    });
    return w;
  };
  window.Worker.prototype = NativeWorker.prototype;
})();`;

let exitCode = 1;
// Private bytes per browser process of this run (matched by its profile dir), MiB by --type; Windows only.
const osBy = () => {
  if (process.platform !== 'win32') return null;
  const ps = `Get-CimInstance Win32_Process -Filter "Name='${exe.split('/').pop()}'" | Where-Object { $_.CommandLine -like '*${profile}*' } | ForEach-Object { $t = if ($_.CommandLine -match '--type=([a-z-]+)') { $Matches[1] } else { 'browser' }; $p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue; if ($p) { "$t $($p.PrivateMemorySize64)" } }`;
  try {
    const by = {};
    for (const l of execFileSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean)) {
      const [t, b] = l.trim().split(' ');
      by[t] = (by[t] ?? 0) + Number(b) / 2 ** 20;
    }
    return by;
  } catch { return null; }
};
const osMemory = () => {
  const by = osBy();
  if (!by) return 'n/a (not Windows or not readable)';
  const total = Object.values(by).reduce((a, b) => a + b, 0);
  return `${total.toFixed(0)} MiB private (${Object.entries(by).map(([t, m]) => `${t} ${m.toFixed(0)}`).join(' · ')})`;
};
try {
  let targets;
  for (let i = 0; i < 50 && !targets; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); } catch { await sleep(200); }
  }
  const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pending = new Map();
  const exceptions = [];
  const refusals = {}; // the viewer's own spec 5.4 verdicts, by reason
  const contextLog = []; // the viewer's expected lines while --lose-context is on
  const consoleIssues = []; // the page's own console.error / console.warn (refusal verdicts are counted apart)
  const link = linkLog();
  const [cx, cy] = [W / 2, H / 2];
  const drag = async (dx, dy) => {
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
    for (let k = 1; k <= 10; k++) {
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx + (dx * k) / 10, y: cy + (dy * k) / 10, button: 'left' });
    }
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx + dx, y: cy + dy, button: 'left', clickCount: 1 });
  };
  const cdp = (method, params = {}) => new Promise((res) => {
    pending.set(++id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id) pending.get(m.id)?.(m.result ?? m.error);
    else if (m.method.startsWith('Network.')) link.observe(m, ev.data.length);
    else if (m.method === 'Runtime.exceptionThrown') {
      exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    } else if (m.method === 'Runtime.consoleAPICalled') {
      const text = String(m.params.args?.[0]?.value ?? '');
      const why = /refused \((\w+)\)/.exec(text);
      if (why) refusals[why[1]] = (refusals[why[1]] ?? 0) + 1;
      else if (loseContext && /WebGL context (lost|restored|not restored)/.test(text)) contextLog.push(text);
      else if (m.params.type === 'error' || m.params.type === 'warning') consoleIssues.push(`${m.params.type}: ${text}`);
    } else if (m.method === 'Log.entryAdded' && (m.params.entry.level === 'error' || m.params.entry.level === 'warning')) {
      consoleIssues.push(`${m.params.entry.level}: ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
    }
  });
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: dpr, mobile: false });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: hook });
  if (args.cap) {
    await cdp('Page.addScriptToEvaluateOnNewDocument',
      { source: `localStorage.setItem('seurat.brushCap', ${JSON.stringify(String(Number(args.cap)))})` });
  }
  await applyThrottle(cdp, throttle); // before the only navigation: everything is throttled
  const navAt = Date.now();
  await cdp('Page.navigate', { url: `${base}/?render=${renderSwitches}#/visor/${encodeURIComponent(args.work)}` });
  const read = async () => JSON.parse((await cdp('Runtime.evaluate',
    { expression: 'JSON.stringify(window.__smoke)', returnByValue: true })).result.value);
  link.start(read, navAt);
  const seedWait = throttle ? await waitForSeed(read, tl.settleCapMs) : 0;
  // --lose-context: lose the context, restore it, wait until the picture is back; what the recovery cost.
  async function loseAndRestore() {
    const shotSize = async () => Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64').length;
    const ext = (call) => cdp('Runtime.evaluate', { returnByValue: true, expression: `(() => {
      const cv = [...document.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      const gl = cv.getContext('webgl2') || cv.getContext('webgl');
      const x = window.__loseX ||= gl && gl.getExtension('WEBGL_lose_context'); // only a live context hands it out
      if (!x) return 'no-gl'; x.${call}(); return 'ok'; })()` }).then((r) => r.result.value);
    const giveUp = args['lose-context'] === 'giveup';
    const beforeS = await read();
    const sizeBefore = await shotSize();
    const lost = await ext('loseContext');
    await sleep(1500);
    const restoredCall = args['lose-context'] === 'giveup' ? 'skipped' : await ext('restoreContext');
    const t0 = Date.now();
    let size = 0;
    while (Date.now() - t0 < RECOVER_MS) {
      await sleep(1000);
      size = await shotSize();
      if (contextLog.some((l) => (giveUp ? /Canvas2D/ : /context restored/).test(l)) && size >= BLANK_RATIO * sizeBefore) break;
    }
    const afterS = await read();
    return { lost, restoredCall, sizeBefore, size, ms: Date.now() - t0, beforeS, afterS };
  }
  const tabMeasure = async () => (await cdp('Runtime.evaluate', { returnByValue: true, awaitPromise: true, expression: `(async () => {
    if (!self.crossOriginIsolated || !performance.measureUserAgentSpecificMemory) return null;
    const m = await performance.measureUserAgentSpecificMemory();
    const by = (f) => m.breakdown.filter((e) => f(e.attribution[0]?.scope ?? '')).reduce((a, e) => a + e.bytes, 0);
    const parts = m.breakdown.filter((e) => e.bytes > 0).map((e) => ({ bytes: e.bytes, types: e.types, scope: e.attribution[0]?.scope ?? '-', url: e.attribution[0]?.url ?? '' }));
    return { total: m.bytes, page: by((c) => c === 'Window'), workers: by((c) => c.endsWith('WorkerGlobalScope')), parts };
  })()` })).result.value;
  const curve = [];
  const sampleNow = async (t) => {
    const tab = await tabMeasure();
    const os = osBy() ?? {};
    await cdp('HeapProfiler.enable');
    const heap = ((await cdp('Runtime.getHeapUsage')).usedSize ?? 0) / 2 ** 20;
    curve.push(`${t}s tab ${tab ? (tab.total / 2 ** 20).toFixed(0) : 'n/a'} (page ${tab ? (tab.page / 2 ** 20).toFixed(0) : '-'}) renderer ${(os.renderer ?? 0).toFixed(0)} gpu ${(os['gpu-process'] ?? 0).toFixed(0)} heap ${heap.toFixed(0)}`);
  };
  const panFrom = 4 + 2 * zoomSteps;
  let lastInput = Date.now();
  for (let t = 2; t <= seconds; t += 2) {
    await sleep(2000);
    if (t > 4 && t <= panFrom) {
      await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -400 });
      lastInput = Date.now();
    } else if (t > panFrom && t <= panFrom + 2 * panSteps) {
      const k = (t - panFrom) / 2;
      await drag(k % 2 ? -700 : 0, k % 2 ? 0 : -400); // alternate half-screen moves: new ground each time
      lastInput = Date.now();
    }
    if (sampleEvery && t % sampleEvery === 0) await sampleNow(t);
  }
  // Time to settle: how long after the last input the deliveries kept arriving (quiet for 2 s = settled).
  const totalNow = async () => Object.values((await read()).strata).reduce((a, b) => a + b, 0);
  if (args.probe) { // one more zoom-in of --probe wheel units after everything settled: what does it cost to follow?
    await sleep(SETTLE_MS);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -Number(args.probe) });
    lastInput = Date.now();
  }
  const before = await totalNow();
  let seen = before;
  let changedAt = lastInput;
  for (let quiet = Date.now(); Date.now() - quiet < tl.quietMs && Date.now() - lastInput < tl.settleCapMs; await sleep(250)) {
    const n = await totalNow();
    if (n !== seen) { seen = n; quiet = Date.now(); changedAt = quiet; }
  }
  const settleSec = ((changedAt - lastInput) / 1000).toFixed(1);
  const afterInput = seen - before;
  await sleep(SETTLE_MS);
  const recovery = loseContext ? await loseAndRestore() : null;
  // Settled held count: open Telemetry (T) and read the Brushes section's "Held" row ("362 of 768" -> 362).
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 't', code: 'KeyT', text: 't' });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 't', code: 'KeyT' });
  await sleep(1200);
  const heldText = (await cdp('Runtime.evaluate', {
    returnByValue: true,
    expression: `[...document.querySelectorAll('aside[aria-label=Telemetry] span')]
      .find((e) => e.textContent === 'Held')?.nextElementSibling?.textContent ?? ''`,
  })).result.value;
  const held = /^\d+/.exec(heldText)?.[0] ?? 'n/a';
  const memRow = async (label) => (await cdp('Runtime.evaluate', {
    returnByValue: true,
    expression: `[...document.querySelectorAll('aside[aria-label=Telemetry] span')]
      .find((e) => e.textContent === ${JSON.stringify(label)})?.nextElementSibling?.textContent ?? 'n/a'`,
  })).result.value;
  const plan = await memRow('Plan');
  const linkRows = { first: await memRow('First brush after'), transport: await memRow('Transport'), peak: await memRow('Peak (10 s)'),
    total: await memRow('Session total'), received: await memRow('Received'), rate: await memRow('Average rate'),
    allowed: await memRow('Finest allowed') };
  const resent = { evicted: await memRow('Evicted since open'), again: await memRow('Re-sent within 60 s'),
    median: await memRow('Median time to refetch') };
  const memory = `planes ${await memRow('Parent planes')} · bitmaps ${await memRow('Decoded bitmaps')} · estimate ${await memRow('Estimate (sum)')}`;
  const probeText = (expression) => cdp('Runtime.evaluate', { returnByValue: true, expression }).then((r) => r.result.value);
  const nav = await probeText(`(() => { const n = performance.getEntriesByType('navigation')[0];
    return n ? { dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd } : null; })()`);
  const canvas = await probeText(`(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect();
    return { bw: c.width, bh: c.height, cw: r.width, ch: r.height, dpr: window.devicePixelRatio }; })()`);
  const meter = await probeText(`document.querySelector('[data-meter] [aria-live=off]')?.textContent ?? 'n/a'`);
  // What a reviewer would read: JS heap after a forced GC, the browser's own tab measurement, our estimate.
  await cdp('HeapProfiler.enable');
  await cdp('HeapProfiler.collectGarbage');
  const heapAfterGc = ((await cdp('Runtime.getHeapUsage')).usedSize ?? 0) / 2 ** 20;
  const tab = await tabMeasure();
  const osText = osMemory();
  const s = await read();
  const shot = args.shot ?? '.seurat/smoke-viewer.png'; // .seurat/ is gitignored
  writeFileSync(shot, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  const extra = { rows: {}, canvases: '' };
  if (args.breakdown) { // read while the socket is still open
    for (const k of ['Compressed bands', 'GPU textures', 'Worker caches (max)', 'JS heap']) extra.rows[k] = await memRow(k);
    extra.canvases = await probeText(`JSON.stringify([...document.querySelectorAll('canvas')].map((c) => c.width + 'x' + c.height))`);
  }
  link.stop();
  ws.close();

  const strata = Object.keys(s.strata).map(Number).filter((k) => k !== 10).sort((a, b) => a - b);
  const deliveries = Object.values(s.strata).reduce((a, b) => a + b, 0);
  const refused = s.soltar[RELEASE.refused] ?? 0;
  const refusedPct = deliveries ? (100 * refused) / deliveries : 0;
  console.log(`viewport ${W}x${H} · held ${held} brushes (settled; telemetry "${heldText}")`);
  console.log(`render dpr ${canvas.dpr} · scale ${args.scale ?? 'default'} · effective ${(canvas.bw / (canvas.cw * canvas.dpr)).toFixed(2)} · backing ${canvas.bw}x${canvas.bh} (css ${canvas.cw}x${canvas.ch}) · meter "${meter}"`);
  console.log(`memory parts ${memory}`);
  const tabMiB = tab ? tab.total / 2 ** 20 : NaN;
  const tabText = tab ? `${tabMiB.toFixed(0)} MiB (measured: page ${(tab.page / 2 ** 20).toFixed(0)} · workers ${(tab.workers / 2 ** 20).toFixed(0)})`
    : 'n/a (not cross-origin isolated)';
  console.log(`memory: tab ${tabText} · js heap after gc ${heapAfterGc.toFixed(0)} MiB · estimate ${memory.split('estimate ')[1]}`);
  console.log(`os: ${osText}`);
  if (curve.length) console.log(`curve: ${curve.join(' | ')}`);
  if (args.breakdown && tab) {
    const rows = tab.parts.map((e) => `  ${(e.bytes / 2 ** 20).toFixed(1)} MiB ${e.types.join('+')} ${e.scope} ${e.url}`);
    console.log(['tab breakdown:', ...rows].join('\n'));
    console.log(`viewer rows ${JSON.stringify(extra.rows)}`);
    console.log(`canvases ${extra.canvases}`);
  }
  for (const l of link.lines(throttle, nav, linkRows, s)) console.log(l);
  if (throttle) console.log(`throttle ${args.throttle}: seed after ${seedWait === null ? 'never' : (seedWait / 1000).toFixed(1) + ' s'} · settle cap ${tl.settleCapMs / 1000} s · quiet ${tl.quietMs / 1000} s`);
  console.log(`settle ${settleSec} s after the last input (+${afterInput} deliveries) · last plan "${plan}"`);
  const mib = (t) => { const m = /([\d.]+)\s*(B|KiB|MiB|GiB)/.exec(t ?? ''); return m ? Number(m[1]) * 1024 ** ['B', 'KiB', 'MiB', 'GiB'].indexOf(m[2]) / 2 ** 20 : 0; };
  const flowMiB = s.flowBytes / 2 ** 20;
  const resentMiB = mib(resent.again.split('·')[1]);
  const resentPct = flowMiB ? (100 * resentMiB) / flowMiB : 0;
  console.log(`re-sent ${resent.again} of evicted ${resent.evicted} · median ${resent.median} · ${resentMiB.toFixed(1)} of ${flowMiB.toFixed(1)} MiB received (${resentPct.toFixed(1)} %)`);
  console.log(`deliveries ${deliveries} · strata ${JSON.stringify(s.strata)} · SOLTAR ${JSON.stringify(s.soltar)}`);
  if (s.strata[0]) console.log(`stratum 0 reached · deliveries by bands-through ${JSON.stringify(s.s0bands)}`);
  console.log(`receipts ${s.out[`0:${0x26}`] ?? 0} · refused on arrival ${refused} (${refusedPct.toFixed(1)} %) ${JSON.stringify(refusals)} · screenshot ${shot}`);
  const synthText = Object.entries(s.synth).map(([k, e]) => `${k} ${e.n} (worker ${(e.work / Math.max(e.n, 1)).toFixed(0)} ms, round trip ${(e.trip / Math.max(e.n, 1)).toFixed(0)} ms each)`).join(' · ');
  console.log(`worker jobs ${synthText}`);
  let recoveryFail = null;
  if (recovery) {
    const back = contextLog.some((l) => /context restored/.test(l));
    const giveUp = args['lose-context'] === 'giveup';
    const gaveUp = contextLog.some((l) => /Canvas2D/.test(l));
    const receipts = (recovery.afterS.out[RECIBO] ?? 0) - (recovery.beforeS.out[RECIBO] ?? 0);
    const rebuilt = (recovery.afterS.synth.restore?.n ?? 0) - (recovery.beforeS.synth.restore?.n ?? 0);
    console.log(`context loss: lose ${recovery.lost} · restore ${recovery.restoredCall} · restored ${back} · gave up ${gaveUp} · picture ${recovery.size} B vs ${recovery.sizeBefore} B before · ${(recovery.ms / 1000).toFixed(1)} s · ${rebuilt} bitmaps rebuilt from bands · RECIBO sent ${receipts}`);
    recoveryFail = [
      recovery.lost !== 'ok' && `the context could not be lost (${recovery.lost})`,
      !giveUp && !back && 'the viewer never logged the context restore',
      !giveUp && gaveUp && 'the viewer gave up on WebGL',
      giveUp && !gaveUp && 'the viewer did not fall back to Canvas2D',
      recovery.size < BLANK_RATIO * recovery.sizeBefore && 'the picture did not come back after the restore',
      receipts !== 0 && `${receipts} RECIBO sent during the recovery`,
    ].filter(Boolean);
  }
  const failures = [
    ...(recoveryFail ?? []),
    exceptions.length && `page exceptions: ${exceptions.join(' | ')}`,
    consoleIssues.length && `${consoleIssues.length} console error/warning(s): ${consoleIssues.join(' | ')}`,
    s.in[ERROR] && `${s.in[ERROR]} ERROR frame(s) from the server`,
    (s.soltar[RELEASE.decode] || s.soltar[RELEASE.crc] || s.synthFail) && 'decode/CRC failures (SOLTAR 2/6)',
    !throttle && strata.length < 3 && `no refinement: only strata ${strata.join(',') || 'none'} besides the seed`,
    throttle && Object.keys(s.strata).length < 2 && `no sketch: only strata ${Object.keys(s.strata).join(',') || 'none'} (seed + one sketch stratum needed)`,
    resentPct > maxResentPct && `re-sent ${resentPct.toFixed(1)} % of the bytes received > ${maxResentPct} %`,
    tabMiB > maxTabMiB && `tab memory ${tabMiB.toFixed(0)} MiB > ${maxTabMiB} MiB`,
    refusedPct > maxRefusedPct && `refused ${refusedPct.toFixed(1)} % > ${maxRefusedPct} %`,
  ].filter(Boolean);
  for (const f of failures) console.log('FAIL ' + f);
  if (failures.length === 0) console.log('PASS viewer smoke');
  exitCode = failures.length ? 1 : 0;
} finally {
  chrome.kill();
  await sleep(300);
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* the profile may still be locked */ }
}
process.exit(exitCode);
