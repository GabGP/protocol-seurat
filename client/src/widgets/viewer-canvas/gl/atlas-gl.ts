import { TILE } from '@/shared/config/constants';

/** The slice of WebGL2 the atlas uses (a fake of it drives the tests). */
export type AtlasGL = Pick<WebGL2RenderingContext,
  'createTexture' | 'deleteTexture' | 'bindTexture' | 'texStorage3D' | 'texSubImage3D' | 'texImage2D'
  | 'texParameteri' | 'pixelStorei' | 'getError'
  | 'TEXTURE_2D' | 'TEXTURE_2D_ARRAY' | 'RGBA8' | 'RGBA' | 'UNSIGNED_BYTE' | 'OUT_OF_MEMORY' | 'NO_ERROR'
  | 'TEXTURE_WRAP_S' | 'TEXTURE_WRAP_T' | 'CLAMP_TO_EDGE' | 'TEXTURE_MIN_FILTER' | 'TEXTURE_MAG_FILTER' | 'LINEAR'
  | 'UNPACK_FLIP_Y_WEBGL' | 'UNPACK_PREMULTIPLY_ALPHA_WEBGL' | 'UNPACK_COLORSPACE_CONVERSION_WEBGL' | 'NONE'>;

export interface Slot {
  array: number;
  layer: number;
}

export function textureParams(gl: AtlasGL, target: number): void {
  gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

/** Bitmaps are opaque sRGB bytes already: no flip, premultiply or colour conversion. */
export function unpackRaw(gl: AtlasGL): void {
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
}

/** A TEXTURE_2D_ARRAY of `layers` tiles; null when there is no texture or VRAM ran out (§5.2.3's pressure signal). */
export function allocLayerArray(gl: AtlasGL, layers: number, onVramFailure: () => void): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, TILE, TILE, layers);
  if (gl.getError() === gl.OUT_OF_MEMORY) {
    gl.deleteTexture(tex);
    onVramFailure();
    return null;
  }
  textureParams(gl, gl.TEXTURE_2D_ARRAY);
  return tex;
}

/** Copies one tile bitmap into a layer of the bound-by-this-call array. */
export function uploadLayer(gl: AtlasGL, array: WebGLTexture | null, layer: number, bmp: ImageBitmap): void {
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, array);
  unpackRaw(gl);
  gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, TILE, TILE, 1, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
}

/** The sketch's own 2D texture (seed-sized, not a tile). */
export function uploadSketch(gl: AtlasGL, tex: WebGLTexture, bmp: ImageBitmap): void {
  gl.bindTexture(gl.TEXTURE_2D, tex);
  textureParams(gl, gl.TEXTURE_2D);
  unpackRaw(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
}
