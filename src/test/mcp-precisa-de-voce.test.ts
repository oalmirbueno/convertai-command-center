import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { montarPedidosDoDono as doPainel, tipoDaAprovacao as tipoNoPainel, type LinhasDoDono } from "@/lib/esteiraLinha/precisaDeVoce";
import {
  ACAO_PEDIR_DECISAO_DO_DONO,
  montarPedidosDoDono as doMcp,
  pedidosNoEscopo,
  tipoDaAprovacao as tipoNoMcp,
} from "../../supabase/functions/mcp-server/modulos/precisa-de-voce-regras";
import { FERRAMENTAS_POR_AREA } from "../../supabase/functions/mcp-server/modulos/guia-do-painel";
import { MCP_VERSION } from "../../supabase/functions/_shared/mcp-release";
import { CLIENT_SCOPED_LEGACY_TOOLS } from "../../supabase/functions/_shared/mcp-security";
import { RPCS_DA_PONTE } from "../../supabase/functions/_shared/mcp-mesas-ponte";

/**
 * MCP 2.28.0 (14/11/2026): a caixa "Precisa de você" pelos agentes, a revisão
 * interna e o pedido ao dono.
 *
 * 1. A regra do MCP é a regra do painel: as duas montagens rodam sobre as
 *    mesmas linhas e têm de dar a mesma lista.
 * 2. A migration da RPC nova, lida como texto: o que cria e o que não pode
 *    fazer (aprovar, agendar, publicar, mexer em arquivo ou peça).
 * 3. O registro das três ferramentas.
 */

const ler = (p: string) => readFileSync(p, "utf8");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const PARADO = "33333333-3333-4333-8333-333333333333";

const aprovacao = (id: string, extra: Record<string, unknown> = {}) => ({
  id, status: "pendente", action_kind: "mudar_estrategia", o_que: "Trocar a linha editorial do mês", por_que: "O cliente pediu outro tom",
  custo_previsto: null, client_id: A, task_link_id: null, created_at: "2026-11-14T10:00:00Z", invalidated_at: null, ...extra,
});

const LINHAS: LinhasDoDono = {
  aprovacoes: [
    aprovacao("ap-gasto", { action_kind: "gastar", custo_previsto: "450.5", created_at: "2026-11-14T12:00:00Z" }),
    aprovacao("ap-proposta", { action_kind: "criar_proposta", client_id: B }),
    aprovacao("ap-dono", { action_kind: ACAO_PEDIR_DECISAO_DO_DONO, client_id: null, o_que: "Definir quem atende a conta nova", por_que: "Depende de como a equipe vai ser dividida" }),
    aprovacao("ap-dono-custo", { action_kind: ACAO_PEDIR_DECISAO_DO_DONO, custo_previsto: 90, o_que: "Contratar banco de imagens para o cliente", por_que: "Não cabe no que foi combinado" }),
    aprovacao("ap-fala-plano", { o_que: "Cliente quer mudança de plano em dezembro", por_que: "Pediu no grupo" }),
    aprovacao("ap-fala-verba", { o_que: "Aumentar a verba da campanha", por_que: "CPL caiu", status: "adiado", task_link_id: "vinc-com-pedido" }),
    aprovacao("ap-longa", { o_que: "x".repeat(400), por_que: "y ".repeat(300) }),
    aprovacao("ap-decidida", { status: "aprovado" }),
    aprovacao("ap-invalida", { invalidated_at: "2026-11-14T11:00:00Z" }),
  ],
  vinculos: [
    { id: "vinc-1", status: "doing", approval_required: true, block_reason: "Falta o sim do dono", next_step: "Subir a campanha", last_action: null, updated_at: "2026-11-14T09:00:00Z" },
    { id: "vinc-sem-texto", status: "blocked", approval_required: true, block_reason: null, next_step: null, last_action: null, updated_at: "2026-11-13T09:00:00Z" },
    { id: "vinc-com-pedido", status: "doing", approval_required: true, block_reason: null, next_step: "x", last_action: null, updated_at: "2026-11-14T09:00:00Z" },
    { id: "vinc-feito", status: "done", approval_required: true, block_reason: null, next_step: "x", last_action: null, updated_at: "2026-11-14T09:00:00Z" },
  ],
  acoesDeAnuncio: [
    { id: "acao-1", client_id: A, estado: "proposta", alvo_nome: "Campanha de novembro", motivo: "CPL subiu 40%", criado_em: "2026-11-14T08:00:00Z" },
    { id: "acao-2", client_id: B, estado: "proposta", alvo: { nome: "Conjunto frio", nivel: "adset" }, porque: "Frequência alta", created_at: "2026-11-13T08:00:00Z" },
    { id: "acao-feita", client_id: B, estado: "feita", alvo_nome: "x", criado_em: "2026-11-13T08:00:00Z" },
  ],
  rejeicoes: [
    { id: "ev-1", file_id: "f1", client_id: B, created_at: "2026-11-10T10:00:00Z", feedback: "Cor errada" },
    { id: "ev-2", file_id: "f2", client_id: B, created_at: "2026-11-12T10:00:00Z", feedback: "Ainda não é isso" },
    { id: "ev-3", file_id: "g1", client_id: A, created_at: "2026-11-10T10:00:00Z", feedback: "Uma vez só" },
    { id: "ev-4", file_id: "h1", client_id: A, created_at: "2026-11-08T10:00:00Z", feedback: "Primeira" },
    { id: "ev-5", file_id: "h2", client_id: A, created_at: "2026-11-09T10:00:00Z", feedback: "Segunda" },
    { id: "ev-6", file_id: "p1", client_id: PARADO, created_at: "2026-11-08T10:00:00Z", feedback: "a" },
    { id: "ev-7", file_id: "p2", client_id: PARADO, created_at: "2026-11-09T10:00:00Z", feedback: "b" },
    { id: "ev-8", file_id: "arte-atual", client_id: A, created_at: "2026-11-13T10:00:00Z", feedback: "Trocar a foto" },
  ],
  arquivos: [
    { id: "f1", client_id: B, file_name: "banner.png", revision_of_file_id: null, approval_status: "rejected", archived_at: null, created_at: "2026-11-09T10:00:00Z" },
    { id: "f2", client_id: B, file_name: "banner-v2.png", revision_of_file_id: "f1", approval_status: "rejected", archived_at: null, created_at: "2026-11-11T10:00:00Z" },
    { id: "g1", client_id: A, file_name: "uma.png", revision_of_file_id: null, approval_status: "rejected", archived_at: null, created_at: "2026-11-09T10:00:00Z" },
    // Cadeia já resolvida: a terceira versão foi aprovada.
    { id: "h1", client_id: A, file_name: "h.png", revision_of_file_id: null, approval_status: "rejected", archived_at: null, created_at: "2026-11-07T10:00:00Z" },
    { id: "h2", client_id: A, file_name: "h2.png", revision_of_file_id: "h1", approval_status: "rejected", archived_at: null, created_at: "2026-11-08T12:00:00Z" },
    { id: "h3", client_id: A, file_name: "h3.png", revision_of_file_id: "h2", approval_status: "approved", archived_at: null, created_at: "2026-11-10T12:00:00Z" },
    { id: "p1", client_id: PARADO, file_name: "p.png", revision_of_file_id: null, approval_status: "rejected", archived_at: null, created_at: "2026-11-07T10:00:00Z" },
    { id: "p2", client_id: PARADO, file_name: "p2.png", revision_of_file_id: "p1", approval_status: "rejected", archived_at: null, created_at: "2026-11-08T12:00:00Z" },
  ],
  trabalhos: [
    {
      id: "trab-1", client_id: A, task_id: "tarefa-1", post_id: null, entrega_status: "reprovado", file_ids: ["arte-atual"], titulo: "Post de sexta",
      ajustes_do_cliente: [{ evento_id: "ev-antigo", decisao: "ajuste", texto: "Mudar o título", pedido_em: "2026-11-11T10:00:00Z", file_id: "arte-velha" }],
    },
    {
      id: "trab-post", client_id: B, task_id: "tarefa-2", post_id: "post-9", entrega_status: null, file_ids: [],
      ajustes_do_cliente: [
        { evento_id: "e1", decisao: "ajuste", texto: "a", pedido_em: "2026-11-05T10:00:00Z", file_id: "z1" },
        { evento_id: "e2", decisao: "ajuste", texto: "b", pedido_em: "2026-11-06T10:00:00Z", file_id: "z2" },
        { evento_id: "e3", decisao: "aprovado", texto: "", pedido_em: "2026-11-07T10:00:00Z", file_id: "z3" },
      ],
    },
    { id: "trab-resolvido", client_id: A, task_id: "t3", post_id: null, entrega_status: "agendado", file_ids: [], ajustes_do_cliente: [{ evento_id: "r1", decisao: "ajuste" }, { evento_id: "r2", decisao: "ajuste" }] },
  ],
};

const NOMES: Record<string, string> = { [A]: "Cliente A", [B]: "Cliente B", [PARADO]: "Cliente parado" };
const nomeDe = (id: string | null) => (id ? NOMES[id] ?? null : null);
const semIds = <T extends { ids: unknown }>(p: T) => {
  const { ids: _ids, ...resto } = p;
  return resto;
};

describe("MCP: a caixa Precisa de você segue a regra do painel", () => {
  it("as duas montagens dão a mesma lista, item por item, com e sem o corte de cliente ativo", () => {
    for (const clientesAtivos of [undefined, new Set([A, B])]) {
      for (const podeAbrirEstudio of [true, false]) {
        const painel = doPainel({ ...LINHAS, nomeDe, clientesAtivos, podeAbrirEstudio });
        const mcp = doMcp({ ...LINHAS, nomeDe, clientesAtivos, podeAbrirEstudio });
        expect(mcp.map(semIds)).toEqual(painel);
        expect(painel.length).toBeGreaterThan(8);
      }
    }
  });

  it("a lista de exemplo cobre os quatro tipos e os casos que ficam de fora", () => {
    const mcp = doMcp({ ...LINHAS, nomeDe, clientesAtivos: new Set([A, B]) });
    const chaves = mcp.map((p) => p.chave);
    expect(new Set(mcp.map((p) => p.tipo))).toEqual(new Set(["dinheiro", "cliente_ou_plano", "rejeicao_repetida", "decisao_de_agente"]));
    for (const fora of ["aprovacao:ap-decidida", "aprovacao:ap-invalida", "vinculo:vinc-feito", "vinculo:vinc-com-pedido", "anuncio:acao-feita", "rejeicao:arquivo:g1", "rejeicao:arquivo:h1", "rejeicao:arquivo:p1", "rejeicao:trabalho:trab-resolvido"]) {
      expect(chaves, fora).not.toContain(fora);
    }
    for (const dentro of ["aprovacao:ap-gasto", "aprovacao:ap-dono", "anuncio:acao-1", "anuncio:acao-2", "vinculo:vinc-1", "rejeicao:arquivo:f1", "rejeicao:trabalho:trab-1", "rejeicao:trabalho:trab-post"]) {
      expect(chaves, dentro).toContain(dentro);
    }
  });

  it("o tipo de cada pedido é o mesmo nos dois lados, inclusive o pedido novo ao dono", () => {
    for (const a of LINHAS.aprovacoes) expect(tipoNoMcp(a), a.id).toBe(tipoNoPainel(a));
    const novo = { action_kind: ACAO_PEDIR_DECISAO_DO_DONO, o_que: "Definir quem atende a conta nova", por_que: "Depende da divisão da equipe", custo_previsto: null };
    expect(ACAO_PEDIR_DECISAO_DO_DONO).toBe("pedir_decisao_do_dono");
    expect(tipoNoPainel(novo)).toBe("decisao_de_agente");
    expect(tipoNoMcp(novo)).toBe("decisao_de_agente");
  });

  it("os ids úteis acompanham cada item, sem campo vazio", () => {
    const mcp = doMcp({ ...LINHAS, nomeDe });
    const ids = Object.fromEntries(mcp.map((p) => [p.chave, p.ids]));
    expect(ids["aprovacao:ap-gasto"]).toEqual({ approval_id: "ap-gasto" });
    expect(ids["aprovacao:ap-fala-verba"]).toEqual({ approval_id: "ap-fala-verba", link_id: "vinc-com-pedido" });
    expect(ids["anuncio:acao-1"]).toEqual({ acao_de_anuncio_id: "acao-1" });
    expect(ids["vinculo:vinc-1"]).toEqual({ link_id: "vinc-1" });
    expect(ids["rejeicao:arquivo:f1"]).toEqual({ file_id: "f1" });
    expect(ids["rejeicao:trabalho:trab-1"]).toEqual({ trabalho_id: "trab-1", task_id: "tarefa-1" });
    expect(ids["rejeicao:trabalho:trab-post"]).toEqual({ trabalho_id: "trab-post", task_id: "tarefa-2", post_id: "post-9" });
  });

  it("escopo: credencial restrita só vê os seus clientes e nada sem cliente", () => {
    const todos = doMcp({ ...LINHAS, nomeDe });
    const doA = pedidosNoEscopo(todos, { unrestricted: false, clientIds: [A] });
    expect(doA.length).toBeGreaterThan(0);
    expect(new Set(doA.map((p) => p.clientId))).toEqual(new Set([A]));
    expect(pedidosNoEscopo(todos, { unrestricted: false, clientIds: [] })).toEqual([]);
    expect(pedidosNoEscopo(todos, { unrestricted: true, clientIds: [] })).toHaveLength(todos.length);
  });

  it("o módulo de regras do MCP é puro: sem import e sem banco", () => {
    const fonte = ler("supabase/functions/mcp-server/modulos/precisa-de-voce-regras.ts");
    expect(fonte).not.toMatch(/^import /m);
    expect(fonte).not.toMatch(/supabase|fetch\(|Deno\./);
  });
});

describe("MCP 2.28: registro das três ferramentas", () => {
  const NOVAS = ["aceleriq_revisar_trabalho_interno", "aceleriq_listar_precisa_de_voce", "aceleriq_marcar_precisa_de_voce"];
  const tools = ler("supabase/functions/_shared/mcp-tools.ts");

  it("versão, catálogo, escopo granular, fronteira de cliente, ponte e guia", () => {
    expect(MCP_VERSION).toBe("2.36.0");
    expect(ler("supabase/functions/_shared/mcp-release.ts")).toContain("// 2.28.0 (14/11/2026):");
    expect(tools).toContain("import { FERRAMENTAS_DE_PRECISA_DE_VOCE_E_REVISAO } from '../mcp-server/modulos/precisa-de-voce-e-revisao.ts';");
    expect(tools).toContain("  ...FERRAMENTAS_DE_PRECISA_DE_VOCE_E_REVISAO,\n];");
    expect(tools).toContain("aceleriq_revisar_trabalho_interno: 'mesas:write'");
    expect(tools).toContain("aceleriq_marcar_precisa_de_voce: 'mesas:write'");
    expect(tools).toContain("aceleriq_listar_precisa_de_voce: 'clients:read'");
    for (const nome of NOVAS) expect(CLIENT_SCOPED_LEGACY_TOOLS as readonly string[], nome).toContain(nome);
    expect(RPCS_DA_PONTE as readonly string[]).toContain("revisar_trabalho_interno");
    expect(RPCS_DA_PONTE as readonly string[]).toContain("marcar_precisa_do_dono");
    expect(FERRAMENTAS_POR_AREA.aprovacoes).toContain("aceleriq_revisar_trabalho_interno");
    expect(FERRAMENTAS_POR_AREA.execucao).toContain("aceleriq_listar_precisa_de_voce");
    expect(FERRAMENTAS_POR_AREA.execucao).toContain("aceleriq_marcar_precisa_de_voce");
  });

  it("a ferramenta antiga de pedir aprovação continua com o catálogo fechado: o valor novo só entra pela RPC nova", () => {
    const antiga = tools.slice(tools.indexOf("const operatorRequestApprovalTool"), tools.indexOf("const operatorProposeAssigneeTool"));
    expect(antiga).not.toContain("pedir_decisao_do_dono");
    expect(antiga).toContain("required: ['operator', 'link_id', 'action_kind', 'o_que', 'por_que']");
  });

  it("a Execução dá nome ao pedido novo", () => {
    expect(ler("src/components/execucao/AprovacoesExplicadas.tsx")).toContain('pedir_decisao_do_dono: "Decisão do dono"');
    expect(ler("src/components/execucao/central/ObjetoDaCentral.tsx")).toContain('pedir_decisao_do_dono: "Decisão do dono"');
  });
});

describe("migration 20261114230000: marcar_precisa_do_dono", () => {
  const sql = ler("supabase/migrations/20261114230000_marcar_precisa_do_dono.sql");
  /** Só o que executa: sem os comentários de linha. */
  const codigo = sql.split("\n").filter((linha) => !linha.trim().startsWith("--")).join("\n");
  const funcao = codigo.slice(codigo.indexOf("CREATE OR REPLACE FUNCTION public.marcar_precisa_do_dono"), codigo.indexOf("$function$;"));
  const ASSINATURA = "public.marcar_precisa_do_dono(text, text, text, text, uuid, uuid, uuid, numeric)";

  it("o catálogo de ações só cresce: os 16 valores de sempre mais o novo", () => {
    const check = codigo.slice(codigo.indexOf("ADD CONSTRAINT operator_approvals_action_kind_check"), codigo.indexOf("CREATE UNIQUE INDEX"));
    const valores = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(valores).toEqual([
      "publicar", "agendar", "enviar_mensagem", "contatar_cliente", "criar_proposta", "enviar_contrato", "ativar_campanha",
      "alterar_orcamento", "gastar", "alterar_financeiro", "alterar_permissoes", "exportar_dados", "excluir_dados",
      "mudar_estrategia", "alterar_responsavel", "promover_autonomia", "pedir_decisao_do_dono",
    ]);
    // O catálogo antigo, como nasceu, está inteiro dentro do novo.
    const original = ler("supabase/migrations/20260829010000_participacao_aprovacao_e_propostas.sql");
    const antigos = [...original.slice(original.indexOf("action_kind text not null check"), original.indexOf("o_que text not null")).matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(antigos).toHaveLength(16);
    expect(valores.slice(0, 16)).toEqual(antigos);
  });

  it("uma chave, um pedido: índice único só para o valor novo", () => {
    expect(codigo).toContain("CREATE UNIQUE INDEX IF NOT EXISTS operator_approvals_precisa_do_dono_key");
    expect(codigo).toMatch(/ON public\.operator_approvals \(request_key\)\s+WHERE action_kind = 'pedir_decisao_do_dono';/);
    expect(funcao).toContain("PERFORM pg_advisory_xact_lock(hashtextextended(_chave, 0));");
    expect(funcao).toContain("'ja_existia', true");
    // A chave inclui o cliente (ou "interno"): a mesma chave em outro cliente não devolve o pedido alheio.
    expect(funcao).toContain("COALESCE(p_client_id::text, 'interno')");
    expect(funcao).toContain("esta chave já foi usada em outro pedido");
    expect(funcao).toContain("a tarefa ou o vínculo não pertence a este cliente");
    expect(funcao).toContain("o vínculo e a tarefa informados não são do mesmo trabalho");
  });

  it("SECURITY DEFINER com search_path vazio, só para authenticated, sem anon", () => {
    expect(funcao).toContain("SECURITY DEFINER");
    expect(funcao).toContain("SET search_path TO ''");
    expect(codigo).toContain(`REVOKE ALL ON FUNCTION ${ASSINATURA} FROM PUBLIC, anon;`);
    expect(codigo).toContain(`GRANT EXECUTE ON FUNCTION ${ASSINATURA} TO authenticated;`);
    expect(codigo.match(/GRANT /g)).toHaveLength(1);
    expect(codigo).toContain(`COMMENT ON FUNCTION ${ASSINATURA} IS`);
  });

  it("só a equipe autenticada e um operador ativo; o cliente do portal nunca passa", () => {
    expect(funcao).toContain("_ator uuid := auth.uid();");
    expect(funcao).toContain("IF _ator IS NULL OR NOT (");
    for (const papel of ["admin", "manager", "design", "traffic"]) expect(funcao).toContain(`public.has_role(_ator, '${papel}'::public.app_role)`);
    expect(funcao).not.toContain("'client'::public.app_role");
    expect(funcao).toContain("IF _op.status <> 'active' THEN");
    expect(funcao).toContain("IF p_client_id IS NOT NULL AND NOT public.can_access_client(p_client_id) THEN");
    expect(funcao).toContain("IF length(_por_que) < 10 THEN");
    // A recusa de papel vem antes de qualquer leitura ou escrita.
    expect(funcao.indexOf("IF _ator IS NULL OR NOT (")).toBeLessThan(funcao.indexOf("FROM public.internal_operators"));
  });

  it("grava um pedido pendente, com origem clara, e nada além da trilha e do aviso aos admins", () => {
    expect(funcao).toContain("'pedir_decisao_do_dono'");
    expect(funcao).toMatch(/1, 'pendente', _chave\)/);
    expect(funcao).toContain("jsonb_build_object('origem', 'precisa_de_voce', 'operador', _slug, 'pedido_por', _ator)");
    const escritas = [...funcao.matchAll(/INSERT INTO public\.([a-z_]+)/g)].map((m) => m[1]);
    expect(escritas).toEqual(["operator_approvals", "operator_audit_log", "notifications"]);
    expect(funcao).toContain("FROM public.user_roles ur WHERE ur.role = 'admin'::public.app_role;");
    expect(funcao).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bPERFORM public\./);
  });

  it("não aprova, não agenda, não publica e não mexe em arquivo, peça, agenda nem vínculo", () => {
    for (const proibido of [
      "decide_file_approval", "aprovar_pelo_cliente", "review_file_agency", "request_file_agency_review",
      "operator_approval_decidir", "transition_editorial_publication", "mesa_enviar_para_aprovacao",
      "public.files", "estudio_trabalhos", "editorial_", "approval_status", "entrega_status", "client_approved",
      "'aprovado'", "decided_by", "executed_at",
    ]) {
      expect(codigo, proibido).not.toContain(proibido);
    }
    expect(codigo).not.toMatch(/CREATE POLICY|DROP POLICY|ALTER POLICY|DISABLE ROW LEVEL SECURITY/i);
    expect(codigo).not.toMatch(/CREATE TABLE|DROP TABLE|TRUNCATE|DELETE FROM|DROP FUNCTION|DROP COLUMN/i);
    expect(codigo).not.toMatch(/\bauth\.users\b/);
    // O vínculo e a tarefa são só referência: lidos, nunca alterados.
    expect(codigo).not.toMatch(/UPDATE\s+public\.operator_task_links|UPDATE\s+public\.tasks/i);
    expect(sql).toContain("-- O que esta migration NÃO faz:");
  });

  it("rollback fora de supabase/migrations: remove função e índice, e não apaga pedido nenhum", () => {
    const rollback = ler("docs/rollback/20261114230000_marcar_precisa_do_dono.sql");
    const executa = rollback.split("\n").filter((linha) => !linha.trim().startsWith("--")).join("\n");
    expect(executa).toContain(`DROP FUNCTION IF EXISTS ${ASSINATURA};`);
    expect(executa).toContain("DROP INDEX IF EXISTS public.operator_approvals_precisa_do_dono_key;");
    expect(executa).not.toMatch(/DELETE|TRUNCATE|DROP TABLE|ALTER TABLE/i);
    // O DELETE dos pedidos existe só como opção comentada, para o operador decidir.
    expect(rollback).toMatch(/--\s+DELETE FROM public\.operator_approvals\s*\n--\s+WHERE action_kind = 'pedir_decisao_do_dono';/);
  });
});
