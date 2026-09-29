/**
 * O agente da campanha muda a campanha de verdade e mostra a prova (29/09).
 *
 * O caso real (Stop Informática, 28/09 19:26): o dono pediu "a campanha tem
 * que rodar até o dia 29" e o agente respondeu "Registrei o encerramento em
 * 29/09/2026", mas o esquema da conversa não tinha período: nada mudou (o fim
 * continuou 15/10) e a mudança de nome e conceito foi gravada calada, sem
 * cartão nem Desfazer.
 *
 * Agora a conversa da campanha também devolve período, situação e tipo; o
 * código confere cada valor (data válida, fim depois do começo, situação e
 * tipo do vocabulário) e o que mudou vira um cartão JÁ FEITO, com o antes e o
 * depois de cada campo e o Desfazer (desfazer_acao_agente do agente do Mês,
 * que volta campo a campo). Pedido sem custo e com reverso: vai direto
 * (regra 6 de _shared/acoes-do-agente.ts).
 *
 * Puro: sem Deno e sem banco. O Vitest lê este arquivo.
 */
import { type AcaoDoAgente, type ItemDaAcaoDoAgente, type ResultadoDoItem, TIPO_DA_ACAO } from "../_shared/acoes-do-agente.ts";
import { rotuloDoTipo, tipoValido } from "../_shared/tipos-de-campanha.ts";

/** Campos a mais no objeto `campanha` do esquema da conversa (todos aceitam null: "não muda"). */
export const CAMPOS_DA_CAMPANHA_NA_CONVERSA = {
  periodo_inicio: { type: ["string", "null"] },
  periodo_fim: { type: ["string", "null"] },
  status: { type: ["string", "null"] },
  tipo: { type: ["string", "null"] },
} as const;

export const STATUS_DA_CAMPANHA = ["planejada", "gravada", "encerrada"] as const;

const ROTULO_DO_CAMPO: Record<string, string> = {
  nome: "Nome",
  objetivo: "Objetivo",
  conceito: "Conceito",
  periodo_inicio: "Começo",
  periodo_fim: "Fim",
  status: "Situação",
  tipo: "Tipo",
  identidade: "Identidade visual",
  briefing: "Briefing (oferta, mensagem, público)",
};

export type CampanhaAtual = {
  id: string;
  nome: string;
  objetivo: string | null;
  conceito: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  status: string;
  identidade: Record<string, unknown> | null;
  briefing?: Record<string, unknown> | null;
};

export type MudancaDaCampanha = { campo: string; rotulo: string; antes: unknown; depois: unknown };

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

/** Data AAAA-MM-DD que existe no calendário, ou null. */
export function dataValida(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().slice(0, 10) : "";
  if (!DATA.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * O que a conversa pediu para mudar no período, na situação e no tipo, já
 * conferido. `recusas` explica o que não entrou (data inválida, fim antes do
 * começo...), para a resposta não dizer que mudou.
 */
export function camposDaCampanhaNaConversa(
  nova: Record<string, unknown> | null,
  atual: CampanhaAtual,
): { campos: Record<string, unknown>; recusas: string[] } {
  const campos: Record<string, unknown> = {};
  const recusas: string[] = [];
  if (!nova) return { campos, recusas };
  const ini = nova.periodo_inicio == null || nova.periodo_inicio === "" ? null : dataValida(nova.periodo_inicio);
  const fim = nova.periodo_fim == null || nova.periodo_fim === "" ? null : dataValida(nova.periodo_fim);
  if (nova.periodo_inicio && !ini) recusas.push(`começo "${umaLinha(nova.periodo_inicio, 20)}" não é uma data válida`);
  if (nova.periodo_fim && !fim) recusas.push(`fim "${umaLinha(nova.periodo_fim, 20)}" não é uma data válida`);
  const inicioFinal = ini || atual.periodo_inicio;
  const fimFinal = fim || atual.periodo_fim;
  if (inicioFinal && fimFinal && fimFinal < inicioFinal) {
    recusas.push(`o fim (${fimFinal}) ficaria antes do começo (${inicioFinal})`);
  } else {
    if (ini && ini !== atual.periodo_inicio) campos.periodo_inicio = ini;
    if (fim && fim !== atual.periodo_fim) campos.periodo_fim = fim;
  }
  if (nova.status != null && nova.status !== "") {
    const s = String(nova.status).trim().toLowerCase();
    if ((STATUS_DA_CAMPANHA as readonly string[]).indexOf(s) < 0) recusas.push(`situação "${umaLinha(nova.status, 20)}" não existe`);
    else if (s !== atual.status) campos.status = s;
  }
  if (nova.tipo != null && nova.tipo !== "") {
    const t = tipoValido(nova.tipo);
    const antes = atual.identidade && typeof atual.identidade === "object" ? tipoValido((atual.identidade as Record<string, unknown>).tipo) : null;
    if (!t) recusas.push(`tipo "${umaLinha(nova.tipo, 30)}" não existe`);
    else if (t !== antes) campos.tipo = t;
  }
  return { campos, recusas };
}

/** O que de fato mudou entre a campanha de antes e a gravada (o cartão mostra antes e depois). */
export function mudancasDaCampanha(antes: CampanhaAtual, depois: CampanhaAtual): MudancaDaCampanha[] {
  const saida: MudancaDaCampanha[] = [];
  const tipoAntes = antes.identidade ? tipoValido((antes.identidade as Record<string, unknown>).tipo) : null;
  const tipoDepois = depois.identidade ? tipoValido((depois.identidade as Record<string, unknown>).tipo) : null;
  for (const campo of ["nome", "objetivo", "conceito", "periodo_inicio", "periodo_fim", "status"] as const) {
    if (!igual(antes[campo], depois[campo])) saida.push({ campo, rotulo: ROTULO_DO_CAMPO[campo], antes: antes[campo] ?? null, depois: depois[campo] ?? null });
  }
  if (tipoAntes !== tipoDepois) saida.push({ campo: "tipo", rotulo: ROTULO_DO_CAMPO.tipo, antes: tipoAntes, depois: tipoDepois });
  // Identidade sem contar o tipo (o tipo já tem linha própria).
  const semTipo = (i: Record<string, unknown> | null) => {
    if (!i || typeof i !== "object") return null;
    const { tipo: _t, ...resto } = i;
    return resto;
  };
  if (!igual(semTipo(antes.identidade), semTipo(depois.identidade))) saida.push({ campo: "identidade", rotulo: ROTULO_DO_CAMPO.identidade, antes: antes.identidade ?? null, depois: depois.identidade ?? null });
  if (antes.briefing !== undefined && !igual(antes.briefing, depois.briefing)) saida.push({ campo: "briefing", rotulo: ROTULO_DO_CAMPO.briefing, antes: antes.briefing ?? null, depois: depois.briefing ?? null });
  return saida;
}

const dataCurta = (v: unknown) => (typeof v === "string" && DATA.test(v) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : null);

/** Texto curto de um valor para o cartão. */
export function valorCurto(campo: string, v: unknown): string {
  if (v == null || v === "") return "vazio";
  if (campo === "periodo_inicio" || campo === "periodo_fim") return dataCurta(v) || String(v);
  if (campo === "tipo") return rotuloDoTipo(v) || String(v);
  if (campo === "identidade" || campo === "briefing") return "atualizado";
  return umaLinha(v, 120);
}

/**
 * O cartão já feito da conversa da campanha: um item por campo que mudou (e
 * um para os conteúdos), cada resultado com o valor de antes para o Desfazer.
 * Null quando nada mudou.
 */
export function acaoDaConversaDaCampanha(
  campanha: { id: string; nome: string; client_id: string },
  mudancas: MudancaDaCampanha[],
  opcoes: { userId: string; conteudos?: { proposta_id: string; itens_antes: unknown[]; quantos: number; task_ids_antes: number } | null; id?: string },
): AcaoDoAgente | null {
  if (!mudancas.length && !opcoes.conteudos) return null;
  const itens: ItemDaAcaoDoAgente[] = [];
  const resultados: ResultadoDoItem[] = [];
  mudancas.forEach((m, i) => {
    const ref = `k${i + 1}`;
    const detalhe = m.campo === "identidade" || m.campo === "briefing" ? "mudou pela conversa" : `antes: ${valorCurto(m.campo, m.antes)}`;
    itens.push({ ref, alvo_id: campanha.id, titulo: m.rotulo, detalhe, operacao: "campanha_campo", rotulo: "mudar", para: null, para_rotulo: valorCurto(m.campo, m.depois) });
    resultados.push({ ref, alvo_id: campanha.id, titulo: m.rotulo, operacao: "campanha_campo", ok: true, desfazer: { campo: m.campo, antes: m.antes ?? null } });
  });
  if (opcoes.conteudos) {
    const c = opcoes.conteudos;
    itens.push({ ref: "c1", alvo_id: c.proposta_id, titulo: "Conteúdos da campanha", detalhe: "os que já estão na agenda não mudam", operacao: "campanha_conteudos", rotulo: "atualizar", para: null, para_rotulo: `${c.quantos} ${c.quantos === 1 ? "conteúdo" : "conteúdos"}` });
    resultados.push({ ref: "c1", alvo_id: c.proposta_id, titulo: "Conteúdos da campanha", operacao: "campanha_conteudos", ok: true, desfazer: { itens_antes: c.itens_antes, task_ids_antes: c.task_ids_antes } });
  }
  const partes = mudancas.map((m) => m.rotulo.toLowerCase().split(" (")[0]);
  if (opcoes.conteudos) partes.push("conteúdos");
  const agora = new Date().toISOString();
  return {
    tipo: TIPO_DA_ACAO,
    agente: "mes",
    id: opcoes.id || `campanha-${Date.now().toString(36)}`,
    resumo: `Mudei na campanha "${umaLinha(campanha.nome, 80)}": ${partes.join(", ")}.`,
    itens,
    ignorados: [],
    recusados: [],
    contexto: { campanha_id: campanha.id, client_id: campanha.client_id, tipo: "campanha_na_conversa" },
    executada_em: agora,
    executada_por: opcoes.userId,
    executada_direto: true,
    resultados,
  };
}

/** Patch que volta um campo da campanha ao valor de antes (tipo mora em identidade.tipo). */
export function patchParaVoltar(campo: string, antes: unknown, identidadeAgora: Record<string, unknown> | null): Record<string, unknown> {
  if (campo === "tipo") {
    const base = { ...(identidadeAgora || {}) };
    if (antes) base.tipo = antes;
    else delete base.tipo;
    return { identidade: base };
  }
  if (["nome", "objetivo", "conceito", "periodo_inicio", "periodo_fim", "status", "identidade", "briefing"].indexOf(campo) < 0) {
    throw new Error("Campo da campanha desconhecido.");
  }
  if (campo === "nome" && (!antes || !String(antes).trim())) throw new Error("O nome de antes estava vazio.");
  return { [campo]: antes ?? null };
}
