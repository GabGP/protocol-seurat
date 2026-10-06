// The viewer smoke's page hook for the WebTransport mapping: the same counters the WebSocket hook fills
// (window.__smoke: control frames in and out by type, deliveries by stratum, SOLTAR reasons, bytes), read from the
// session's streams and datagrams. It is pasted inside the hook's function, where S, vi and bump are in scope.
// `transport` is the smoke's --transport: `ws` hides WebTransport from the page, so the viewer takes the fallback.

export const wtHook = (soltar, transport) => `
  const NativeWT = window.WebTransport;
  if (${JSON.stringify(transport)} === 'ws') window.WebTransport = undefined;
  else if (NativeWT) {
    const delivery = (b) => { // a whole unidirectional stream: the content of spec 3.1.4
      S.wsBytes += b.length; S.flowBytes += b.length; S.lastFlow = performance.now(); S.firstFlow ??= S.lastFlow;
      let o = 0; for (let i = 0; i < 3; i++) o = vi(b, o)[1];
      bump(S.strata, b[o]);
      if (b[o] === 0) bump(S.s0bands, b[o + 8] & 0x0f);
    };
    const whole = async (stream) => {
      const parts = []; let n = 0;
      try { for (const r = stream.getReader(); ;) { const { done, value } = await r.read(); if (done) break; parts.push(value); n += value.length; } }
      catch { return; } // a reset stream is not a delivery
      const b = new Uint8Array(n); let o = 0;
      for (const p of parts) { b.set(p, o); o += p.length; }
      delivery(b);
    };
    const frames = async (stream) => { // the control stream: frames back to back, cut anywhere
      let buf = new Uint8Array(0);
      try {
        for (const r = stream.getReader(); ;) {
          const { done, value } = await r.read(); if (done) break;
          S.wsBytes += value.length;
          const next = new Uint8Array(buf.length + value.length); next.set(buf); next.set(value, buf.length); buf = next;
          for (; buf.length > 0;) {
            const n1 = 1 << (buf[0] >> 6);
            if (buf.length <= n1 || buf.length < n1 + (1 << (buf[n1] >> 6))) break;
            const [len, o] = vi(buf, n1);
            if (buf.length < o + len) break;
            bump(S.in, vi(buf, 0)[0]);
            buf = buf.subarray(o + len);
          }
        }
      } catch { /* the session ended */ }
    };
    const counted = (writable, seen) => {
      const w = writable.getWriter();
      return new WritableStream({ write: (c) => { seen(c); return w.write(c); }, close: () => w.close(), abort: (r) => w.abort(r) });
    };
    const control = (c) => {
      bump(S.out, '0:' + c[0]);
      if (c[0] === ${soltar}) { let o = vi(c, 1)[1]; o = vi(c, o)[1]; bump(S.soltar, c[o]); }
    };
    window.WebTransport = function (...a) {
      const t = new NativeWT(...a);
      S.wt = true;
      let uni = null; let dg = null;
      return new Proxy(t, { get(target, k) {
        if (k === 'createBidirectionalStream') return async (...x) => {
          const s = await target.createBidirectionalStream(...x);
          const [app, mine] = s.readable.tee();
          frames(mine);
          return { readable: app, writable: counted(s.writable, control) };
        };
        if (k === 'incomingUnidirectionalStreams') return uni ??= target.incomingUnidirectionalStreams.pipeThrough(
          new TransformStream({ transform(s, out) { const [app, mine] = s.tee(); whole(mine); out.enqueue(app); } }));
        if (k === 'datagrams') return dg ??= { readable: target.datagrams.readable,
          writable: counted(target.datagrams.writable, (c) => bump(S.out, '2:' + c[0])) };
        const v = target[k];
        return typeof v === 'function' ? v.bind(target) : v;
      } });
    };
  }
`;
