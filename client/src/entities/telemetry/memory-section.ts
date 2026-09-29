import { BYTES_PER_KIB } from '@/shared/config/constants';
import { fmtBytes, fmtMs } from '@/shared/lib/format-units';
import { pending, PENDING, type TelemetryInput, type TelemetrySection } from './types';

const KEYS = [
  'Viewer memory (est.)', 'Compressed bands', 'Decoded pixels', 'Brushes held', 'Brush data', 'In flight', 'Decode queue',
];
const HEAP_KEY = 'JS heap';
const TITLE = 'Stored on this device';

interface HeapProbe {
  memory?: { usedJSHeapSize: number };
}

/** All bytes the held brushes own, and what one costs on average; the placeholder while nothing is held. */
function brushData(total: number, held: number): string {
  return held > 0 ? `${fmtBytes(total)} · ${fmtBytes(total / held)} / brush` : PENDING;
}

const heapKeys = (): string[] => ((performance as HeapProbe).memory ? [HEAP_KEY] : []);

/**
 * Everything this viewer holds for the open image: compressed bands, parent planes, live bitmaps,
 * GPU textures and the workers' plane caches (an upper bound), against the declared `mem_mib`.
 */
export function memory({ sink, concession, gpuBytes, declaredMemMiB }: TelemetryInput): TelemetrySection {
  if (!sink) return { title: TITLE, rows: pending([...KEYS, ...heapKeys()]) };
  let bands = 0;
  let pixels = 0;
  let planes = 0;
  for (const r of sink.book.byDelivery.values()) {
    bands += r.bytes;
    if (r.rgba) pixels += r.rgba.width * r.rgba.height * 4;
    for (const p of r.planes ?? []) planes += p.byteLength;
  }
  const estimate = bands + planes + pixels + (gpuBytes ?? 0) + sink.workerCacheBound;
  const held = sink.book.byDelivery.size;
  const values = [
    declaredMemMiB ? `${fmtBytes(estimate)} of ${declaredMemMiB} MiB declared` : fmtBytes(estimate),
    concession ? `${fmtBytes(bands)} of ${fmtBytes(concession.maxKiB * BYTES_PER_KIB)}` : fmtBytes(bands),
    fmtBytes(pixels),
    concession ? `${held} of ${concession.maxBrushes}` : String(held),
    brushData(bands + pixels, held),
    String(sink.book.inFlight.size),
    fmtMs(sink.queueDepthMs),
  ];
  const rows = KEYS.map((k, i) => ({ k, v: values[i] ?? PENDING }));
  const heap = (performance as HeapProbe).memory;
  if (heap) rows.push({ k: HEAP_KEY, v: fmtBytes(heap.usedJSHeapSize) });
  return { title: TITLE, rows };
}
