import { Reader } from '../reader';
import { concat, strEncode, viEncode } from '../varint';

export interface WorkMessage {
  event: number; state: number; progress: number; edition: number;
  width: number; height: number; strata: number; id: string; name: string;
}
export function workCore(o: WorkMessage): Uint8Array {
  return concat(
    [o.event, o.state, o.progress], viEncode(o.edition), viEncode(o.width),
    viEncode(o.height), [o.strata], strEncode(o.id), strEncode(o.name),
  );
}
export function workDecode(payload: Uint8Array): WorkMessage {
  const r = new Reader(payload);
  return {
    event: r.u8(), state: r.u8(), progress: r.u8(), edition: r.vi(), width: r.vi(),
    height: r.vi(), strata: r.u8(), id: r.str(), name: r.str(),
  };
}

export function openCore(id: string): Uint8Array {
  return strEncode(id);
}
export function openDecode(payload: Uint8Array): string {
  return new Reader(payload).str();
}

export interface WorkOpened {
  handle: number; width: number; height: number; strata: number; edition: number;
  seedWidth: number; seedHeight: number;
}
export function openedCore(a: WorkOpened): Uint8Array {
  return concat(
    viEncode(a.handle), viEncode(a.width), viEncode(a.height), [a.strata],
    viEncode(a.edition),
    viEncode(a.seedWidth), viEncode(a.seedHeight),
  );
}
export function openedDecode(payload: Uint8Array): WorkOpened {
  const r = new Reader(payload);
  return {
    handle: r.vi(), width: r.vi(), height: r.vi(), strata: r.u8(), edition: r.vi(),
    seedWidth: r.vi(), seedHeight: r.vi(),
  };
}
