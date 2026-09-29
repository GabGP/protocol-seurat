import { crc32c } from '@/shared/codec/crc32c';
import { concat, viEncode } from '@/shared/proto/varint';

const PINCELADA = 0x01;
const NIBBLE_MASK = 0xf;
const CORRUPT_XOR = 0xff;

export interface DeliveryBytesOpts {
  handle: number;
  delivery: number;
  brushId: bigint;
  from: number;
  through: number;
  epoch: number;
  qY?: number;
  qC?: number;
  edition?: number;
  /** One band's bytes; the default is five arbitrary bytes. */
  band?: Uint8Array;
  /** Flip the band's CRC so the receiver must refuse it (CRC32C mismatch). */
  corruptCrc?: boolean;
}

/** A PINCELADA wire body (spec 3.4) with one band, ready for `sink.ingest`. */
export function makeDeliveryBytes(o: DeliveryBytesOpts): Uint8Array {
  const band = o.band ?? new Uint8Array([10, 20, 30, 40, 50]);
  const crc = o.corruptCrc ? crc32c(band) ^ CORRUPT_XOR : crc32c(band);
  const id = new Uint8Array(8);
  new DataView(id.buffer).setBigUint64(0, o.brushId);
  const crcBuf = new Uint8Array(4);
  new DataView(crcBuf.buffer).setUint32(0, crc);
  return concat(
    viEncode(PINCELADA),
    viEncode(o.handle),
    viEncode(o.delivery),
    id,
    new Uint8Array([((o.from & NIBBLE_MASK) << 4) | (o.through & NIBBLE_MASK)]),
    viEncode(o.epoch),
    new Uint8Array([o.qY ?? 4, o.qC ?? 6]),
    viEncode(o.edition ?? 1),
    crcBuf,
    viEncode(band.length),
    band,
  );
}
