import type { WorkPreview } from '@/entities/work/previews';
import { shownSize } from '@/workers/plane-shrink';
import type { Level, PreviewLevels } from './preview-levels';
import type { PreviewFinisher, PreviewPatch } from './preview-finisher';

/**
 * The card's image of `level`, `shownWidth` wide. A level the card already shows at that size has
 * only its changed part finished, and patched into the image in place (a new preview object, so
 * the card redraws); otherwise all of it is. Nothing changed: the image as it was.
 */
export async function showLevel(
  levels: PreviewLevels, level: Level, shownWidth: number, finisher: PreviewFinisher,
): Promise<WorkPreview> {
  const { width, height } = shownSize(level.width, level.height, shownWidth);
  const last = levels.shown;
  const kept = last && last.from === level && last.preview.width === width && last.preview.height === height ? last.preview : null;
  if (kept && !level.dirty) return kept;
  const dirty = (kept && level.dirty) || { x: 0, y: 0, w: level.width, h: level.height };
  const patch = await finisher.finish(level, width, height, dirty);
  level.dirty = null;
  const preview = kept ? paste(kept, patch) : { rgba: patch.rgba, width, height };
  levels.shown = { preview, from: level };
  return preview;
}

/** `patch` copied into `into`'s pixels. */
function paste(into: WorkPreview, patch: PreviewPatch): WorkPreview {
  const { x, y, w, h } = patch.rect;
  for (let r = 0; r < h; r++) into.rgba.set(patch.rgba.subarray(r * w * 4, (r + 1) * w * 4), ((y + r) * into.width + x) * 4);
  return { ...into };
}
