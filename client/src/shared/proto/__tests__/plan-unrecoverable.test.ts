import { describe, expect, it } from 'vitest';
import { tlvEncode } from '@/shared/proto/frame';
import { planCore, planDecode, type PlanMsg } from '@/shared/proto/messages';
import { concat } from '@/shared/proto/varint';

describe('PLAN INICIO IRRECUPERABLES (ADR-06)', () => {
  it('decodes PLAN INICIO without TLV with unrecoverable undefined and re-encodes to the same bytes', () => {
    const orig: PlanMsg = { handle: 1, gazeSeq: 42, event: 0, first: 10, expectedCount: 5, throttle: 1 };
    const bytes = planCore(orig);
    const decoded = planDecode(bytes);
    expect(decoded.event).toBe(0);
    if (decoded.event === 0) {
      expect(decoded.unrecoverable).toBeUndefined();
    }
    expect(decoded).toEqual(orig);
    expect(planCore(decoded)).toEqual(bytes);
  });

  it('round-trips PLAN INICIO with two brush ids through planCore and planDecode', () => {
    const orig: PlanMsg = {
      handle: 2,
      gazeSeq: 7,
      event: 0,
      first: 100,
      expectedCount: 20,
      throttle: 0,
      unrecoverable: [0x010000000000680dn, 0x0200000000001234n],
    };
    const bytes = planCore(orig);
    const decoded = planDecode(bytes);
    expect(decoded).toEqual(orig);
    expect(planCore(decoded)).toEqual(bytes);
  });

  it('skips unknown TLV tag after throttle and succeeds', () => {
    const base: PlanMsg = { handle: 1, gazeSeq: 5, event: 0, first: 0, expectedCount: 10, throttle: 2 };
    const core = planCore(base);
    const unknownTlv = tlvEncode(0x7f, new Uint8Array([1, 2, 3]));
    const payload = concat(core, unknownTlv);
    const decoded = planDecode(payload);
    expect(decoded).toEqual(base);
    if (decoded.event === 0) {
      expect(decoded.unrecoverable).toBeUndefined();
    }
  });
});
