import { useEffect, useState } from 'react';
import { GALLERY_COLUMNS_WIDTH } from '@/shared/config/layout';

export interface WorkPreview {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
}

const previewCache = new Map<string, WorkPreview>();
const listeners = new Set<() => void>();
let cardWidth = 0;

function notify(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function getWorkPreview(id: string): WorkPreview | undefined {
  return previewCache.get(id);
}

export function hasWorkPreview(id: string): boolean {
  return previewCache.has(id);
}

export function setWorkPreview(id: string, preview: WorkPreview): void {
  previewCache.set(id, preview);
  notify();
}

/** The seed behind a thumbnail is a loan: when it is released, the thumbnail goes too. */
export function dropWorkPreview(id: string): void {
  if (previewCache.delete(id)) notify();
}

/** The gallery reports its cards' width in device pixels: the resolution a preview asks for. */
export function notePreviewWidth(px: number): void {
  if (px > 0) cardWidth = px;
}

/** The last card width reported; before any card is laid out, the narrowest column at this screen's density. */
export function previewWidth(): number {
  const dpr = (globalThis as { devicePixelRatio?: number }).devicePixelRatio || 1;
  return cardWidth || Math.round(GALLERY_COLUMNS_WIDTH * dpr);
}

export function clearWorkPreviews(): void {
  previewCache.clear();
  notify();
}

export function useWorkPreview(id: string): WorkPreview | undefined {
  const [preview, setPreview] = useState<WorkPreview | undefined>(() => previewCache.get(id));

  useEffect(() => {
    setPreview(previewCache.get(id));
    const onUpdate = (): void => {
      setPreview(previewCache.get(id));
    };
    listeners.add(onUpdate);
    return () => {
      listeners.delete(onUpdate);
    };
  }, [id]);

  return preview;
}
