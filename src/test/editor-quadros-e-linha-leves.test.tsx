import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Editor de vídeo leve (EX-03 e EX-12, 30/09).
 * - Quadros: o mesmo <video> escondido é reaproveitado por URL (antes, um
 *   novo por quadro: arquivo baixado de novo a cada miniatura); pedido que
 *   saiu da tela antes da vez não roda nem vai para o cache.
 * - URLs das fontes: cada fonte com a própria assinatura; somar outra não
 *   troca a URL das que já estavam (o Player não recarrega).
 * - Linha do tempo: arrastar não reinstala ouvintes da janela e só o clipe
 *   arrastado redesenha.
 */

const assinar = vi.hoisted(() => ({ lote: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: (caminhos: string[], expira: number) => assinar.lote(bucket, caminhos, expira),
      }),
    },
  },
}));

const rotulos = vi.hoisted(() => ({ chamadas: 0 }));
vi.mock("@/lib/editor/apelidos", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  const rotuloDoClipe = real.rotuloDoClipe as (...a: unknown[]) => string;
  return {
    ...real,
    rotuloDoClipe: (...a: unknown[]) => {
      rotulos.chamadas += 1;
      return rotuloDoClipe(...a);
    },
  };
});

import { __zerarQuadrosParaTeste, extrairQuadro } from "@/lib/editor/quadros";
import { criarRelogio, useUrlsDasFontes } from "@/components/mesa-edicao/editor/apoio";
import LinhaDoTempo from "@/components/mesa-edicao/editor/LinhaDoTempo";
import { clipeNovo, projetoDosTakes, type ProjetoDeEdicao } from "../../supabase/functions/_shared/projeto-de-edicao";

// ------------------------------------------------------------------ vídeo e canvas simulados

type VideoFalso = {
  src: string;
  readyState: number;
  duration: number;
  videoWidth: number;
  videoHeight: number;
  crossOrigin: string;
  muted: boolean;
  preload: string;
  currentTime: number;
  saltos: number[];
  addEventListener: (ev: string, f: () => void) => void;
  removeEventListener: (ev: string, f: () => void) => void;
  setAttribute: () => void;
  removeAttribute: (nome: string) => void;
  load: () => void;
};

let videos: VideoFalso[] = [];
let falharSalto = false;

function videoFalso(): VideoFalso {
  const ouvintes: Record<string, Array<() => void>> = {};
  const disparar = (ev: string) => (ouvintes[ev] || []).slice().forEach((f) => f());
  let src = "";
  let tempo = 0;
  const v: VideoFalso = {
    get src() {
      return src;
    },
    set src(valor: string) {
      src = valor;
      if (valor) {
        setTimeout(() => {
          v.readyState = 2;
          disparar("loadeddata");
        }, 0);
      }
    },
    readyState: 0,
    duration: 60,
    videoWidth: 1080,
    videoHeight: 1920,
    crossOrigin: "",
    muted: false,
    preload: "",
    get currentTime() {
      return tempo;
    },
    set currentTime(t: number) {
      tempo = t;
      v.saltos.push(t);
      setTimeout(() => disparar(falharSalto ? "error" : "seeked"), 0);
    },
    saltos: [],
    addEventListener: (ev, f) => {
      (ouvintes[ev] = ouvintes[ev] || []).push(f);
    },
    removeEventListener: (ev, f) => {
      ouvintes[ev] = (ouvintes[ev] || []).filter((x) => x !== f);
    },
    setAttribute: () => undefined,
    removeAttribute: (nome) => {
      if (nome === "src") src = "";
    },
    load: () => undefined,
  };
  return v;
}

const criarOriginal = document.createElement.bind(document);

beforeEach(() => {
  videos = [];
  falharSalto = false;
  __zerarQuadrosParaTeste();
  assinar.lote.mockReset();
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
    if (tag === "video") {
      const v = videoFalso();
      videos.push(v);
      return v as unknown as HTMLVideoElement;
    }
    if (tag === "canvas") {
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => undefined }),
        toDataURL: () => "data:image/jpeg;base64,QUJD",
      } as unknown as HTMLCanvasElement;
    }
    return criarOriginal(tag);
  }) as typeof document.createElement);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("quadros: vídeo reaproveitado por URL", () => {
  it("vários quadros do mesmo vídeo usam um elemento só, em ordem", async () => {
    const tempos = [1.02, 5.02, 9.02, 13.02, 17.02, 21.02];
    const quadros = await Promise.all(tempos.map((t) => extrairQuadro("https://x/a.mp4", t, { largura: 120 })));
    expect(quadros.every((q) => !!q && q.dataUrl.indexOf("data:image/jpeg") === 0)).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`[EX-03] ${tempos.length} quadros do mesmo vídeo: elementos de vídeo criados=${videos.length} (antes: ${tempos.length})`);
    expect(videos.length).toBe(1);
    expect(videos[0].saltos).toEqual(tempos);
    expect(quadros.map((q) => q && q.tempo_s)).toEqual(tempos);
  });

  it("a reserva guarda no máximo 2 vídeos; o terceiro URL solta o mais antigo", async () => {
    await extrairQuadro("https://x/a.mp4", 1, {});
    await extrairQuadro("https://x/b.mp4", 1, {});
    await extrairQuadro("https://x/c.mp4", 1, {});
    expect(videos.length).toBe(3);
    expect(videos[0].src).toBe("");
    expect(videos[1].src).toBe("https://x/b.mp4");
    await extrairQuadro("https://x/b.mp4", 2, {});
    expect(videos.length).toBe(3);
  });

  it("o vídeo parado é solto depois de 10 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await extrairQuadro("https://x/a.mp4", 1, {});
    expect(videos[0].src).toBe("https://x/a.mp4");
    vi.advanceTimersByTime(9_000);
    expect(videos[0].src).toBe("https://x/a.mp4");
    vi.advanceTimersByTime(1_500);
    expect(videos[0].src).toBe("");
  });

  it("pedido cancelado antes da vez não roda e não vai para o cache", async () => {
    let vivo = false;
    const cancelado = await extrairQuadro("https://x/a.mp4", 3.02, { cancelado: () => !vivo });
    expect(cancelado).toBeNull();
    expect(videos.length).toBe(0);
    vivo = true;
    const lido = await extrairQuadro("https://x/a.mp4", 3.02, { cancelado: () => !vivo });
    expect(lido && lido.tempo_s).toBe(3.02);
    expect(videos.length).toBe(1);
  });

  it("vídeo reaproveitado que falha no salto tenta uma vez com um vídeo novo", async () => {
    await extrairQuadro("https://x/a.mp4", 1, {});
    falharSalto = true;
    const q = await extrairQuadro("https://x/a.mp4", 2, {});
    expect(q).toBeNull();
    expect(videos.length).toBe(2);
    expect(videos[0].src).toBe("");
  });
});

// ------------------------------------------------------------------ URLs das fontes

function projetoCom(n: number): ProjetoDeEdicao {
  const takes = Array.from({ length: n }).map((_, k) => ({
    id: `t${k}`,
    nome: `IMG_${k}.MOV`,
    tipo: "bruto" as const,
    storage_bucket: "mesa",
    storage_path: `c/v${k}.mp4`,
    cena_ref: null,
    melhor: true,
    duracao_s: 10,
    largura: 1080,
    altura: 1920,
  }));
  return projetoDosTakes({ titulo: "P", fps: 25, takes, agora: "2026-09-30T12:00:00.000Z" });
}

describe("URLs das fontes: uma assinatura por fonte", () => {
  it("somar uma fonte não troca a URL das outras nem esvazia a lista", async () => {
    let versao = 0;
    assinar.lote.mockImplementation((_b: string, caminhos: string[]) => {
      versao += 1;
      return Promise.resolve({ data: caminhos.map((p) => ({ path: p, signedUrl: `https://x/${p}?token=${versao}`, error: null })), error: null });
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const um = projetoCom(1);
    const dois = projetoCom(2);
    const { result, rerender } = renderHook(({ p }: { p: ProjetoDeEdicao }) => useUrlsDasFontes(p), {
      initialProps: { p: um },
      wrapper: ({ children }) => h(QueryClientProvider, { client: qc }, children),
    });
    await waitFor(() => expect(Object.keys(result.current).length).toBe(1));
    const chaveA = Object.keys(um.fontes)[0];
    const antes = result.current[chaveA];
    expect(assinar.lote).toHaveBeenCalledTimes(1);
    rerender({ p: dois });
    // Enquanto assina a nova, a que já estava continua na lista.
    expect(result.current[chaveA]).toBe(antes);
    await waitFor(() => expect(Object.keys(result.current).length).toBe(2));
    expect(result.current[chaveA]).toBe(antes);
    // Só a fonte nova foi assinada.
    expect(assinar.lote).toHaveBeenCalledTimes(2);
    expect(assinar.lote.mock.calls[1][1]).toEqual(["c/v1.mp4"]);
    // Voltar (desfazer) não assina nada e devolve o mesmo objeto de antes quando nada mudou.
    const objeto = result.current;
    rerender({ p: dois });
    expect(result.current).toBe(objeto);
  });

  it("as fontes pedidas juntas vão numa chamada só por bucket", async () => {
    assinar.lote.mockImplementation((_b: string, caminhos: string[]) =>
      Promise.resolve({ data: caminhos.map((p) => ({ path: p, signedUrl: `https://x/${p}`, error: null })), error: null }),
    );
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useUrlsDasFontes(projetoCom(4)), {
      wrapper: ({ children }) => h(QueryClientProvider, { client: qc }, children),
    });
    await waitFor(() => expect(Object.keys(result.current).length).toBe(4));
    expect(assinar.lote).toHaveBeenCalledTimes(1);
    expect(assinar.lote.mock.calls[0][1].length).toBe(4);
  });
});

// ------------------------------------------------------------------ linha do tempo

function projetoGrande(): ProjetoDeEdicao {
  const base = projetoCom(2);
  const fontes = Object.keys(base.fontes);
  const faixa = (id: string, tipo: "video" | "texto", n: number, comFonte: boolean) => ({
    id,
    tipo,
    nome: id,
    muda: false,
    oculta: false,
    clipes: Array.from({ length: n }).map((_, k) =>
      clipeNovo({ id: `${id}-${k}`, inicio_s: k * 2, entrada_s: 0, saida_s: 1.8, fonte: comFonte ? fontes[k % fontes.length] : null, texto: comFonte ? null : `Texto ${k}` }),
    ),
  });
  return { ...base, duracao_s: 120, trilhas: [faixa("v", "video", 40, true), faixa("t", "texto", 40, false)] } as ProjetoDeEdicao;
}

describe("linha do tempo: arrastar é leve", () => {
  it("60 movimentos de arrasto: os ouvintes da janela não são reinstalados e só o clipe arrastado redesenha", () => {
    const projeto = projetoGrande();
    const onOps = vi.fn();
    const { container } = render(
      h(LinhaDoTempo, { projeto, relogio: criarRelogio(0), px: 8, setPx: vi.fn(), selecao: [], onSelecionar: vi.fn(), onOps, urls: {} }),
    );
    const adicionar = vi.spyOn(window, "addEventListener");
    rotulos.chamadas = 0;
    const clipe = container.querySelector('[data-clipe="t-10"]') as HTMLElement;
    fireEvent.mouseDown(clipe, { clientX: 500, clientY: 100 });
    for (let k = 1; k <= 60; k++) fireEvent.mouseMove(window, { clientX: 500 + k * 2, clientY: 100 });
    fireEvent.mouseUp(window, { clientX: 620, clientY: 100 });
    // eslint-disable-next-line no-console
    console.log(`[EX-12] 60 movimentos: addEventListener na janela=${adicionar.mock.calls.length} clipes redesenhados=${rotulos.chamadas} (medido em 30/09 no código anterior: 373 e 4.960)`);
    expect(adicionar.mock.calls.length).toBeLessThanOrEqual(1);
    // Um desenho do clipe arrastado por movimento (mais o soltar e a volta).
    expect(rotulos.chamadas).toBeLessThanOrEqual(64);
    expect(onOps).toHaveBeenCalledTimes(1);
    expect(onOps.mock.calls[0][0][0]).toMatchObject({ op: "mover", clipe: "t-10" });
  });
});
