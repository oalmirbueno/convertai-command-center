import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { concluirPeriodoSemItens, type MensagemDoPeriodoSemProposta } from "../../supabase/functions/agente-calendario/modulos/pedido-vazio-do-periodo";

const pedido = {
  periodo: { inicio: "2026-10-21", fim: "2026-10-27" }, itensDoModelo: [],
  respostaDoModelo: "O período já está coberto pelo planejamento atual; não acrescentei pautas.",
  mensagem: "Prepare uma proposta de 21 a 27/10 sem substituir o que já existe.",
  anexosDoUsuario: [{ caminho: "cliente/referencia.png" }], conversaId: "conversa-atual", projectId: "projeto-atual",
  uso: { usoId: "uso-ja-cobrado", custoUsd: .164966, saldoUsd: 10.5 },
};
const fonte = readFileSync(resolve("supabase/functions/agente-calendario/index.ts"), "utf8");

describe("Período explícito pode terminar explicado, sem proposta", () => {
  it("persiste a explicação na mesma conversa sem alterar propostas, agenda ou campanhas anteriores", async () => {
    const anteriores = { propostas: [{ id: "proposta-anterior", status: "gravada" }], tarefas: [{ id: "tarefa-anterior", data: "2026-10-21" }], campanhas: [{ id: "campanha-anterior" }], mensagens: [{ conversa_id: pedido.conversaId, papel: "agente", conteudo: "Histórico anterior", anexos: [] as unknown[] }] };
    const congelado = structuredClone(anteriores);
    const registrar = vi.fn(async (mensagens: MensagemDoPeriodoSemProposta[]) => {
      anteriores.mensagens.push(...mensagens.map((m) => ({ ...m, conversa_id: pedido.conversaId })));
    });
    const resultado = await concluirPeriodoSemItens(pedido, registrar);
    expect(registrar).toHaveBeenCalledOnce();
    expect(registrar.mock.calls[0][0]).toEqual([
      { papel: "usuario", conteudo: pedido.mensagem, anexos: pedido.anexosDoUsuario },
      { papel: "agente", conteudo: pedido.respostaDoModelo, uso_id: pedido.uso.usoId, anexos: [{ tipo: "calendario_sem_proposta", sem_proposta: true, quantidade: 0, periodo_pedido: pedido.periodo }] },
    ]);
    expect(resultado).toMatchObject({ proposta: null, quantidade: 0, sem_proposta: true, resposta: pedido.respostaDoModelo, aviso_da_acao: pedido.respostaDoModelo, conversa_id: pedido.conversaId, project_id: pedido.projectId, custo_usd: pedido.uso.custoUsd, saldo_usd: pedido.uso.saldoUsd });
    expect(registrar.mock.calls[0][0][1].anexos[0]).not.toHaveProperty("proposta_id");
    expect(anteriores.propostas).toEqual(congelado.propostas);
    expect(anteriores.tarefas).toEqual(congelado.tarefas);
    expect(anteriores.campanhas).toEqual(congelado.campanhas);
    expect(anteriores.mensagens[0]).toEqual(congelado.mensagens[0]);
    expect(anteriores.mensagens).toHaveLength(congelado.mensagens.length + 2);
    expect(anteriores.mensagens[2].anexos).toEqual([{ tipo: "calendario_sem_proposta", sem_proposta: true, quantidade: 0, periodo_pedido: pedido.periodo }]);
  });
  it("não transforma zero itens legado nem JSON malformado em sucesso", async () => {
    const registrar = vi.fn(async () => {});
    expect(await concluirPeriodoSemItens({ ...pedido, periodo: null }, registrar)).toBeNull();
    for (const itensDoModelo of [undefined, null, {}, [{ tema: "" }], [{ tema: "Uma pauta válida" }]]) {
      expect(await concluirPeriodoSemItens({ ...pedido, itensDoModelo }, registrar)).toBeNull();
    }
    expect(registrar).not.toHaveBeenCalled();
  });
  it("recusa janela inválida antes de persistir qualquer mensagem", async () => {
    const registrar = vi.fn(async () => {});
    for (const periodo of [{ inicio: "2026-10-21", fim: "2026-11-01" }, { inicio: "2026-10-31", fim: "2026-10-31" }, { inicio: "2026-10-27", fim: "2026-10-21" }]) {
      await expect(concluirPeriodoSemItens({ ...pedido, periodo }, registrar)).rejects.toThrow();
    }
    expect(registrar).not.toHaveBeenCalled();
  });
  it("preserva a resposta limitada e usa fallback neutro, sem afirmar que a agenda está cheia", async () => {
    const registrar = vi.fn(async () => {});
    const longo = await concluirPeriodoSemItens({ ...pedido, respostaDoModelo: `  ${"x".repeat(2100)}  ` }, registrar);
    expect(longo?.resposta).toHaveLength(2000);
    const semTexto = await concluirPeriodoSemItens({ ...pedido, respostaDoModelo: null }, registrar);
    expect(semTexto?.resposta).toContain("Nenhum conteúdo novo foi proposto de 2026-10-21 até 2026-10-27");
    expect(semTexto?.resposta).toContain("Revise o período ou os critérios");
    expect(semTexto?.resposta).not.toMatch(/cheia|lotada|sem vagas|limite atingido/i);
  });
  it("só confirma a resposta depois de persistir e propaga falha sem repetir a geração", async () => {
    const registrar = vi.fn(async () => { throw new Error("mensagem_nao_gravada"); });
    await expect(concluirPeriodoSemItens(pedido, registrar)).rejects.toThrow("mensagem_nao_gravada");
    expect(registrar).toHaveBeenCalledOnce();
  });
  it("o ramo real do handler retorna antes de criar proposta e exige ACK sem mudar o padrão legado", () => {
    const inicio = fonte.indexOf("if (!itens.length) {", fonte.indexOf("async function pedidoLivre("));
    const ramo = fonte.slice(inicio, fonte.indexOf("itens.sort(", inicio));
    expect(ramo).toContain("concluirPeriodoSemItens({");
    expect(ramo).toContain("periodo: corpo.data_fim !== undefined ? { inicio, fim } : null");
    expect(ramo).toContain("registrarMensagens(servico, conversaId, clientId, mensagens, true)");
    expect(ramo).toContain("if (semProposta) return json(semProposta);");
    expect(ramo).toContain('throw new ErroHttp(502, "pedido_sem_itens"');
    expect(ramo).not.toMatch(/chamarTexto\(|gravarItens\(|\.from\(/);
    const persistencia = fonte.slice(fonte.indexOf("async function registrarMensagens("), fonte.indexOf("// ------------------------------------------------------------ contexto real"));
    expect(persistencia).toContain("exigirPersistencia = false");
    expect(persistencia).toContain("tentativa < 2");
    expect(persistencia).toContain('if (exigirPersistencia) throw new ErroHttp(503, "mensagem_nao_gravada"');
  });
});
