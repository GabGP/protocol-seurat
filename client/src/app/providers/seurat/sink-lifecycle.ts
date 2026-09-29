import { DeliverySink, onBrushCap } from '@/entities/delivery';
import { ImageTelemetry } from '@/entities/telemetry';
import { DEFAULT_MAX_BRUSHES, DEFAULT_MAX_KIB } from '@/shared/config/constants';
import type { WorkOpened } from '@/shared/proto/messages';
import type { Runtime } from './runtime';

/**
 * Dispose the open canvas' sink and forget it. With `keepBook` the book moves to the retired
 * ledgers and the server is told to close the handle (the work stays answerable for RASPAR/AUDITAR).
 */
export function retireSink(rt: Runtime, keepBook: boolean): void {
  const sink = rt.sink;
  if (!sink) return;
  if (keepBook) {
    rt.ledgers.adopt(sink.handle, sink.book);
    rt.client?.closeHandle(sink.handle);
  }
  rt.gaze?.forget(sink.handle);
  rt.offBrushCap?.();
  rt.offBrushCap = null;
  sink.dispose();
  rt.sink = null;
}

/** ABIERTA for the viewer: a fresh sink and telemetry for the new handle. */
export function openSink(rt: Runtime, a: WorkOpened): void {
  rt.preview?.pause();
  if (rt.sink && rt.sink.handle !== a.handle) retireSink(rt, true);
  rt.ui.setWorkOpened(a);
  const sink = new DeliverySink(
    a.handle,
    () => rt.client,
    () => rt.concession?.maxKiB ?? DEFAULT_MAX_KIB,
    () => rt.concession?.maxBrushes ?? DEFAULT_MAX_BRUSHES,
    a.seedWidth,
    a.seedHeight,
    a.strata,
  );
  sink.setExtent(a.width, a.height);
  rt.sink = sink;
  rt.offBrushCap?.();
  rt.offBrushCap = onBrushCap(() => sink.relieveNow());
  rt.telemetry = new ImageTelemetry(a.handle, performance.now());
}

/** The viewer closed its work: the book is kept for the server's audits, the canvas is empty. */
export function closeWork(rt: Runtime): void {
  retireSink(rt, true);
  rt.telemetry = null;
  rt.ui.setWorkOpened(null);
  rt.ui.setConcession(null);
  rt.ui.setPlan(null);
  rt.preview?.resume();
}

/** The handle is dead (resume rejected, or the work was withdrawn): nothing of it is worth keeping. */
export function dropSink(rt: Runtime): void {
  retireSink(rt, false);
  rt.telemetry = null;
  rt.ui.setWorkOpened(null);
  rt.ui.setConcession(null);
  rt.preview?.resume();
}
