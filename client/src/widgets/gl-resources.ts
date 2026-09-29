import { DOT_TILE_CELLS } from '@/shared/config/render';
import { link, type GLProgram } from './gl-context';
import { BG_FS, DISC_FS, OUTLINE_FS, RECT_VS, SHADOW_FS, TILE_FS, TILE_VS } from './gl-shaders';
import { dotParams } from './pointillism';

/** Instance attributes of the tile pass: dev rect, uv rect, image rect, layer. */
const INSTANCE_ATTRIBUTES = 4;

/** GPU objects one WebGL2 renderer owns, plus the surface size every pass reads. */
export class GLResources {
  readonly bg: GLProgram;
  readonly shadow: GLProgram;
  readonly tile: GLProgram;
  readonly disc: GLProgram;
  readonly outline: GLProgram;
  readonly dotTile: WebGLTexture | null;
  readonly empty: WebGLVertexArrayObject | null;
  readonly tiles: WebGLVertexArrayObject | null;
  readonly buffer: WebGLBuffer | null;
  readonly linear: WebGLSampler | null;
  readonly nearest: WebGLSampler | null;
  W = 0;
  H = 0;
  dpr = 1;

  constructor(readonly gl: WebGL2RenderingContext, readonly canvas: HTMLCanvasElement) {
    this.bg = link(gl, RECT_VS, BG_FS);
    this.shadow = link(gl, RECT_VS, SHADOW_FS);
    this.tile = link(gl, TILE_VS, TILE_FS);
    this.disc = link(gl, RECT_VS, DISC_FS);
    this.outline = link(gl, RECT_VS, OUTLINE_FS);
    this.dotTile = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.dotTile);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, DOT_TILE_CELLS, DOT_TILE_CELLS, 0, gl.RGBA, gl.UNSIGNED_BYTE, dotParams());
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    this.empty = gl.createVertexArray();
    this.tiles = gl.createVertexArray();
    this.buffer = gl.createBuffer();
    gl.bindVertexArray(this.tiles);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    for (let a = 0; a < INSTANCE_ATTRIBUTES; a++) {
      gl.enableVertexAttribArray(a);
      gl.vertexAttribDivisor(a, 1);
    }
    gl.bindVertexArray(null);
    this.linear = this.sampler(gl.LINEAR);
    this.nearest = this.sampler(gl.NEAREST);
  }

  resize(W: number, H: number, dpr: number): void {
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Bind a program and set the uniforms every shader shares: the buffer size and the DPR. */
  frame(p: GLProgram): GLProgram {
    return p.use().f2('uView', this.canvas.width, this.canvas.height).f1('uDpr', this.dpr);
  }

  dispose(): void {
    const gl = this.gl;
    for (const p of [this.bg, this.shadow, this.tile, this.disc, this.outline]) gl.deleteProgram(p.program);
    gl.deleteTexture(this.dotTile);
    gl.deleteVertexArray(this.empty);
    gl.deleteVertexArray(this.tiles);
    gl.deleteBuffer(this.buffer);
    gl.deleteSampler(this.linear);
    gl.deleteSampler(this.nearest);
  }

  private sampler(filter: number): WebGLSampler | null {
    const gl = this.gl;
    const s = gl.createSampler();
    gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, filter);
    gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, filter);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return s;
  }
}
