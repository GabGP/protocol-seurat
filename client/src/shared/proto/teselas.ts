// ADR-09 set codec: run or block form, whichever is smaller.
import { TESELAS_MAX_NUMBERS } from '../config/constants';
import { FatalProtocolError } from './frame';
import { blockForm, decodeBlockForm, readVi } from './teselas-blocks';
import { viPush } from './varint';

export function setsEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.every((v, i) => v === sb[i]);
}

function cleanSorted(nums: readonly number[]): readonly number[] {
  let isClean = true;
  let prev = 0;
  for (let i = 0; i < nums.length; i++) {
    const n = nums[i]!;
    if (n < 1 || !Number.isSafeInteger(n) || n <= prev) {
      isClean = false;
      break;
    }
    prev = n;
  }
  if (isClean) return nums;

  const seen = new Set<number>();
  const out: number[] = [];
  for (const n of nums) {
    if (n >= 1 && Number.isSafeInteger(n) && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out.sort((a, b) => a - b);
}

function runForm(sorted: readonly number[]): number[] {
  const menor = sorted[0]!;
  let runStart = menor;
  let runEnd = menor;
  let primerLargo = -1;
  let prevEnd = menor;
  let nSaltos = 0;
  const tail: number[] = [];

  for (let i = 1; i <= sorted.length; i++) {
    const cur = i < sorted.length ? sorted[i]! : -1;
    if (cur === runEnd + 1) {
      runEnd = cur;
      continue;
    }
    if (primerLargo === -1) {
      primerLargo = runEnd - runStart;
    } else {
      nSaltos++;
      viPush(tail, runStart - prevEnd - 2);
      viPush(tail, runEnd - runStart);
    }
    prevEnd = runEnd;
    runStart = cur;
    runEnd = cur;
  }

  const out: number[] = [];
  viPush(out, menor);
  viPush(out, nSaltos);
  viPush(out, primerLargo);
  for (let i = 0; i < tail.length; i++) out.push(tail[i]!);
  return out;
}

export function teselasEncode(nums: readonly number[]): Uint8Array {
  const sorted = cleanSorted(nums);
  if (sorted.length === 0) return Uint8Array.of(0, 0);

  const runBytes = runForm(sorted);
  const blkBody = blockForm(sorted);
  if (blkBody.length + 1 < runBytes.length) {
    return Uint8Array.from([0, ...blkBody]);
  }
  return Uint8Array.from(runBytes);
}

function decodeRunForm(bytes: Uint8Array, pos: number, menor: number): { values: number[]; next: number } {
  if (menor < 1 || !Number.isSafeInteger(menor)) {
    throw new FatalProtocolError('run form: menor < 1');
  }
  const nSaltosCur = readVi(bytes, pos);
  const nSaltos = nSaltosCur.value;
  pos = nSaltosCur.next;

  const primerCur = readVi(bytes, pos);
  const primerLargo = primerCur.value;
  pos = primerCur.next;

  if (primerLargo + 1 > TESELAS_MAX_NUMBERS) {
    throw new FatalProtocolError('run exceeds max numbers');
  }
  if (menor + primerLargo > Number.MAX_SAFE_INTEGER) {
    throw new FatalProtocolError('number exceeds safe integer');
  }

  const values: number[] = [];
  for (let n = menor; n <= menor + primerLargo; n++) values.push(n);
  let prevLast = menor + primerLargo;

  for (let i = 0; i < nSaltos; i++) {
    const saltoCur = readVi(bytes, pos);
    const salto = saltoCur.value;
    pos = saltoCur.next;

    const largoCur = readVi(bytes, pos);
    const largo = largoCur.value;
    pos = largoCur.next;

    const start = prevLast + salto + 2;
    const last = start + largo;
    if (start > Number.MAX_SAFE_INTEGER || last > Number.MAX_SAFE_INTEGER) {
      throw new FatalProtocolError('number exceeds safe integer');
    }
    if (values.length + largo + 1 > TESELAS_MAX_NUMBERS) {
      throw new FatalProtocolError('run exceeds max numbers');
    }
    for (let n = start; n <= last; n++) values.push(n);
    prevLast = last;
  }
  return { values, next: pos };
}

export function teselasDecode(bytes: Uint8Array, pos: number): { values: number[]; next: number } {
  const first = readVi(bytes, pos);
  pos = first.next;

  if (first.value === 0) {
    const second = readVi(bytes, pos);
    pos = second.next;
    if (second.value === 0) {
      return { values: [], next: pos };
    }
    return decodeBlockForm(bytes, pos, second.value);
  }

  return decodeRunForm(bytes, pos, first.value);
}
