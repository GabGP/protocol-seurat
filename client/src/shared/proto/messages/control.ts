import { Reader } from '../reader';
import { concat, strEncode, u64Encode, viEncode } from '../varint';

export function heartbeatCore(nonce: bigint): Uint8Array {
  return Uint8Array.from(u64Encode(nonce));
}
export function heartbeatDecode(payload: Uint8Array): bigint {
  return new Reader(payload).u64();
}
export function echoCore(nonce: bigint): Uint8Array {
  return Uint8Array.from(u64Encode(nonce));
}
export function echoDecode(payload: Uint8Array): bigint {
  return new Reader(payload).u64();
}

export interface ProtocolError { code: number; fatal: number; refType: number; msg: string }
export function errorCore(e: ProtocolError): Uint8Array {
  return concat(viEncode(e.code), [e.fatal], viEncode(e.refType), strEncode(e.msg));
}
export function errorDecode(payload: Uint8Array): ProtocolError {
  const r = new Reader(payload);
  return { code: r.vi(), fatal: r.u8(), refType: r.vi(), msg: r.str() };
}

export interface Goodbye { code: number; msg: string }
export function goodbyeCore(a: Goodbye): Uint8Array {
  return concat(viEncode(a.code), strEncode(a.msg));
}
export function goodbyeDecode(payload: Uint8Array): Goodbye {
  const r = new Reader(payload);
  return { code: r.vi(), msg: r.str() };
}
