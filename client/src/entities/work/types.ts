export type WorkState = 0 | 1 | 2 | 3 | 4 | 5;
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

export function workMp(w: Work): string {
  const px = w.width * w.height;
  if (px < 100_000) {
    return (px / 1e3).toFixed(1) + ' kpx';
  }
  const mp = px / 1e6;
  return (mp < 0.1 ? '< 0.1' : mp.toFixed(1)) + ' MP';
}

export function workTitle(w: Work, index: number): string {
  if (w.name && w.name.length > 0) return w.name;
  return 'Plate ' + String(index + 1).padStart(2, '0');
}
