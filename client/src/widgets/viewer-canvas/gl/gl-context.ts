/** A linked program with lazily cached uniform locations. */
export class GLProgram {
  private readonly locs = new Map<string, WebGLUniformLocation | null>();

  constructor(private readonly gl: WebGL2RenderingContext, readonly program: WebGLProgram) {}

  use(): this {
    this.gl.useProgram(this.program);
    return this;
  }

  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name);
      this.locs.set(name, l);
    }
    return l;
  }

  f1(name: string, x: number): this {
    this.gl.uniform1f(this.loc(name), x);
    return this;
  }

  f2(name: string, x: number, y: number): this {
    this.gl.uniform2f(this.loc(name), x, y);
    return this;
  }

  f3(name: string, v: readonly [number, number, number]): this {
    this.gl.uniform3f(this.loc(name), v[0], v[1], v[2]);
    return this;
  }

  f4(name: string, x: number, y: number, z: number, w: number): this {
    this.gl.uniform4f(this.loc(name), x, y, z, w);
    return this;
  }

  i1(name: string, x: number): this {
    this.gl.uniform1i(this.loc(name), x);
    return this;
  }
}

function shader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error('gl: createShader failed');
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s) ?? '';
    gl.deleteShader(s);
    throw new Error('gl: shader compile failed: ' + log);
  }
  return s;
}

export function link(gl: WebGL2RenderingContext, vs: string, fs: string): GLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('gl: createProgram failed');
  const v = shader(gl, gl.VERTEX_SHADER, vs);
  const f = shader(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error('gl: link failed: ' + (gl.getProgramInfoLog(p) ?? ''));
  }
  return new GLProgram(gl, p);
}

/** '#RRGGBB' → [r, g, b] in 0..1. */
export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 'rgba(r,g,b,a)' → [r, g, b, a] in 0..1. */
export function rgba(css: string): [number, number, number, number] {
  const m = css.match(/[\d.]+/g)?.map(Number) ?? [];
  return [(m[0] ?? 0) / 255, (m[1] ?? 0) / 255, (m[2] ?? 0) / 255, m[3] ?? 1];
}
