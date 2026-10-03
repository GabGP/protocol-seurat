import { describe, expect, it } from 'vitest';
import { FatalProtocolError } from '../frame';
import { setsEqual, teselasDecode, teselasEncode } from '../teselas';
import { rangosEncode } from '../testing/rangos-ref';

const hex = (b: Uint8Array): string =>
  Array.from(b)
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');

const fromHex = (h: string): Uint8Array => {
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
};

const R = (a: number, b: number): number[] =>
  Array.from({ length: b - a + 1 }, (_, i) => a + i);

const odd = Array.from({ length: 20 }, (_, i) => 1 + i * 2);

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('teselas codec', () => {
  const vectors: Array<{ name: string; set: number[]; hex: string }> = [
    { name: 'empty', set: [], hex: '0000' },
    { name: 'R(45,51) + R(53,60)', set: [...R(45, 51), ...R(53, 60)], hex: '2d01060007' },
    { name: 'R(285,289)', set: R(285, 289), hex: '411d0004' },
    { name: 'R(1,256)', set: R(1, 256), hex: '010040ff' },
    { name: 'R(1,256) + R(290,336)', set: [...R(1, 256), ...R(290, 336)], hex: '010140ff202e' },
    { name: 'odd', set: odd, hex: '000101025555555555000000' },
    { name: 'odd + R(70,80)', set: [...odd, ...R(70, 80)], hex: '00010202555555555500000007050a' },
    { name: 'odd + [1000]', set: [...odd, 1000], hex: '00010302555555555500000038072700' },
    {
      name: 'R(1,128) + odd.map(n => n + 128)',
      set: [...R(1, 128), ...odd.map((n) => n + 128)],
      hex: '00010209025555555555000000',
    },
  ];

  for (const v of vectors) {
    it(`encodes and decodes ${v.name}`, () => {
      const enc = teselasEncode(v.set);
      expect(hex(enc)).toBe(v.hex);
      const dec = teselasDecode(enc, 0);
      expect(dec.values).toEqual(v.set);
      expect(dec.next).toBe(enc.length);
    });
  }

  it('decodes at non-zero pos and returns next equal to byte length', () => {
    const set = [...R(45, 51), ...R(53, 60)];
    const enc = teselasEncode(set);
    const prefixed = new Uint8Array([0xff, ...enc]);
    const dec = teselasDecode(prefixed, 1);
    expect(dec.values).toEqual(set);
    expect(dec.next).toBe(prefixed.length);
  });

  it('decodes forms the encoder did not choose', () => {
    const d1 = teselasDecode(fromHex('00010111'), 0);
    expect(d1.values).toEqual(R(1, 256));
    expect(d1.next).toBe(4);

    const d2 = teselasDecode(fromHex('002d010b00060807'), 0);
    expect(d2.values).toEqual([...R(45, 51), ...R(53, 60)]);
    expect(d2.next).toBe(8);
  });

  it('encodes reference rangos vectors', () => {
    expect(hex(rangosEncode([]))).toBe('000000');
    expect(hex(rangosEncode([...R(45, 51), ...R(53, 60)]))).toBe('3c01070006');
    expect(hex(rangosEncode(R(1, 256)))).toBe('41000040ff');
    expect(hex(rangosEncode([...R(1, 256), ...R(290, 336)]))).toBe('4150012e2040ff');
  });

  it('encodes unsorted input with duplicates and non-positives like clean set', () => {
    const unsorted = [0, 50, 45, 48, 50, -3, 46, 47, 49, 51];
    const clean = R(45, 51);
    expect(hex(teselasEncode(unsorted))).toBe(hex(teselasEncode(clean)));
    expect(teselasDecode(teselasEncode(unsorted), 0).values).toEqual(clean);
  });

  it('throws FatalProtocolError on malformed inputs', () => {
    const badCases = [
      '000101073f01',
      '0001010255',
      '00010180013881',
      '2d',
    ];
    for (const b of badCases) {
      expect(() => teselasDecode(fromHex(b), 0)).toThrow(FatalProtocolError);
    }
  });

  it('compares sets with setsEqual', () => {
    expect(setsEqual([1, 2, 3], [3, 2, 1])).toBe(true);
    expect(setsEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it('property: 2000 PRNG sets encode, decode back, and <= rangos length', () => {
    const rand = mulberry32(9);
    for (let i = 0; i < 2000; i++) {
      const shape = i % 4;
      let s: number[];
      if (shape === 0) {
        const start = 1 + Math.floor(rand() * 10000);
        const len = 1 + Math.floor(rand() * 500);
        s = R(start, start + len - 1);
      } else if (shape === 1) {
        const count = Math.floor(rand() * 50);
        s = [];
        for (let k = 0; k < count; k++) s.push(1 + Math.floor(rand() * 199));
      } else if (shape === 2) {
        s = [];
        let cur = 1 + Math.floor(rand() * 100);
        const numRuns = 1 + Math.floor(rand() * 8);
        for (let r = 0; r < numRuns; r++) {
          const len = 1 + Math.floor(rand() * 40);
          for (let j = 0; j < len; j++) s.push(cur + j);
          cur += len + 1 + Math.floor(rand() * 100);
        }
      } else {
        s = [];
        const count = 1 + Math.floor(rand() * 10);
        for (let k = 0; k < count; k++) {
          const base = 1 + Math.floor(rand() * 19_999_900);
          const len = 1 + Math.floor(rand() * 5);
          for (let j = 0; j < len; j++) s.push(base + j);
        }
      }
      const clean = [...new Set(s.filter((n) => n >= 1 && Number.isSafeInteger(n)))].sort((a, b) => a - b);
      const enc = teselasEncode(s);
      const dec = teselasDecode(enc, 0);
      expect(dec.values).toEqual(clean);
      expect(dec.next).toBe(enc.length);
      const rangos = rangosEncode(s);
      expect(enc.length).toBeLessThanOrEqual(rangos.length);
    }
  });
});
