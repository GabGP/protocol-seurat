import { GAZE_QUIET_IDLE_MS } from '@/shared/config/constants';
import { gazeCore, MFLAGS_HIDDEN, MFLAGS_STILL, T, type Gaze } from '@/shared/proto/messages';
import { concat, viEncode } from '@/shared/proto/varint';
import type { SeuratTransport } from '@/shared/api/transport';

export class GazeSender {
  private seq = 0;
  private pending: Gaze | null = null;
  private last: Gaze | null = null;
  private raf = 0;
  private idleTimer = 0;
  private lastSentAt = 0;

  /**
   * `onLook` hears every view a MIRADA will describe, with its seq, whoever asked for it: the
   * delivery book must know the cone the server is painting before anything arrives for it.
   */
  constructor(
    private transport: () => SeuratTransport | null,
    private onLook: (m: Gaze) => void = () => {},
  ) {}

  motion(m: Omit<Gaze, 'seq'>): void {
    this.record(m);
    if (this.raf === 0) {
      const g = globalThis as { requestAnimationFrame?: (cb: () => void) => number };
      if (typeof g.requestAnimationFrame === 'function') {
        this.raf = g.requestAnimationFrame(() => {
          this.raf = 0;
          this.flush(false);
        });
      } else {
        this.raf = 1;
        setTimeout(() => {
          this.raf = 0;
          this.flush(false);
        }, 16);
      }
    }
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.flush(true), GAZE_QUIET_IDLE_MS) as unknown as number;
  }

  still(m: Omit<Gaze, 'seq'>): void {
    clearTimeout(this.idleTimer);
    this.record(m);
    this.flush(true);
  }

  /** After a resume the server has no plan: the current view again, reliably, with a new seq. */
  again(): void {
    if (!this.last) return;
    this.record(this.last);
    this.flush(true);
  }

  private record(m: Omit<Gaze, 'seq'>): void {
    this.seq += 1;
    this.pending = { ...m, seq: this.seq };
    this.last = this.pending;
    this.onLook(this.pending);
  }

  hidden(handle: number): void {
    this.seq += 1;
    const t = this.transport();
    if (!t) return;
    const core = gazeCore({ handle, seq: this.seq, x0: 0, y0: 0, x1: 0, y1: 0, vw: 0, vh: 0, flags: MFLAGS_HIDDEN });
    t.sendControl(concat(viEncode(T.MIRADA), viEncode(core.length), core));
    this.pending = null;
  }

  private flush(still: boolean): void {
    const t = this.transport();
    const m = this.pending ?? (still ? this.last : null);
    if (!t || !m) return;
    this.pending = null;
    this.lastSentAt = performance.now();
    if (still) {
      const core = gazeCore({ ...m, flags: m.flags | MFLAGS_STILL });
      t.sendControl(concat(viEncode(T.MIRADA), viEncode(core.length), core));
    } else {
      // Datagram form, vi tipo · payload (spec 3.2): a WT datagram, or the WS channel-2 message.
      t.sendGazeDatagram(concat(viEncode(T.MIRADA), gazeCore(m)));
    }
  }

  /** The seq of the latest MIRADA (sent or about to be). */
  get lastSeq(): number {
    return this.seq;
  }

  get lastSent(): number {
    return this.lastSentAt;
  }

  dispose(): void {
    const g = globalThis as { cancelAnimationFrame?: (h: number) => void };
    if (typeof g.cancelAnimationFrame === 'function' && this.raf !== 0) g.cancelAnimationFrame(this.raf);
    clearTimeout(this.idleTimer);
    this.raf = 0;
    this.pending = null;
  }
}
