import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cópias leves fora do fio principal (EX-13, 30/09). Com Worker,
 * createImageBitmap e OffscreenCanvas, a redução vai para o worker; sem eles
 * (Safari 11, Chrome 64, jsdom), ou com qualquer falha ou tamanho diferente
 * do <img>, segue pelo caminho de sempre, com o mesmo resultado.
 */

vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({}) } } }));

import {
  LADO_MEDIA,
  LADO_MINIATURA,
  __zerarWorkerDasCopiasParaTeste,
  prepararCopias,
  tamanhoQueCabe,
  temCopiasNoWorker,
} from "@/lib/miniaturas";

type Mensagem = { id: number; largura: number; altura: number; alvoMini: unknown; alvoMedia: unknown; checarTransparencia: boolean; qualidadeMini: number; qualidadeMedia: number };

let enviadas: Mensagem[] = [];
let responder: (m: Mensagem, w: WorkerFalso) => void = () => undefined;

class WorkerFalso {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  terminate = vi.fn();
  postMessage(m: Mensagem) {
    enviadas.push(m);
    setTimeout(() => responder(m, this), 0);
  }
}

let canvasDaTela = 0;

/** jsdom não tem Blob.text(). */
const ler = (b: Blob) =>
  new Promise<string>((resolve) => {
    const f = new FileReader();
    f.onload = () => resolve(String(f.result));
    f.readAsText(b);
  });

function imagemFalsa(largura: number, altura: number) {
  return class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = largura;
    naturalHeight = altura;
    width = largura;
    height = altura;
    decoding = "";
    set src(_v: string) {
      setTimeout(() => this.onload && this.onload(), 0);
    }
  };
}

const criarOriginal = document.createElement.bind(document);

beforeEach(() => {
  enviadas = [];
  canvasDaTela = 0;
  __zerarWorkerDasCopiasParaTeste();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined }));
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag !== "canvas") return criarOriginal(tag);
    canvasDaTela += 1;
    const c = {
      width: 0,
      height: 0,
      getContext: () => ({
        drawImage: () => undefined,
        fillRect: () => undefined,
        getImageData: () => ({ data: new Uint8ClampedArray(64).fill(255) }),
      }),
      toBlob: (cb: (b: Blob) => void, tipo: string) => cb(new Blob(["tela"], { type: tipo })),
    };
    return c as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  __zerarWorkerDasCopiasParaTeste();
});

function ligarWorker() {
  vi.stubGlobal("Worker", WorkerFalso);
  vi.stubGlobal("createImageBitmap", () => Promise.resolve({}));
  class OffscreenCanvasFalso {
    convertToBlob() {
      return Promise.resolve(new Blob());
    }
  }
  vi.stubGlobal("OffscreenCanvas", OffscreenCanvasFalso);
}

describe("cópias no worker", () => {
  it("sem Worker nem OffscreenCanvas (jsdom, Safari 11): caminho de sempre", async () => {
    vi.stubGlobal("Image", imagemFalsa(4000, 3000));
    expect(temCopiasNoWorker()).toBe(false);
    const c = await prepararCopias(new Blob(["x"], { type: "image/jpeg" }));
    expect(c && (await ler(c.mini))).toBe("tela");
    expect(canvasDaTela).toBeGreaterThan(0);
  });

  it("com o worker: a tela não desenha, e os alvos e a qualidade são os mesmos", async () => {
    ligarWorker();
    vi.stubGlobal("Image", imagemFalsa(4000, 3000));
    responder = (m, w) => w.onmessage && w.onmessage({ data: { id: m.id, mini: new Blob(["worker-mini"], { type: "image/jpeg" }), media: new Blob(["worker-media"], { type: "image/jpeg" }) } });
    expect(temCopiasNoWorker()).toBe(true);
    const c = await prepararCopias(new Blob(["x"], { type: "image/jpeg" }));
    expect(c && (await ler(c.mini))).toBe("worker-mini");
    expect(c && c.media && (await ler(c.media))).toBe("worker-media");
    expect(c && [c.largura, c.altura]).toEqual([4000, 3000]);
    expect(canvasDaTela).toBe(0);
    expect(enviadas[0]).toMatchObject({
      largura: 4000,
      altura: 3000,
      alvoMini: tamanhoQueCabe(4000, 3000, LADO_MINIATURA),
      alvoMedia: tamanhoQueCabe(4000, 3000, LADO_MEDIA),
      checarTransparencia: false,
      qualidadeMini: 0.8,
      qualidadeMedia: 0.9,
    });
  });

  it("PNG pequeno: confere transparência e não pede a média", async () => {
    ligarWorker();
    vi.stubGlobal("Image", imagemFalsa(1080, 1350));
    responder = (m, w) => w.onmessage && w.onmessage({ data: { id: m.id, mini: new Blob(["png"], { type: "image/png" }), media: null } });
    const c = await prepararCopias(new Blob(["x"], { type: "image/png" }));
    expect(c && c.media).toBeNull();
    expect(enviadas[0]).toMatchObject({ checarTransparencia: true, alvoMedia: null });
  });

  it("tamanho diferente do <img> (orientação) ou erro no worker: faz pelo caminho de sempre", async () => {
    ligarWorker();
    vi.stubGlobal("Image", imagemFalsa(3000, 4000));
    responder = (m, w) => w.onmessage && w.onmessage({ data: { id: m.id, erro: "tamanho_diferente" } });
    const c = await prepararCopias(new Blob(["x"], { type: "image/jpeg" }));
    expect(c && (await ler(c.mini))).toBe("tela");
    expect(canvasDaTela).toBeGreaterThan(0);
  });

  it("worker que não carrega: o resto da sessão vai pelo caminho de sempre", async () => {
    ligarWorker();
    vi.stubGlobal("Image", imagemFalsa(2000, 2000));
    responder = (_m, w) => w.onerror && w.onerror(new Event("error"));
    const c = await prepararCopias(new Blob(["x"], { type: "image/jpeg" }));
    expect(c && (await ler(c.mini))).toBe("tela");
    expect(temCopiasNoWorker()).toBe(false);
  });
});
