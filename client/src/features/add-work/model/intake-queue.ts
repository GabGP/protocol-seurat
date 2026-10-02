import { isOpenable, WORK_STATE, type Work } from '@/entities/work';
import type { IntakeAction, IntakeItem } from './types';

export { createIntakeKey, itemsFromFiles, itemFromText } from './intake-items';

export function intakeReducer(items: IntakeItem[], action: IntakeAction): IntakeItem[] {
  switch (action.type) {
    case 'add': {
      const existing = new Set(items.map((it) => it.key));
      const fresh = action.items.filter((it) => !existing.has(it.key));
      return [...items, ...fresh];
    }
    case 'progress':
      return items.map((it) => {
        if (it.key !== action.key || it.status === 'failed' || it.status === 'ready') return it;
        return { ...it, status: 'sending', sent: action.sent, rate: action.rate };
      });
    case 'waiting':
      return items.map((it) => {
        if (it.key !== action.key || it.status === 'failed' || it.status === 'ready') return it;
        return { ...it, status: 'waiting' };
      });
    case 'remote':
      return items.map((it) => {
        if (it.key !== action.key || it.status !== 'waiting') return it;
        return {
          ...it,
          sent: action.sent ?? it.sent,
          rate: action.rate,
          remote: {
            phase: action.phase,
            received: action.received,
            total: action.total,
          },
        };
      });
    case 'accepted':
      return items.map((it) => {
        if (it.key !== action.key || it.status === 'failed' || it.status === 'ready') return it;
        return { ...it, status: 'ingesting', sent: 1, rate: undefined };
      });
    case 'failed':
      return items.map((it) => (it.key === action.key ? { ...it, status: 'failed', error: action.error, rate: undefined } : it));
    case 'cancel':
      return items.map((it) => (it.key === action.key ? { ...it, status: 'failed', error: 'Cancelled', rate: undefined } : it));
    case 'remove':
      return items.filter((it) => it.key !== action.key);
    case 'works': {
      const map = new Map<string, Work>();
      for (const w of action.works) map.set(w.id, w);
      return items.map((it) => {
        const isWaiting = it.status === 'waiting';
        const isSendingDone = it.status === 'sending' && it.sent >= 1;
        const isIngesting = it.status === 'ingesting';
        if (!isWaiting && !isSendingDone && !isIngesting) return it;

        const work = map.get(it.stem);
        if (!work) return it;

        if (work.state === WORK_STATE.FAILED) {
          return { ...it, status: 'failed', error: 'Server could not read this image', rate: undefined };
        }
        if (work.state === WORK_STATE.READY && isOpenable(work)) {
          return { ...it, status: 'ready', ingest: work.progress, rate: undefined };
        }
        return { ...it, status: 'ingesting', ingest: work.progress };
      });
    }
    default:
      return items;
  }
}
