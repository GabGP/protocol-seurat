import { describe, expect, it, vi } from 'vitest';
import { BrushMemo } from '../model/preview-memo';
import type { DecodedPlanes } from '../model/preview-decoder';

const planes = (v: number): DecodedPlanes => ({ planes: [Int16Array.of(v)], width: 1, height: 1 });

describe('BrushMemo', () => {
  it('decodes a brush once while its signature holds, and again when it changes', async () => {
    const memo = new BrushMemo();
    const decode = vi.fn(async () => planes(decode.mock.calls.length));
    const first = await memo.get('9/0/0', '2<1', decode);
    expect(await memo.get('9/0/0', '2<1', decode)).toBe(first);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(await memo.get('9/0/0', '2,5<1', decode)).not.toBe(first); // a retouch landed on it
    expect(decode).toHaveBeenCalledTimes(2);
  });

  it('sweeps what the last compose did not ask for', async () => {
    const memo = new BrushMemo();
    const decode = async () => planes(0);
    await memo.get('seed', '1', decode);
    await memo.get('8/0/0', '<1', decode);
    memo.sweep();
    expect(memo.size).toBe(2);
    await memo.get('seed', '1', decode); // the next compose stops above stratum 8
    memo.sweep();
    expect(memo.size).toBe(1);
  });
});
