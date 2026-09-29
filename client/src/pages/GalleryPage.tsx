import { useMemo, useLayoutEffect } from 'react';
import { GalleryGrid, GalleryHero } from '@/widgets/gallery';
import { filterWorks } from '@/entities/work';
import { workTitle } from '@/entities/work';
import { galleryScroll, goViewer } from '@/app/router';
import { patchUi, useUi } from '@/app/store';
import { useSeurat } from '@/app/providers/SeuratProvider';
import styles from './GalleryPage.module.css';

function DotMark(): JSX.Element {
  return (
    <div className={styles.dotMark}>
      <span className={styles.dot1} />
      <span className={styles.dot2} />
      <span className={styles.dot3} />
      <span className={styles.dot4} />
      <span className={styles.dot5} />
    </div>
  );
}

export function GalleryPage(): JSX.Element {
  const ui = useUi();
  const { works } = useSeurat();
  const items = useMemo(() => filterWorks(works, ui.filter), [works, ui.filter]);
  const tags = useMemo(() => {
    const s = new Set<string>();
    for (const w of works) {
      if (w.tag) s.add(w.tag);
    }
    return [...s].sort();
  }, [works]);

  useLayoutEffect(() => {
    const y = galleryScroll();
    if (y > 0) window.scrollTo(0, y);
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <DotMark />
        <span className={styles.brand}>asynchronous</span>
      </header>
      <main className={styles.main}>
        <GalleryHero
          featuredWorkId={items[0]?.id}
          featuredTitle={items[0] ? workTitle(items[0], 0) : 'Plate 01'}
          onOpen={() => {
            const first = items[0];
            if (first) goViewer(first.id);
          }}
        />
        <GalleryGrid
          items={items}
          tags={tags}
          filter={ui.filter}
          onFilter={(f) => patchUi({ filter: f })}
          onOpen={(id) => goViewer(id)}
        />
      </main>
    </div>
  );
}
