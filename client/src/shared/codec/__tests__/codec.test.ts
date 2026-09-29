import { describe, expect, it } from 'vitest';
import { sLebDecode, sLebEncode, ulebDecode, ulebEncode, zigzagDecode, zigzagEncode } from '@/shared/codec/leb128';
import { crc32c } from '@/shared/codec/crc32c';
import { rgbToYCoCg, yCoCgToRgb } from '@/shared/codec/ycocgr';
import { deq, liftBlock, spPredict } from '@/shared/codec/spInverse';
import { forwardBlock, quant } from './sp-forward';

/** The 2x2 child block of one parent sample, as [a, b, c, d]. */
function inverseBlock(s: number, h: number, v: number, d: number): number[] {
  const out = new Int16Array(4);
  liftBlock(out, 0, 2, s, h, v, d);
  return [...out];
}

describe('leb128 + zigzag', () => {
  it('uleb round-trips incl. multi-byte', () => {
    for (const v of [0, 1, 127, 128, 300, 16384, 2 ** 32, 2 ** 53 - 1]) {
      const enc = Uint8Array.from(ulebEncode(v));
      expect(ulebDecode(enc, 0).value).toBe(v);
    }
  });
  it('zigzag pairs', () => {
    expect([zigzagEncode(0), zigzagEncode(-1), zigzagEncode(1), zigzagEncode(-2)]).toEqual([0, 1, 2, 3]);
    for (const x of [0, 1, -1, 255, -256, 1020, -1021]) expect(zigzagDecode(zigzagEncode(x))).toBe(x);
  });
  it('signed round-trip', () => {
    for (const x of [0, -1, 63, -64, 510, -510, 1020, -1020]) {
      const enc = Uint8Array.from(sLebEncode(x));
      expect(sLebDecode(enc, 0).value).toBe(x);
    }
  });
});

describe('crc32c', () => {
  it('matches Castagnoli check vector', () => {
    const v = new TextEncoder().encode('123456789');
    expect(crc32c(v)).toBe(0xe3069283);
  });
  it('empty input is zero', () => {
    expect(crc32c(new Uint8Array(0))).toBe(0);
  });
});

describe('ycocg-r', () => {
  it('round-trips extremes and ramps', () => {
    const pts: Array<[number, number, number]> = [[0, 0, 0], [255, 255, 255], [255, 0, 0], [0, 255, 0], [0, 0, 255], [13, 200, 77]];
    for (let v = 0; v < 256; v += 17) {
      pts.push([v, 0, 0], [0, v, 0], [0, 0, v], [v, v, v]);
    }
    for (const [r, g, b] of pts) {
      const { y, co, cg } = rgbToYCoCg(r, g, b);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(255);
      expect(Math.abs(co)).toBeLessThanOrEqual(255);
      expect(Math.abs(cg)).toBeLessThanOrEqual(255);
      expect(yCoCgToRgb(y, co, cg)).toEqual({ r, g, b });
    }
  });
});

describe('s+inverse', () => {
  it('inverts the forward transform incl. extremes', () => {
    const blocks: Array<[number, number, number, number]> = [
      [0, 0, 0, 0], [255, 255, 255, 255], [-510, 510, -255, 255], [10, -20, 30, -40],
    ];
    for (const [a, b, c, d] of blocks) {
      const f = forwardBlock(a, b, c, d);
      expect(inverseBlock(f.s, f.h, f.v, f.dv)).toEqual([a, b, c, d]);
    }
  });
  it('prediction + quantize round-trip at q=1', () => {
    expect(spPredict(10, 6)).toBe((10 - 6 + 2) >> 2);
    for (const x of [-1020, -5, 0, 7, 1020]) expect(deq(quant(x, 1), 1)).toBe(x);
  });
  it('dequantizes nothing without a quantizer', () => {
    expect(deq(5, 0)).toBe(0);
    expect(deq(0, 3)).toBe(0);
    expect(deq(-2, 4)).toBe(-10);
  });
  it('lossless round-trips a 256x256 plane with S+P prediction', () => {
    const orig = new Int16Array(256 * 256);
    for (let i = 0; i < orig.length; i++) orig[i] = ((i * 37 + 11) % 256) - 128;
    const parent = new Int16Array(128 * 128);
    const hDet = new Int16Array(128 * 128);
    const vDet = new Int16Array(128 * 128);
    const dDet = new Int16Array(128 * 128);
    for (let py = 0; py < 128; py++) {
      for (let px = 0; px < 128; px++) {
        const a = orig[(2 * py) * 256 + 2 * px] ?? 0;
        const b = orig[(2 * py) * 256 + 2 * px + 1] ?? 0;
        const c = orig[(2 * py + 1) * 256 + 2 * px] ?? 0;
        const d = orig[(2 * py + 1) * 256 + 2 * px + 1] ?? 0;
        const f = forwardBlock(a, b, c, d);
        const idx = py * 128 + px;
        parent[idx] = f.s;
        hDet[idx] = f.h;
        vDet[idx] = f.v;
        dDet[idx] = f.dv;
      }
    }
    // Encode with S+P prediction
    const qh = new Int16Array(128 * 128);
    const qv = new Int16Array(128 * 128);
    const qd = new Int16Array(128 * 128);
    for (let py = 0; py < 128; py++) {
      const yPrev = py === 0 ? 0 : -128;
      const yNext = py === 127 ? 0 : 128;
      for (let px = 0; px < 128; px++) {
        const xPrev = px === 0 ? 0 : -1;
        const xNext = px === 127 ? 0 : 1;
        const idx = py * 128 + px;
        const hHat = ((parent[idx + xPrev] ?? 0) - (parent[idx + xNext] ?? 0) + 2) >> 2;
        const vHat = ((parent[idx + yPrev] ?? 0) - (parent[idx + yNext] ?? 0) + 2) >> 2;
        qh[idx] = (hDet[idx] ?? 0) - hHat;
        qv[idx] = (vDet[idx] ?? 0) - vHat;
        qd[idx] = dDet[idx] ?? 0;
      }
    }
    // Decode with worker synthesis algorithm
    const recon = new Int16Array(256 * 256);
    for (let py = 0; py < 128; py++) {
      const yPrev = py === 0 ? 0 : -128;
      const yNext = py === 127 ? 0 : 128;
      for (let px = 0; px < 128; px++) {
        const xPrev = px === 0 ? 0 : -1;
        const xNext = px === 127 ? 0 : 1;
        const idx = py * 128 + px;
        const hHat = ((parent[idx + xPrev] ?? 0) - (parent[idx + xNext] ?? 0) + 2) >> 2;
        const vHat = ((parent[idx + yPrev] ?? 0) - (parent[idx + yNext] ?? 0) + 2) >> 2;
        const hVal = (qh[idx] ?? 0) + hHat;
        const vVal = (qv[idx] ?? 0) + vHat;
        const dVal = qd[idx] ?? 0;
        const p = parent[idx] ?? 0;
        liftBlock(recon, (2 * py) * 256 + 2 * px, (2 * py + 1) * 256 + 2 * px, p, hVal, vVal, dVal);
      }
    }
    expect(recon).toEqual(orig);
  });
});
