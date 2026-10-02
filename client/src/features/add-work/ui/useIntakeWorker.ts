import { useEffect, useReducer, useRef } from 'react';
import type { Work } from '@/entities/work';
import { intakeReducer } from '../model/intake-queue';
import { runQueue, type RunQueueDeps } from '../model/run-queue';
import type { IntakeAction, IntakeItem } from '../model/types';

export interface UseIntakeWorkerOptions {
  works: Work[];
  transfer: {
    upload: RunQueueDeps['upload'];
    importSource: RunQueueDeps['importSource'];
  };
}

export function useIntakeWorker({ works, transfer }: UseIntakeWorkerOptions) {
  const [items, dispatch] = useReducer(intakeReducer, []);
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const worksRef = useRef(works);
  worksRef.current = works;
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const runningRef = useRef(false);

  useEffect(() => {
    dispatch({ type: 'works', works });
  }, [works]);

  const runWorker = async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const deps: RunQueueDeps = {
        upload: transfer.upload,
        importSource: transfer.importSource,
        dispatch: (action: IntakeAction) => {
          itemsRef.current = intakeReducer(itemsRef.current, action);
          dispatch(action);
          if (action.type === 'accepted') {
            const syncWorks: IntakeAction = { type: 'works', works: worksRef.current };
            itemsRef.current = intakeReducer(itemsRef.current, syncWorks);
            dispatch(syncWorks);
          }
        },
        signalFor: (key: string) => {
          let ctrl = controllersRef.current.get(key);
          if (!ctrl) {
            ctrl = new AbortController();
            controllersRef.current.set(key, ctrl);
          }
          return ctrl.signal;
        },
        now: () => Date.now(),
      };

      while (true) {
        const queued = itemsRef.current.filter((it) => it.status === 'queued');
        if (queued.length === 0) break;
        await runQueue(itemsRef.current, deps);
      }
    } finally {
      runningRef.current = false;
    }
  };

  useEffect(() => {
    if (items.some((it) => it.status === 'queued') && !runningRef.current) {
      void runWorker();
    }
  }, [items]);

  const handleAdd = (newItems: IntakeItem[]) => {
    const addAction: IntakeAction = { type: 'add', items: newItems };
    itemsRef.current = intakeReducer(itemsRef.current, addAction);
    dispatch(addAction);
    void runWorker();
  };

  // An aborted controller stays in the map, so a queued item cancelled before its turn is skipped.
  const abort = (key: string) => {
    let ctrl = controllersRef.current.get(key);
    if (!ctrl) {
      ctrl = new AbortController();
      controllersRef.current.set(key, ctrl);
    }
    ctrl.abort();
  };

  const handleCancel = (key: string) => {
    abort(key);
    dispatch({ type: 'cancel', key });
  };

  const handleRemove = (key: string) => {
    abort(key);
    dispatch({ type: 'remove', key });
  };

  return { items, handleAdd, handleCancel, handleRemove };
}
