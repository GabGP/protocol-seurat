import { RENDER_SCALE_STEPS } from '@/shared/config/render';
import { backingPx, effectiveRenderScale, type RenderScaleSetting } from '@/shared/lib/render-scale';

const PERCENT = 100;

export const scaleLabel = (scale: number): string => `${Math.round(scale * PERCENT)}%`;

/** The Settings options: auto, then each step from full resolution down. */
export const SCALE_CHOICES: ReadonlyArray<{ value: RenderScaleSetting; label: string }> = [
  { value: 'auto', label: 'Auto' },
  ...RENDER_SCALE_STEPS.map((s) => ({ value: s, label: scaleLabel(s) })),
];

/** "auto → 50% · 1920×1080": what the setting means for a canvas of this CSS size (the MIRADA's device px). */
export function scaleStatus(setting: RenderScaleSetting, css: { w: number; h: number } | null, dpr: number): string {
  const name = setting === 'auto' ? 'auto' : scaleLabel(setting);
  if (!css || css.w <= 0 || css.h <= 0) return name;
  const scale = effectiveRenderScale(setting, css.w, css.h, dpr);
  const { w, h } = backingPx(css.w, css.h, dpr * scale);
  return `${setting === 'auto' ? `auto → ${scaleLabel(scale)}` : name} · ${w}×${h}`;
}
