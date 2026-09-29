/**
 * Composição rápida no navegador: WebGL 1 (Chrome 64, Safari 11) com a mesma conta de
 * composicao.ts. Sem WebGL, cai na função pura (mais lenta, mesmo resultado).
 *
 * Seis texturas: base, vazio, ganho, uv, mapa e um atlas com o design de cada slot empilhado.
 * uv e mapa são lidos sem filtro e sem conversão de cor (são números, não cores).
 */
import { comporMockup, type ImagemRGBA } from "./composicao";

export interface CamadasCarregadas {
  largura: number;
  altura: number;
  base: HTMLImageElement;
  vazio: HTMLImageElement;
  ganho: HTMLImageElement;
  uv: HTMLImageElement;
  mapa: HTMLImageElement;
}

const MAX_SLOTS = 8;

const VERT = `
attribute vec2 aPos;
varying vec2 vPos;
void main() {
  vPos = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const frag = (precisao: string) => `
precision ${precisao} float;
varying vec2 vPos;
uniform sampler2D uBase;
uniform sampler2D uVazio;
uniform sampler2D uGanho;
uniform sampler2D uUv;
uniform sampler2D uMapa;
uniform sampler2D uAtlas;
uniform vec4 uRect[${MAX_SLOTS}];
uniform vec4 uMargem[${MAX_SLOTS}];
void main() {
  vec3 b = texture2D(uBase, vPos).rgb;
  vec3 z = texture2D(uVazio, vPos).rgb;
  float k = floor(texture2D(uMapa, vPos).r * 255.0 + 0.5);
  if (k < 0.5) { gl_FragColor = vec4(b, 1.0); return; }
  vec4 r = vec4(0.0);
  vec4 m = vec4(0.0);
  for (int i = 0; i < ${MAX_SLOTS}; i++) {
    if (abs(float(i + 1) - k) < 0.5) { r = uRect[i]; m = uMargem[i]; }
  }
  if (r.z <= 0.0) { gl_FragColor = vec4(z, 1.0); return; }
  vec3 g = texture2D(uGanho, vPos).rgb;
  vec3 e = floor(texture2D(uUv, vPos).rgb * 255.0 + 0.5);
  float ulo = floor(e.b / 16.0);
  float vlo = e.b - ulo * 16.0;
  vec2 uv = vec2(e.r * 16.0 + ulo, e.g * 16.0 + vlo) / 4095.0;
  uv = clamp(uv, m.xy, m.zw);
  vec4 d = texture2D(uAtlas, r.xy + uv * r.zw);
  gl_FragColor = vec4(z + d.a * (b - z) + g * d.rgb, 1.0);
}`;

type Gl = WebGLRenderingContext;

export interface Compositor {
  /** Desenha o mockup no canvas de destino (tamanho do destino = tamanho das camadas). */
  desenhar(camadas: CamadasCarregadas, designs: Array<HTMLCanvasElement | null>, destino: HTMLCanvasElement): void;
  webgl: boolean;
  ladoMaximo: number;
}

function compilar(gl: Gl, tipo: number, fonte: string): WebGLShader {
  const s = gl.createShader(tipo);
  if (!s) throw new Error("WebGL sem shader");
  gl.shaderSource(s, fonte);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || "shader não compilou");
  return s;
}

/** Monta o atlas: designs empilhados na vertical com 2 px de folga. */
export function montarAtlas(designs: Array<{ width: number; height: number } | null>): { largura: number; altura: number; posicoes: Array<{ y: number; w: number; h: number } | null> } {
  let largura = 1;
  let y = 0;
  const posicoes = designs.map((d) => {
    if (!d) return null;
    const p = { y, w: d.width, h: d.height };
    largura = Math.max(largura, d.width);
    y += d.height + 2;
    return p;
  });
  return { largura, altura: Math.max(1, y), posicoes };
}

function criarWebgl(): Compositor | null {
  if (typeof document === "undefined") return null;
  const tela = document.createElement("canvas");
  let gl: Gl | null = null;
  try {
    gl = (tela.getContext("webgl", { premultipliedAlpha: false, antialias: false }) || tela.getContext("experimental-webgl")) as Gl | null;
  } catch {
    gl = null;
  }
  if (!gl) return null;
  const g = gl;
  const alta = g.getShaderPrecisionFormat(g.FRAGMENT_SHADER, g.HIGH_FLOAT);
  const precisao = alta && alta.precision > 0 ? "highp" : "mediump";
  let prog: WebGLProgram;
  try {
    const p = g.createProgram();
    if (!p) return null;
    g.attachShader(p, compilar(g, g.VERTEX_SHADER, VERT));
    g.attachShader(p, compilar(g, g.FRAGMENT_SHADER, frag(precisao)));
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) return null;
    prog = p;
  } catch {
    return null;
  }
  const buf = g.createBuffer();
  g.bindBuffer(g.ARRAY_BUFFER, buf);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), g.STATIC_DRAW);
  const ladoMaximo = g.getParameter(g.MAX_TEXTURE_SIZE) as number;
  const cache = new WeakMap<object, WebGLTexture>();
  const atlasTex = g.createTexture();

  const textura = (img: TexImageSource & object, numero: boolean): WebGLTexture => {
    const ja = cache.get(img);
    if (ja) return ja;
    const t = g.createTexture() as WebGLTexture;
    g.bindTexture(g.TEXTURE_2D, t);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL, numero ? g.NONE : g.BROWSER_DEFAULT_WEBGL);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img);
    const filtro = numero ? g.NEAREST : g.LINEAR;
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, filtro);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, filtro);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    cache.set(img, t);
    return t;
  };

  return {
    webgl: true,
    ladoMaximo,
    desenhar(c, designs, destino) {
      tela.width = c.largura;
      tela.height = c.altura;
      g.viewport(0, 0, c.largura, c.altura);
      g.useProgram(prog);
      const loc = g.getAttribLocation(prog, "aPos");
      g.bindBuffer(g.ARRAY_BUFFER, buf);
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);

      const at = montarAtlas(designs);
      const atlas = document.createElement("canvas");
      atlas.width = at.largura;
      atlas.height = at.altura;
      const actx = atlas.getContext("2d");
      designs.forEach((d, i) => {
        const p = at.posicoes[i];
        if (d && p && actx) actx.drawImage(d, 0, p.y);
      });
      g.activeTexture(g.TEXTURE5);
      g.bindTexture(g.TEXTURE_2D, atlasTex);
      g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      g.pixelStorei(g.UNPACK_COLORSPACE_CONVERSION_WEBGL, g.BROWSER_DEFAULT_WEBGL);
      g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, atlas);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);

      const fontes: Array<[string, TexImageSource & object, boolean]> = [
        ["uBase", c.base, false],
        ["uVazio", c.vazio, false],
        ["uGanho", c.ganho, false],
        ["uUv", c.uv, true],
        ["uMapa", c.mapa, true],
      ];
      fontes.forEach(([nome, img, numero], i) => {
        g.activeTexture(g.TEXTURE0 + i);
        g.bindTexture(g.TEXTURE_2D, textura(img, numero));
        g.uniform1i(g.getUniformLocation(prog, nome), i);
      });
      g.uniform1i(g.getUniformLocation(prog, "uAtlas"), 5);
      const rects = new Float32Array(MAX_SLOTS * 4);
      const margens = new Float32Array(MAX_SLOTS * 4);
      for (let i = 0; i < MAX_SLOTS; i++) {
        const p = at.posicoes[i];
        if (!p) continue;
        rects.set([0, p.y / at.altura, p.w / at.largura, p.h / at.altura], i * 4);
        margens.set([0.5 / p.w, 0.5 / p.h, 1 - 0.5 / p.w, 1 - 0.5 / p.h], i * 4);
      }
      g.uniform4fv(g.getUniformLocation(prog, "uRect"), rects);
      g.uniform4fv(g.getUniformLocation(prog, "uMargem"), margens);
      g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
      destino.width = c.largura;
      destino.height = c.altura;
      const dctx = destino.getContext("2d");
      if (dctx) dctx.drawImage(tela, 0, 0);
    },
  };
}

const pixelsCache = new WeakMap<object, Uint8ClampedArray>();

function pixelsDe(img: CanvasImageSource & object, w: number, h: number): Uint8ClampedArray {
  const ja = pixelsCache.get(img);
  if (ja && ja.length === w * h * 4) return ja;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível");
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  pixelsCache.set(img, px);
  return px;
}

/** Reserva sem WebGL: a função pura, com os pixels lidos por canvas 2D. */
function criarCanvas2d(): Compositor {
  return {
    webgl: false,
    ladoMaximo: 4096,
    desenhar(c, designs, destino) {
      const { largura: w, altura: h } = c;
      const ds: Array<ImagemRGBA | null> = designs.map((d) => {
        if (!d) return null;
        const ctx = d.getContext("2d");
        return ctx ? { largura: d.width, altura: d.height, pixels: ctx.getImageData(0, 0, d.width, d.height).data } : null;
      });
      const out = comporMockup(
        { largura: w, altura: h, base: pixelsDe(c.base, w, h), vazio: pixelsDe(c.vazio, w, h), ganho: pixelsDe(c.ganho, w, h), uv: pixelsDe(c.uv, w, h), mapa: pixelsDe(c.mapa, w, h) },
        ds,
      );
      destino.width = w;
      destino.height = h;
      const ctx = destino.getContext("2d");
      if (ctx) ctx.putImageData(new ImageData(out, w, h), 0, 0);
    },
  };
}

let unico: Compositor | null = null;

/** Um compositor por página (um contexto WebGL só). */
export function compositor(): Compositor {
  if (!unico) unico = criarWebgl() || criarCanvas2d();
  return unico;
}
