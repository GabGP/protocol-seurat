import { GAZE_QUIET_IDLE_MS } from '@/shared/config/constants';
import { gazeCore, T, type Gaze } from '@/shared/proto/messages';
import { concat, viEncode } from '@/shared/proto/varint';
import type { SeuratTransport } from '@/shared/api/transport';

export const MFLAGS_HIDDEN = 0x01;
export const MFLAGS_STILL = 0x02;

export class GazeSender {
  private seq = 0;
  private pending: Gaze | null = null;
  private last: Gaze | null = null;
  private raf = 0;
  private idleTimer = 0;
  private lastSentAt = 0;

  constructor(private transport: () => SeuratTransport | null) {}

  motion(m: Omit<Gaze, 'seq'>): void {
    this.seq += 1;
    this.pending = { ...m, seq: this.seq };
    this.last = this.pending;
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
    this.seq += 1;
    this.pending = { ...m, seq: this.seq };
    this.last = this.pending;
    this.flush(true);
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
      const core = gazeCore(m);
      if (t.supportsDatagrams) t.sendGazeDatagram(concat(viEncode(T.MIRADA), core));
      else t.sendGazeDatagram(core);
    }
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
