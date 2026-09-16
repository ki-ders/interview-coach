import { LANDMARK_COUNT } from './landmarks';
import type { FaceRig } from './rig';
import { FACE_TRIANGLES, MOUTH_TRIANGLES } from './triangulation';

const VERT = `
attribute vec2 aPos;
attribute vec2 aUv;
uniform vec2 uScale;
uniform vec2 uOffset;
uniform vec2 uCanvas;
varying vec2 vUv;
void main() {
  vec2 p = aPos * uScale + uOffset;
  gl_Position = vec4(p.x / uCanvas.x * 2.0 - 1.0, 1.0 - p.y / uCanvas.y * 2.0, 0.0, 1.0);
  vUv = aUv;
}`;

const FRAG = `
precision mediump float;
uniform sampler2D uTex;
uniform vec4 uColor;
uniform float uUseTex;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uTex, vUv);
  // uUseTex: 1 = 사진 그대로, 0 = 단색. 그 사이는 섞는다
  gl_FragColor = mix(uColor, t, uUseTex);
}`;

export interface Framing {
  /** 얼굴 중심을 둘 위치 (캔버스 비율) */
  faceX: number;
  faceY: number;
  /** 얼굴 높이가 캔버스 높이의 몇 배가 될지 */
  faceHeight: number;
}

export const DEFAULT_FRAMING: Framing = { faceX: 0.5, faceY: 0.44, faceHeight: 0.42 };

/**
 * 사진 한 장을 배경으로 깔고, 그 위에 같은 사진을 텍스처로 입힌 얼굴 메시를 그린다.
 * 메시 정점만 움직이면 얼굴이 움직이는 것처럼 보인다 (2.5D).
 */
export class FaceGl {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private aPos: number;
  private aUv: number;
  private uScale: WebGLUniformLocation | null;
  private uOffset: WebGLUniformLocation | null;
  private uCanvas: WebGLUniformLocation | null;
  private uColor: WebGLUniformLocation | null;
  private uUseTex: WebGLUniformLocation | null;

  private tex: WebGLTexture | null = null;
  private bgPos: WebGLBuffer;
  private bgUv: WebGLBuffer;
  private facePos: WebGLBuffer;
  private faceUv: WebGLBuffer;
  private faceIdx: WebGLBuffer;
  private mouthIdx: WebGLBuffer;

  private rig: FaceRig | null = null;
  private imageW = 1;
  private imageH = 1;
  private scale = 1;
  private offset = { x: 0, y: 0 };
  private dpr = 1;
  disposed = false;
  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL 을 사용할 수 없습니다.');
    this.gl = gl;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        throw new Error(`shader: ${gl.getShaderInfoLog(sh) ?? 'compile failed'}`);
      }
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(`program: ${gl.getProgramInfoLog(prog) ?? 'link failed'}`);
    }
    this.prog = prog;
    gl.useProgram(prog);

    this.aPos = gl.getAttribLocation(prog, 'aPos');
    this.aUv = gl.getAttribLocation(prog, 'aUv');
    this.uScale = gl.getUniformLocation(prog, 'uScale');
    this.uOffset = gl.getUniformLocation(prog, 'uOffset');
    this.uCanvas = gl.getUniformLocation(prog, 'uCanvas');
    this.uColor = gl.getUniformLocation(prog, 'uColor');
    this.uUseTex = gl.getUniformLocation(prog, 'uUseTex');

    this.bgPos = gl.createBuffer()!;
    this.bgUv = gl.createBuffer()!;
    this.facePos = gl.createBuffer()!;
    this.faceUv = gl.createBuffer()!;
    this.faceIdx = gl.createBuffer()!;
    this.mouthIdx = gl.createBuffer()!;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.bgUv);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.faceIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, FACE_TRIANGLES, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.mouthIdx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, MOUTH_TRIANGLES, gl.STATIC_DRAW);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.1, 0.1, 0.12, 1);
  }

  /** 사진과 리그를 올린다 */
  setImage(image: TexImageSource & { width: number; height: number }, rig: FaceRig) {
    const gl = this.gl;
    this.rig = rig;
    this.imageW = rig.width;
    this.imageH = rig.height;

    if (this.tex) gl.deleteTexture(this.tex);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    // 2의 거듭제곱이 아닌 이미지도 쓸 수 있게 CLAMP + LINEAR
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const w = rig.width;
    const h = rig.height;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bgPos);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, w, 0, 0, h, w, h]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.faceUv);
    gl.bufferData(gl.ARRAY_BUFFER, rig.uv, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.facePos);
    gl.bufferData(gl.ARRAY_BUFFER, LANDMARK_COUNT * 2 * 4, gl.DYNAMIC_DRAW);
  }

  /**
   * 캔버스 크기를 맞추고, 얼굴이 원하는 위치·크기로 오도록 사진→캔버스 변환을 계산한다.
   * 사진이 캔버스를 다 덮지 못하면 덮을 만큼 확대한다.
   */
  resize(cssW: number, cssH: number, dpr: number, framing: Framing = DEFAULT_FRAMING) {
    const gl = this.gl;
    this.dpr = dpr;
    const cw = Math.max(1, Math.round(cssW * dpr));
    const ch = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    gl.viewport(0, 0, cw, ch);

    const rig = this.rig;
    if (!rig) return;
    let s = (framing.faceHeight * ch) / rig.faceH;
    const cover = Math.max(cw / this.imageW, ch / this.imageH);
    if (s < cover) s = cover;
    let ox = cw * framing.faceX - s * rig.center.x;
    let oy = ch * framing.faceY - s * rig.center.y;
    // 사진 바깥이 보이지 않게
    ox = Math.min(0, Math.max(cw - s * this.imageW, ox));
    oy = Math.min(0, Math.max(ch - s * this.imageH, oy));
    this.scale = s;
    this.offset = { x: ox, y: oy };
  }

  /**
   * 변형된 정점(468 x 2, 사진 픽셀 좌표)으로 한 프레임을 그린다.
   * @param mouthOpen 0~1 턱 벌림. 입 안쪽을 사진 그대로 두다가 벌어질수록 어둡게 한다
   *   (웃는 사진처럼 원래 입이 조금 열려 있어도 치아가 검게 덮이지 않도록).
   */
  render(positions: Float32Array, mouthOpen = 0) {
    const gl = this.gl;
    if (!this.rig || !this.tex || this.disposed) return;

    gl.useProgram(this.prog);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.uCanvas, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uScale, this.scale, this.scale);
    gl.uniform2f(this.uOffset, this.offset.x, this.offset.y);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);

    // 1) 배경: 사진 전체
    gl.uniform1f(this.uUseTex, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bgPos);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bgUv);
    gl.enableVertexAttribArray(this.aUv);
    gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 2) 입 안쪽 (어두운 색) — 입이 벌어지면 이 삼각형들이 보인다
    gl.bindBuffer(gl.ARRAY_BUFFER, this.facePos);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.faceUv);
    gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 0, 0);

    const darkness = Math.min(1, Math.max(0, (mouthOpen - 0.12) / 0.5));
    gl.uniform1f(this.uUseTex, 1 - darkness * 0.82);
    gl.uniform4f(this.uColor, 0.16, 0.06, 0.07, 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.mouthIdx);
    gl.drawElements(gl.TRIANGLES, MOUTH_TRIANGLES.length, gl.UNSIGNED_SHORT, 0);

    // 3) 얼굴 메시
    gl.uniform1f(this.uUseTex, 1);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.faceIdx);
    gl.drawElements(gl.TRIANGLES, FACE_TRIANGLES.length, gl.UNSIGNED_SHORT, 0);
  }

  get pixelRatio() {
    return this.dpr;
  }

  dispose() {
    this.disposed = true;
    const gl = this.gl;
    if (this.tex) gl.deleteTexture(this.tex);
    for (const b of [this.bgPos, this.bgUv, this.facePos, this.faceUv, this.faceIdx, this.mouthIdx]) {
      gl.deleteBuffer(b);
    }
    gl.deleteProgram(this.prog);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
