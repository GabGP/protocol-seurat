import { QUEUE_AMBER_MS, QUEUE_RED_MS } from '@/shared/config/constants';
import { RateMeter } from '@/shared/lib/rate-meter';
import { DecodeQueue } from '../decode-queue';
import { MinRtt } from '../sink/min-rtt';
import { BANDS, simplePlanner, sizeOf, type Cone, type PlanItem, type Planner } from './cone-plan';
import { SIM, viewOf, type Frame } from './eviction-sim';

/**
 * ADR-08 bench: a 1 ms replay of a gaze trace through the server's gates and a link. Server side
 * as built: a plan per MIRADA (core with ancestors nearest first, then the ring), gate (c)
 * `unsettled < libre` (8 before the first RECIBO), 12 flow slots (6 amber, none red), the
 * WebSocket writer (control first, one message at a time) and a kernel send buffer drained at the
 * link rate. Client side: the real cola_ms meter, min-RTT tracker and rate meter, a synthesis
 * pool, and the policy under test choosing `libre` and when a RECIBO goes out. The planner (ADR-10)
 * and an optional QUIETA copy once the view rests `quietMs` are the cone under test.
 */
export interface Link { name: string; bps: number; oneWayMs: number; sndbuf: number }
export interface Decoder { name: string; parallel: number; baseMs: number; msPerKiB: number }

/** What the client knows when it computes RECIBO.libre (decodeMs: the measured mean synthesis job). */
export interface CreditIn {
  linkBps: number; avg: number; rttS: number; queueMs: number; parallel: number; decodeMs: number; memory: number;
}
/** What the client knows when it decides whether a RECIBO goes now. */
export interface DueIn {
  nowMs: number; landed: boolean; pending: number; oldestMs: number;
  lastFree: number; free: () => number; queueMs: number; lastQueueMs: number;
}
export interface Policy { name: string; free(c: CreditIn): number; due(d: DueIn, st: { timerAt: number }): boolean }

export interface FlowResult {
  /** Delivery bytes that arrived, and those outside the view's plan when they arrived. */
  bytes: number; stale: number;
  /** Core tiles of the view not yet synthesized, summed over the 50 ms frames. */
  stallFrames: number;
  /** Link idle while the server still had plan entries. */
  idleMs: number;
  receipts: number; deliveries: number;
  /** Times cola_ms entered amber and red. */
  amber: number; red: number;
  /** Demand waiting while both the link and a synthesis worker sat idle: a pipeline bubble. */
  starvedMs: number;
  /** Opened and not yet synthesized (server queue, wire, client queue): the in-flight bytes. */
  peakTransit: number;
  /** Bytes of brushes that arrived and were never on screen (a view's core or its ancestors) afterwards. */
  unseen: number;
}
/** `onReceipt`: each RECIBO's delivery set as it leaves (ADR-09 bench). */
export interface FlowOpts { planner?: () => Planner; quietMs?: number; onReceipt?: (numbers: number[]) => void }

const KIB = 1024;
const MEMORY = 200;
const INITIAL_CREDIT = 8;
const SLOTS = 12;
const CONTROL_BYTES = 64;

interface Msg { id: number; bytes: number; left: number; tile: string | null; to: number; seq: number }
interface Chunk { msg: Msg; bytes: number; last: boolean }

export function simulateFlow(trace: readonly Frame[], link: Link, dec: Decoder, policy: Policy, o: FlowOpts = {}): FlowResult {
  const r: FlowResult = {
    bytes: 0, stale: 0, stallFrames: 0, idleMs: 0, receipts: 0, deliveries: 0, amber: 0, red: 0, starvedMs: 0, peakTransit: 0, unseen: 0,
  };
  const srv = (o.planner ?? simplePlanner)();
  const cli = (o.planner ?? simplePlanner)();
  const events = new Map<number, Array<() => void>>();
  const at = (t: number, f: () => void): void => { const l = events.get(t) ?? []; l.push(f); events.set(t, l); };
  // Server.
  let W = INITIAL_CREDIT;
  let red = false;
  let srvQueue = 0;
  const book = new Map<string, number>();
  const booked = (k: string): number => book.get(k) ?? 0;
  const unsettled = new Map<number, number>();
  let plan: PlanItem[] = [];
  const ws: Msg[] = [];
  const ctl: Msg[] = [];
  let cur: Msg | null = null;
  const kernel: Chunk[] = [];
  let kernelBytes = 0;
  let nextId = 1;
  // Client.
  const decode = new DecodeQueue();
  decode.setParallelism(dec.parallel);
  const rtt = new MinRtt();
  const meter = new RateMeter();
  const waiting: Msg[] = [];
  const workers: Array<{ m: Msg; doneAt: number; start: number }> = [];
  let pending: Array<{ id: number; at: number }> = [];
  const held = new Map<string, number>();
  const arrived = new Map<string, { at: number; bytes: number }>();
  const lastSeen = new Map<string, number>();
  let avg = 0;
  let linkBps = 0;
  let lastFree = -1;
  let lastQueue = 0;
  let band = 0;
  let cone: Cone = { items: [], core: [], seen: [] };
  let wantSet = new Set<string>();
  let seq = 0;
  let lastSent = '';
  let movedAt = 0;
  let quietSent = true;
  const look = (now: number, quiet: boolean): void => {
    const view = viewOf(trace[Math.min(trace.length - 1, now / (SIM.stepS * 1000))]!);
    const s = ++seq;
    rtt.sent(s, now);
    at(now + link.oneWayMs, () => {
      plan = srv.plan(view, (now + link.oneWayMs) / 1000, quiet).items.filter((i) => booked(i.tile) < i.to);
      ctl.push({ id: 0, bytes: CONTROL_BYTES, left: CONTROL_BYTES, tile: null, to: 0, seq: s });
    });
  };
  const landedIds = new Set<number>();
  const st = { timerAt: 0 };
  const credit = (now: number): number => {
    const peak = meter.peak(now);
    if (avg > 0 && peak >= avg) linkBps = peak;
    return policy.free({
      linkBps, avg, rttS: rtt.seconds(now), queueMs: decode.ms, parallel: decode.workers,
      decodeMs: decode.jobMs, memory: MEMORY,
    });
  };
  const sendReceipt = (now: number): void => {
    const free = credit(now);
    const queue = Math.round(decode.ms);
    if (pending.length === 0 && free === lastFree && queue === lastQueue) return;
    const done = pending.map((p) => p.id);
    o.onReceipt?.(done);
    pending = [];
    lastFree = free;
    lastQueue = queue;
    r.receipts++;
    at(now + link.oneWayMs, () => {
      for (const id of done) {
        unsettled.delete(id);
        landedIds.delete(id);
      }
      W = free;
      srvQueue = queue;
      if (queue > QUEUE_RED_MS) red = true;
      else if (queue < QUEUE_AMBER_MS) red = false;
    });
  };
  const end = trace.length * SIM.stepS * 1000 + 2000;
  for (let now = 0; now < end; now++) {
    for (const f of events.get(now) ?? []) f();
    events.delete(now);
    // Client: a new frame every stepS sends a MIRADA when the view changed.
    if (now % (SIM.stepS * 1000) === 0 && now / (SIM.stepS * 1000) < trace.length) {
      const view = viewOf(trace[now / (SIM.stepS * 1000)]!);
      const sig = `${view.x0},${view.y0},${view.x1},${view.y1}`;
      if (sig !== lastSent) {
        lastSent = sig;
        cone = cli.plan(view, now / 1000, false);
        wantSet = new Set(cone.items.map((i) => i.tile));
        movedAt = now;
        quietSent = false;
        look(now, false);
      } else if (o.quietMs !== undefined && !quietSent && now - movedAt >= o.quietMs) {
        quietSent = true;
        look(now, true);
      }
      for (const k of cone.core) if (!held.get(k)) r.stallFrames++;
      for (const k of cone.seen) lastSeen.set(k, now);
    }
    // Server: gate (c), slots, then the writer into the kernel buffer.
    const limit = red ? 0 : srvQueue >= QUEUE_AMBER_MS ? SLOTS / 2 : SLOTS;
    while (plan.length > 0 && unsettled.size < W && ws.length + (cur && cur.tile ? 1 : 0) < limit) {
      const { tile, to } = plan.shift()!;
      const from = booked(tile);
      if (from >= to) continue;
      book.set(tile, to);
      const bytes = (sizeOf(tile) * (to - from)) / BANDS;
      const m: Msg = { id: nextId++, bytes, left: bytes, tile, to, seq: 0 };
      unsettled.set(m.id, m.bytes);
      ws.push(m);
    }
    let transit = 0;
    for (const [id, b] of unsettled) if (!landedIds.has(id)) transit += b;
    r.peakTransit = Math.max(r.peakTransit, transit);
    let room = link.sndbuf - kernelBytes;
    while (room > 0) {
      if (!cur) cur = ctl.shift() ?? ws.shift() ?? null;
      if (!cur) break;
      const n = Math.min(room, cur.left);
      cur.left -= n;
      room -= n;
      kernelBytes += n;
      kernel.push({ msg: cur, bytes: n, last: cur.left === 0 });
      if (cur.left === 0) cur = null;
    }
    // Link.
    let cap = link.bps / 1000;
    const full = cap;
    while (cap > 0 && kernel.length > 0) {
      const c = kernel[0]!;
      const n = Math.min(cap, c.bytes);
      c.bytes -= n;
      cap -= n;
      kernelBytes -= n;
      if (c.bytes > 0) break;
      kernel.shift();
      if (!c.last) continue;
      const m = c.msg;
      at(now + link.oneWayMs, () => {
        if (!m.tile) { rtt.answered(m.seq, now + link.oneWayMs); return; }
        const t = now + link.oneWayMs;
        meter.record(m.bytes, t);
        avg = avg === 0 ? m.bytes : 0.8 * avg + 0.2 * m.bytes;
        r.bytes += m.bytes;
        r.deliveries++;
        if (!wantSet.has(m.tile)) r.stale += m.bytes;
        const a = arrived.get(m.tile);
        if (a) a.bytes += m.bytes;
        else arrived.set(m.tile, { at: t, bytes: m.bytes });
        waiting.push(m);
      });
    }
    if (plan.length > 0 || ws.length > 0) {
      r.idleMs += cap / full;
      if (workers.length < dec.parallel && waiting.length === 0) r.starvedMs += cap / full;
    }
    // Client: synthesis.
    let landed = false;
    for (let i = workers.length - 1; i >= 0; i--) {
      const w = workers[i]!;
      if (w.doneAt > now) continue;
      workers.splice(i, 1);
      decode.answered(now - w.start);
      held.set(w.m.tile!, Math.max(held.get(w.m.tile!) ?? 0, w.m.to));
      landedIds.add(w.m.id);
      pending.push({ id: w.m.id, at: now });
      landed = true;
    }
    while (workers.length < dec.parallel && waiting.length > 0) {
      const m = waiting.shift()!;
      decode.posted();
      workers.push({ m, start: now, doneAt: now + Math.max(1, Math.round(dec.baseMs + (dec.msPerKiB * m.bytes) / KIB)) });
    }
    decode.setWaiting(waiting.length);
    const q = decode.ms;
    const nb = q > QUEUE_RED_MS ? 2 : q >= QUEUE_AMBER_MS ? 1 : 0;
    if (nb >= 1 && band === 0) r.amber++;
    if (nb === 2 && band < 2) r.red++;
    band = nb;
    const due = policy.due({
      nowMs: now, landed, pending: pending.length, oldestMs: pending[0]?.at ?? now,
      lastFree, free: () => credit(now), queueMs: q, lastQueueMs: lastQueue,
    }, st);
    if (due) sendReceipt(now);
  }
  for (const k of cone.seen) lastSeen.set(k, end);
  for (const [k, a] of arrived) if ((lastSeen.get(k) ?? -1) < a.at) r.unseen += a.bytes;
  return r;
}
