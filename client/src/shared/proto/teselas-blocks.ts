import { TESELAS_MAX_NUMBERS } from '../config/constants';
import { FatalProtocolError } from './frame';
import { viDecode, viPush } from './varint';

export function readVi(bytes: Uint8Array, pos: number): { value: number; next: number } {
  try {
    return viDecode(bytes, pos);
  } catch (e) {
    throw new FatalProtocolError(e instanceof Error ? e.message : 'vi: decode failed');
  }
}

function emitWordPiece(body: number[], lo: number, hi: number): void {
  const runs: number[] = [];
  let inRun = false, start = 0;
  for (let i = 0; i < 64; i++) {
    const bit = i < 32 ? (lo & (1 << i)) !== 0 : (hi & (1 << (i - 32))) !== 0;
    if (bit && !inRun) { inRun = true; start = i; }
    else if (!bit && inRun) { runs.push(start, i - start); inRun = false; }
  }
  if (inRun) runs.push(start, 64 - start);
  const rCount = runs.length >> 1;
  if (rCount > 0 && rCount <= 3) {
    viPush(body, rCount * 4 + 3);
    for (let i = 0; i < runs.length; i += 2) body.push(runs[i]!, runs[i + 1]! - 1);
  } else {
    body.push(2, lo & 0xff, (lo >>> 8) & 0xff, (lo >>> 16) & 0xff, (lo >>> 24) & 0xff,
      hi & 0xff, (hi >>> 8) & 0xff, (hi >>> 16) & 0xff, (hi >>> 24) & 0xff);
  }
}

export function blockForm(sorted: readonly number[]): number[] {
  if (sorted.length === 0) return [];
  const menor = sorted[0]!, body: number[] = [];
  let pendingKind: 'salto' | 'lleno' | null = null, pendingCount = 0, nPiezas = 0;

  const flushPending = () => {
    if (pendingKind !== null) {
      viPush(body, pendingCount * 4 + (pendingKind === 'salto' ? 0 : 1));
      nPiezas++;
      pendingKind = null;
      pendingCount = 0;
    }
  };

  let idx = 0, prevB = -1;
  while (idx < sorted.length) {
    const b = Math.floor((sorted[idx]! - menor) / 64);
    const emptyBefore = b - prevB - 1;
    if (emptyBefore > 0) {
      if (pendingKind !== 'salto') flushPending();
      pendingKind = 'salto';
      pendingCount += emptyBefore;
    }
    let lo = 0, hi = 0;
    const bBase = menor + b * 64;
    while (idx < sorted.length && sorted[idx]! < bBase + 64) {
      const offset = sorted[idx]! - bBase;
      if (offset < 32) lo = (lo | (1 << offset)) >>> 0;
      else hi = (hi | (1 << (offset - 32))) >>> 0;
      idx++;
    }
    if (lo === 0xffffffff && hi === 0xffffffff) {
      if (pendingKind !== 'lleno') flushPending();
      pendingKind = 'lleno';
      pendingCount++;
    } else {
      flushPending();
      emitWordPiece(body, lo, hi);
      nPiezas++;
    }
    prevB = b;
  }
  flushPending();

  const out: number[] = [];
  viPush(out, menor);
  viPush(out, nPiezas);
  for (let i = 0; i < body.length; i++) out.push(body[i]!);
  return out;
}

export function decodeBlockForm(
  bytes: Uint8Array,
  pos: number,
  menor: number,
): { values: number[]; next: number } {
  if (menor < 1 || !Number.isSafeInteger(menor)) throw new FatalProtocolError('block form: menor < 1');
  const nPiezasCur = readVi(bytes, pos);
  pos = nPiezasCur.next;

  const values: number[] = [];
  let b = 0;
  for (let p = 0; p < nPiezasCur.value; p++) {
    const cabCur = readVi(bytes, pos);
    pos = cabCur.next;
    const kind = cabCur.value & 3, count = Math.floor(cabCur.value / 4);

    if (kind === 0) {
      b += count;
      if (menor + b * 64 > Number.MAX_SAFE_INTEGER) throw new FatalProtocolError('number exceeds safe integer');
    } else if (kind === 1) {
      if (values.length + count * 64 > TESELAS_MAX_NUMBERS) throw new FatalProtocolError('LLENO exceeds max numbers');
      if (menor + (b + count) * 64 - 1 > Number.MAX_SAFE_INTEGER) throw new FatalProtocolError('number exceeds safe integer');
      for (let k = 0; k < count; k++) {
        const base = menor + (b + k) * 64;
        for (let i = 0; i < 64; i++) values.push(base + i);
      }
      b += count;
    } else if (kind === 2) {
      if (pos + 8 > bytes.length) throw new FatalProtocolError('truncated MAPA');
      const base = menor + b * 64;
      if (base + 63 > Number.MAX_SAFE_INTEGER) throw new FatalProtocolError('number exceeds safe integer');
      const lo = (bytes[pos]! | (bytes[pos + 1]! << 8) | (bytes[pos + 2]! << 16) | (bytes[pos + 3]! << 24)) >>> 0;
      const hi = (bytes[pos + 4]! | (bytes[pos + 5]! << 8) | (bytes[pos + 6]! << 16) | (bytes[pos + 7]! << 24)) >>> 0;
      pos += 8;
      for (let i = 0; i < 64; i++) {
        const bit = i < 32 ? (lo & (1 << i)) !== 0 : (hi & (1 << (i - 32))) !== 0;
        if (bit) {
          if (values.length >= TESELAS_MAX_NUMBERS) throw new FatalProtocolError('exceeds max numbers');
          values.push(base + i);
        }
      }
      b += 1;
    } else {
      if (pos + count * 2 > bytes.length) throw new FatalProtocolError('truncated TRAMOS');
      const base = menor + b * 64;
      for (let r = 0; r < count; r++) {
        const desde = bytes[pos++]!, largo = bytes[pos++]! + 1;
        if (desde + largo > 64) throw new FatalProtocolError('TRAMOS run leaves block');
        if (base + desde + largo - 1 > Number.MAX_SAFE_INTEGER) throw new FatalProtocolError('number exceeds safe integer');
        if (values.length + largo > TESELAS_MAX_NUMBERS) throw new FatalProtocolError('exceeds max numbers');
        for (let i = 0; i < largo; i++) values.push(base + desde + i);
      }
      b += 1;
    }
  }
  return { values, next: pos };
}
