import { fmtPct } from '@/shared/lib/zoom';
import {
  POINTILLIST_ZOOM_THRESHOLD_PCT,
  VIEWER_MAX_ZOOM,
} from '@/shared/config/view';

export interface InfoRowItem {
  k: string;
  v: string;
}

export function buildViewerInfoRows(
  dims: string,
  mp: string,
  iw: number,
  ih: number,
  fitPct: number,
  status: string,
  tag?: string,
): InfoRowItem[] {
  return [
    { k: 'Dimensions', v: dims + ' px' },
    { k: 'Resolution', v: mp },
    ...(tag ? [{ k: 'Tag', v: tag }] : []),
    { k: 'Aspect ratio', v: iw >= ih ? '3 : 2' : '2 : 3' },
    { k: 'Fit zoom', v: fmtPct(fitPct) },
    { k: 'Max zoom', v: (VIEWER_MAX_ZOOM * 100).toLocaleString('en-US') + '%' },
    { k: 'Dots from', v: POINTILLIST_ZOOM_THRESHOLD_PCT.toLocaleString('en-US') + '%' },
    { k: 'Source', v: status },
  ];
}
