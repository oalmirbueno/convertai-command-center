import { describe, it, expect, vi } from "vitest";
vi.mock("../../supabase/functions/_shared/imagem-reduzida.ts", () => ({ reduzidaSemTransformacao: vi.fn(async () => null) }));
import { caminhosDoCliente, documentosDoPlano, materiaisDoPlano, recuperarMateriais } from "../../supabase/functions/agente-contexto/modulos/materiais-do-plano";

describe("materiais do contexto", () => {
  it("somente aceita imagens da pasta de pedidos do próprio cliente", () => {
    expect(caminhosDoCliente("a", ["a/pedidos/foto.png", "b/pedidos/foto.png", "a/pedidos/../b/foto.png", "a/pedidos/%2e%2e/foto", "a/pedidos/foto.png", "a/outros/foto.png"])).toEqual(["a/pedidos/foto.png"]);
  });
  it("informa leitura parcial e mantém o teto total de documentos", () => {
    const r = documentosDoPlano({ lidos: [{ nome: "longo.txt", tipo: "texto", texto: "a".repeat(100_000) }, { nome: "outro.txt", tipo: "texto", texto: "b".repeat(5000) }] });
    expect(r.lidos.reduce((n, a) => n + a.texto.length, 0)).toBe(90_000);
    expect(r.cortados).toContain("longo.txt"); expect(r.cortados).toContain("outro.txt");
  });
  it("imagem indisponível nunca é reportada como lida", async () => {
    const r = await materiaisDoPlano({} as any, "a", "equipe", { anexos: ["a/pedidos/foto.png"] });
    expect(r.imagens).toEqual([]); expect(r.avisos).toEqual(["Imagem 1 não lida. Reenvie em tamanho menor."]);
  });
  it("não recupera documentos de outro cliente mesmo que referenciados na conversa", async () => {
    const download = vi.fn();
    const db = { storage: { from: () => ({ download }) } };
    const r = await recuperarMateriais(db as any, "a", [{ anexos: [{ tipo: "arquivos_lidos", caminho_texto: "b/pedidos/contexto-leitura-123.json" }] }]);
    expect(r).toBe(""); expect(download).not.toHaveBeenCalled();
  });
});
