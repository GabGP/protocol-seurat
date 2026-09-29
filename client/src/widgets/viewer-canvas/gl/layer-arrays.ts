import { TILE } from '@/shared/config/constants';
import { addGpuBytes } from '@/shared/lib/gpu-meter';
import { allocLayerArray, type AtlasGL, type Slot } from './atlas-gl';

/**
 * The texture arrays behind the atlas and their free layers. An array grows when every layer is
 * taken and is deleted when every layer of it is free again (a work switch or a scrape gives its
 * VRAM back); a deleted array leaves a hole so the other slots keep their array index.
 */
export class LayerArrays {
  private readonly arrays: Array<WebGLTexture | null> = [];
  private readonly free: Slot[] = [];

  constructor(
    private readonly gl: AtlasGL,
    private readonly layers: number,
    private readonly onVramFailure: () => void,
  ) {}

  private get arrayBytes(): number {
    return this.layers * TILE * TILE * 4;
  }

  /** Arrays holding VRAM now. */
  get count(): number {
    return this.arrays.filter((a) => a !== null).length;
  }

  array(i: number): WebGLTexture | undefined {
    return this.arrays[i] ?? undefined;
  }

  /** A free layer, from a new array when none is left; null when VRAM ran out (§5.2.3's pressure signal). */
  take(): Slot | null {
    return this.free.pop() ?? this.grow();
  }

  give(slot: Slot): void {
    this.free.push(slot);
  }

  /** Deletes the arrays that no brush uses; true when any went. */
  trim(): boolean {
    const freeIn = new Map<number, number>();
    for (const s of this.free) freeIn.set(s.array, (freeIn.get(s.array) ?? 0) + 1);
    const empty = new Set<number>();
    for (const [array, n] of freeIn) if (n === this.layers) empty.add(array);
    if (empty.size === 0) return false;
    for (const i of empty) {
      const tex = this.arrays[i];
      if (tex) this.gl.deleteTexture(tex);
      this.arrays[i] = null;
      addGpuBytes(-this.arrayBytes);
    }
    this.free.splice(0, this.free.length, ...this.free.filter((s) => !empty.has(s.array)));
    return true;
  }

  dispose(): void {
    addGpuBytes(-this.count * this.arrayBytes);
    for (const t of this.arrays) if (t) this.gl.deleteTexture(t);
    this.arrays.length = 0;
    this.free.length = 0;
  }

  private grow(): Slot | null {
    const tex = allocLayerArray(this.gl, this.layers, this.onVramFailure);
    if (!tex) return null;
    let array = this.arrays.indexOf(null);
    if (array < 0) array = this.arrays.length;
    this.arrays[array] = tex;
    addGpuBytes(this.arrayBytes);
    for (let layer = this.layers - 1; layer > 0; layer--) this.free.push({ array, layer });
    return { array, layer: 0 };
  }
}
