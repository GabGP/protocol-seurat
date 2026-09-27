import { IMAGE_PX, type Frame } from './eviction-sim';

/** Seeded PRNG (mulberry32): every run replays the same traces. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const C = IMAGE_PX / 2;
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

/** `steps` frames easing from `a` to `b` (smoothstep, like a fling that settles). */
function move(a: Frame, b: Frame, steps: number): Frame[] {
  return Array.from({ length: steps }, (_, i) => {
    const k = (i + 1) / steps;
    const e = k * k * (3 - 2 * k);
    return { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), z: lerp(a.z, b.z, e) };
  });
}

/** Looking around a spot: a slow drift that stays within `jitter` px of it. */
function dwell(at: Frame, steps: number, jitter: number, rand: () => number): Frame[] {
  let dx = 0;
  let dy = 0;
  return Array.from({ length: steps }, () => {
    dx = Math.max(-jitter / 2, Math.min(jitter / 2, dx + (rand() - 0.5) * jitter * 0.1));
    dy = Math.max(-jitter / 2, Math.min(jitter / 2, dy + (rand() - 0.5) * jitter * 0.1));
    return { x: at.x + dx, y: at.y + dy, z: at.z };
  });
}

/** One long pan across the image with a vertical wobble. */
function pan(): Frame[] {
  return Array.from({ length: 800 }, (_, i) => ({ x: 4000 + i * 70, y: C + 3000 * Math.sin(i / 60), z: 1.5 }));
}

/** Back and forth between two regions: what was left behind is needed again. */
function panReturn(): Frame[] {
  const a = { x: 12000, y: C, z: 1.5 };
  const b = { x: 34000, y: C + 4000, z: 1.5 };
  return [move(a, b, 160), move(b, a, 160), move(a, b, 160), move(b, a, 160), move(a, b, 160)].flat();
}

/** Zoom dives: into P, out, over to Q, into Q, then back into P. */
function zoomDive(): Frame[] {
  const p = { x: 20000, y: 22000, z: 0.3 };
  const q = { x: 44000, y: 40000, z: 0.3 };
  const hi = (f: Frame): Frame => ({ ...f, z: 5.5 });
  const rand = rng(7);
  return [
    move(hi(p), p, 120), dwell(p, 60, 400, rand), move(p, hi(p), 120),
    move(hi(p), hi(q), 60), move(hi(q), q, 120), dwell(q, 60, 400, rand), move(q, hi(q), 120),
    move(hi(q), hi(p), 60), move(hi(p), p, 120), dwell(p, 60, 400, rand),
  ].flat();
}

/** Inspecting three points of interest in random order, flinging between them. */
function hotspots(): Frame[] {
  const rand = rng(42);
  const pois: Frame[] = [
    { x: 14000, y: 16000, z: 0.5 }, { x: 36000, y: 20000, z: 0.5 }, { x: 24000, y: 42000, z: 0.5 },
  ];
  const out: Frame[] = [];
  let at = pois[0]!;
  for (let visit = 0; visit < 9; visit++) {
    const next = pois[Math.floor(rand() * pois.length)]!;
    if (next !== at) out.push(...move(at, next, 40));
    out.push(...dwell(next, 80, 600, rand));
    at = next;
  }
  return out;
}

/** Free exploration: velocity and zoom follow a mean-reverting random walk. */
function randomWalk(): Frame[] {
  const rand = rng(1234);
  let f: Frame = { x: C, y: C, z: 1.5 };
  let vx = 0;
  let vy = 0;
  let vz = 0;
  const out: Frame[] = [];
  for (let i = 0; i < 1000; i++) {
    const scale = 2 ** f.z;
    vx = 0.9 * vx + (rand() - 0.5) * 60 * scale;
    vy = 0.9 * vy + (rand() - 0.5) * 60 * scale;
    vz = 0.9 * vz + (rand() - 0.5) * 0.02;
    f = {
      x: Math.min(IMAGE_PX - 1, Math.max(0, f.x + vx)),
      y: Math.min(IMAGE_PX - 1, Math.max(0, f.y + vy)),
      z: Math.min(4, Math.max(0.2, f.z + vz)),
    };
    out.push(f);
  }
  return out;
}

export const TRACES: Record<string, Frame[]> = {
  pan: pan(),
  panReturn: panReturn(),
  zoomDive: zoomDive(),
  hotspots: hotspots(),
  randomWalk: randomWalk(),
};
