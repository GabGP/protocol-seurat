/** The screen's device pixels per CSS pixel, 1 where the browser does not say. */
export function deviceDpr(): number {
  return (globalThis as { devicePixelRatio?: number }).devicePixelRatio || 1;
}
