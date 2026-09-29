import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetRenderFlags, setRenderScale } from '@/shared/lib/render-flags';
import type { ChromeCtx } from '../chrome-types';
import { reportGaze } from '../frame-sync';

function ctxFor(W: number, H: number) {
  const motion = vi.fn();
  const ctx = {
    st: { v: { s: 0.5, tx: 0, ty: 0 } },
    P: () => ({ gazeService: { motion }, handle: 7, iw: 8000, ih: 4500 }),
    frame: { W, H, dpr: 1, dirty: false },
  } as unknown as ChromeCtx;
  return { ctx, motion };
}

afterEach(() => {
  resetRenderFlags();
  vi.unstubAllGlobals();
});

describe('reportGaze', () => {
  it('sends MIRADA vw x vh in device px while the ROI stays in image px (CSS size)', () => {
    vi.stubGlobal('devicePixelRatio', 1);
    const { ctx, motion } = ctxFor(3840, 2160);
    reportGaze(ctx); // auto: 4K at dpr 1 renders at 0.5
    const m = motion.mock.calls[0]![0] as { vw: number; vh: number; x1: number; y1: number; handle: number };
    expect([m.handle, m.vw, m.vh]).toEqual([7, 1920, 1080]);
    expect([m.x1, m.y1]).toEqual([7680, 4320]); // css 3840 / s 0.5, not device px
  });

  it('follows the setting: 100% at dpr 2 asks for the full backing size', () => {
    vi.stubGlobal('devicePixelRatio', 2);
    setRenderScale(1);
    const { ctx, motion } = ctxFor(1920, 1080);
    reportGaze(ctx);
    expect(motion.mock.calls[0]![0]).toMatchObject({ vw: 3840, vh: 2160 });
  });
});
