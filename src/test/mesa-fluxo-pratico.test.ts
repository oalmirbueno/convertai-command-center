import { beforeEach, describe, expect, it, vi } from "vitest";
import { referenciaAprovadaMaisRecente } from "../../supabase/functions/mesa-foto/modulos/referencia-aprovada";
import { entregarEEnviar } from "@/components/mesa-foto/agendaApi";

const api = vi.hoisted(() => ({ chamarFuncao: vi.fn(), enviarParaAprovacao: vi.fn() }));
vi.mock("@/lib/mesa/api", () => api);
vi.mock("@/lib/mesa/entregaEmPartes", () => ({ repetirEntregaEmPartes: (acao: () => Promise<unknown>) => acao() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const foto = (id: string, derivada_de: string | null, aprovada: boolean, criado_em = "2026-10-01") => ({ id, derivada_de, aprovada, criado_em, client_id: "cliente", ativa: true });
describe("Produto usa a versão aprovada mais recente", () => {
  it("promove tratamento encadeado e mantém a identidade da linhagem", () => {
    const fotos = [foto("original", null, false), foto("luz", "original", true), foto("upscale", "luz", true, "2026-10-05")];
    expect(referenciaAprovadaMaisRecente(fotos, "original", "cliente")?.id).toBe("upscale");
    expect(fotos[0].id).toBe("original");
  });
  it("aprovar uma versão antiga não rebaixa a referência atual", () => {
    const fotos = [foto("original", null, false), foto("antiga", "original", true), foto("nova", "original", true, "2026-10-06")];
    expect(referenciaAprovadaMaisRecente(fotos, "antiga", "cliente")?.id).toBe("nova");
  });
  it("não usa rejeitada, inativa, outro produto ou outro cliente", () => {
    const fotos = [foto("original", null, false), foto("aprovada", "original", true), foto("pendente", "original", false, "2026-10-06"), { ...foto("arquivada", "original", true, "2026-10-07"), ativa: false }, foto("outro", null, true, "2026-10-08"), { ...foto("externa", "original", true, "2026-10-09"), client_id: "outro" }];
    expect(referenciaAprovadaMaisRecente(fotos, "original", "cliente")?.id).toBe("aprovada");
    expect(referenciaAprovadaMaisRecente(fotos, "original", "outro")).toBeNull();
  });
  it("linhagem ausente ou ciclo não trava a aprovação", () => {
    expect(referenciaAprovadaMaisRecente([], "faltando", "cliente")).toBeNull();
    expect(() => referenciaAprovadaMaisRecente([foto("a", "b", true), foto("b", "a", true)], "a", "cliente")).not.toThrow();
  });
});

beforeEach(() => vi.clearAllMocks());
const post = { id: "post", status: "entregue", file_ids: ["arquivo"], entrega_status: null };
describe("Entrega de fotos confirmada pelo servidor", () => {
  it.each([[], [{ trabalho_id: "post", ok: false, erro: "Legenda obrigatória" }], [{ trabalho_id: "outro", ok: true }]])("recusa falso sucesso: %j", async (resposta) => {
    api.enviarParaAprovacao.mockResolvedValue(resposta);
    await expect(entregarEEnviar(post)).rejects.toThrow();
    expect(api.chamarFuncao).not.toHaveBeenCalled();
  });
  it("confirma apenas o resultado do post solicitado", async () => {
    api.enviarParaAprovacao.mockResolvedValue([{ trabalho_id: "outro", ok: false }, { trabalho_id: "post", ok: true, estado: "aguardando_cliente" }]);
    expect(await entregarEEnviar(post)).toMatchObject({ entregue: true, enviado: true, resultado: { trabalho_id: "post", ok: true } });
  });
  it("falha de entrega não envia um arquivo incompleto", async () => {
    api.chamarFuncao.mockRejectedValue(new Error("Arquivo não preparado"));
    await expect(entregarEEnviar({ ...post, status: "pronto", file_ids: [] })).rejects.toThrow("Arquivo não preparado");
    expect(api.enviarParaAprovacao).not.toHaveBeenCalled();
  });
});
