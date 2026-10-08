/**
 * Ferramentas do Gestor Aceleriq (Central de Autonomia, 08/10/2026).
 *
 * O Gestor PROPÕE ações no contrato comum (_shared/acoes-do-agente.ts): o
 * modelo só vê apelidos (c1 cliente, p1 projeto, t1 tarefa) e devolve
 * { operacao, ref, para }; o código troca apelido por id real, valida o
 * `para`, aplica as travas e executa item a item, com Desfazer.
 *
 * Níveis (governança):
 * - consulta: responder com fontes (não é ferramenta);
 * - execução interna (aqui): criar e ajustar tarefa, registrar memória,
 *   pedir trabalho a um agente. Reversível e registrado; vai direto só com
 *   ordem clara (regra 6 do contrato), senão Confirmar;
 * - decisão do dono: aprovar ou devolver uma solicitação que JÁ existe
 *   (operator_approvals) pelo mecanismo oficial (central_review_decide ou
 *   operator_approval_decidir), com a sessão do próprio dono. Sempre
 *   Confirmar, sem Desfazer (decisão é final). Aprovar não envia nem publica:
 *   executar o que foi aprovado é etapa à parte. Registrar uma decisão na
 *   memória NÃO substitui aprovar;
 * - sensível: publicar, mandar mensagem a cliente, mexer em campanha ou
 *   verba, contrato, excluir. NUNCA é ferramenta: o modelo devolve em
 *   `bloqueadas` e a tela mostra onde decidir.
 *
 * Puro (sem banco): os executores recebem o cliente do banco por parâmetro.
 */

import type { AlvoComApelido, ItemDaAcaoDoAgente, RegraDaOperacao } from "../../_shared/acoes-do-agente.ts";

export const AGENTE_DO_GESTOR = "gestor";

export const STATUS_EDITAVEIS = ["backlog", "todo", "doing", "review"] as const;
export const PRIORIDADES = ["low", "medium", "high", "urgent"] as const;
export const TIPOS_DE_MEMORIA = ["preferencia", "evitar", "decisao", "instrucao", "aprendizado"] as const;
export const AREAS_DE_MEMORIA = ["geral", "calendario", "campanha", "arte", "foto", "ads", "copy", "conta"] as const;

const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const DATA = /^\d{4}-\d{2}-\d{2}$/;

function lerJson(bruto: unknown): Record<string, unknown> | null {
  if (bruto && typeof bruto === "object" && !Array.isArray(bruto)) return bruto as Record<string, unknown>;
  if (typeof bruto !== "string" || !bruto.trim()) return null;
  try {
    const o = JSON.parse(bruto);
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Uma data válida (AAAA-MM-DD) que existe no calendário; senão null. */
export function dataValida(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!DATA.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}

export type AlvoDoGestor = { id: string; titulo: string; detalhe?: string | null; dados?: Record<string, unknown> };

/** Normalizadores do `para` de cada operação: devolvem o JSON limpo (string) ou null (item ignorado). */
export const PARA = {
  criar_tarefa(bruto: unknown): string | null {
    const o = lerJson(bruto);
    if (!o) return null;
    const titulo = umaLinha(o.titulo, 160);
    if (titulo.length < 3) return null;
    const saida: Record<string, unknown> = { titulo };
    const descricao = String(o.descricao ?? "").trim().slice(0, 4000);
    if (descricao) saida.descricao = descricao;
    const prazo = o.prazo ? dataValida(o.prazo) : null;
    if (o.prazo && !prazo) return null;
    if (prazo) saida.prazo = prazo;
    const prioridade = String(o.prioridade ?? "").toLowerCase();
    if (prioridade && (PRIORIDADES as readonly string[]).indexOf(prioridade) < 0) return null;
    if (prioridade) saida.prioridade = prioridade;
    return JSON.stringify(saida);
  },
  atualizar_tarefa(bruto: unknown): string | null {
    const o = lerJson(bruto);
    if (!o) return null;
    const saida: Record<string, unknown> = {};
    if (o.status !== undefined && o.status !== null && o.status !== "") {
      const s = String(o.status).toLowerCase();
      // "done" passa: a trava recusa com o motivo (concluir é na revisão, com prova).
      if ((STATUS_EDITAVEIS as readonly string[]).indexOf(s) < 0 && s !== "done") return null;
      saida.status = s;
    }
    if (o.prazo !== undefined && o.prazo !== null && o.prazo !== "") {
      const p = dataValida(o.prazo);
      if (!p) return null;
      saida.prazo = p;
    }
    if (o.prioridade) {
      const p = String(o.prioridade).toLowerCase();
      if ((PRIORIDADES as readonly string[]).indexOf(p) < 0) return null;
      saida.prioridade = p;
    }
    if (o.titulo) {
      const t = umaLinha(o.titulo, 160);
      if (t.length < 3) return null;
      saida.titulo = t;
    }
    if (o.nota) saida.nota = String(o.nota).trim().slice(0, 1500);
    return Object.keys(saida).length ? JSON.stringify(saida) : null;
  },
  registrar_memoria(bruto: unknown): string | null {
    const o = lerJson(bruto);
    if (!o) return null;
    const tipo = String(o.tipo ?? "").toLowerCase();
    if ((TIPOS_DE_MEMORIA as readonly string[]).indexOf(tipo) < 0) return null;
    const texto = String(o.texto ?? "").replace(/\s+/g, " ").trim().slice(0, 1200);
    if (texto.length < 5) return null;
    const area = String(o.area ?? "geral").toLowerCase();
    const saida: Record<string, unknown> = { tipo, texto, area: (AREAS_DE_MEMORIA as readonly string[]).indexOf(area) >= 0 ? area : "geral" };
    const evidencia = String(o.evidencia ?? "").trim().slice(0, 600);
    if (evidencia) saida.evidencia = evidencia;
    return JSON.stringify(saida);
  },
  aprovar_solicitacao(bruto: unknown): string | null {
    const o = lerJson(bruto) || {};
    const nota = String(o.nota ?? "").trim().slice(0, 1500);
    return JSON.stringify(nota ? { nota } : {});
  },
  pedir_alteracao(bruto: unknown): string | null {
    const o = lerJson(bruto);
    if (!o) return null;
    const nota = String(o.nota ?? "").trim().slice(0, 1500);
    if (nota.length < 5) return null;
    return JSON.stringify({ nota });
  },
  pedir_ao_agente(bruto: unknown, agentes: string[]): string | null {
    const o = lerJson(bruto);
    if (!o) return null;
    const agente = String(o.agente ?? "").trim().toLowerCase();
    if (agentes.indexOf(agente) < 0) return null;
    const instrucao = String(o.instrucao ?? "").trim().slice(0, 2000);
    if (instrucao.length < 5) return null;
    return JSON.stringify({ agente, instrucao });
  },
};

/** As regras do contrato para o Gestor. `agentes` = slugs ativos (o modelo não inventa agente). */
export function regrasDoGestor(agentes: string[]): Record<string, RegraDaOperacao<AlvoDoGestor>> {
  return {
    criar_tarefa: { rotulo: "criar tarefa", alvos: ["p"], repete: true, direta: true, para: (b) => PARA.criar_tarefa(b) },
    atualizar_tarefa: {
      rotulo: "atualizar tarefa", alvos: ["t"], direta: true, para: (b) => PARA.atualizar_tarefa(b),
      trava: (alvo, para) => {
        const p = lerJson(para) || {};
        if (p.status === "done") return "Concluir é na revisão, com prova (Execução ou Kanban), não pelo Gestor.";
        if ((alvo.dados?.status as string) === "done") return "A tarefa já está concluída; reabra pelo Kanban se for o caso.";
        return null;
      },
    },
    registrar_memoria: {
      rotulo: "registrar na memória do cliente", alvos: ["c"], repete: true, direta: true, para: (b) => PARA.registrar_memoria(b),
      trava: (_alvo, para) => {
        const p = lerJson(para) || {};
        return p.tipo === "aprendizado" && !p.evidencia ? "Aprendizado só com evidência (resultado medido ou fonte); sem isso é hipótese." : null;
      },
    },
    pedir_ao_agente: {
      rotulo: "pedir a um agente", alvos: ["t"], para: (b) => PARA.pedir_ao_agente(b, agentes),
      trava: (alvo) => ((alvo.dados?.status as string) === "done" ? "A tarefa já está concluída." : null),
    },
    // Decisão do dono sobre uma solicitação existente: nunca direta (sempre Confirmar), sem Desfazer.
    aprovar_solicitacao: {
      rotulo: "aprovar a solicitação", alvos: ["a"], para: (b) => PARA.aprovar_solicitacao(b),
      trava: (alvo) => travaDaSolicitacao(alvo),
    },
    pedir_alteracao: {
      rotulo: "devolver com pedido de alteração", alvos: ["a"], para: (b) => PARA.pedir_alteracao(b),
      trava: (alvo) => travaDaSolicitacao(alvo),
    },
  };
}

function travaDaSolicitacao(alvo: AlvoDoGestor): string | null {
  const st = String(alvo.dados?.status || "");
  if (st && st !== "pendente" && st !== "adiado") return `Esta solicitação já foi decidida (${st}); decisão não volta atrás.`;
  const validade = alvo.dados?.valid_until ? Date.parse(String(alvo.dados.valid_until)) : NaN;
  if (Number.isFinite(validade) && validade <= Date.now()) return "Esta solicitação venceu; peça uma versão nova ao agente.";
  return null;
}

/** Operações de decisão: pedem a sessão do dono e nunca vão direto. */
export const OPERACOES_DE_DECISAO = ["aprovar_solicitacao", "pedir_alteracao"];

export const DESCRICOES_DAS_OPERACOES: Record<string, string> = {
  criar_tarefa: 'cria uma tarefa no projeto pN. para = JSON {"titulo","descricao"?,"prazo"?:"AAAA-MM-DD","prioridade"?:"low|medium|high|urgent"}. Uma por tarefa pedida.',
  atualizar_tarefa: 'ajusta a tarefa tN. para = JSON com só o que muda: {"status"?:"backlog|todo|doing|review","prazo"?,"prioridade"?,"titulo"?,"nota"?}. Nunca "done": concluir é na revisão com prova.',
  registrar_memoria: 'grava na memória do cliente cN. para = JSON {"tipo":"preferencia|evitar|decisao|instrucao|aprendizado","texto","area"?:"geral|calendario|campanha|arte|foto|ads|copy|conta","evidencia"?}. Preferência e evitar = gosto do cliente; decisão = algo que o dono APROVOU; instrução = regra operacional nova; aprendizado só com evidência medida. Hipótese não é memória.',
  pedir_ao_agente: 'manda a tarefa tN para a fila de um agente e deixa a instrução no diário dele. para = JSON {"agente":"<slug da lista>","instrucao"}. Pede Confirmar.',
  aprovar_solicitacao: 'aprova a solicitação aN (pedido real de aprovação do OS) pelo mecanismo oficial. para = JSON {"nota"?}. Use quando o dono disser para aprovar ("pode aprovar", "aprova essa"). Sempre pede Confirmar. Aprovar NÃO envia nem publica: o envio é etapa à parte. NUNCA troque isto por registrar_memoria.',
  pedir_alteracao: 'devolve a solicitação aN ao agente pedindo alteração. para = JSON {"nota":"o que mudar"} (obrigatório). Sempre pede Confirmar.',
};

/** Tarefa → alvo tN (sem id no prompt). */
export function alvoDaTarefa(t: { id: string; title: string; status: string; cliente?: string | null; due_date?: string | null }): AlvoDoGestor {
  return { id: t.id, titulo: t.title, detalhe: [t.status, t.cliente, t.due_date ? `prazo ${t.due_date}` : ""].filter(Boolean).join(" · "), dados: { status: t.status } };
}

/** Objeto do OS que a Central abre na lateral nativa (sem iframe). */
export type ObjetoDoGestor = { tipo: "tarefa" | "memoria_agente" | "memoria_projeto" | "aprovacao" | "projeto" | "arquivo" | "publicacao" | "vinculo"; id: string; titulo?: string | null; client_id?: string | null };

export type EntregaDoGestor = {
  ref: string;
  nome: string;
  tipo: "tarefa" | "memoria" | "fila_do_agente" | "aprovacao";
  objeto?: ObjetoDoGestor;
  cliente: string | null;
  projeto: string | null;
  estado: string;
  id: string;
  link: string;
  proxima: string;
};

/** O texto de um item para o resumo da conversa ("criar tarefa: X"). */
export function linhaDoItem(i: ItemDaAcaoDoAgente): string {
  const p = lerJson(i.para) || {};
  const nome = (p.titulo as string) || (p.texto as string) || (p.instrucao as string) || i.titulo;
  return `${i.rotulo}: ${umaLinha(nome, 120)}`;
}

export function paraDoItem(i: Pick<ItemDaAcaoDoAgente, "para">): Record<string, unknown> {
  return lerJson(i.para) || {};
}

export type { AlvoComApelido };
