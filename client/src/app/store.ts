import { useSyncExternalStore } from 'react';

type Listener = () => void;

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<Listener>();
  return {
    get(): T {
      return value;
    },
    set(next: T): void {
      value = next;
      for (const l of listeners) l();
    },
    patch(partial: Partial<T>): void {
      value = { ...value, ...partial };
      for (const l of listeners) l();
    },
    subscribe(l: Listener): () => void {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

export interface UiState {
  route: { name: 'gallery' } | { name: 'viewer'; id: string };
  filter: string;
  loupe: boolean;
  info: boolean;
  telemetry: boolean;
  settings: boolean;
  menu: boolean;
}

const store = createStore<UiState>({
  route: { name: 'gallery' },
  filter: 'all',
  loupe: false,
  info: false,
  telemetry: false,
  settings: false,
  menu: false,
});

export function getUi(): UiState {
  return store.get();
}

export function setUi(next: UiState): void {
  store.set(next);
}

export function patchUi(partial: Partial<UiState>): void {
  store.patch(partial);
}

export function useUi(): UiState {
  return useSyncExternalStore(
    (l) => store.subscribe(l),
    () => store.get(),
    () => store.get(),
  );
}
