import { uploadSketch, type AtlasGL } from './atlas-gl';

/** The sketch's own 2D texture (seed-sized, not a tile), keyed by the landed bitmap's identity. */
export class SketchTexture {
  private cur: { image: number; tex: WebGLTexture } | null = null;

  constructor(private readonly gl: AtlasGL) {}

  has(image: number): boolean {
    return this.cur?.image === image;
  }

  texture(image: number): WebGLTexture | null {
    return this.cur?.image === image ? this.cur.tex : null;
  }

  get loaded(): boolean {
    return this.cur !== null;
  }

  /** Deletes the texture unless it is the wanted image's; true when something was deleted. */
  keepOnly(image: number): boolean {
    if (!this.cur || this.cur.image === image) return false;
    this.gl.deleteTexture(this.cur.tex);
    this.cur = null;
    return true;
  }

  /** False stops this frame's uploads (no texture); a bitmap that fails to upload is dropped. */
  put(image: number, bmp: ImageBitmap): boolean {
    const tex = this.gl.createTexture();
    if (!tex) return false;
    try {
      uploadSketch(this.gl, tex, bmp);
    } catch {
      this.gl.deleteTexture(tex);
      return true;
    }
    if (this.cur) this.gl.deleteTexture(this.cur.tex);
    this.cur = { image, tex };
    return true;
  }

  dispose(): void {
    if (this.cur) this.gl.deleteTexture(this.cur.tex);
    this.cur = null;
  }

  /** The context that owned the texture is lost: no GL call. */
  forget(): void {
    this.cur = null;
  }
}
