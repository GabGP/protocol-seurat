type Schedule = (cb: () => void) => unknown;

const nextFrame: Schedule = (cb) =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : setTimeout(cb, 0);

/**
 * Coalesces bursts of calls into one `fn` per animation frame: a delivery burst of N brushes
 * costs one React render, not N (the canvas already repaints from the sink's revision).
 */
export function frameBatch(fn: () => void, schedule: Schedule = nextFrame): { (): void; cancel(): void } {
  let pending = false;
  let live = true;
  const trigger = (): void => {
    if (pending || !live) return;
    pending = true;
    schedule(() => {
      pending = false;
      if (live) fn();
    });
  };
  trigger.cancel = (): void => {
    live = false;
  };
  return trigger;
}
