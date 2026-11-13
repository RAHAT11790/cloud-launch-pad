// ============================================================
// YuvPainter — shows decoded I420 pictures with WebGL (GPU colour
// conversion), the standard way web H.265 players stay smooth on phones.
// Works on an OffscreenCanvas inside a worker. Falls back to 2D VideoFrame
// drawing when WebGL is unavailable.
// ============================================================

const RGB_FS = `precision mediump float;varying vec2 uv;uniform sampler2D tr;void main(){gl_FragColor=vec4(texture2D(tr,uv).rgb,1.0);}`;
const VS = `attribute vec2 p;varying vec2 uv;void main(){uv=vec2((p.x+1.0)*0.5,(1.0-p.y)*0.5);gl_Position=vec4(p,0.0,1.0);}`;
const FS = `precision mediump float;varying vec2 uv;uniform sampler2D ty;uniform sampler2D tu;uniform sampler2D tv;uniform vec4 k;
void main(){float y=1.1643*(texture2D(ty,uv).r-0.0625);float u=texture2D(tu,uv).r-0.5;float v=texture2D(tv,uv).r-0.5;
gl_FragColor=vec4(clamp(vec3(y+k.x*v,y-k.y*u-k.z*v,y+k.w*u),0.0,1.0),1.0);}`;

/** Limited-range BT.709 (HD) or BT.601 (SD) coefficients: Rv, Gu, Gv, Bu. */
const coefficients = (h: number) => (h >= 600 ? [1.7927, 0.2132, 0.5329, 2.1124] : [1.5958, 0.3917, 0.8129, 2.0172]);

type Canvas = OffscreenCanvas | HTMLCanvasElement;

export interface YuvPicture { width: number; height: number; data: Uint8Array }

export class YuvPainter {
  private gl: WebGLRenderingContext | null = null;
  private g2d: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;
  private tex: WebGLTexture[] = [];
  private kLoc: WebGLUniformLocation | null = null;
  private yuvProg: WebGLProgram | null = null;
  private rgbProg: WebGLProgram | null = null;
  private rgbTex: WebGLTexture | null = null;
  private current: WebGLProgram | null = null;
  private w = 0; private h = 0;
  private yw = 0; private yh = 0;

  constructor(private readonly canvas: Canvas) {
    const gl = (canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, desynchronized: true, powerPreference: "low-power" } as WebGLContextAttributes)
      || canvas.getContext("experimental-webgl" as "webgl")) as WebGLRenderingContext | null;
    if (gl && this.setup(gl)) this.gl = gl;
    else this.g2d = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
  }

  get kind() { return this.gl ? "webgl" : this.g2d ? "2d" : "none"; }

  private setup(gl: WebGLRenderingContext): boolean {
    const sh = (type: number, src: string) => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
    const link = (fsSrc: string) => {
      const vs = sh(gl.VERTEX_SHADER, VS); const fs = sh(gl.FRAGMENT_SHADER, fsSrc);
      if (!vs || !fs) return null;
      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs); gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, "p");
      gl.linkProgram(prog);
      return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null;
    };
    const yuv = link(FS); const rgb = link(RGB_FS);
    if (!yuv || !rgb) return false;
    this.yuvProg = yuv; this.rgbProg = rgb;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const makeTex = (unit: number) => {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    gl.useProgram(yuv);
    ["ty", "tu", "tv"].forEach((name, i) => { this.tex.push(makeTex(i)); gl.uniform1i(gl.getUniformLocation(yuv, name), i); });
    this.kLoc = gl.getUniformLocation(yuv, "k");
    gl.useProgram(rgb);
    this.rgbTex = makeTex(3);
    gl.uniform1i(gl.getUniformLocation(rgb, "tr"), 3);
    this.use(gl, yuv);
    return !gl.isContextLost();
  }

  private use(gl: WebGLRenderingContext, prog: WebGLProgram) {
    if (this.current !== prog) { gl.useProgram(prog); this.current = prog; }
  }

  private fit(w: number, h: number) {
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    const changed = w !== this.w || h !== this.h;
    if (changed) { this.w = w; this.h = h; this.gl?.viewport(0, 0, w, h); }
    return changed;
  }

  /** Paints a decoder VideoFrame (phone hardware decoder). */
  paintFrame(f: VideoFrame) {
    const w = f.displayWidth || f.codedWidth; const h = f.displayHeight || f.codedHeight;
    const gl = this.gl;
    if (gl && this.rgbProg) {
      this.fit(w, h);
      this.use(gl, this.rgbProg);
      gl.activeTexture(gl.TEXTURE3);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, f as unknown as TexImageSource);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }
    if (this.g2d) { this.fit(w, h); this.g2d.drawImage(f as unknown as CanvasImageSource, 0, 0, w, h); }
  }

  /** Paints one I420 picture (planes packed Y, U, V). */
  paint(pic: YuvPicture) {
    const { width: w, height: h, data } = pic;
    const cw = w >> 1; const ch = h >> 1;
    const gl = this.gl;
    if (gl && this.yuvProg) {
      this.fit(w, h);
      this.use(gl, this.yuvProg);
      const sizeChanged = w !== this.yw || h !== this.yh; // plane textures need (re)allocating
      if (sizeChanged) { this.yw = w; this.yh = h; gl.uniform4fv(this.kLoc, coefficients(h)); }
      const planes: Array<[number, number, number, number]> = [[0, w, h, 0], [1, cw, ch, w * h], [2, cw, ch, w * h + cw * ch]];
      for (const [i, pw, ph, off] of planes) {
        gl.activeTexture(gl.TEXTURE0 + i);
        const view = data.subarray(off, off + pw * ph);
        if (sizeChanged) gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, pw, ph, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, view);
        else gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, pw, ph, gl.LUMINANCE, gl.UNSIGNED_BYTE, view);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return;
    }
    if (this.g2d) {
      this.fit(w, h);
      const f = new VideoFrame(data, { format: "I420", codedWidth: w, codedHeight: h, timestamp: 0 });
      try { this.g2d.drawImage(f as unknown as CanvasImageSource, 0, 0, w, h); } finally { f.close(); }
    }
  }
}
