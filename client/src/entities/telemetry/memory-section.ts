import { BYTES_PER_KIB } from '@/shared/config/constants';
import { fmtBytes } from '@/shared/lib/format-units';
import { tabMemoryRows } from './tab-memory-row';
import { pending, PENDING, type TelemetryInput, type TelemetryRow, type TelemetrySection } from './types';

const [TOTAL, BANDS, BITMAPS, GPU, PLANES, CACHES] = [
  'Estimate (sum)', 'Compressed bands', 'Decoded bitmaps', 'GPU textures', 'Parent planes', 'Worker caches (max)',
] as const;
const KEYS = [TOTAL, BANDS, BITMAPS, GPU, PLANES, CACHES];
const HEAP_KEY = 'JS heap';
const TITLE = 'Memory on this device';

interface HeapProbe {
  memory?: { usedJSHeapSize: number };
}

const heapKeys = (): string[] => ((performance as HeapProbe).memory ? [HEAP_KEY] : []);

/**
 * Under the measured tab total (when the browser can give it), what the viewer holds for the open image, part by part, and their sum against the declared `mem_mib`.
 * With WebGL a decoded brush lives on the GPU only: its bitmap is closed once uploaded and rebuilt from its bands if
 * the pixels are needed again, so "Decoded bitmaps" is just what is held (the seed sketch; every tile on Canvas2D).
 * GPU textures count whole 16-layer arrays, and the worker caches are their upper bound.
 */
export function memory({ sink, concession, gpuBytes, declaredMemMiB, tabMemory }: TelemetryInput): TelemetrySection {
  const tab = tabMemoryRows(tabMemory);
  if (!sink) return { title: TITLE, rows: [...tab, ...pending([...KEYS, ...heapKeys()])] };
  let bands = 0;
  let bitmaps = 0;
  let planes = 0;
  for (const r of sink.book.byDelivery.values()) {
    bands += r.bytes;
    if (r.rgba) bitmaps += r.rgba.width * r.rgba.height * 4;
    for (const p of r.planes ?? []) planes += p.byteLength;
  }
  const gpu = gpuBytes ?? 0;
  const total = bands + bitmaps + gpu + planes + sink.workerCacheBound;
  const values = [
    declaredMemMiB ? `${fmtBytes(total)} of ${declaredMemMiB} MiB declared` : fmtBytes(total),
    concession ? `${fmtBytes(bands)} of ${fmtBytes(concession.maxKiB * BYTES_PER_KIB)}` : fmtBytes(bands),
    fmtBytes(bitmaps),
    fmtBytes(gpu),
    fmtBytes(planes),
    fmtBytes(sink.workerCacheBound),
  ];
  const rows: TelemetryRow[] = KEYS.map((k, i) => ({ k, v: values[i] ?? PENDING }));
  const heap = (performance as HeapProbe).memory;
  if (heap) rows.push({ k: HEAP_KEY, v: fmtBytes(heap.usedJSHeapSize) });
  return { title: TITLE, rows: [...tab, ...rows] };
}
