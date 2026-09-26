import { useEffect, useRef, type CSSProperties } from 'react';
import { hash3 } from '@/shared/lib/hash3';
import { useWorkPreview } from '@/entities/work';
import { drawScaledRgba } from '@/shared/codec/seed';
import type { Work } from '@/entities/work/types';
import { workDims, workTitle } from '@/entities/work/types';
import type { Filter } from '@/entities/work/store';
import { Icon } from '@/shared/ui/Icon';
import styles from './GalleryGrid.module.css';

function Thumb({ work }: { work: Work }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const preview = useWorkPreview(work.id);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const maxDim = 144;
    const ar = work.height > 0 ? work.width / work.height : 1;
    const w = ar >= 1 ? maxDim : Math.max(32, Math.round(maxDim * ar));
    const h = ar >= 1 ? Math.max(32, Math.round(maxDim / ar)) : maxDim;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    if (preview) {
      drawScaledRgba(ctx, preview.rgba, preview.width, preview.height, w, h);
      return;
    }

    const img = ctx.createImageData(w, h);
    let seed = 0;
    for (const ch of work.id) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [a, b, cc] = hash3(x + seed, y - seed);
        const i = (y * w + x) * 4;
        img.data[i] = Math.round(90 + 120 * a);
        img.data[i + 1] = Math.round(100 + 100 * b);
        img.data[i + 2] = Math.round(170 + 70 * cc);
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [work, preview]);

  return <canvas ref={ref} className={styles.thumbCanvas} />;
}

interface Props {
  items: Work[];
  tags?: string[];
  filter: Filter;
  onFilter: (f: Filter) => void;
  onOpen: (id: string) => void;
}

export function GalleryGrid({ items, tags, filter, onFilter, onOpen }: Props): JSX.Element {
  const chips: Array<[Filter, string]> = [
    ['all', 'All'],
    ...(tags ?? []).map((t) => [t, t] as [Filter, string]),
    ['landscape', 'Landscape'],
    ['portrait', 'Portrait'],
  ];

  return (
    <>
      <div className={styles.filterBar}>
        <div className={styles.chipGroup}>
          {chips.map(([k, label]) => {
            const on = filter === k;
            return (
              <button
                key={k}
                onClick={() => onFilter(k)}
                className={on ? styles.chipOn : 'chip-off'}
              >
                {on ? <Icon name="check" size={18} /> : null}{label}
              </button>
            );
          })}
        </div>
        <span className={styles.counter}>{items.length} images</span>
      </div>
      <div className={styles.grid}>
        {items.map((w, i) => (
          <div
            key={w.id}
            onClick={() => onOpen(w.id)}
            className="gallery-card"
          >
            <div
              className={`gallery-card-thumb ${styles.cardThumb}`}
              style={{ '--ratio': `${w.width} / ${w.height}` } as CSSProperties}
            >
              <Thumb work={w} />
            </div>
            <div className={styles.cardMeta}>
              <span className={styles.cardTitle} title={workTitle(w, i)}>{workTitle(w, i)}</span>
              <span className={styles.cardDims}>{workDims(w)}</span>
            </div>
            {w.tag && (
              <div style={{ padding: '0 10px', marginTop: -4 }}>
                <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 10, background: '#DEE1F9', color: '#171B2C', fontSize: 12, fontWeight: 600 }}>
                  {w.tag}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}
