export const WORK_STATE = {
  RECEIVING: 0,
  SKETCH: 1,
  PAINTING: 2,
  READY: 3,
  FAILED: 4,
  WITHDRAWN: 5,
} as const;

export type WorkState = (typeof WORK_STATE)[keyof typeof WORK_STATE];
export type Orient = 'landscape' | 'portrait';

export interface Work {
  id: string;
  name: string;
  width: number;
  height: number;
  strata: number;
  state: WorkState;
  edition: number;
  progress: number;
  tag?: string;
}

/**
 * ABRIR succeeds (spec 7.3): LISTA, or BOCETO/PINTANDO with the sketch (edition 1) to show. A work
 * whose master carries no overview has no edition until LISTA.
 */
export function isOpenable(w: Work): boolean {
  return w.state === 3 || ((w.state === 1 || w.state === 2) && w.edition === 1);
}

export function orientOf(w: Work): Orient {
  return w.width >= w.height ? 'landscape' : 'portrait';
}

export function workDims(w: Work): string {
  return w.width.toLocaleString('en-US') + ' × ' + w.height.toLocaleString('en-US');
}

const KPX_BELOW = 100_000;
const MP = 1e6;
const GP_FROM_MP = 1000;

/** Pixel count at one decimal: kpx for tiny works, then MP, then GP from a thousand megapixels. */
export function workMp(w: Work): string {
  const px = w.width * w.height;
  if (px < KPX_BELOW) {
    return (px / 1e3).toFixed(1) + ' kpx';
  }
  const mp = Number((px / MP).toFixed(1));
  if (mp >= GP_FROM_MP) return (mp / GP_FROM_MP).toFixed(1) + ' GP';
  return (mp < 0.1 ? '< 0.1' : mp.toFixed(1)) + ' MP';
}

export function workTitle(w: Work, index: number): string {
  if (w.name && w.name.length > 0) return w.name;
  return 'Plate ' + String(index + 1).padStart(2, '0');
}

/** Ingest status badge for catalog items; null when ready for viewing or withdrawn. */
export function ingestBadge(w: Work): string | null {
  switch (w.state) {
    case WORK_STATE.RECEIVING:
      return 'Receiving';
    case WORK_STATE.SKETCH:
    case WORK_STATE.PAINTING: {
      const n = Math.min(100, Math.max(0, Math.round(w.progress)));
      return `Processing ${n}%`;
    }
    case WORK_STATE.FAILED:
      return 'Failed';
    case WORK_STATE.READY:
    case WORK_STATE.WITHDRAWN:
    default:
      return null;
  }
}
