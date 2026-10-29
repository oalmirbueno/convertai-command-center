import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 29/10/2026 (dono): "os vídeos que estão no painel não parecem nada, eles têm que aparecer a capa" e "quando eu
 * seleciono um vídeo do Workspace na Mesa, ele já puxa aquele vídeo e consigo gerar mais vídeos a partir daquele,
 * como referência, como usar ou como editar".
 */

const mock = vi.hoisted(() => ({ assinar: vi.fn(), gravar: vi.fn(), auto: true }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { storage: { from: () => ({ createSignedUrls: mock.assinar }) } },
}));
vi.mock("@/lib/miniaturas", () => ({
  autoMiniaturasLigadas: () => mock.auto,
  caminhoDaMiniatura: (c: string) => `${c}.mini.jpg`,
}));
vi.mock("@/lib/mesa-videos/quadros", () => ({ gravarMiniaturaDoVideo: (...a: unknown[]) => mock.gravar(...a) }));

import { __zerarCapasParaTeste, capasDeVideoEmLote } from "@/lib/capaDoVideo";
import CapaDoVideo from "@/components/sistema/CapaDoVideo";

const ler = (c: string) => readFileSync(resolve(process.cwd(), c), "utf8");

beforeEach(() => {
  vi.clearAllMocks();
  __zerarCapasParaTeste();
  mock.auto = true;
  mock.gravar.mockResolvedValue(true);
});

describe("capa do vídeo", () => {
  it("uma chamada assina a capa e o vídeo; sem capa, a equipe grava em segundo plano", async () => {
    mock.assinar.mockResolvedValue({
      data: [
        { path: "c/a.mp4.mini.jpg", signedUrl: "https://s/a.jpg", error: null },
        { path: "c/a.mp4", signedUrl: "https://s/a.mp4", error: null },
        { path: "c/b.mp4.mini.jpg", signedUrl: null, error: "Object not found" },
        { path: "c/b.mp4", signedUrl: "https://s/b.mp4", error: null },
      ],
      error: null,
    });
    const r = await capasDeVideoEmLote("workspace", ["c/a.mp4", "c/b.mp4", "c/a.mp4"]);
    expect(mock.assinar).toHaveBeenCalledTimes(1);
    expect(mock.assinar.mock.calls[0][0]).toEqual(["c/a.mp4.mini.jpg", "c/a.mp4", "c/b.mp4.mini.jpg", "c/b.mp4"]);
    expect(r["c/a.mp4"]).toEqual({ capa: "https://s/a.jpg", video: "https://s/a.mp4" });
    expect(r["c/b.mp4"]).toEqual({ capa: null, video: "https://s/b.mp4" });
    await waitFor(() => expect(mock.gravar).toHaveBeenCalledWith("workspace", "c/b.mp4"));
    expect(mock.gravar).toHaveBeenCalledTimes(1);
  });

  it("cliente (sem cópias leves) não grava capa", async () => {
    mock.auto = false;
    mock.assinar.mockResolvedValue({ data: [{ path: "c/b.mp4", signedUrl: "https://s/b.mp4", error: null }], error: null });
    await capasDeVideoEmLote("workspace", ["c/b.mp4"]);
    expect(mock.gravar).not.toHaveBeenCalled();
  });

  it("componente: imagem com capa; quadro do vídeo sem ela (nunca preload none com src); ícone sem nada", () => {
    const qc = new QueryClient();
    const m = (p: Record<string, unknown>) => render(h(QueryClientProvider, { client: qc }, h("div", { style: { position: "relative" } }, h(CapaDoVideo, p as never))));
    const { container, unmount } = m({ capa: "https://s/a.jpg", video: "https://s/a.mp4", nome: "Reel" });
    expect(container.querySelector("img")!.getAttribute("src")).toBe("https://s/a.jpg");
    expect(screen.getByAltText("Capa do vídeo Reel")).toBeTruthy();
    unmount();
    const v = m({ capa: null, video: "https://s/b.mp4" });
    const video = v.container.querySelector("video")!;
    expect(video.getAttribute("data-capa-do-video")).toBe("quadro");
    // jsdom não tem IntersectionObserver: carrega direto, já no quadro perto de 1 s.
    expect(video.getAttribute("src")).toBe("https://s/b.mp4#t=1");
    expect(video.getAttribute("preload")).toBe("metadata");
    v.unmount();
    const nada = m({ capa: null, video: null });
    expect(nada.container.querySelector("[data-capa-do-video='icone']")).toBeTruthy();
  });
});

describe("ligações", () => {
  it("quadro da capa perto de 1 s (o quadro 0 costuma ser preto)", async () => {
    const real = await vi.importActual<typeof import("@/lib/mesa-videos/quadros")>("@/lib/mesa-videos/quadros");
    expect(real.tempoDoQuadro("capa", 12)).toBe(1);
    expect(real.tempoDoQuadro("capa", 4)).toBe(0.4);
    expect(real.tempoDoQuadro("primeiro", 12)).toBe(0);
  });

  it("Workspace: vídeo usa a capa e não fica mais com preload none", () => {
    const ws = ler("src/pages/Workspace.tsx");
    expect(ws).toContain('capasDeVideoEmLote("workspace", vidTargets.map(n => n.storage_path!), 3600)');
    expect(ws).not.toContain('preload="none"');
    expect(ws).toContain("<CapaDoVideo capa={capaDoVideo}");
  });

  it("seletor do Workspace mostra a capa do vídeo", () => {
    expect(ler("src/components/laboratorio/no/EscolherDocumentos.tsx")).toContain('<CapaDoVideo bucket="workspace" caminho={n.storage_path} nome={n.name} />');
  });

  it("peça de vídeo: aba A partir deste vídeo com o vídeo da peça, a pauta e a volta para a prancheta", () => {
    const e = ler("src/components/mesa/EstudioDeVideoDaPauta.tsx");
    expect(e).toContain('{ id: "apartir", nome: "A partir deste vídeo", icone: Repeat2 }');
    expect(e).toContain("<ContinuarVideo key={atual.id} videoInicial={atual.id} taskId={item.id}");
    expect(e).toContain('aoAPartir={() => setAba("apartir")}');
    expect(ler("src/components/mesa/PecaDeVideoDaPauta.tsx")).toContain("data-a-partir-deste-video");
  });

  it("nova versão: a abertura do vídeo vira o primeiro quadro; continuar e transição levam a pauta", () => {
    const c = ler("src/components/mesa-videos/ContinuarVideo.tsx");
    expect(c).toContain('{ valor: "variar", rotulo: "Nova versão" }');
    expect(c).toContain('quadroDoVideoNoStorage(clientId, a.storage_bucket, a.storage_path, "capa")');
    expect(c.split("...daPauta").length - 1).toBe(3);
    const g = ler("supabase/functions/mesa-videos/geracao.ts");
    expect(g.split("...(taskId ? { extras: { task_id: taskId } } : {})").length - 1).toBe(2);
    expect(g).toContain("async function pautaDoPedido(");
  });
});
