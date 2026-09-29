#!/usr/bin/env node
// Real-browser smoke test of the viewer against a running server. Offline, no dependencies:
// Node >= 22 (global WebSocket) drives headless Chrome/Edge over the DevTools protocol.
//
//   node scripts/smoke-viewer.mjs --work <id> [--url http://localhost:8180] [--seconds 20]
//                                [--zoom 3] [--pan 0] [--key <access key>] [--shot .seurat/smoke-viewer.png]
//                                [--max-refused-pct 2] [--size 1600x900] [--cap 362]
//
// --size WxH sets the viewport in CSS px (default 1600x900); the "held" line is the settled number of brushes the viewer holds,
// read from the Telemetry panel after the run. Console errors/warnings the page logs are listed and fail the run.
// Opens #/visor/<id>, zooms in at the centre, then drags the view `--pan` times, and counts the Seurat/1 traffic the page sends
// and receives. Fails on a page exception, an ERROR frame, a decode/CRC release (SOLTAR 2/6),
// no refinement past the first strata, or too many deliveries refused on arrival (SOLTAR 4).
// With --key it signs in first (seurat.conf auth.accounts) and reports the finest stratum reached
// and the bands delivered there. Use a large work (1.6-31 GP): small ones never leave the sketch.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
const [W, H] = (args.size ?? '1600x900').split('x').map(Number);
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
  'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Installed before the app loads: counts control frames per type and channel, delivery strata,
// SOLTAR reasons, and failed syntheses, in window.__smoke.
const hook = `(() => {
  const vi = (b, o) => { const n = 1 << (b[o] >> 6); let v = b[o] & 0x3f;
    for (let i = 1; i < n; i++) v = v * 256 + b[o + i]; return [v, o + n]; };
  const S = window.__smoke = { in: {}, out: {}, strata: {}, s0bands: {}, soltar: {}, synthFail: 0 };
  const bump = (m, k) => { m[k] = (m[k] || 0) + 1; };
  const NativeWS = window.WebSocket;
  window.WebSocket = function (...a) {
    const s = new NativeWS(...a);
    s.addEventListener('message', (e) => {
      if (!(e.data instanceof ArrayBuffer)) return;
      const b = new Uint8Array(e.data);
      if (b[0] === 1) { let o = 1; for (let i = 0; i < 3; i++) o = vi(b, o)[1]; bump(S.strata, b[o]);
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
    w.addEventListener('message', (e) => { if (e.data && e.data.ok === false && e.data.error !== 'stale-parent') S.synthFail++; });
    return w;
  };
  window.Worker.prototype = NativeWorker.prototype;
})();`;

let exitCode = 1;
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
  const consoleIssues = []; // the page's own console.error / console.warn (refusal verdicts are counted apart)
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
    else if (m.method === 'Runtime.exceptionThrown') {
      exceptions.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
    } else if (m.method === 'Runtime.consoleAPICalled') {
      const text = String(m.params.args?.[0]?.value ?? '');
      const why = /refused \((\w+)\)/.exec(text);
      if (why) refusals[why[1]] = (refusals[why[1]] ?? 0) + 1;
      else if (m.params.type === 'error' || m.params.type === 'warning') consoleIssues.push(`${m.params.type}: ${text}`);
    } else if (m.method === 'Log.entryAdded' && (m.params.entry.level === 'error' || m.params.entry.level === 'warning')) {
      consoleIssues.push(`${m.params.entry.level}: ${m.params.entry.text} ${m.params.entry.url ?? ''}`);
    }
  });
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Page.enable');
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: hook });
  if (args.key) {
    await cdp('Page.addScriptToEvaluateOnNewDocument',
      { source: `localStorage.setItem('seurat.accessKey', ${JSON.stringify(args.key)})` });
  }
  if (args.cap) {
    await cdp('Page.addScriptToEvaluateOnNewDocument',
      { source: `localStorage.setItem('seurat.brushCap', ${JSON.stringify(String(Number(args.cap)))})` });
  }
  await cdp('Page.navigate', { url: `${base}/#/visor/${encodeURIComponent(args.work)}` });
  const read = async () => JSON.parse((await cdp('Runtime.evaluate',
    { expression: 'JSON.stringify(window.__smoke)', returnByValue: true })).result.value);
  const panFrom = 4 + 2 * zoomSteps;
  for (let t = 2; t <= seconds; t += 2) {
    await sleep(2000);
    if (t > 4 && t <= panFrom) {
      await cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -400 });
    } else if (t > panFrom && t <= panFrom + 2 * panSteps) {
      const k = (t - panFrom) / 2;
      await drag(k % 2 ? -700 : 0, k % 2 ? 0 : -400); // alternate half-screen moves: new ground each time
    }
  }
  await sleep(SETTLE_MS);
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
  const memory = `planes ${await memRow('Parent planes')} · bitmaps ${await memRow('Decoded bitmaps')} · total ${await memRow('Total (est.)')}`;
  const s = await read();
  const shot = args.shot ?? '.seurat/smoke-viewer.png'; // .seurat/ is gitignored
  writeFileSync(shot, Buffer.from((await cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  ws.close();

  const strata = Object.keys(s.strata).map(Number).filter((k) => k !== 10).sort((a, b) => a - b);
  const deliveries = Object.values(s.strata).reduce((a, b) => a + b, 0);
  const refused = s.soltar[RELEASE.refused] ?? 0;
  const refusedPct = deliveries ? (100 * refused) / deliveries : 0;
  console.log(`viewport ${W}x${H} · held ${held} brushes (settled; telemetry "${heldText}")`);
  console.log(`memory ${memory}`);
  console.log(`deliveries ${deliveries} · strata ${JSON.stringify(s.strata)} · SOLTAR ${JSON.stringify(s.soltar)}`);
  if (s.strata[0]) console.log(`stratum 0 reached · deliveries by bands-through ${JSON.stringify(s.s0bands)}`);
  console.log(`receipts ${s.out[`0:${0x26}`] ?? 0} · refused on arrival ${refused} (${refusedPct.toFixed(1)} %) ${JSON.stringify(refusals)} · screenshot ${shot}`);
  const failures = [
    exceptions.length && `page exceptions: ${exceptions.join(' | ')}`,
    consoleIssues.length && `${consoleIssues.length} console error/warning(s): ${consoleIssues.join(' | ')}`,
    s.in[ERROR] && `${s.in[ERROR]} ERROR frame(s) from the server`,
    (s.soltar[RELEASE.decode] || s.soltar[RELEASE.crc] || s.synthFail) && 'decode/CRC failures (SOLTAR 2/6)',
    strata.length < 3 && `no refinement: only strata ${strata.join(',') || 'none'} besides the seed`,
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
