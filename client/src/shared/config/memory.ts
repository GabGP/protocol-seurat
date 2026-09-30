/** Wait between the end of one `measureUserAgentSpecificMemory()` and the start of the next (each is a costly, GC-like walk). */
export const TAB_MEMORY_POLL_MS = 10_000;
/** `attribution[].scope` of a memory breakdown entry that belongs to the page itself. */
export const SCOPE_WINDOW = 'Window';
/** Every dedicated, shared or service worker scope ends with this. */
export const SCOPE_WORKER_SUFFIX = 'WorkerGlobalScope';
/** Rebuilds of released brush bitmaps in flight at once (each carries a copy of its parent's planes, and queues behind live deliveries). */
export const PIXEL_RESTORE_WINDOW = 8;
