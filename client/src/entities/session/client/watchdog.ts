import { HEARTBEAT_MISSES } from '@/shared/config/session';

const MS_PER_S = 1000;

/**
 * A half-open link delivers nothing and never closes. The server sends LATIDO every heartbeatS,
 * so HEARTBEAT_MISSES intervals with no frame at all mean the link is gone: `lost` fires once.
 */
export class Watchdog {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly lost: () => void) {}

  /** A frame arrived: the countdown starts over. */
  feed(heartbeatS: number): void {
    this.stop();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.lost();
    }, HEARTBEAT_MISSES * heartbeatS * MS_PER_S);
  }

  stop(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}
