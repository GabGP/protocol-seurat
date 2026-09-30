// What the viewer smoke reports about the link: the static load (HTTP bytes, requests, encoding, DOMContentLoaded
// and load), the WebSocket rate over the delivery period (does DevTools throttle it?), and the finest stratum over time.

const SAMPLE_MS = 1000;
const PEAK_WINDOW_S = 5;
const MARKS_S = [30, 60, 120];
const THROTTLE_SLACK = 1.2; // a throttled link may burst a little above its rate as buffers drain
const kib = (b) => `${(b / 1024).toFixed(1)} KiB`;

export function linkLog() {
  const req = new Map(); // requestId -> { url, encoding, bytes }
  const samples = [];
  let cdpFrameBytes = 0;
  let timer = null;
  let busy = false;
  return {
    /** Every CDP event of the page session; raw is the length of its JSON. */
    observe(m, raw) {
      const p = m.params;
      if (m.method === 'Network.requestWillBeSent' && /^https?:/.test(p.request.url)) req.set(p.requestId, { url: p.request.url, encoding: null, bytes: null });
      else if (m.method === 'Network.responseReceived' && req.has(p.requestId)) {
        const h = Object.entries(p.response.headers ?? {}).find(([k]) => k.toLowerCase() === 'content-encoding');
        req.get(p.requestId).encoding = h ? h[1] : null;
      } else if (m.method === 'Network.loadingFinished' && req.has(p.requestId)) req.get(p.requestId).bytes = p.encodedDataLength;
      else if (m.method?.startsWith('Network.webSocketFrame')) cdpFrameBytes += raw;
    },
    /** Reads window.__smoke every second from navAt on (flow and WS bytes, strata). */
    start(read, navAt) {
      timer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try { const s = await read(); samples.push({ t: (Date.now() - navAt) / 1000, ws: s.wsBytes, strata: s.strata }); } catch { /* loading */ }
        busy = false;
      }, SAMPLE_MS);
    },
    stop() { clearInterval(timer); },
    /** The report lines; nav is the page's navigation timing, rows the viewer's Telemetry rows, s the final __smoke. */
    lines(preset, nav, rows, s) {
      const done = [...req.values()].filter((r) => r.bytes !== null);
      const bytes = done.reduce((a, r) => a + r.bytes, 0);
      const enc = [...new Set(done.map((r) => r.encoding ?? 'identity'))].join(',');
      const out = [`static load ${kib(bytes)} over ${done.length} HTTP request(s) · content-encoding ${enc || 'n/a'} · DOMContentLoaded ${nav ? nav.dcl.toFixed(0) : 'n/a'} ms · load ${nav ? nav.load.toFixed(0) : 'n/a'} ms`];
      out.push(`first brush after ${rows.first} (telemetry) · first flow frame at ${s.firstFlow === undefined ? 'n/a' : (s.firstFlow / 1000).toFixed(1) + ' s'} after navigation`);
      out.push(`link rows: transport ${rows.transport} · peak (10 s) ${rows.peak} · session total ${rows.total} · image received ${rows.received} · average rate ${rows.rate} · finest allowed ${rows.allowed}`);
      const active = s.firstFlow === undefined ? 0 : (s.lastFlow - s.firstFlow) / 1000;
      const avg = active > 0 ? s.wsBytes / active : 0;
      let peak = 0;
      for (const a of samples) {
        const b = samples.find((x) => x.t >= a.t + PEAK_WINDOW_S);
        if (b) peak = Math.max(peak, (b.ws - a.ws) / (b.t - a.t));
      }
      out.push(`ws ${kib(s.wsBytes)} received over ${active.toFixed(1)} s of delivery: avg ${(avg / 1000).toFixed(1)} kB/s · peak ${PEAK_WINDOW_S} s window ${(peak / 1000).toFixed(1)} kB/s · CDP frame events ${kib(cdpFrameBytes)}`);
      if (preset) {
        const cap = preset.downloadThroughput;
        const over = Math.max(avg, peak) > cap * THROTTLE_SLACK;
        out.push(over ? `!!! WEBSOCKET NOT THROTTLED: ${(Math.max(avg, peak) / 1000).toFixed(1)} kB/s > ${cap / 1000} kB/s preset — DevTools throttles HTTP only, the WS runs at full speed !!!`
          : `ws throttled: ${(Math.max(avg, peak) / 1000).toFixed(1)} kB/s <= ${cap / 1000} kB/s preset (+${Math.round((THROTTLE_SLACK - 1) * 100)} % slack)`);
      }
      const end = samples.at(-1)?.t ?? 0;
      out.push('finest stratum ' + MARKS_S.map((m) => {
        const at = samples.find((x) => x.t >= m);
        return `t=${m}s ${at ? finest(at.strata) : `n/a (run ended at ${end.toFixed(0)} s)`}`;
      }).join(' · ') + ` · end ${finest(s.strata)}`);
      return out;
    },
  };
}

/** "E<min> (<n> strata, <d> deliveries)" of a strata count map; the seed is the coarsest key. */
function finest(strata) {
  const keys = Object.keys(strata ?? {}).map(Number);
  if (keys.length === 0) return 'none';
  const n = Object.values(strata).reduce((a, b) => a + b, 0);
  return `E${Math.min(...keys)} (${keys.length} strata, ${n} deliveries)`;
}
