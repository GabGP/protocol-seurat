import { viDecode } from '../proto/varint';

/** Emits every whole control frame at the start of `buf`; returns what is left (a partial frame). */
export function drainFrames(buf: Uint8Array<ArrayBuffer>, emit: (frame: Uint8Array) => void): Uint8Array<ArrayBuffer> {
  let pos = 0;
  for (;;) {
    if (pos >= buf.length) break;
    try {
      const t = viDecode(buf, pos);
      const l = viDecode(buf, t.next);
      if (l.next + l.value > buf.length) break;
      emit(buf.slice(pos, l.next + l.value));
      pos = l.next + l.value;
    } catch {
      break;
    }
  }
  return buf.slice(pos);
}
