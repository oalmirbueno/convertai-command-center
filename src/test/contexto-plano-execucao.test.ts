import { describe, it, expect, vi } from "vitest";
import { aplicarPlanoEmPassos, memoriaDosResultados, podeAplicarPlano } from "../../supabase/functions/agente-contexto/modulos/operacao-do-plano";
import { normalizarPlanoDoCliente, type DadosDoPlano } from "../../supabase/functions/agente-contexto/plano-do-cliente";
import type { AcaoGuardada } from "../../supabase/functions/_shared/acoes-do-agente";

const dados: DadosDoPlano = { hoje: "2026-10-07", projetos: [], marcos: [], tarefas: [], equipe: [], contexto: {} };
const plano = () => normalizarPlanoDoCliente({ plano: {
  projeto: { ref: "novo", nome: "Evento de inauguração", inicio: "2026-10-07", prazo: "2026-10-25", tipo: "marketing" },
  marcos: [{ ref: "mn1", titulo: "Divulgação", prazo: "2026-10-20" }],
  tarefas: [{ titulo: "Preparar vídeo convite", marco: "mn1", prazo: "2026-10-15", frente: "video", entrega: "video", prioridade: "high", descricao: "Usar o briefing enviado. Pronto: roteiro, CTA e cena final definidos." }],
} }, dados, "cliente", "teste")!;

describe("contexto: pedido, execução e continuidade", () => {
  it("conserva diferenciais e lacunas como listas e permite limpar só a lista solicitada", () => {
    const a = normalizarPlanoDoCliente({ contexto: { diferenciais: ["Entrega local", "Entrega local"], lacunas: [] } }, { ...dados, contexto: { lacunas: ["Data do evento"] } }, "cliente")!;
    expect(a.itens).toHaveLength(2);
    expect(a.contexto?.dados).toMatchObject({ "preencher_contexto:ctx_diferenciais": { valor: ["Entrega local"] }, "preencher_contexto:ctx_lacunas": { valor: [] } });
    expect(normalizarPlanoDoCliente({ contexto: { diferenciais: null, lacunas: null } }, dados, "cliente")).toBeNull();
  });
  it("executa ordem autorizada, mas não conversa, hipótese ou proposta", () => {
    expect(podeAplicarPlano(plano(), "executar", true)).toBe(true);
    for (const intencao of ["conversar", "propor", null]) expect(podeAplicarPlano(plano(), intencao, true)).toBe(false);
    expect(podeAplicarPlano(plano(), "executar", false)).toBe(false);
    expect(podeAplicarPlano(plano(), "executar", undefined)).toBe(false);
  });
  it("não aplica silenciosamente plano com recusas, excesso ou operação externa", () => {
    expect(podeAplicarPlano({ ...plano(), acima_do_teto: 1 }, "executar", true)).toBe(false);
    expect(podeAplicarPlano({ ...plano(), ignorados: ["p99"] }, "executar", true)).toBe(false);
    const acao = plano(); acao.itens[0].operacao = "publicar";
    expect(podeAplicarPlano(acao, "executar", true)).toBe(false);
  });
  it("grava cada resultado antes de continuar e recompõe o vínculo projeto/marco", async () => {
    const acao = plano();
    const ordem: string[] = [];
    const guardada: AcaoGuardada = { acao, mensagem: { id: "msg", client_id: "cliente", conversa_id: "conversa" }, gravar: async a => { ordem.push(`salvar:${a.resultados?.length}`); return a; } };
    const r = await aplicarPlanoEmPassos(guardada, async item => {
      ordem.push(item.ref);
      return { desfazer: item.ref === "pn1" ? { projeto_id: "projeto" } : item.ref === "mn1" ? { marco_id: "marco", projeto_id: "projeto" } : { tarefa_id: "tarefa", projeto_id: "projeto" } };
    }, { userId: "equipe", caminho: () => null });
    expect(ordem).toEqual(["pn1", "salvar:1", "mn1", "salvar:2", "tn1", "salvar:3"]);
    expect(r.terminou).toBe(true);
    expect(memoriaDosResultados(r.resultados).get("mn1")).toBe("marco");
  });
  it("retoma sem refazer um projeto já registrado", async () => {
    const acao = plano();
    acao.resultados = [{ ...acao.itens[0], ok: true, desfazer: { projeto_id: "existente" } }];
    const executor = vi.fn(async () => ({}));
    const r = await aplicarPlanoEmPassos({ acao, mensagem: { id: "msg", client_id: "cliente", conversa_id: null }, gravar: async a => a }, executor, { userId: "equipe", caminho: () => null });
    expect(executor.mock.calls).toHaveLength(2);
    expect(r.anexo.resultados).toHaveLength(3);
    expect(memoriaDosResultados(r.anexo.resultados).get("pn1")).toBe("existente");
  });
  it("não continua escrevendo quando o recibo falha", async () => {
    const executor = vi.fn(async () => ({}));
    await expect(aplicarPlanoEmPassos({ acao: plano(), mensagem: { id: "msg", client_id: "cliente", conversa_id: null }, gravar: async () => { throw new Error("falha de gravação"); } }, executor, { userId: "equipe", caminho: () => null })).rejects.toThrow("falha de gravação");
    expect(executor).toHaveBeenCalledTimes(1);
  });
});
