import { renderFlags as flags } from '@/shared/lib/render-flags';
import { currentBrushes } from './brush-cache';
import type { ChromeCtx } from './chrome-types';
import { FrameMeter } from './frame-meter';

/** The frame meter's text is rewritten at most this often (it is DOM: keep layout work rare). */
const METER_TEXT_MS = 250;

export interface MeterView {
  /** One drawn frame: feeds the meter and refreshes the text at most every `METER_TEXT_MS`. */
  frame(now: number): void;
  /** Settings changed: show or hide the meter and refresh it now. */
  refresh(): void;
}

export function createMeterView(ctx: ChromeCtx, el: () => HTMLElement | null, kind: string): MeterView {
  const { st } = ctx;
  /** The readout, placeholders included: shown from the moment the meter is on, before the first paint. */
  function text(): void {
    const node = el();
    if (node) node.textContent = (st.meter ??= new FrameMeter()).label(st.drawn, currentBrushes(ctx).length, kind);
  }
  return {
    frame(now) {
      const meter = (st.meter ??= new FrameMeter());
      meter.frame(now, performance.now() - now);
      if (now - st.meterAt < METER_TEXT_MS) return;
      st.meterAt = now;
      text();
    },
    refresh() {
      st.meterAt = -Infinity;
      const node = el();
      if (node) node.hidden = !flags.fps;
      if (flags.fps) text();
    },
  };
}
