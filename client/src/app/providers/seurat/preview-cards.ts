import { isOpenable } from '@/entities/work';
import type { Runtime } from './runtime';

/** The gallery shows these cards: they get a thumbnail (if openable), every other preview canvas closes. */
export function showPreviews(rt: Runtime, ids: string[] = rt.previewIds): void {
  rt.previewIds = ids;
  rt.preview?.show(
    ids.filter((id) => {
      const w = rt.works.get(id);
      return w !== undefined && isOpenable(w);
    }),
  );
}
