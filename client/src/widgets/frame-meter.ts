const WINDOW = 120;
/** Gaps longer than this are idle time between gestures, not frames. */
const IDLE_GAP_MS = 250;
const LEFT = 16;
const TOP = 76;

/**
 * `?render=fps` overlay: frame gaps between consecutive painted frames (what the eye sees),
 * the CPU time of the paint itself, and how many brushes were drawn out of those loaded.
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
    this.cpu = this.cpu * 0.9 + paintMs * 0.1;
    if (gap <= 0 || gap > IDLE_GAP_MS) return;
    this.gaps[this.next] = gap;
    this.next = (this.next + 1) % WINDOW;
    this.n = Math.min(WINDOW, this.n + 1);
  }

  label(drawn: number, loaded: number): string {
    if (this.n === 0) return `move to measure · paint ${this.cpu.toFixed(1)} ms · draws ${drawn} · loaded ${loaded}`;
    const g = Array.from(this.gaps.subarray(0, this.n)).sort((a, b) => a - b);
    const mean = g.reduce((a, b) => a + b, 0) / g.length;
    const p95 = g[Math.min(g.length - 1, Math.floor(g.length * 0.95))] ?? mean;
    return `${(1000 / mean).toFixed(0)} fps · p95 ${p95.toFixed(1)} ms · paint ${this.cpu.toFixed(1)} ms · draws ${drawn} · loaded ${loaded}`;
  }

  draw(ctx: CanvasRenderingContext2D, text: string): void {
    ctx.font = '600 12px ui-monospace, monospace';
    const w = ctx.measureText(text).width + 16;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(LEFT, TOP, w, 22);
    ctx.fillStyle = '#B8C4FF';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, LEFT + 8, TOP + 11);
  }
}
