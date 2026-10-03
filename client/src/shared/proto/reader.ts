import { FatalProtocolError } from './frame';
import { teselasDecode } from './teselas';
import { strDecode, u64Decode, viDecode } from './varint';

/** A cursor over a payload: each read returns the field and moves past it. */
export class Reader {
  pos = 0;

  constructor(readonly bytes: Uint8Array) {}

  vi(): number {
    const r = viDecode(this.bytes, this.pos);
    this.pos = r.next;
    return r.value;
  }

  /** A fixed u8 field; past the payload the frame is malformed (fatal ERROR 1), never 0. */
  u8(): number {
    const v = this.bytes[this.pos];
    if (v === undefined) throw new FatalProtocolError('truncated payload');
    this.pos += 1;
    return v;
  }

  u64(): bigint {
    const r = u64Decode(this.bytes, this.pos);
    this.pos = r.next;
    return r.value;
  }

  str(): string {
    const r = strDecode(this.bytes, this.pos);
    this.pos = r.next;
    return r.value;
  }

  /** A Teselas set (ADR-09), ascending. */
  teselas(): number[] {
    const r = teselasDecode(this.bytes, this.pos);
    this.pos = r.next;
    return r.values;
  }

  take(n: number): Uint8Array {
    const out = this.bytes.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  rest(): Uint8Array {
    return this.bytes.slice(this.pos);
  }
}
