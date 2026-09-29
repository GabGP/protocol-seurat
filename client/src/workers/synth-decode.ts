import { ByteReader } from '@/shared/codec/byte-reader';
import { inflateRaw } from '@/shared/codec/inflate';
import { zz } from '@/shared/codec/leb128';
import { deq } from '@/shared/codec/spInverse';
import { TILE_HALF_CELLS } from '@/shared/config/protocol';
import type { SynthRequest } from './protocol';
import { PLANE_CHANNELS, type PlaneSet } from './synth-cache';

/** Decoded H/V/D detail bands of one channel, at parent resolution. */
export interface ChannelDetails {
  h: Int32Array;
  v: Int32Array;
  d: Int32Array;
}
export type BandDetails = [ChannelDetails, ChannelDetails, ChannelDetails];

/**
 * Read cursor shared by the hot decode loops (allocation-free). Every loop resets it after its last
 * `await`, so interleaved messages never share it.
 */
const cursor = new ByteReader();

const MASK_BITS_LOG2 = 3;
const MASK_BIT_INDEX = 7;

function emptyChannel(): ChannelDetails {
  return {
    h: new Int32Array(TILE_HALF_CELLS),
    v: new Int32Array(TILE_HALF_CELLS),
    d: new Int32Array(TILE_HALF_CELLS),
  };
}

/** Seed: three raster-order planes, each row delta-coded from its left neighbour. */
export async function decodeSeedPlanes(req: SynthRequest, planes: PlaneSet): Promise<void> {
  const w = req.seedWidth;
  const h = req.seedHeight;
  const raw = await inflateRaw(new Uint8Array(req.bands[0] ?? new ArrayBuffer(0)));
  cursor.reset(raw);
  for (const ch of PLANE_CHANNELS) {
    const pl = planes[ch];
    for (let y = 0; y < h; y++) {
      let left = 0;
      for (let x = 0; x < w; x++) {
        left += zz(cursor.uleb());
        pl[y * w + x] = left;
      }
    }
  }
}

/** One detail band: sparse values whose positions come from the bitmask at the head of the band. */
function readDetail(raw: Uint8Array, out: Int32Array, q: number): void {
  for (let i = 0; i < TILE_HALF_CELLS; i++) {
    const maskByte = raw[i >> MASK_BITS_LOG2] ?? 0;
    if (((maskByte >> (i & MASK_BIT_INDEX)) & 1) === 1) out[i] = deq(zz(cursor.uleb()), q);
  }
}

/** Brush: every non-empty band is a bitmask plus the sparse quantized details of each channel. */
export async function decodeBandDetails(req: SynthRequest): Promise<BandDetails> {
  const details: BandDetails = [emptyChannel(), emptyChannel(), emptyChannel()];
  const channels = req.qC > 0 ? 3 : 1;
  for (const bandBytes of req.bands) {
    if (!bandBytes || bandBytes.byteLength === 0) continue;
    const raw = await inflateRaw(new Uint8Array(bandBytes));
    cursor.reset(raw, TILE_HALF_CELLS >> MASK_BITS_LOG2);
    for (let c = 0; c < channels; c++) {
      const cd = details[c];
      if (!cd) continue;
      const q = c === 0 ? req.qY : req.qC;
      readDetail(raw, cd.h, q);
      readDetail(raw, cd.v, q);
      readDetail(raw, cd.d, q);
    }
  }
  return details;
}
