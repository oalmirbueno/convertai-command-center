import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Memória do estúdio de mockups (CT-03, 30/09): as camadas de cada mockup
 * (5 imagens de ~4 MB no trabalho e ~20 MB na alta, já na GPU) ficavam no
 * cache da página até fechar a aba. Agora quem usa solta: `esquecerImagem` e
 * `liberarCamadas` revogam o URL local e o compositor apaga a textura (ou os
 * pixels do modo sem WebGL). A tela não muda; só quem reabre baixa de novo.
 */

const baixar = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ download: (caminho: string) => baixar(caminho) }) } },
}));

/** Imagem de mentira: o jsdom não abre blob, então o onload vem logo depois do src. */
class ImagemFalsa {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 2;
  naturalHeight = 2;
  private endereco = "";
  set src(v: string) {
    this.endereco = v;
    setTimeout(() => this.onload && this.onload(), 0);
  }
  get src() {
    return this.endereco;
  }
}

/** WebGL de mentira: registra as texturas criadas e apagadas. */
function glFalso() {
  const registro = { criadas: [] as object[], apagadas: [] as object[] };
  const fixos: Record<string, unknown> = {
    getShaderPrecisionFormat: () => ({ precision: 23 }),
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getParameter: () => 4096,
    getAttribLocation: () => 0,
    getUniformLocation: () => ({}),
    createTexture: () => {
      const t = { textura: registro.criadas.length };
      registro.criadas.push(t);
      return t;
    },
    deleteTexture: (t: object) => {
      registro.apagadas.push(t);
    },
  };
  const gl = new Proxy({}, { get: (_a, k) => (typeof k === "string" && k in fixos ? fixos[k] : typeof k === "string" && /^[A-Z0-9_]+$/.test(k) ? 1 : () => undefined) });
  return { gl, registro };
}

const camadasDe = (imgs: object[]) => ({ largura: 2, altura: 2, base: imgs[0], vazio: imgs[1], ganho: imgs[2], uv: imgs[3], mapa: imgs[4] }) as never;
const destino = () => document.createElement("canvas");

let urls = 0;
const criarUrl = vi.fn(() => `blob:${++urls}`);
const revogarUrl = vi.fn();
/** O jsdom não tem createObjectURL: troca e devolve no fim de cada teste. */
const urlGlobal = URL as unknown as { createObjectURL: unknown; revokeObjectURL: unknown };
const original = { criar: urlGlobal.createObjectURL, revogar: urlGlobal.revokeObjectURL };

beforeEach(() => {
  vi.resetModules();
  urls = 0;
  baixar.mockReset();
  baixar.mockImplementation(async () => ({ data: new Blob(["x"]), error: null }));
  criarUrl.mockClear();
  revogarUrl.mockClear();
  urlGlobal.createObjectURL = criarUrl;
  urlGlobal.revokeObjectURL = revogarUrl;
  vi.stubGlobal("Image", ImagemFalsa);
});

afterEach(() => {
  urlGlobal.createObjectURL = original.criar;
  urlGlobal.revokeObjectURL = original.revogar;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const esperarMicrotarefas = () => new Promise((r) => setTimeout(r, 0));

describe("cache de imagens dos mockups (api.ts)", () => {
  it("esquecerImagem revoga o URL local e a próxima chamada baixa de novo", async () => {
    const { carregarImagem, esquecerImagem } = await import("@/lib/mockups/api");
    const a = await carregarImagem("t/base.jpg");
    expect(await carregarImagem("t/base.jpg")).toBe(a);
    expect(baixar).toHaveBeenCalledTimes(1);

    esquecerImagem("t/base.jpg");
    await esperarMicrotarefas();
    expect(revogarUrl).toHaveBeenCalledWith("blob:1");

    const b = await carregarImagem("t/base.jpg");
    expect(b).not.toBe(a);
    expect(baixar).toHaveBeenCalledTimes(2);
    // Esquecer o que não está no cache não faz nada.
    esquecerImagem("nunca/aberta.png");
    await esperarMicrotarefas();
    expect(revogarUrl).toHaveBeenCalledTimes(1);
  });

  it("imagem esquecida enquanto ainda baixava: o URL é revogado quando ela abre", async () => {
    const { carregarImagem, esquecerImagem } = await import("@/lib/mockups/api");
    const p = carregarImagem("t/uv.png");
    esquecerImagem("t/uv.png");
    await p;
    await esperarMicrotarefas();
    expect(revogarUrl).toHaveBeenCalledWith("blob:1");
  });

  it("liberarCamadas solta as 5 camadas do mockup e deixa a logo (bucket mesa) no cache", async () => {
    const { carregarImagem, liberarCamadas } = await import("@/lib/mockups/api");
    const conjunto = { base: "t/b.jpg", vazio: "t/v.jpg", ganho: "t/g.png", uv: "t/u.png", mapa: "t/m.png" };
    await Promise.all([conjunto.base, conjunto.vazio, conjunto.ganho, conjunto.uv, conjunto.mapa].map((c) => carregarImagem(c)));
    const logo = await carregarImagem("logos/principal.png", "mesa");
    expect(baixar).toHaveBeenCalledTimes(6);

    liberarCamadas(conjunto);
    liberarCamadas(null);
    await esperarMicrotarefas();
    expect(revogarUrl).toHaveBeenCalledTimes(5);

    expect(await carregarImagem("logos/principal.png", "mesa")).toBe(logo);
    expect(baixar).toHaveBeenCalledTimes(6);
    await carregarImagem(conjunto.base);
    expect(baixar).toHaveBeenCalledTimes(7);
  });

  it("imagem que não abre revoga o URL e sai do cache", async () => {
    class ImagemQueFalha extends ImagemFalsa {
      set src(_v: string) {
        setTimeout(() => this.onerror && this.onerror(), 0);
      }
    }
    vi.stubGlobal("Image", ImagemQueFalha);
    const { carregarImagem } = await import("@/lib/mockups/api");
    await expect(carregarImagem("t/quebrada.png")).rejects.toThrow("Imagem não abriu");
    expect(revogarUrl).toHaveBeenCalledWith("blob:1");
    await expect(carregarImagem("t/quebrada.png")).rejects.toThrow();
    expect(baixar).toHaveBeenCalledTimes(2);
  });
});

describe("compositor (webgl.ts)", () => {
  function comWebglFalso() {
    const { gl, registro } = glFalso();
    const telas: HTMLCanvasElement[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement, tipo: string) {
      if (tipo === "webgl") {
        telas.push(this);
        return gl as never;
      }
      if (tipo === "2d") return { drawImage() {} } as never;
      return null;
    } as never);
    return { registro, telas };
  }

  it("liberar apaga a textura e tira a entrada do cache: desenhar de novo sobe outra (nunca uma apagada)", async () => {
    const { registro } = comWebglFalso();
    const { compositor, liberarDoCompositor } = await import("@/lib/mockups/webgl");
    const imgs = [{}, {}, {}, {}, {}];
    const c = compositor();
    expect(c.webgl).toBe(true);
    const atlas = registro.criadas.length; // a textura do atlas nasce com o compositor
    c.desenhar(camadasDe(imgs), [], destino());
    expect(registro.criadas.length - atlas).toBe(5);
    c.desenhar(camadasDe(imgs), [], destino());
    expect(registro.criadas.length - atlas).toBe(5); // reaproveita

    const daBase = registro.criadas[atlas];
    liberarDoCompositor(imgs[0]);
    expect(registro.apagadas).toEqual([daBase]);
    liberarDoCompositor(imgs[0]); // de novo: nada a apagar
    expect(registro.apagadas).toHaveLength(1);

    c.desenhar(camadasDe(imgs), [], destino());
    expect(registro.criadas.length - atlas).toBe(6); // só a base subiu de novo
  });

  it("esquecerImagem chega ao compositor: a textura da camada é apagada", async () => {
    const { registro } = comWebglFalso();
    const api = await import("@/lib/mockups/api");
    const { compositor } = await import("@/lib/mockups/webgl");
    const conjunto = { base: "a/b.jpg", vazio: "a/v.jpg", ganho: "a/g.png", uv: "a/u.png", mapa: "a/m.png" };
    const camadas = await api.carregarCamadas(conjunto, 2, 2);
    compositor().desenhar(camadas, [], destino());
    const criadas = registro.criadas.length;
    api.liberarCamadas(conjunto);
    await esperarMicrotarefas();
    expect(registro.apagadas).toHaveLength(5);
    expect(registro.criadas.length).toBe(criadas);
  });

  it("sem compositor criado, liberar não cria um (nem abre contexto WebGL)", async () => {
    const { telas } = comWebglFalso();
    const { liberarDoCompositor } = await import("@/lib/mockups/webgl");
    liberarDoCompositor({});
    expect(telas).toHaveLength(0);
  });

  it("contexto WebGL perdido: o próximo compositor() cria outro", async () => {
    const { telas } = comWebglFalso();
    const { compositor } = await import("@/lib/mockups/webgl");
    const primeiro = compositor();
    expect(compositor()).toBe(primeiro);
    telas[0].dispatchEvent(new Event("webglcontextlost"));
    const segundo = compositor();
    expect(segundo).not.toBe(primeiro);
    expect(segundo.webgl).toBe(true);
  });

  it("sem WebGL (reserva em canvas 2D): liberar solta os pixels lidos e a próxima vez lê de novo", async () => {
    let leituras = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (tipo: string) {
      if (tipo !== "2d") return null;
      return {
        drawImage() {},
        putImageData() {},
        getImageData: (_x: number, _y: number, w: number, h: number) => {
          leituras++;
          return { data: new Uint8ClampedArray(w * h * 4) };
        },
      } as never;
    } as never);
    vi.stubGlobal("ImageData", class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    });
    const { compositor, liberarDoCompositor } = await import("@/lib/mockups/webgl");
    const imgs = [{}, {}, {}, {}, {}];
    const c = compositor();
    expect(c.webgl).toBe(false);
    c.desenhar(camadasDe(imgs), [], destino());
    expect(leituras).toBe(5);
    c.desenhar(camadasDe(imgs), [], destino());
    expect(leituras).toBe(5);
    liberarDoCompositor(imgs[2]);
    c.desenhar(camadasDe(imgs), [], destino());
    expect(leituras).toBe(6);
  });
});
