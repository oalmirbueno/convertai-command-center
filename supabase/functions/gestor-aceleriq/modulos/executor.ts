/**
 * Executor das ferramentas do Gestor (Central de Autonomia, 08/10/2026).
 *
 * Toda escrita:
 * - confere o isolamento: com cliente na conversa, o projeto, a tarefa e a
 *   memória têm de ser desse cliente (o id vem do apelido, nunca do modelo);
 * - grava a origem (Gestor Aceleriq), o autor e a conversa;
 * - devolve o que o Desfazer precisa;
 * - nunca diz "feito" sem reler a linha gravada (a entrega sai da releitura).
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ErroDaAcao, type AcaoDoAgente, type ItemDaAcaoDoAgente, type ResultadoDoItem } from "../../_shared/acoes-do-agente.ts";
import { type EntregaDoGestor, paraDoItem } from "./ferramentas.ts";

const FONTE = "gestor-aceleriq";

type Contexto = { client_id?: string | null; conversa_id?: string | null; pergunta?: string | null };

function contextoDa(acao: AcaoDoAgente): Contexto {
  return (acao.contexto || {}) as Contexto;
}

async function projetoDoCliente(db: SupabaseClient, projetoId: string, ctx: Contexto) {
  const { data, error } = await db.from("projects").select("id, name, client_id").eq("id", projetoId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ErroDaAcao(404, "projeto_inexistente", "Esse projeto não existe mais.");
  const p = data as { id: string; name: string; client_id: string | null };
  if (ctx.client_id && p.client_id !== ctx.client_id) throw new ErroDaAcao(403, "outro_cliente", "Esse projeto é de outro cliente: nada foi feito.");
  return p;
}

async function tarefaDoCliente(db: SupabaseClient, tarefaId: string, ctx: Contexto) {
  const { data, error } = await db.from("tasks").select("id, title, status, priority, due_date, description, deleted_at, project:projects!tasks_project_id_fkey(id, name, client_id)").eq("id", tarefaId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ErroDaAcao(404, "tarefa_inexistente", "Essa tarefa não existe mais.");
  const t = data as unknown as { id: string; title: string; status: string; priority: string | null; due_date: string | null; description: string | null; deleted_at: string | null; project: { id: string; name: string; client_id: string | null } | null };
  if (t.deleted_at) throw new ErroDaAcao(409, "tarefa_excluida", "Essa tarefa foi excluída.");
  if (ctx.client_id && t.project?.client_id !== ctx.client_id) throw new ErroDaAcao(403, "outro_cliente", "Essa tarefa é de outro cliente: nada foi feito.");
  return t;
}

/** Erros do mecanismo oficial de decisão, em português. */
const ERROS_DA_DECISAO: Record<string, string> = {
  CENTRAL_SOURCE_STALE: "Os dados do relatório mudaram depois que ele foi preparado. Atualize a revisão antes de aprovar.",
  CENTRAL_REPORT_VERSION_CONFLICT: "A versão desta solicitação mudou. Abra de novo para decidir a versão atual.",
  CENTRAL_ALREADY_DECIDED: "Esta solicitação já foi decidida.",
  CENTRAL_APPROVAL_EXPIRED: "Esta solicitação venceu. Peça uma versão nova.",
  CENTRAL_REPORT_NOT_DRAFT: "O relatório não está mais em rascunho.",
  CENTRAL_SUMMARY_REQUIRED: "O relatório está sem a mensagem. Complete o rascunho antes de aprovar.",
  CENTRAL_NEXT_STEPS_REQUIRED: "O relatório está sem o próximo passo. Complete o rascunho antes de aprovar.",
  CENTRAL_CLIENT_MISMATCH: "Esta solicitação é de outro cliente.",
  CENTRAL_COMMENT_REQUIRED: "Escreva o que precisa mudar.",
  ja_decidida: "Esta solicitação já foi decidida; decisão não volta atrás.",
  apenas_admin: "Só o admin decide aprovações.",
};

function erroDaDecisao(mensagem: string): ErroDaAcao {
  const chave = Object.keys(ERROS_DA_DECISAO).find((k) => mensagem.includes(k));
  return new ErroDaAcao(409, "decisao_recusada", chave ? ERROS_DA_DECISAO[chave] : `O mecanismo de aprovação recusou: ${mensagem}`);
}

/**
 * Decide uma solicitação existente pelo MESMO mecanismo da tela de Decisões
 * (src/lib/execucaoApresentacao.ts: central_review_decide para relatórios da
 * Central, operator_approval_decidir para os demais), com a sessão do dono
 * (as funções conferem auth.uid()). Fica registrado quem, quando e a versão.
 */
async function decidirSolicitacao(db: SupabaseClient, comoDono: SupabaseClient | null, item: ItemDaAcaoDoAgente, acao: AcaoDoAgente, ctx: Contexto, p: Record<string, unknown>) {
  if (!comoDono) throw new ErroDaAcao(401, "sessao_do_dono", "Aprovar precisa da sua sessão. Atualize a tela e confirme de novo.");
  const { data, error } = await db.from("operator_approvals").select("id, status, origin, report_id, client_id, payload, payload_hash, payload_version, valid_until, o_que").eq("id", item.alvo_id).maybeSingle();
  if (error) throw new Error(error.message);
  const a = data as { id: string; status: string; origin: string | null; report_id: string | null; client_id: string | null; payload: Record<string, unknown> | null; payload_hash: string | null; payload_version: number; valid_until: string | null; o_que: string } | null;
  if (!a) throw new ErroDaAcao(404, "solicitacao_inexistente", "Essa solicitação não existe mais.");
  if (ctx.client_id && a.client_id && a.client_id !== ctx.client_id) throw new ErroDaAcao(403, "outro_cliente", "Essa solicitação é de outro cliente: nada foi feito.");
  if (a.status !== "pendente" && a.status !== "adiado") throw new ErroDaAcao(409, "ja_decidida", `Esta solicitação já está como ${a.status}.`);
  const decisao = item.operacao === "aprovar_solicitacao" ? "aprovado" : "alteracoes_pedidas";
  const nota = String(p.nota || "").trim();
  let r;
  if (a.origin === "central" || a.report_id) {
    if (!a.client_id || !a.payload_hash || !Number.isInteger(a.payload_version)) throw new ErroDaAcao(409, "sem_identidade", "Solicitação sem identidade completa. Atualize a revisão.");
    r = await comoDono.rpc("central_review_decide", {
      _approval_id: a.id, _expected_client_id: a.client_id, _expected_version: a.payload_version, _expected_payload_hash: a.payload_hash,
      _decision: decisao, _comment: nota || null, _idempotency_key: `gestor-${acao.id}-${item.ref}`.slice(0, 128),
    });
  } else {
    r = await comoDono.rpc("operator_approval_decidir", { _approval_id: a.id, _decisao: decisao, _nota: nota || `Decidido pelo dono na Central (Gestor Aceleriq).` });
  }
  if (r.error) throw erroDaDecisao(r.error.message);
  return { desfazer: { approval_id: a.id, decisao, versao: a.payload_version } };
}

export async function executarItem(db: SupabaseClient, item: ItemDaAcaoDoAgente, acao: AcaoDoAgente, userId: string, comoDono: SupabaseClient | null = null): Promise<{ desfazer?: Record<string, unknown> | null; aviso?: string }> {
  const ctx = contextoDa(acao);
  const p = paraDoItem(item);

  if (item.operacao === "aprovar_solicitacao" || item.operacao === "pedir_alteracao") {
    return await decidirSolicitacao(db, comoDono, item, acao, ctx, p);
  }

  if (item.operacao === "criar_tarefa") {
    const projeto = await projetoDoCliente(db, item.alvo_id, ctx);
    const linha = {
      project_id: projeto.id,
      title: String(p.titulo),
      description: [p.descricao ? String(p.descricao) : "", `Criada pelo Gestor Aceleriq a pedido do dono${ctx.pergunta ? `: "${String(ctx.pergunta).slice(0, 300)}"` : "."}`].filter(Boolean).join("\n\n"),
      status: "todo",
      priority: (p.prioridade as string) || "medium",
      due_date: (p.prazo as string) || null,
      source: FONTE,
    };
    const { data, error } = await db.from("tasks").insert(linha).select("id").single();
    if (error || !data) throw new Error(error?.message || "A tarefa não foi gravada.");
    return { desfazer: { task_id: (data as { id: string }).id } };
  }

  if (item.operacao === "atualizar_tarefa") {
    const t = await tarefaDoCliente(db, item.alvo_id, ctx);
    const antes = { status: t.status, priority: t.priority, due_date: t.due_date, title: t.title, description: t.description };
    const mudanca: Record<string, unknown> = {};
    if (p.status) mudanca.status = p.status;
    if (p.prioridade) mudanca.priority = p.prioridade;
    if (p.prazo) mudanca.due_date = p.prazo;
    if (p.titulo) mudanca.title = p.titulo;
    if (p.nota) {
      const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
      mudanca.description = `${t.description ? `${t.description}\n\n` : ""}Nota do Gestor Aceleriq (${hoje}): ${String(p.nota)}`;
    }
    const { error } = await db.from("tasks").update(mudanca).eq("id", t.id);
    if (error) throw new Error(error.message);
    return { desfazer: { task_id: t.id, antes } };
  }

  if (item.operacao === "registrar_memoria") {
    const clientId = item.alvo_id;
    if (ctx.client_id && clientId !== ctx.client_id) throw new ErroDaAcao(403, "outro_cliente", "Essa memória seria de outro cliente: nada foi feito.");
    const tipo = String(p.tipo);
    const texto = String(p.texto);
    const evidencia = [p.evidencia ? String(p.evidencia) : "", ctx.pergunta ? `Pedido do dono: "${String(ctx.pergunta).slice(0, 400)}"` : ""].filter(Boolean).join(" · ");
    if (tipo === "preferencia" || tipo === "evitar") {
      const { data, error } = await db.from("agente_memoria").insert({
        client_id: clientId, agente: "geral", tipo, texto, origem: "manual", area: p.area || "geral",
        categoria: tipo === "evitar" ? "evitar" : "preferencia", fonte: FONTE, evidencia: evidencia || null, criado_por: userId,
      }).select("id").single();
      if (error || !data) throw new Error(error?.message || "A memória não foi gravada.");
      return { desfazer: { tabela: "agente_memoria", id: (data as { id: string }).id, client_id: clientId } };
    }
    const { data, error } = await db.from("project_memory").insert({
      client_id: clientId, kind: tipo, source: FONTE, title: texto.slice(0, 120), content: texto,
      tags: ["gestor-aceleriq", tipo], created_by: userId,
      metadata: { origem: FONTE, autor: userId, conversa_id: ctx.conversa_id || null, evidencia: evidencia || null, registrado_em: new Date().toISOString(), area: p.area || "geral" },
    }).select("id").single();
    if (error || !data) throw new Error(error?.message || "A memória não foi gravada.");
    return { desfazer: { tabela: "project_memory", id: (data as { id: string }).id, client_id: clientId } };
  }

  if (item.operacao === "pedir_ao_agente") {
    const t = await tarefaDoCliente(db, item.alvo_id, ctx);
    const agente = String(p.agente);
    const instrucao = String(p.instrucao);
    const { error } = await db.rpc("operator_assign_task", { _operator_slug: agente, _kanban_task_id: t.id, _actor: `gestor:${userId}`, _note: instrucao.slice(0, 500) });
    if (error) throw new ErroDaAcao(409, "fila_recusou", `A fila do agente recusou: ${error.message}`);
    const { data: op } = await db.from("internal_operators").select("id").eq("slug", agente).maybeSingle();
    const { data: link } = await db.from("operator_task_links").select("id").eq("kanban_task_id", t.id).eq("operator_id", (op as { id: string } | null)?.id || "").order("created_at", { ascending: false }).limit(1).maybeSingle();
    const linkId = (link as { id: string } | null)?.id || null;
    if (linkId) {
      const { error: e2 } = await db.from("operator_participations").insert({
        task_link_id: linkId, author_kind: "humano", author_id: userId, entry_type: "instrucao", title: "Pedido do Gestor Aceleriq", body: instrucao, attachments: [],
      });
      if (e2) return { desfazer: null, aviso: `Foi para a fila, mas a instrução não entrou no diário: ${e2.message}` };
    }
    return { desfazer: null, aviso: linkId ? undefined : "Foi para a fila do agente; o vínculo ainda não apareceu para o diário." };
  }

  throw new ErroDaAcao(400, "operacao_desconhecida", "Operação desconhecida.");
}

export async function reverterItem(db: SupabaseClient, r: ResultadoDoItem): Promise<void> {
  const d = (r.desfazer || {}) as Record<string, unknown>;
  if (r.operacao === "criar_tarefa") {
    // A tarefa criada agora sai para a lixeira (exclusão lógica), nunca apagada de vez.
    const { error } = await db.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", String(d.task_id || "")).is("deleted_at", null);
    if (error) throw new Error(error.message);
    return;
  }
  if (r.operacao === "atualizar_tarefa") {
    const antes = (d.antes || {}) as Record<string, unknown>;
    const { error } = await db.from("tasks").update({ status: antes.status, priority: antes.priority, due_date: antes.due_date, title: antes.title, description: antes.description }).eq("id", String(d.task_id || ""));
    if (error) throw new Error(error.message);
    return;
  }
  if (r.operacao === "registrar_memoria") {
    if (d.tabela === "agente_memoria") {
      const { error } = await db.from("agente_memoria").update({ ativa: false }).eq("id", String(d.id || ""));
      if (error) throw new Error(error.message);
      return;
    }
    // Registro que o próprio Gestor acabou de criar: desfazer remove a linha (não há decisão anterior sobrescrita).
    const { error } = await db.from("project_memory").delete().eq("id", String(d.id || "")).eq("source", FONTE);
    if (error) throw new Error(error.message);
    return;
  }
  throw new Error("Sem Desfazer para esta operação.");
}

/** As entregas da proposta feita, RELIDAS do banco (estado real, id gravado, atalho e próxima ação). */
export async function entregasDaAcao(db: SupabaseClient, acao: AcaoDoAgente): Promise<EntregaDoGestor[]> {
  const saida: EntregaDoGestor[] = [];
  const itens = new Map(acao.itens.map((i) => [`${i.operacao}|${i.ref}`, i]));
  for (const r of acao.resultados || []) {
    if (!r.ok) continue;
    const d = (r.desfazer || {}) as Record<string, unknown>;
    const item = itens.get(`${r.operacao}|${r.ref}`);
    try {
      if (r.operacao === "criar_tarefa" || r.operacao === "atualizar_tarefa" || r.operacao === "pedir_ao_agente") {
        const id = String(d.task_id || r.alvo_id);
        const { data } = await db.from("tasks").select("id, title, status, deleted_at, project:projects!tasks_project_id_fkey(id, name, client:profiles!projects_client_id_fkey(company_name, full_name))").eq("id", id).maybeSingle();
        const t = data as unknown as { id: string; title: string; status: string; deleted_at: string | null; project: { id: string; name: string; client: { company_name: string | null; full_name: string | null } | null } | null } | null;
        if (!t) continue;
        let link = `/kanban?task=${t.id}`;
        let estado = t.deleted_at ? "na lixeira" : t.status;
        let proxima = r.operacao === "criar_tarefa" ? "Peça aqui para mandar a um agente, ou abra no Kanban." : "Acompanhe no Kanban.";
        let tipo: EntregaDoGestor["tipo"] = "tarefa";
        if (r.operacao === "pedir_ao_agente") {
          const p = item ? paraDoItem(item) : {};
          const { data: op } = await db.from("internal_operators").select("id, display_name").eq("slug", String(p.agente || "")).maybeSingle();
          const o = op as { id: string; display_name: string } | null;
          const { data: l } = await db.from("operator_task_links").select("id, status").eq("kanban_task_id", t.id).eq("operator_id", o?.id || "").order("created_at", { ascending: false }).limit(1).maybeSingle();
          const vinculo = l as { id: string; status: string } | null;
          if (vinculo) { link = `/execucao?vinculo=${vinculo.id}`; estado = `na fila de ${o?.display_name || p.agente} (${vinculo.status})`; }
          proxima = "O agente pega na próxima rodada do Hermes; a resposta volta no diário e aqui no Histórico.";
          tipo = "fila_do_agente";
        }
        saida.push({ ref: r.ref, nome: t.title, tipo, objeto: { tipo: "tarefa", id: t.id, titulo: t.title, client_id: null }, cliente: t.project?.client?.company_name || t.project?.client?.full_name || null, projeto: t.project?.name || null, estado, id: t.id, link, proxima });
      } else if (r.operacao === "registrar_memoria") {
        const tabela = String(d.tabela);
        const { data } = tabela === "agente_memoria"
          ? await db.from("agente_memoria").select("id, texto, tipo, ativa, client_id").eq("id", String(d.id)).maybeSingle()
          : await db.from("project_memory").select("id, title, kind, client_id").eq("id", String(d.id)).maybeSingle();
        const m = data as Record<string, unknown> | null;
        if (!m) continue;
        const { data: c } = await db.from("profiles").select("company_name, full_name").eq("id", String(m.client_id)).maybeSingle();
        const cli = c as { company_name: string | null; full_name: string | null } | null;
        saida.push({
          ref: r.ref, nome: String(m.texto || m.title || "Memória"), tipo: "memoria", cliente: cli?.company_name || cli?.full_name || null, projeto: null,
          objeto: { tipo: tabela === "agente_memoria" ? "memoria_agente" : "memoria_projeto", id: String(m.id), titulo: String(m.texto || m.title || "Memória").slice(0, 120), client_id: String(m.client_id) },
          estado: tabela === "agente_memoria" ? (m.ativa ? `${m.tipo} ativa` : "desativada") : `${m.kind} registrada`, id: String(m.id),
          link: `/mesa?client=${m.client_id}&aba=contexto`, proxima: "Os agentes das Mesas já leem isto no próximo pedido.",
        });
      } else if (r.operacao === "aprovar_solicitacao" || r.operacao === "pedir_alteracao") {
        const { data } = await db.from("operator_approvals").select("id, o_que, status, decided_at, payload_version, client_id, client:profiles!operator_approvals_client_id_fkey(company_name, full_name)").eq("id", String(d.approval_id || r.alvo_id)).maybeSingle();
        const a = data as unknown as { id: string; o_que: string; status: string; decided_at: string | null; payload_version: number; client_id: string | null; client: { company_name: string | null; full_name: string | null } | null } | null;
        if (!a) continue;
        saida.push({
          ref: r.ref, nome: a.o_que, tipo: "aprovacao", objeto: { tipo: "aprovacao", id: a.id, titulo: a.o_que, client_id: a.client_id },
          cliente: a.client?.company_name || a.client?.full_name || null, projeto: null,
          estado: `${a.status} (versão ${a.payload_version})`, id: a.id, link: "/execucao?aba=decisoes",
          proxima: a.status === "aprovado" ? "Aprovado não é enviado: o envio é a próxima etapa, no fluxo de envio." : "O agente recebe o pedido de alteração e prepara outra versão.",
        });
      }
    } catch {
      /* uma entrega que não relê não vira cartão (nunca um "feito" sem prova) */
    }
  }
  return saida;
}
