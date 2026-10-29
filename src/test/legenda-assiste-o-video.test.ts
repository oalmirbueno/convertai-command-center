import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 29/10/2026 (dono): "tem vídeo que vou subir que não está no roteiro, então ele tem que assistir o vídeo e entender
 * para gerar a legenda com base no vídeo".
 */

const mock = vi.hoisted(() => ({ funcao: vi.fn() }));
vi.mock("@/lib/mesa/api", () => ({ chamarFuncao: (...a: unknown[]) => mock.funcao(...a) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { storage: { from: () => ({ createSignedUrl: vi.fn() }) } } }));

import { assistirOVideo, FRACOES_DO_VIDEO, legendaDoVideo } from "@/components/mesa/videoDaPauta";

const ler = (c: string) => readFileSync(resolve(process.cwd(), c), "utf8");

beforeEach(() => {
  vi.clearAllMocks();
  mock.funcao.mockResolvedValue({ legenda: "x", hashtags: [] });
});

describe("tela", () => {
  it("com o vídeo assistido, manda os quadros e a fala; sem quadros, segue pelo roteiro", async () => {
    await legendaDoVideo("c", "t", { quadros: ["c/video/quadros/a.png"], fala: "Olá" });
    expect(mock.funcao).toHaveBeenLastCalledWith("estudio-arte", { acao: "legenda_do_video", client_id: "c", task_id: "t", video: { quadros: ["c/video/quadros/a.png"], fala: "Olá" } });
    await legendaDoVideo("c", "t", { quadros: [], fala: "" });
    expect(mock.funcao).toHaveBeenLastCalledWith("estudio-arte", { acao: "legenda_do_video", client_id: "c", task_id: "t" });
    await legendaDoVideo("c", "t", null);
    expect(mock.funcao).toHaveBeenLastCalledWith("estudio-arte", { acao: "legenda_do_video", client_id: "c", task_id: "t" });
  });

  it("4 quadros ao longo do vídeo; navegador sem vídeo desiste na hora (a legenda segue pelo roteiro)", async () => {
    expect(FRACOES_DO_VIDEO).toHaveLength(4);
    await expect(assistirOVideo("c", { bucket: "workspace", caminho: "c/v.mp4" })).rejects.toThrow(/não assiste/);
  });

  it("entrega e peça assistem antes de escrever", () => {
    const entrega = ler("src/components/mesa/EntregaDoVideoDaPauta.tsx");
    expect(entrega).toContain('"Escrever pelo vídeo"');
    expect(entrega).toContain("const l = await legendaDoVideo(clientId, item.id, assistido);");
    expect(entrega).toContain("O que o vídeo mostra: {visto}");
    expect(ler("src/components/mesa/PecaDeVideoDaPauta.tsx")).toContain("const assistido = await assistirOVideo(clientId, video).catch(() => null);");
  });
});

describe("servidor", () => {
  const s = ler("supabase/functions/estudio-arte/index.ts");
  it("só quadros da pasta do cliente, no máximo 6, lidos pelo modelo de leitura com a fala", () => {
    expect(s).toContain("const pasta = `${clientId}/video/quadros/`;");
    expect(s).toContain('.filter((q) => q.indexOf(pasta) === 0 && q.indexOf("..") < 0)');
    expect(s).toContain(".slice(0, 6);");
    expect(s).toContain('const leitor = await modeloDoPapel("leitura");');
  });
  it("o vídeo manda; a pauta é só a intenção; sem vídeo, o roteiro como antes", () => {
    expect(s).toContain("Post de Reels do VÍDEO ENVIADO");
    expect(s).toContain("Pauta (intenção; use só o que combinar com o vídeo)");
    expect(s).toContain("const cards = assistido ? cardsDoVideoAssistido(assistido) : roteiro ? roteiro.cards : [];");
    expect(s).toContain("pelo_video: !!assistido,");
    expect(s).toContain("custo_usd: arred(num(e.custo_usd) + (assistido ? assistido.custo_usd : 0)),");
  });
});
