/** A single sliced page of items with pagination metadata. */
export interface Page<T> {
  items: T[];
  page: number;
  count: number;
  offset: number;
}

/** Slices a list of items for a zero-based page index with clamped bounds. */
export function paginate<T>(items: readonly T[], page: number, size: number): Page<T> {
  const safeSize = Math.max(1, size);
  const count = Math.max(1, Math.ceil(items.length / safeSize));
  const floored = Number.isFinite(page) ? Math.floor(page) : 0;
  const safePage = Math.min(Math.max(0, floored), count - 1);
  const offset = safePage * safeSize;
  return {
    items: items.slice(offset, offset + safeSize),
    page: safePage,
    count,
    offset,
  };
}

/** Slot in a pagination bar: a zero-based page index or a gap indicator. */
export type PageSlot = number | 'gap';

/**
 * Computes the page slots to display: always the first and last pages,
 * the active page and its siblings, with single hidden pages expanded
 * and 2+ hidden pages represented by a gap.
 */
export function pageRange(page: number, count: number, siblings: number): PageSlot[] {
  if (count <= 1) {
    return [0];
  }
  const floored = Number.isFinite(page) ? Math.floor(page) : 0;
  const clampedPage = Math.min(Math.max(0, floored), count - 1);
  const safeSiblings = Math.max(0, Number.isFinite(siblings) ? Math.floor(siblings) : 0);

  const keptSet = new Set<number>();
  keptSet.add(0);
  keptSet.add(count - 1);
  const start = Math.max(0, clampedPage - safeSiblings);
  const end = Math.min(count - 1, clampedPage + safeSiblings);
  for (let i = start; i <= end; i++) {
    keptSet.add(i);
  }

  const kept = Array.from(keptSet).sort((a, b) => a - b);
  const slots: PageSlot[] = [];

  for (let i = 0; i < kept.length; i++) {
    if (i > 0) {
      const prev = kept[i - 1]!;
      const curr = kept[i]!;
      const diff = curr - prev;
      if (diff === 2) {
        slots.push(prev + 1);
      } else if (diff > 2) {
        slots.push('gap');
      }
    }
    slots.push(kept[i]!);
  }

  return slots;
}
