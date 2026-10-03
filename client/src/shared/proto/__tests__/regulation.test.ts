import { describe, expect, it } from 'vitest';
import { regulationCore, regulationDecode, type Regulation } from '@/shared/proto/messages';

describe('REGULACION (ADR-07)', () => {
  it('encodes golden regulation and round-trips through regulationDecode', () => {
    const reg: Regulation = { rung: 1, budgetKibS: 2048, capacityKibS: 24576, sessions: 16 };
    const golden = Uint8Array.from([0x01, 0x48, 0x00, 0x80, 0x00, 0x60, 0x00, 0x10]);
    const encoded = regulationCore(reg);
    expect(encoded).toEqual(golden);
    expect(regulationDecode(encoded)).toEqual(reg);
  });
});
