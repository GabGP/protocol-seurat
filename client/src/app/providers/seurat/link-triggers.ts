import type { Runtime } from './runtime';

/** The browser objects the triggers listen on; tests pass plain event targets. */
export interface LinkEnv {
  win: EventTarget;
  doc: EventTarget & { visibilityState: string };
}

/**
 * What tells a page that its link may be gone without the socket saying so. Each one only asks
 * `reconnect` when the client is not live, and `reconnect` itself ignores an attempt already under way.
 * pagehide sends nothing (spec 5.3): the book survives L + delta. Back from the bfcache (pageshow), back
 * online, or back on screen after a sleep, REANUDAR claims what has not expired (none of it after L, and
 * then the canvas starts over from the sketch). Returns the teardown.
 */
export function watchLink(
  rt: Runtime,
  reconnect: () => void,
  env: LinkEnv = { win: window, doc: document },
): () => void {
  const check = (): void => {
    const client = rt.client;
    if (client && !client.connected && !client.failed) reconnect();
  };
  const onPageShow = (e: Event): void => {
    if ((e as PageTransitionEvent).persisted) check();
  };
  const onVisible = (): void => {
    if (env.doc.visibilityState === 'visible') check();
  };
  env.win.addEventListener('pageshow', onPageShow);
  env.win.addEventListener('online', check);
  env.doc.addEventListener('visibilitychange', onVisible);
  return () => {
    env.win.removeEventListener('pageshow', onPageShow);
    env.win.removeEventListener('online', check);
    env.doc.removeEventListener('visibilitychange', onVisible);
  };
}
