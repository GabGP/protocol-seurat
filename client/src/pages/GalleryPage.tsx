import { useEffect, useLayoutEffect, useMemo } from 'react';
import { GalleryGrid, GalleryHero } from '@/widgets/gallery';
import { filterWorks, workTitle } from '@/entities/work';
import { AddWorkButton } from '@/features/add-work';
import { galleryScroll, goViewer } from '@/app/router';
import { patchUi, useUi } from '@/app/store';
import { useSeurat } from '@/app/providers/SeuratProvider';
import { importSource, uploadMaster } from '@/shared/api/intake';
import { paginate } from '@/shared/lib/pagination';
import { GALLERY_PAGE_SIZE } from '@/shared/config/layout';
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
  const { works, session, showPreviews } = useSeurat();
  const items = useMemo(() => filterWorks(works, ui.filter), [works, ui.filter]);
  const slice = useMemo(() => paginate(items, ui.page, GALLERY_PAGE_SIZE), [items, ui.page]);
  const shown = useMemo(
    () => [...new Set([items[0]?.id, ...slice.items.map((w) => w.id)].filter((id): id is string => id !== undefined))],
    [items, slice],
  );
  const shownKey = shown.join('\n');
  // Only the hero and the cards on this page hold a thumbnail.
  useEffect(() => showPreviews(shown), [shownKey]);

  const tags = useMemo(() => {
    const s = new Set<string>();
    for (const w of works) {
      if (w.tag) s.add(w.tag);
    }
    return [...s].sort();
  }, [works]);

  const transfer = useMemo(() => ({ upload: uploadMaster, importSource }), []);

  useLayoutEffect(() => {
    const y = galleryScroll();
    if (y > 0) window.scrollTo(0, y);
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <DotMark />
        <span className={styles.brand}>asynchronous</span>
        <div className={styles.headerRight}>
          <AddWorkButton
            works={works}
            local={session?.local ?? false}
            transfer={transfer}
            onOpen={goViewer}
          />
        </div>
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
          items={slice.items}
          total={items.length}
          offset={slice.offset}
          page={slice.page}
          count={slice.count}
          onPage={(p) => patchUi({ page: p })}
          tags={tags}
          filter={ui.filter}
          onFilter={(f) => patchUi({ filter: f, page: 0 })}
          onOpen={(id) => goViewer(id)}
        />
      </main>
    </div>
  );
}
