import { IMAGE_PX } from './eviction-sim';
import { TRACES } from './eviction-traces';
import type { Decoder, Link } from './flow-sim';

/** The links, decoders and traces the flow benches (ADR-08, ADR-10) replay. */
export const MIB = 1024 * 1024;
const KIB = 1024;
/** Estimated RECIBO overhead on the wire besides its ranges: frame header, handle, cola_ms, libre, renov_hasta. */
export const RECIBO_BYTES = 12;
export const LINKS: Link[] = [
  { name: 'lan', bps: 40 * MIB, oneWayMs: 1, sndbuf: 256 * KIB },
  { name: 'wan', bps: 4 * MIB, oneWayMs: 40, sndbuf: 256 * KIB },
  { name: 'slow', bps: 1 * MIB, oneWayMs: 100, sndbuf: 128 * KIB },
];
/** The credit bench also replays a throttled 3G link (Chrome's 3G profile as measured: 33 kB/s of WebSocket payload,
 * no added WebSocket latency, everything the server writes queued in the browser) and a fast link with a long round trip. */
export const CREDIT_LINKS: Link[] = [
  ...LINKS,
  { name: 'dt3g', bps: 33_000, oneWayMs: 25, sndbuf: 4 * MIB },
  { name: 'far', bps: 2 * MIB, oneWayMs: 300, sndbuf: MIB },
];
export const DECODERS: Decoder[] = [
  { name: 'fast', parallel: 4, baseMs: 3, msPerKiB: 0.08 },
  { name: 'slow', parallel: 2, baseMs: 10, msPerKiB: 0.5 },
];
const STILL = Array.from({ length: 400 }, () => ({ x: IMAGE_PX / 2, y: IMAGE_PX / 2, z: 1.5 }));
export const ALL = { still: STILL, ...TRACES };
