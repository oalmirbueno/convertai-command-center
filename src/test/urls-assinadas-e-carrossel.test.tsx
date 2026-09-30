import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";

/**
 * Achados E05 e E10 (30/09):
 * - E05: a pré-carga do carrossel e a prévia assinavam o mesmo original cada
 *   uma com um token (outra URL) e o navegador baixava duas vezes (101
 *   assinaturas de uma lâmina num dia). resolveFileUrl agora guarda a
 *   promessa da assinatura; e o carrossel não volta para a lâmina 1 quando a
 *   tela de cima renderiza de novo com os mesmos arquivos.
 * - E10: pasta só de leitura (mesa/biblioteca, mesa/globais) não entra na
 *   fila de miniatura (a RLS recusaria depois de baixar o original).
 */

const assinarUma = vi.fn();
const assinarVarias = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: (caminho: string, expira: number) => assinarUma(bucket, caminho, expira),
        createSignedUrls: (caminhos: string[], expira: number) => assinarVarias(bucket, caminhos, expira),
        upload: vi.fn(async () => ({ error: null })),
        download: vi.fn(async () => ({ data: null, error: null })),
      }),
    },
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
    functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
  },
}));

import { __zerarUrlsAssinadasParaTeste, esquecerUrlsAssinadas, resolveFileUrl } from "@/lib/fileUrls";
import { __zerarMiniaturasParaTeste, agendarMiniatura, definirAutoMiniaturas, definirDonoDasUrls, urlLeve } from "@/lib/miniaturas";
import { prefetchImages } from "@/components/shared/FilePreviewContent";
import CarouselSlider from "@/components/shared/CarouselSlider";

let contador = 0;
function assinaturaNova() {
  assinarUma.mockImplementation(async (bucket: string, caminho: string) => {
    contador += 1;
    return { data: { signedUrl: `https://x/${bucket}/${caminho}?token=${contador}` }, error: null };
  });
}

beforeEach(() => {
  __zerarUrlsAssinadasParaTeste();
  __zerarMiniaturasParaTeste();
  assinarUma.mockReset();
  assinarVarias.mockReset();
  contador = 0;
  assinaturaNova();
  assinarVarias.mockImplementation(async (_b: string, caminhos: string[]) => ({
    data: caminhos.map((p) => ({ path: p, signedUrl: `https://x/leve/${p}`, error: null })),
    error: null,
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("E05: uma assinatura por original enquanto a URL vale", () => {
  it("duas chamadas no mesmo instante dividem uma assinatura e recebem a mesma URL", async () => {
    const [a, b] = await Promise.all([
      resolveFileUrl({ fileUrl: "files://c9/f.jpg" }),
      resolveFileUrl({ fileUrl: "files://c9/f.jpg", storageBucket: "files", storagePath: "c9/f.jpg", expiresIn: 3600 }),
    ]);
    expect(assinarUma).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    // Depois, a mesma URL volta sem assinar de novo.
    expect(await resolveFileUrl({ fileUrl: "files://c9/f.jpg" })).toBe(a);
    expect(assinarUma).toHaveBeenCalledTimes(1);
  });

  it("falha não fica guardada: continua lançando e o tentar de novo assina outra vez", async () => {
    assinarUma.mockResolvedValueOnce({ data: null, error: { message: "Object not found" } });
    await expect(resolveFileUrl({ fileUrl: "files://c9/nao.jpg" })).rejects.toMatchObject({ message: "Object not found" });
    assinarUma.mockResolvedValueOnce({ data: { signedUrl: null }, error: null });
    await expect(resolveFileUrl({ fileUrl: "files://c9/nao.jpg" })).rejects.toThrow("URL indisponível");
    expect(await resolveFileUrl({ fileUrl: "files://c9/nao.jpg" })).toMatch(/^https:\/\/x\/files\/c9\/nao\.jpg\?token=/);
    expect(assinarUma).toHaveBeenCalledTimes(3);
  });

  it("validade curta (até 300 s) não usa o guardado; 15 min guarda só 10 min", async () => {
    await resolveFileUrl({ fileUrl: "files://c9/a.pdf", expiresIn: 300 });
    await resolveFileUrl({ fileUrl: "files://c9/a.pdf", expiresIn: 300 });
    expect(assinarUma).toHaveBeenCalledTimes(2);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    const primeira = await resolveFileUrl({ fileUrl: "files://c9/contrato.pdf", expiresIn: 15 * 60 });
    vi.setSystemTime(new Date("2026-09-30T12:09:59Z"));
    expect(await resolveFileUrl({ fileUrl: "files://c9/contrato.pdf", expiresIn: 15 * 60 })).toBe(primeira);
    vi.setSystemTime(new Date("2026-09-30T12:10:01Z"));
    expect(await resolveFileUrl({ fileUrl: "files://c9/contrato.pdf", expiresIn: 15 * 60 })).not.toBe(primeira);
    // Validade diferente é outra entrada (não devolve URL que vence antes do pedido).
    const hora = await resolveFileUrl({ fileUrl: "files://c9/contrato.pdf", expiresIn: 3600 });
    expect(hora).not.toBe(primeira);
    expect(assinarUma.mock.calls.map((c) => c[2])).toEqual([300, 300, 900, 900, 3600]);
  });

  it("guarda até 40 min, mesmo com validade longa", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    const primeira = await resolveFileUrl({ fileUrl: "files://c9/g.jpg", expiresIn: 24 * 3600 });
    vi.setSystemTime(new Date("2026-09-30T12:39:00Z"));
    expect(await resolveFileUrl({ fileUrl: "files://c9/g.jpg", expiresIn: 24 * 3600 })).toBe(primeira);
    vi.setSystemTime(new Date("2026-09-30T12:40:01Z"));
    expect(await resolveFileUrl({ fileUrl: "files://c9/g.jpg", expiresIn: 24 * 3600 })).not.toBe(primeira);
  });

  it("URL direta e texto seguem como antes, sem assinar", async () => {
    expect(await resolveFileUrl({ fileUrl: "https://cdn.exemplo.com/a.png" })).toBe("https://cdn.exemplo.com/a.png");
    expect(await resolveFileUrl({ fileUrl: "" })).toBe("");
    expect(assinarUma).not.toHaveBeenCalled();
  });

  it("troca de usuário na aba esquece tudo (originais e miniaturas); o mesmo usuário mantém", async () => {
    assinarVarias.mockImplementation(async (_b: string, caminhos: string[]) => {
      contador += 1;
      return { data: caminhos.map((p) => ({ path: p, signedUrl: `https://x/leve/${p}?t=${contador}`, error: null })), error: null };
    });
    definirDonoDasUrls("u1");
    const original = await resolveFileUrl({ fileUrl: "files://c9/h.jpg" });
    const leve = (await urlLeve("files", "c9/h.jpg")).url;
    definirDonoDasUrls("u1");
    expect(await resolveFileUrl({ fileUrl: "files://c9/h.jpg" })).toBe(original);
    expect((await urlLeve("files", "c9/h.jpg")).url).toBe(leve);
    definirDonoDasUrls(null);
    expect(await resolveFileUrl({ fileUrl: "files://c9/h.jpg" })).not.toBe(original);
    expect((await urlLeve("files", "c9/h.jpg")).url).not.toBe(leve);
    const outra = await resolveFileUrl({ fileUrl: "files://c9/h.jpg" });
    definirDonoDasUrls("u2");
    expect(await resolveFileUrl({ fileUrl: "files://c9/h.jpg" })).not.toBe(outra);
    esquecerUrlsAssinadas();
    expect(assinarUma).toHaveBeenCalledTimes(3);
  });

  it("a pré-carga do carrossel e a prévia visível usam a mesma URL (um download só)", async () => {
    const criadas: string[] = [];
    class ImagemFalsa {
      decoding = "";
      set src(v: string) { criadas.push(v); }
    }
    vi.stubGlobal("Image", ImagemFalsa);
    prefetchImages([{ fileUrl: "files://c1/1-carrossel.png", storageBucket: "files", storagePath: "c1/1-carrossel.png" }]);
    const visivel = await resolveFileUrl({ fileUrl: "files://c1/1-carrossel.png", storageBucket: "files", storagePath: "c1/1-carrossel.png", expiresIn: 3600 });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(assinarUma).toHaveBeenCalledTimes(1);
    expect(criadas).toEqual([visivel]);
    // Texto solto (o formato antigo) continua aceito.
    prefetchImages(["files://c1/1-carrossel.png", "files://c1/doc.pdf"]);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(assinarUma).toHaveBeenCalledTimes(1);
  });
});

describe("E05: o carrossel não volta para a lâmina 1 quando a tela de cima renderiza de novo", () => {
  const laminas = () => [
    { id: "f2", file_name: "2-carrossel.png", file_url: "files://c1/2-carrossel.png", storage_bucket: "files", storage_path: "c1/2-carrossel.png", mime_type: "image/png" },
    { id: "f3", file_name: "3-carrossel.png", file_url: "files://c1/3-carrossel.png", storage_bucket: "files", storage_path: "c1/3-carrossel.png", mime_type: "image/png" },
  ];
  const raiz = () => ({ id: "f1", file_name: "1-carrossel.png", file_url: "files://c1/1-carrossel.png", storage_bucket: "files", storage_path: "c1/1-carrossel.png", mime_type: "image/png" });

  it("mesmos arquivos em objetos novos mantêm a lâmina; arquivos diferentes voltam para a 1", async () => {
    vi.stubGlobal("Image", class { decoding = ""; src = ""; });
    const { rerender } = render(<CarouselSlider parent={raiz()} initialChildren={laminas()} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText("1/3")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Próximo"));
    expect(screen.getByText("2/3")).toBeTruthy();
    // A tela de cima relê (a cada ~30 s) e manda objetos novos com o mesmo conteúdo.
    rerender(<CarouselSlider parent={raiz()} initialChildren={laminas()} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText("2/3")).toBeTruthy();
    // Cada lâmina assinou uma vez só, mesmo com a pré-carga repetida.
    const porCaminho: Record<string, number> = {};
    for (const c of assinarUma.mock.calls) porCaminho[String(c[1])] = (porCaminho[String(c[1])] || 0) + 1;
    expect(Object.values(porCaminho).every((n) => n === 1)).toBe(true);
    // Outra lâmina entrou: recomeça da capa.
    const novas = laminas().concat([{ id: "f4", file_name: "4-carrossel.png", file_url: "files://c1/4-carrossel.png", storage_bucket: "files", storage_path: "c1/4-carrossel.png", mime_type: "image/png" }]);
    rerender(<CarouselSlider parent={raiz()} initialChildren={novas} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.getByText("1/4")).toBeTruthy();
  });
});

describe("E10: pasta só de leitura não entra na fila de miniatura", () => {
  it("mesa/biblioteca e mesa/globais ficam de fora; a pasta do cliente continua", async () => {
    const buscar = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal("fetch", buscar);
    definirAutoMiniaturas(true);
    agendarMiniatura("mesa", "biblioteca/fontes/abril-fatface/amostra.png", "https://x/amostra");
    agendarMiniatura("mesa", "globais/referencias/r1.jpg", "https://x/r1");
    await new Promise((r) => setTimeout(r, 0));
    expect(buscar).not.toHaveBeenCalled();
    agendarMiniatura("mesa", "22222222-2222-4222-8222-222222222222/foto/a.jpg", "https://x/a");
    await new Promise((r) => setTimeout(r, 0));
    expect(buscar).toHaveBeenCalledTimes(1);
    // O 2º argumento (sinal para cancelar acima do teto) veio da frente PERF-tela.
    expect(buscar.mock.calls[0][0]).toBe("https://x/a");
    // Outros buckets com a mesma primeira pasta seguem a regra de sempre.
    agendarMiniatura("files", "biblioteca/x.jpg", "https://x/files-bib");
    await new Promise((r) => setTimeout(r, 450));
    expect(buscar.mock.calls.map((c) => c[0])).toContain("https://x/files-bib");
    definirAutoMiniaturas(false);
  });
});
