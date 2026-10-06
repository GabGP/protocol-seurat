import { fmtPct } from '@/shared/lib/zoom';
import {
  POINTILLIST_ZOOM_THRESHOLD_PCT,
  VIEWER_MAX_ZOOM,
} from '@/shared/config/view';

export interface InfoRowItem {
  k: string;
  v: string;
}

/** Largest term shown as a whole-number ratio (`3 : 2`); beyond it the ratio is a decimal. */
const ASPECT_MAX_TERM = 32;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** The image's own ratio: `1 : 1`, `3 : 2`, or `1.37 : 1` when the sides do not reduce to small numbers. */
export function aspectLabel(iw: number, ih: number): string {
  if (iw <= 0 || ih <= 0) return '—';
  const g = gcd(iw, ih);
  if (iw / g <= ASPECT_MAX_TERM && ih / g <= ASPECT_MAX_TERM) return `${iw / g} : ${ih / g}`;
  return iw >= ih ? `${(iw / ih).toFixed(2)} : 1` : `1 : ${(ih / iw).toFixed(2)}`;
}

/** The session status as the panel shows it: `hello` is the SALUDO already sent, so the session is up. */
export function connectionLabel(status: string): string {
  if (status === 'hello') return 'Connected';
  return status === 'boot' ? 'Connecting' : status;
}

export function buildViewerInfoRows(
  dims: string,
  mp: string,
  iw: number,
  ih: number,
  fitPct: number,
  status: string,
  load: string,
  tag?: string,
): InfoRowItem[] {
  return [
    { k: 'Dimensions', v: dims + ' px' },
    { k: 'Resolution', v: mp },
    ...(tag ? [{ k: 'Tag', v: tag }] : []),
    { k: 'Aspect ratio', v: aspectLabel(iw, ih) },
    { k: 'Fit zoom', v: fmtPct(fitPct) },
    { k: 'Max zoom', v: (VIEWER_MAX_ZOOM * 100).toLocaleString('en-US') + '%' },
    { k: 'Dots from', v: POINTILLIST_ZOOM_THRESHOLD_PCT.toLocaleString('en-US') + '%' },
    { k: 'Connection', v: connectionLabel(status) },
    { k: 'Server load', v: load },
  ];
}
