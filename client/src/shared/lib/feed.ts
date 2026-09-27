import { useSyncExternalStore } from 'react';

/**
 * A value published at frame rate outside React: subscribers (a canvas overlay, one small
 * component) update themselves without re-rendering the page that owns the feed.
 */
export interface Feed<T> {
  get(): T;
  set(next: T): void;
  subscribe(listener: () => void): () => void;
}

export function createFeed<T>(initial: T, same: (a: T, b: T) => boolean = Object.is): Feed<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      if (same(value, next)) return;
      value = next;
      for (const l of listeners) l();
    },
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

export function useFeed<T>(feed: Feed<T>): T {
  return useSyncExternalStore(feed.subscribe, feed.get, feed.get);
}
