/**
 * 26/09/2026: cota de "Storage Image Transformations" estourada (1.212 imagens
 * de origem contra 100 incluídas). Garante que nenhum código pede mais a
 * transformação de imagem do Storage e que a miniatura cai no original quando
 * a cópia leve não existe.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const assinarVarias = vi.fn();
const assinarUma = vi.fn();
const enviar = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: (caminhos: string[], expira: number, ...resto: unknown[]) => assinarVarias(bucket, caminhos, expira, ...resto),
        createSignedUrl: (caminho: string, expira: number, ...resto: unknown[]) => assinarUma(bucket, caminho, expira, ...resto),
        upload: (...args: unknown[]) => enviar(bucket, ...args),
      }),
    },
  },
}));

import {
  __zerarMiniaturasParaTeste,
  agendarMiniatura,
  caminhoDaMedia,
  caminhoDaMiniatura,
  definirAutoMiniaturas,
  ehCopiaReduzida,
  podeTerMiniatura,
  tamanhoQueCabe,
  urlLeve,
  urlsLevesEmLote,
} from "@/lib/miniaturas";
import { resolveFileUrl } from "@/lib/fileUrls";

const RAIZ = join(__dirname, "..", "..");

function arquivosDeCodigo(dir: string): string[] {
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (nome === "node_modules" || nome === "test" || nome.startsWith(".")) continue;
    const p = join(dir, nome);
    const st = statSync(p);
    if (st.isDirectory()) saida.push(...arquivosDeCodigo(p));
    else if (/\.(ts|tsx)$/.test(nome) && !/(_test|\.test|\.spec)\.(ts|tsx)$/.test(nome)) saida.push(p);
  }
  return saida;
}

describe("nenhum uso da transformação de imagem do Storage", () => {
  const arquivos = [...arquivosDeCodigo(join(RAIZ, "src")), ...arquivosDeCodigo(join(RAIZ, "supabase", "functions"))];

  it("varre src/ e supabase/functions/", () => {
    expect(arquivos.length).toBeGreaterThan(100);
  });

  it("sem opção transform em chamadas de Storage (download, createSignedUrl(s), getPublicUrl)", () => {
    const achados: string[] = [];
    // transform: { width | height | resize | quality | format ... } é a opção do Storage; transform: `translate...` (CSS) não casa.
    const opcaoDoStorage = /transform\s*:\s*(\{\s*(width|height|resize|quality|format)\b|[a-zA-Z_$][\w$]*\s*\?\s*\{\s*(width|height|resize|quality|format)\b)/;
    const repasse = /\{\s*transform\s*\}|transform\s*\?\s*\{\s*transform\b|\btransform\s*:\s*input\.transform\b/;
    for (const p of arquivos) {
      const texto = readFileSync(p, "utf8");
      texto.split("\n").forEach((linha, i) => {
        if (/^\s*(\*|\/\/)/.test(linha)) return;
        if (opcaoDoStorage.test(linha) || repasse.test(linha)) achados.push(`${relative(RAIZ, p)}:${i + 1}: ${linha.trim()}`);
      });
    }
    expect(achados).toEqual([]);
  });

  it("sem o endereço /render/image/ (transformação por URL)", () => {
    const achados = arquivos.filter((p) => readFileSync(p, "utf8").indexOf("/render/image/") >= 0).map((p) => relative(RAIZ, p));
    expect(achados).toEqual([]);
  });

  it("as funções reduzem pelo helper local (cópia do painel ou redução na função)", () => {
    const ler = (f: string) => readFileSync(join(RAIZ, "supabase", "functions", f, "index.ts"), "utf8");
    for (const f of ["estudio-arte", "agente-contexto", "agente-calendario", "mesa-foto"]) {
      expect(ler(f)).toContain('from "../_shared/imagem-reduzida.ts"');
    }
    const reduzida = readFileSync(join(RAIZ, "supabase", "functions", "_shared", "imagem-reduzida.ts"), "utf8");
    // O download da cópia e do original é o simples, sem segundo argumento.
    expect(reduzida).toContain("await db.storage.from(bucket).download(caminho);");
    expect(reduzida).not.toMatch(/\.download\([^)\n]*,/);
  });

  it("o Estúdio entrega a lâmina já na proporção sem reamostrar e recorta fora dela", () => {
    const estudio = readFileSync(join(RAIZ, "supabase", "functions", "estudio-arte", "index.ts"), "utf8");
    const corpo = estudio.slice(estudio.indexOf("async function laminaFinal("), estudio.indexOf("async function sha256Hex("));
    expect(corpo).toContain("Math.abs(d.largura / d.altura - alvo.largura / alvo.altura) < 0.01 && d.largura <= alvo.largura * 1.5");
    expect(corpo).toContain("await recortarNaProporcao(original, alvo.largura, alvo.altura, { folga: 1.5 })");
    expect(corpo).not.toContain("transform");
  });
});

describe("caminhos das cópias", () => {
  it("miniatura e média ficam ao lado do original, sem cópia de cópia", () => {
    expect(caminhoDaMiniatura("abc/fotos/1.png")).toBe("abc/fotos/1.png.mini.jpg");
    expect(caminhoDaMedia("abc/fotos/1.png")).toBe("abc/fotos/1.png.media.jpg");
    expect(caminhoDaMiniatura("abc/fotos/1.png.mini.jpg")).toBe("abc/fotos/1.png.mini.jpg");
    expect(ehCopiaReduzida("x/1.JPG.MEDIA.JPG")).toBe(true);
  });

  it("só imagem raster ganha cópia", () => {
    expect(podeTerMiniatura("a/b.jpg")).toBe(true);
    expect(podeTerMiniatura("a/b.webp")).toBe(true);
    expect(podeTerMiniatura("a/b.svg")).toBe(false);
    expect(podeTerMiniatura("a/b.gif")).toBe(false);
    expect(podeTerMiniatura("a/b.pdf")).toBe(false);
    expect(podeTerMiniatura("a/b.mp4")).toBe(false);
    expect(podeTerMiniatura("a/b.png.mini.jpg")).toBe(false);
    expect(podeTerMiniatura("a/sem-extensao", "image/png")).toBe(true);
    expect(podeTerMiniatura("a/b.bin", "image/gif")).toBe(false);
    expect(podeTerMiniatura("a/b.bin", "application/pdf")).toBe(false);
  });

  it("contain sem ampliar", () => {
    expect(tamanhoQueCabe(4032, 3024, 640)).toEqual({ largura: 640, altura: 480 });
    expect(tamanhoQueCabe(300, 200, 640)).toEqual({ largura: 300, altura: 200 });
  });
});

describe("URL leve: miniatura quando existe, original quando não", () => {
  beforeEach(() => {
    __zerarMiniaturasParaTeste();
    assinarVarias.mockReset();
    assinarUma.mockReset();
    enviar.mockReset();
  });
  afterEach(() => __zerarMiniaturasParaTeste());

  it("uma chamada assina a miniatura e o original, sem opção de transformação", async () => {
    assinarVarias.mockResolvedValue({
      data: [
        { path: "c1/a.jpg.mini.jpg", signedUrl: "https://x/mini", error: null },
        { path: "c1/a.jpg", signedUrl: "https://x/orig", error: null },
      ],
      error: null,
    });
    const r = await urlLeve("mesa", "c1/a.jpg");
    expect(r).toEqual({ url: "https://x/mini", miniatura: true });
    expect(assinarVarias).toHaveBeenCalledTimes(1);
    expect(assinarVarias.mock.calls[0]).toEqual(["mesa", ["c1/a.jpg.mini.jpg", "c1/a.jpg"], 3600]);
  });

  it("sem miniatura, entra o original (e a equipe agenda a cópia)", async () => {
    assinarVarias.mockResolvedValue({
      data: [
        { path: "c1/b.png.mini.jpg", signedUrl: null, error: "Either the object does not exist or you do not have access to it" },
        { path: "c1/b.png", signedUrl: "https://x/orig-b", error: null },
      ],
      error: null,
    });
    const r = await urlLeve("files", "c1/b.png");
    expect(r).toEqual({ url: "https://x/orig-b", miniatura: false });
  });

  it("original ilegível: erro, sem link quebrado", async () => {
    assinarVarias.mockResolvedValue({
      data: [
        { path: "c1/z.png.mini.jpg", signedUrl: null, error: "not found" },
        { path: "c1/z.png", signedUrl: null, error: "not found" },
      ],
      error: null,
    });
    await expect(urlLeve("files", "c1/z.png")).rejects.toThrow("URL indisponível");
  });

  it("SVG não procura miniatura", async () => {
    assinarVarias.mockResolvedValue({ data: [{ path: "c1/logo.svg", signedUrl: "https://x/svg", error: null }], error: null });
    const r = await urlLeve("mesa", "c1/logo.svg");
    expect(r.url).toBe("https://x/svg");
    expect(assinarVarias.mock.calls[0][1]).toEqual(["c1/logo.svg"]);
  });

  it("lote do Workspace: miniatura de quem tem, original de quem não tem", async () => {
    assinarVarias.mockResolvedValue({
      data: [
        { path: "client/1/a.jpg.mini.jpg", signedUrl: "https://x/a-mini", error: null },
        { path: "client/1/a.jpg", signedUrl: "https://x/a", error: null },
        { path: "client/1/b.jpg.mini.jpg", signedUrl: null, error: "not found" },
        { path: "client/1/b.jpg", signedUrl: "https://x/b", error: null },
      ],
      error: null,
    });
    const mapa = await urlsLevesEmLote("workspace", ["client/1/a.jpg", "client/1/b.jpg", "client/1/a.jpg"]);
    expect(mapa).toEqual({ "client/1/a.jpg": "https://x/a-mini", "client/1/b.jpg": "https://x/b" });
    expect(assinarVarias).toHaveBeenCalledTimes(1);
  });

  it("resolveFileUrl com miniatura passa pelo helper; sem miniatura assina o original sem opções", async () => {
    assinarVarias.mockResolvedValue({
      data: [
        { path: "c9/f.jpg.mini.jpg", signedUrl: "https://x/f-mini", error: null },
        { path: "c9/f.jpg", signedUrl: "https://x/f", error: null },
      ],
      error: null,
    });
    assinarUma.mockResolvedValue({ data: { signedUrl: "https://x/f-original" }, error: null });
    expect(await resolveFileUrl({ fileUrl: "files://c9/f.jpg", miniatura: true })).toBe("https://x/f-mini");
    expect(await resolveFileUrl({ fileUrl: "files://c9/f.jpg" })).toBe("https://x/f-original");
    expect(assinarUma.mock.calls[0]).toEqual(["files", "c9/f.jpg", 3600]);
  });

  it("cópias em segundo plano só com a equipe ligada", async () => {
    const buscar = vi.fn();
    vi.stubGlobal("fetch", buscar);
    agendarMiniatura("mesa", "c1/x.jpg", "https://x/orig");
    await new Promise((r) => setTimeout(r, 0));
    expect(buscar).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
