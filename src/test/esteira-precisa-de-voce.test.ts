import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Caixa "Precisa de você" da Esteira (fase 2): a montagem pura (só os quatro
 * tipos que dependem do dono, cada item com o link de onde se resolve) e a
 * leitura em lote, que nunca derruba a tela. O banco aqui é simulado.
 */

const banco = vi.hoisted(() => ({
  chamadas: [] as Array<{ tabela: string; passos: Array<[string, ...unknown[]]> }>,
  linhas: {} as Record<string, unknown[]>,
  erroEm: {} as Record<string, { message: string; code?: string }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const from = (tabela: string) => {
    const chamada = { tabela, passos: [] as Array<[string, ...unknown[]]> };
    banco.chamadas.push(chamada);
    const resposta = () => (banco.erroEm[tabela] ? { data: null, error: banco.erroEm[tabela] } : { data: banco.linhas[tabela] ?? [], error: null });
    const q: Record<string, unknown> = { then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(resposta()).then(ok, falha) };
    for (const m of ["select", "in", "eq", "neq", "gte", "or", "order", "limit"]) {
      q[m] = (...args: unknown[]) => {
        chamada.passos.push([m, ...args]);
        return q;
      };
    }
    return q;
  };
  return { supabase: { from } };
});

import {
  montarPedidosDoDono, pecasRejeitadasMaisDeUmaVez, tipoDaAprovacao, LINHAS_DO_DONO_VAZIAS,
  type EntradaDaCaixa, type LinhaDeAprovacao, type LinhaDeArquivoRejeitado, type LinhaDeRejeicao, type LinhaDeTrabalhoRejeitado,
} from "@/lib/esteiraLinha/precisaDeVoce";
import { lerLinhasDoDono } from "@/lib/esteiraLinha/precisaDeVoceFatos";

const NOMES: Record<string, string> = { c1: "Alfa Comércio", c2: "Beta Loja" };
const entrada = (extra: Partial<EntradaDaCaixa> = {}): EntradaDaCaixa => ({ ...LINHAS_DO_DONO_VAZIAS, nomeDe: (id) => (id ? NOMES[id] ?? null : null), ...extra });

const aprovacao = (id: string, extra: Partial<LinhaDeAprovacao> = {}): LinhaDeAprovacao => ({
  id, status: "pendente", action_kind: "mudar_estrategia", o_que: "Trocar o foco da campanha", por_que: "O público atual esgotou.", custo_previsto: null,
  client_id: "c1", task_link_id: null, created_at: "2026-11-14T12:00:00Z", ...extra,
});
const rejeicao = (id: string, file_id: string, created_at: string, extra: Partial<LinhaDeRejeicao> = {}): LinhaDeRejeicao => ({ id, file_id, client_id: "c1", created_at, feedback: `Motivo ${id} do cliente`, ...extra });
const arquivo = (id: string, extra: Partial<LinhaDeArquivoRejeitado> = {}): LinhaDeArquivoRejeitado => ({ id, client_id: "c1", file_name: `${id}.png`, revision_of_file_id: null, approval_status: "rejected", archived_at: null, created_at: "2026-11-01T10:00:00Z", ...extra });
const ajuste = (evento_id: string, file_id: string, pedido_em: string, decisao = "ajuste") => ({ evento_id, file_id, pedido_em, decisao, texto: `Pedido ${evento_id}` });
const trabalho = (id: string, extra: Partial<LinhaDeTrabalhoRejeitado> = {}): LinhaDeTrabalhoRejeitado => ({ id, client_id: "c1", task_id: "t1", post_id: null, entrega_status: "reprovado", file_ids: ["f9"], ajustes_do_cliente: [], titulo: "Carrossel de sexta", ...extra });

describe("tipo do pedido de aprovação do agente", () => {
  it("o catálogo de ações decide primeiro: dinheiro, cliente ou plano, ou decisão de agente", () => {
    for (const acao of ["gastar", "alterar_orcamento", "alterar_financeiro", "ativar_campanha"]) expect(tipoDaAprovacao(aprovacao("a", { action_kind: acao }))).toBe("dinheiro");
    for (const acao of ["criar_proposta", "enviar_contrato"]) expect(tipoDaAprovacao(aprovacao("a", { action_kind: acao }))).toBe("cliente_ou_plano");
    for (const acao of ["publicar", "mudar_estrategia", "enviar_mensagem", "alterar_permissoes"]) expect(tipoDaAprovacao(aprovacao("a", { action_kind: acao }))).toBe("decisao_de_agente");
  });

  it("custo previsto e o texto do pedido também marcam dinheiro e plano", () => {
    expect(tipoDaAprovacao(aprovacao("a", { custo_previsto: 120 }))).toBe("dinheiro");
    expect(tipoDaAprovacao(aprovacao("a", { custo_previsto: "0" }))).toBe("decisao_de_agente");
    expect(tipoDaAprovacao(aprovacao("a", { o_que: "Recarga de R$ 120 na conta de anúncios" }))).toBe("dinheiro");
    expect(tipoDaAprovacao(aprovacao("a", { por_que: "A verba do mês acabou." }))).toBe("dinheiro");
    expect(tipoDaAprovacao(aprovacao("a", { o_que: "Confirmar a mudança de plano para o Pro" }))).toBe("cliente_ou_plano");
    // "plano de conteúdo" não é plano do cliente.
    expect(tipoDaAprovacao(aprovacao("a", { o_que: "Rever o plano de conteúdo de dezembro" }))).toBe("decisao_de_agente");
  });
});

describe("peça rejeitada mais de uma vez pelo cliente", () => {
  it("no Estúdio conta por peça: os ajustes guardados no trabalho mais os do arquivo atual", () => {
    const duas = trabalho("w1", { ajustes_do_cliente: [ajuste("e1", "f1", "2026-11-05T10:00:00Z"), ajuste("e2", "f2", "2026-11-10T10:00:00Z"), ajuste("e3", "f2", "2026-11-11T10:00:00Z", "aprovado")] });
    const [p] = pecasRejeitadasMaisDeUmaVez({ trabalhos: [duas], rejeicoes: [], arquivos: [] });
    expect(p).toMatchObject({ chave: "trabalho:w1", clientId: "c1", titulo: "Carrossel de sexta", rejeicoes: 2, ultimoMotivo: "Pedido e2", origem: { tipo: "estudio", taskId: "t1", postId: null } });

    // Um ajuste guardado e a rejeição do arquivo atual somam duas; o mesmo evento não conta em dobro.
    const comAtual = trabalho("w2", { file_ids: ["f3"], ajustes_do_cliente: [ajuste("e1", "f1", "2026-11-05T10:00:00Z"), ajuste("e9", "f3", "2026-11-12T10:00:00Z")] });
    const lista = pecasRejeitadasMaisDeUmaVez({ trabalhos: [comAtual], rejeicoes: [rejeicao("e9", "f3", "2026-11-12T10:00:00Z")], arquivos: [arquivo("f3")] });
    expect(lista).toHaveLength(1);
    expect(lista[0].rejeicoes).toBe(2);
  });

  it("uma rejeição só, peça já aprovada ou agendada, e comentário de aprovação não entram", () => {
    const uma = trabalho("w1", { ajustes_do_cliente: [ajuste("e1", "f1", "2026-11-05T10:00:00Z"), ajuste("e2", "f1", "2026-11-06T10:00:00Z", "aprovado")] });
    const doisAjustes = [ajuste("e1", "f1", "2026-11-05T10:00:00Z"), ajuste("e2", "f2", "2026-11-10T10:00:00Z")];
    expect(pecasRejeitadasMaisDeUmaVez({ trabalhos: [uma, trabalho("w2", { entrega_status: "aprovado", ajustes_do_cliente: doisAjustes }), trabalho("w3", { entrega_status: "agendado", ajustes_do_cliente: doisAjustes })], rejeicoes: [], arquivos: [] })).toEqual([]);
  });

  it("fora do Estúdio conta pela cadeia de versões do arquivo, não por arquivo", () => {
    const arquivos = [arquivo("f1"), arquivo("f2", { revision_of_file_id: "f1", created_at: "2026-11-05T10:00:00Z" }), arquivo("f3", { revision_of_file_id: "f2", approval_status: "pending", created_at: "2026-11-09T10:00:00Z", file_name: "banner-v3.png" })];
    const rejeicoes = [rejeicao("e1", "f1", "2026-11-02T10:00:00Z"), rejeicao("e2", "f2", "2026-11-06T10:00:00Z"), rejeicao("e5", "fx", "2026-11-06T10:00:00Z")];
    const lista = pecasRejeitadasMaisDeUmaVez({ trabalhos: [], rejeicoes, arquivos: [...arquivos, arquivo("fx")] });
    expect(lista).toEqual([{ chave: "arquivo:f1", clientId: "c1", titulo: "banner-v3.png", rejeicoes: 2, ultimoMotivo: "Motivo e2 do cliente", quando: "2026-11-06T10:00:00Z", origem: { tipo: "arquivo" } }]);
    // Aprovada em alguma versão, ou com a versão mais nova arquivada: não sobe.
    expect(pecasRejeitadasMaisDeUmaVez({ trabalhos: [], rejeicoes, arquivos: arquivos.map((a) => (a.id === "f3" ? { ...a, approval_status: "approved" } : a)) })).toEqual([]);
    expect(pecasRejeitadasMaisDeUmaVez({ trabalhos: [], rejeicoes, arquivos: arquivos.map((a) => (a.id === "f3" ? { ...a, archived_at: "2026-11-10T00:00:00Z" } : a)) })).toEqual([]);
    // Arquivo que já é de uma peça do Estúdio não aparece duas vezes.
    const doEstudio = trabalho("w1", { file_ids: ["f3"], ajustes_do_cliente: [ajuste("e1", "f1", "2026-11-02T10:00:00Z"), ajuste("e2", "f2", "2026-11-06T10:00:00Z")] });
    expect(pecasRejeitadasMaisDeUmaVez({ trabalhos: [doEstudio], rejeicoes, arquivos }).map((p) => p.chave)).toEqual(["trabalho:w1"]);
  });
});

describe("montagem da caixa", () => {
  const completa = () => montarPedidosDoDono(entrada({
    aprovacoes: [
      aprovacao("a1", { action_kind: "gastar", o_que: "Recarregar a conta de anúncios", custo_previsto: 150, created_at: "2026-11-14T10:00:00Z" }),
      aprovacao("a2", { action_kind: "criar_proposta", o_que: "Enviar proposta ao lead novo", client_id: null, created_at: "2026-11-14T11:00:00Z" }),
      aprovacao("a3", { task_link_id: "v1", status: "adiado", client_id: "c2" }),
      aprovacao("a4", { status: "aprovado" }),
      aprovacao("a5", { status: "expirado" }),
      aprovacao("a6", { invalidated_at: "2026-11-14T13:00:00Z" }),
    ],
    vinculos: [
      { id: "v1", status: "review", approval_required: true, block_reason: "Tem pedido explicado", next_step: null, last_action: null, updated_at: "2026-11-14T09:00:00Z" },
      { id: "v2", status: "blocked", approval_required: true, block_reason: "Precisa escolher o fornecedor.", next_step: "Fechar com o fornecedor A ou B", last_action: null, updated_at: "2026-11-13T09:00:00Z" },
      { id: "v3", status: "done", approval_required: true, block_reason: null, next_step: null, last_action: null, updated_at: "2026-11-13T09:00:00Z" },
      // Parado sem pedido de decisão: é da fila da Execução, não da caixa.
      { id: "v4", status: "blocked", approval_required: false, block_reason: "Sem acesso", next_step: null, last_action: null, updated_at: "2026-11-13T09:00:00Z" },
    ],
    acoesDeAnuncio: [
      { id: "x1", client_id: "c2", estado: "proposta", tipo: "orcamento", resumo: "Subir a verba diária para R$ 60", alvo: { nome: "Campanha de novembro" }, criado_em: "2026-11-14T08:00:00Z" },
      { id: "x2", client_id: "c2", estado: "feita", tipo: "pausar", resumo: "Pausou o conjunto", criado_em: "2026-11-14T08:00:00Z" },
    ],
    trabalhos: [
      trabalho("w1", { post_id: "p7", ajustes_do_cliente: [ajuste("e1", "f1", "2026-11-05T10:00:00Z"), ajuste("e2", "f2", "2026-11-10T10:00:00Z")] }),
      trabalho("w2", { client_id: "c9", ajustes_do_cliente: [ajuste("e3", "f3", "2026-11-05T10:00:00Z"), ajuste("e4", "f4", "2026-11-10T10:00:00Z")] }),
    ],
    clientesAtivos: new Set(["c1", "c2"]),
  }));

  it("traz só os quatro tipos, na ordem, e deixa de fora o que não depende do dono", () => {
    const pedidos = completa();
    expect(pedidos.map((p) => `${p.tipo}:${p.chave}`)).toEqual([
      "dinheiro:aprovacao:a1",
      "dinheiro:anuncio:x1",
      "cliente_ou_plano:aprovacao:a2",
      "rejeicao_repetida:rejeicao:trabalho:w1",
      "decisao_de_agente:aprovacao:a3",
      "decisao_de_agente:vinculo:v2",
    ]);
    // Decidido, expirado, invalidado, vínculo concluído ou só parado, ação já feita e cliente inativo: fora.
    const chaves = pedidos.map((p) => p.chave).join(" ");
    for (const fora of ["a4", "a5", "a6", "v1", "v3", "v4", "x2", "w2"]) expect(chaves).not.toContain(fora);
  });

  it("cada item tem o que se pede, o porquê, o cliente quando há e o link de onde se resolve", () => {
    const pedidos = completa();
    for (const p of pedidos) {
      expect(p.oQue.length).toBeGreaterThan(0);
      expect(p.porQue.length).toBeGreaterThan(0);
      expect(p.link.startsWith("/")).toBe(true);
      expect(p.onde.length).toBeGreaterThan(0);
    }
    const por = (chave: string) => pedidos.find((p) => p.chave === chave)!;
    expect(por("aprovacao:a1")).toMatchObject({ cliente: "Alfa Comércio", link: "/execucao?aprovacao=a1", onde: "Execução" });
    expect(por("aprovacao:a1").porQue).toMatch(/Custo previsto: R\$\s?150,00\./);
    expect(por("aprovacao:a2")).toMatchObject({ cliente: null, clientId: null, link: "/execucao?aprovacao=a2" });
    expect(por("aprovacao:a3").porQue).toContain("Você adiou este pedido.");
    expect(por("anuncio:x1")).toMatchObject({ cliente: "Beta Loja", link: "/anuncios/hoje", onde: "Anúncios", oQue: "Proposta do agente de tráfego em Campanha de novembro" });
    expect(por("vinculo:v2")).toMatchObject({ link: "/execucao?vinculo=v2", oQue: "Fechar com o fornecedor A ou B", porQue: "Precisa escolher o fornecedor." });
    expect(por("rejeicao:trabalho:w1")).toMatchObject({ cliente: "Alfa Comércio", link: "/calendario?client=c1&content=p7", onde: "Agenda", oQue: '"Carrossel de sexta" foi rejeitada 2 vezes pelo cliente' });
  });

  it("peça rejeitada: Estúdio para quem pode abrir, Agenda para quem não pode, Aprovações para arquivo avulso", () => {
    const doisAjustes = [ajuste("e1", "f1", "2026-11-05T10:00:00Z"), ajuste("e2", "f2", "2026-11-10T10:00:00Z")];
    const base = { trabalhos: [trabalho("w1", { ajustes_do_cliente: doisAjustes })] };
    expect(montarPedidosDoDono(entrada(base))[0]).toMatchObject({ link: "/mesa?client=c1&aba=estudio&task=t1", onde: "Estúdio" });
    expect(montarPedidosDoDono(entrada({ ...base, podeAbrirEstudio: false }))[0]).toMatchObject({ link: "/calendario?client=c1", onde: "Agenda" });
    const avulso = montarPedidosDoDono(entrada({ arquivos: [arquivo("f1"), arquivo("f2", { revision_of_file_id: "f1" })], rejeicoes: [rejeicao("e1", "f1", "2026-11-02T10:00:00Z"), rejeicao("e2", "f2", "2026-11-06T10:00:00Z")] }));
    expect(avulso[0]).toMatchObject({ tipo: "rejeicao_repetida", link: "/aprovacoes?client=c1", onde: "Aprovações" });
  });

  it("sem nada pendente a lista é vazia", () => {
    expect(montarPedidosDoDono(entrada())).toEqual([]);
  });
});

describe("leitura da caixa", () => {
  beforeEach(() => {
    banco.chamadas.length = 0;
    banco.erroEm = {};
    banco.linhas = {
      operator_approvals: [aprovacao("a1", { action_kind: "gastar" })],
      operator_task_links: [],
      ads_rotina_acoes: [],
      file_approval_events: [rejeicao("e1", "f1", "2026-11-02T10:00:00Z"), rejeicao("e2", "f2", "2026-11-06T10:00:00Z")],
      staff_files_secure: [arquivo("f1"), arquivo("f2", { revision_of_file_id: "f1" })],
      estudio_trabalhos: [{ id: "w1", client_id: "c1", task_id: "t1", post_id: null, entrega_status: "reprovado", file_ids: ["f9"], ajustes_do_cliente: [] }],
      tasks: [{ id: "t1", title: "Carrossel de sexta" }],
    };
  });

  it("lê a casa inteira em poucas consultas, só as linhas em aberto, sem gravar nada", async () => {
    const { linhas, fontesComErro } = await lerLinhasDoDono(new Date("2026-11-15T12:00:00Z"));
    expect(fontesComErro).toEqual([]);
    // Uma consulta por fonte (e três de apoio para as rejeições), nunca uma por cliente.
    expect(banco.chamadas.length).toBeLessThanOrEqual(8);
    const passos = (tabela: string) => banco.chamadas.find((c) => c.tabela === tabela)!.passos;
    expect(passos("operator_approvals")).toContainEqual(["in", "status", ["pendente", "adiado"]]);
    expect(passos("operator_task_links")).toContainEqual(["eq", "approval_required", true]);
    expect(passos("operator_task_links")).toContainEqual(["neq", "status", "done"]);
    expect(passos("ads_rotina_acoes")).toContainEqual(["eq", "estado", "proposta"]);
    expect(passos("ads_rotina_acoes")).toContainEqual(["gte", "criado_em", "2026-11-01T12:00:00.000Z"]);
    expect(passos("file_approval_events")).toContainEqual(["eq", "event_type", "client_rejected"]);
    expect(passos("estudio_trabalhos")).toContainEqual(["gte", "entrega_rodada", 3]);
    for (const c of banco.chamadas) expect(c.passos.map((p) => p[0])).not.toEqual(expect.arrayContaining(["insert", "update", "delete", "upsert", "rpc"]));
    expect(linhas.aprovacoes).toHaveLength(1);
    expect(linhas.trabalhos[0].titulo).toBe("Carrossel de sexta");
    expect(montarPedidosDoDono(entrada(linhas)).map((p) => p.chave)).toEqual(["aprovacao:a1", "rejeicao:arquivo:f1"]);
  });

  it("fonte com erro não derruba a caixa: as outras seguem e o erro é avisado; tabela ausente de anúncios é só vazio", async () => {
    banco.erroEm = { operator_approvals: { message: "permission denied" }, ads_rotina_acoes: { message: "relation does not exist", code: "42P01" } };
    const { linhas, fontesComErro } = await lerLinhasDoDono(new Date("2026-11-15T12:00:00Z"));
    expect(fontesComErro).toEqual(["aprovacoes"]);
    expect(linhas.aprovacoes).toEqual([]);
    expect(linhas.acoesDeAnuncio).toEqual([]);
    expect(linhas.rejeicoes).toHaveLength(2);
  });
});
