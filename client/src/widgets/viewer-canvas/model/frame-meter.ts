import { MS_PER_S } from '@/shared/config/units';

const WINDOW = 120;
/** Gaps longer than this are idle time between gestures, not frames. */
const IDLE_GAP_MS = 250;
/** Digits each field is padded to, so the monospace readout keeps its width as numbers change. */
const FPS_W = 3;
const MS_W = 5; // up to 250.0 (IDLE_GAP_MS) for p95; paint rarely passes 999.9
const COUNT_W = 4;
/** Weight of the running paint-CPU average kept per frame (the new sample gets the rest). */
const CPU_EMA_KEEP = 0.9;
const P95 = 0.95;
const SEP = ' · ';

const timing = (fps: string, p95: string): string[] =>
  [`${fps.padStart(FPS_W)} fps`, `p95 ${p95.padStart(MS_W)} ms`];
/** Stands for a timing not measured yet (no frames, or only idle gaps): the fields keep their place. */
const PENDING = '—';

/**
 * Frame meter (settings → Frame meter, or `?render=fps`): gaps between consecutive painted frames
 * (what the eye sees), the CPU time of the paint itself, and brushes drawn out of those loaded.
 */
export class FrameMeter {
  private readonly gaps = new Float64Array(WINDOW);
  private n = 0;
  private next = 0;
  private last = 0;
  private cpu = 0;

  /** Call once per painted frame, with the CPU ms the paint took. */
  frame(now: number, paintMs: number): void {
    const gap = now - this.last;
    this.last = now;
    this.cpu = this.cpu * CPU_EMA_KEEP + paintMs * (1 - CPU_EMA_KEEP);
    if (gap <= 0 || gap > IDLE_GAP_MS) return;
    this.gaps[this.next] = gap;
    this.next = (this.next + 1) % WINDOW;
    this.n = Math.min(WINDOW, this.n + 1);
  }

  /**
   * Readout parts, each kept on one line (non-breaking spaces) so a narrow screen wraps between
   * parts, never inside one.
   */
  label(drawn: number, loaded: number, renderer?: string): string {
    const parts: string[] = renderer ? [renderer] : [];
    if (this.n === 0) {
      parts.push(...timing(PENDING, PENDING));
    } else {
      const g = Array.from(this.gaps.subarray(0, this.n)).sort((a, b) => a - b);
      const mean = g.reduce((a, b) => a + b, 0) / g.length;
      const p95 = g[Math.min(g.length - 1, Math.floor(g.length * P95))] ?? mean;
      parts.push(...timing((MS_PER_S / mean).toFixed(0), p95.toFixed(1)));
    }
    parts.push(
      `paint ${this.cpu.toFixed(1).padStart(MS_W)} ms`,
      `draws ${String(drawn).padStart(COUNT_W)}`,
      `loaded ${String(loaded).padStart(COUNT_W)}`,
    );
    return parts.map((p) => p.replace(/ /g, ' ')).join(SEP);
  }
}
