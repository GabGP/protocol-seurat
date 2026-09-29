import { BYTES_PER_KIB, MS_PER_S } from '../config/units';

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const;
/** Marks a download rate, the only direction this viewer measures. */
export const DOWNLINK = '↓';
const KIBI = BYTES_PER_KIB;
const KILO = MS_PER_S;
/** A value is shown in the next unit up once it would need a fourth integer digit. */
const UNIT_CEIL = 1000;

/** Three significant digits (5.70, 79.7, 340), so values keep one width as they change. */
function sig3(v: number): string {
  const r = Number(v.toPrecision(3));
  return r === 0 ? '0' : r.toFixed(r < 10 ? 2 : r < 100 ? 1 : 0);
}

function scaled(v: number, base: number, units: readonly string[]): string {
  let u = 0;
  while (u < units.length - 1 && Number(v.toPrecision(3)) >= UNIT_CEIL) {
    v /= base;
    u += 1;
  }
  return `${u === 0 ? Math.round(v) : sig3(v)} ${units[u]}`;
}

export function fmtBytes(n: number): string {
  return scaled(n, KIBI, BYTE_UNITS);
}

export function fmtRate(bytesPerS: number): string {
  return `${DOWNLINK} ${fmtBytes(bytesPerS)}/s`;
}

export function fmtMs(ms: number): string {
  return ms >= KILO ? `${sig3(ms / KILO)} s` : `${Math.round(ms)} ms`;
}
