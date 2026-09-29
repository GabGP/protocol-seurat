/** Longest shift a uleb may reach: the value must stay a safe integer (53 bits). */
const MAX_ULEB_SHIFT = 53;

/**
 * A read cursor over bytes. `reset` re-aims one instance, so the hot decode loops of the synthesis
 * worker read millions of values without allocating a result per value.
 */
export class ByteReader {
  bytes: Uint8Array = new Uint8Array(0);
  pos = 0;

  reset(bytes: Uint8Array, pos = 0): this {
    this.bytes = bytes;
    this.pos = pos;
    return this;
  }

  uleb(): number {
    let value = 0;
    let shift = 0;
    for (;;) {
      const b = this.bytes[this.pos++];
      if (b === undefined) throw new Error('uleb: truncated');
      value += (b & 0x7f) * 2 ** shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > MAX_ULEB_SHIFT) throw new Error('uleb: overflow');
    }
    if (!Number.isSafeInteger(value)) throw new Error('uleb: overflow');
    return value;
  }
}
