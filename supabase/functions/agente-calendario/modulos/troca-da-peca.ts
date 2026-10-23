/**
 * Trocar o que não gostou (24/10/2026). Dono: "ter o poder de trocar conteúdos
 * se eu quiser e não gostar da esteira que tem pronta".
 *
 * - Trocar uma peça: o painel propõe 3 substitutas do mesmo dia (outro tema
 *   e/ou outro formato) numa chamada só, o Jev dá a nota de cada uma e
 *   recomenda a melhor (gerar a mais e escolher, sem laço de correção). A
 *   equipe escolhe e confirma; Desfazer volta a peça de antes.
 * - Trocar várias: refazer a semana, o mês inteiro ou só as não feitas. Peças
 *   com arte pronta, post vinculado, publicação ou pedido do cliente ficam
 *   protegidas, e a lista mostra quais e por quê.
 *
 * Puro (sem Deno, sem banco): a função, a tela e o Vitest leem este arquivo.
 * Sem travessão nos textos.
 */
import { segundaDaSemana, somarDias } from "./cadencia-do-mes.ts";
import { formatoDaOpcao, OPCOES_DO_MES, ROTULO_DA_OPCAO, type OpcaoDoMes } from "./escolha-do-mes.ts";

/** Quantas substitutas por troca (gerar a mais e escolher). */
export const OPCOES_POR_TROCA = 3;

// ------------------------------------------------------------------ proteção

export type SituacaoDaPeca = {
  /** Tarefa nascida de um pedido do cliente. */
  dePedido?: boolean;
  /** Publicação do post ligado: "scheduled", "published" ou nada. */
  publicacao?: string | null;
  /** Há post da Agenda ligado à peça (editorial_post_internal). */
  temPost?: boolean;
  /** Entrega da arte no Estúdio ("aprovado", "agendado", "enviado"...). */
  entrega?: string | null;
  /** Arte pronta ou entregue no Estúdio (status pronto/entregue/gerando ou lâminas geradas). */
  artePronta?: boolean;
  /** Trabalho já começado no Estúdio (direção feita, rascunho com texto), sem arte pronta. */
  emProducao?: boolean;
  status?: string | null;
};

const ESTADOS_FEITOS = ["done", "completed", "published", "cancelled", "archived"];

/** Motivo que protege a peça de ser trocada ou refeita. Null quando pode trocar. */
export function protecaoDaPeca(p: SituacaoDaPeca): string | null {
  if (p.dePedido) return "Veio de um pedido do cliente.";
  if (p.publicacao === "published") return "Já foi publicada.";
  if (p.publicacao === "scheduled") return "A publicação está agendada.";
  if (p.entrega === "aprovado" || p.entrega === "agendado") return "A arte já foi aprovada.";
  if (p.artePronta) return "Tem arte pronta no Estúdio.";
  if (p.temPost) return "Tem post vinculado na Agenda.";
  if (ESTADOS_FEITOS.indexOf(String(p.status || "")) >= 0) return "A peça já foi concluída.";
  return null;
}

/** Peça "não feita": sem proteção e sem nada começado no Estúdio. */
export const pecaNaoFeita = (p: SituacaoDaPeca) => !protecaoDaPeca(p) && !p.emProducao;

export type PecaDaEsteira = SituacaoDaPeca & { id: string; title: string; due_date: string | null; delivery_type: string | null };
export type PecaProtegida = { task_id: string; titulo: string; data: string | null; motivo: string };

/**
 * O escopo do "Trocar várias": as peças do mês (ou da semana que começa na
 * segunda informada), de hoje em diante. As protegidas saem com o motivo; com
 * "só as não feitas", as que já começaram no Estúdio também ficam, com o
 * motivo "Já está em produção no Estúdio".
 */
export function escopoDaEsteira(
  pecas: PecaDaEsteira[],
  o: { mes: string; semana?: string | null; soNaoFeitas: boolean; hoje: string },
): { refazer: PecaDaEsteira[]; protegidas: PecaProtegida[] } {
  const mes = String(o.mes || "").slice(0, 7);
  const seg = o.semana && /^\d{4}-\d{2}-\d{2}$/.test(o.semana) ? segundaDaSemana(o.semana) : null;
  const dom = seg ? somarDias(seg, 6) : null;
  const refazer: PecaDaEsteira[] = [];
  const protegidas: PecaProtegida[] = [];
  const ordenadas = pecas.slice().sort((a, b) => String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")) || String(a.title).localeCompare(String(b.title)));
  for (const p of ordenadas) {
    const data = p.due_date ? p.due_date.slice(0, 10) : null;
    if (!data || data.slice(0, 7) !== mes) continue;
    if (seg && dom && (data < seg || data > dom)) continue;
    if (data < o.hoje) continue;
    const motivo = protecaoDaPeca(p) || (o.soNaoFeitas && p.emProducao ? "Já está em produção no Estúdio." : null);
    if (motivo) protegidas.push({ task_id: p.id, titulo: p.title, data, motivo });
    else refazer.push(p);
  }
  return { refazer, protegidas };
}

// ------------------------------------------------------------------ as opções

/** O que a troca pede: formato fixo (a equipe escolheu) ou livre (o painel varia). */
export function formatosDasOpcoes(atual: OpcaoDoMes, pedido: OpcaoDoMes | null, preferidas: OpcaoDoMes[] = []): OpcaoDoMes[] {
  if (pedido) return Array.from({ length: OPCOES_POR_TROCA }, () => pedido);
  // Livre: a primeira no formato de agora (tema novo) e as outras em formatos diferentes, as preferidas primeiro.
  const outras = preferidas.concat(OPCOES_DO_MES.map((o) => o.id)).filter((o, i, l) => o !== atual && l.indexOf(o) === i);
  return [atual].concat(outras.slice(0, OPCOES_POR_TROCA - 1));
}

/** O texto da tarefa ao modelo (o contexto do cliente vem antes, pelo servidor). */
export function pedidoDaTroca(p: {
  atual: { titulo: string; data: string; opcao: OpcaoDoMes; gancho?: string | null; resumo?: string | null };
  formatos: OpcaoDoMes[];
  pedido?: string | null;
  doMes: string[];
}): string {
  const linhas = p.formatos.map((f, i) => `- opção ${i + 1}: ${ROTULO_DA_OPCAO[f]} (opcao ${f})`);
  return [
    `TROCAR UMA PEÇA DA AGENDA: a equipe não gostou de "${p.atual.titulo}" (${ROTULO_DA_OPCAO[p.atual.opcao]}, ${p.atual.data}).`,
    p.atual.gancho ? `Gancho de agora: ${p.atual.gancho}` : "",
    p.pedido ? `Pedido da equipe para a troca: ${p.pedido}` : "",
    `Proponha ${p.formatos.length} substitutas para o MESMO DIA (${p.atual.data}), cada uma com tema novo, diferente da peça de agora e das outras opções:`,
    ...linhas,
    "Cada opção é um conteúdo completo, pronto para a agenda: tema, gancho, resumo, copy, CTA, público, pilar, objetivo; carrossel com as lâminas em cards; estático com 1 card; foto com a direção em foto; vídeo com a direção em video (gravar: pessoa falando com gancho nos 2 primeiros segundos, narracao com a fala; IA: cenas geradas a partir de fotos reais, sem pessoa falando); Stories com cards vazios e o resumo do que a sequência do dia mostra.",
    p.doMes.length ? `Já estão no mês (não repita o tema nem o ângulo): ${p.doMes.slice(0, 40).join("; ")}.` : "",
    "por_que: 1 frase dizendo por que esta opção funciona melhor neste dia para este cliente.",
  ].filter(Boolean).join("\n");
}

/** A pergunta do Jev: uma nota por opção, numa chamada só, sobre `opcoes`, `atual` e `cliente`. */
export const NIVEIS_DA_TROCA = [
  "Não substitui bem a peça",
  "Substitui, mas rende pouco",
  "Boa substituta para este dia",
  "A melhor escolha para este dia",
];
export function perguntasDaTroca(n: number): Record<string, { type: "score"; instructions: string; criteria: string[] }> {
  const q: Record<string, { type: "score"; instructions: string; criteria: string[] }> = {};
  for (let i = 0; i < n; i++) {
    q[`o${i}`] = {
      type: "score",
      instructions: `A equipe não gostou da peça \`atual\` e quer trocá-la. Quanto a opção \`opcoes[${i}]\` rende no Instagram deste \`cliente\` neste dia, no lugar da atual (tema claro, gancho forte, formato que combina com o nicho, sem repetir o mês)?`,
      criteria: NIVEIS_DA_TROCA,
    };
  }
  return q;
}

/** A recomendada: a de maior nota do Jev (empate: a primeira); sem notas, a primeira. */
export function recomendadaDaTroca(answers: Record<string, { score?: number } | undefined> | null | undefined, n: number): { indice: number; notas: Array<number | null>; fonte: "jev" | "ordem" } {
  const notas: Array<number | null> = [];
  for (let i = 0; i < n; i++) {
    const s = answers && answers[`o${i}`] ? answers[`o${i}`]!.score : undefined;
    notas.push(typeof s === "number" && Number.isFinite(s) ? s : null);
  }
  if (!notas.some((x) => x !== null)) return { indice: 0, notas, fonte: "ordem" };
  let indice = 0;
  for (let i = 1; i < n; i++) if ((notas[i] ?? -1) > (notas[indice] ?? -1)) indice = i;
  return { indice, notas, fonte: "jev" };
}

/** A entrega da tarefa para a opção (foto decide carrossel ou post único na hora de gravar). */
export function entregaDaOpcao(o: OpcaoDoMes): string {
  if (o === "stories") return "story";
  const f = formatoDaOpcao(o).formato;
  return f === "video" ? "reel" : f === "estatico" ? "static" : "carousel";
}

/** A frase do resultado da troca ("Trocada: X por Y (Vídeo com IA). Dá para desfazer."). */
export function fraseDaTrocaFeita(antes: string, depois: string, o: OpcaoDoMes): string {
  return `Trocada: "${antes.slice(0, 80)}" por "${depois.slice(0, 80)}" (${ROTULO_DA_OPCAO[o]}). Dá para desfazer.`;
}

// ------------------------------------------------------------------ aplicar e desfazer

/** O mesmo recibo do mudar formato (mudanca-de-formato.ts): tabela, id, o antes e o depois de cada gravação. */
export type PassoDaTroca = { tabela: string; id: string; antes: Record<string, unknown>; depois: Record<string, unknown> };
type TrabalhoDaTroca = { id: string; direcao: unknown; status: string; cards: unknown[] | null; entrega_status: string | null };

/** Trabalho do Estúdio que a troca pode reescrever: sem entrega, sem arte gerando ou pronta e sem lâminas geradas. */
export const trabalhoLivre = (w: TrabalhoDaTroca) => !w.entrega_status && ["gerando", "pronto", "entregue"].indexOf(w.status) < 0 && !(Array.isArray(w.cards) && w.cards.length > 0);

/**
 * Os passos da troca, na ordem em que são gravados: o item do roteiro (só o da peça; os outros itens ficam
 * iguais), a direção ainda sem arte (volta a rascunho com o conteúdo novo) e a tarefa (título, descrição e
 * entrega). O Desfazer aplica os mesmos passos ao contrário.
 */
export function passosDaTroca(e: {
  taskId: string;
  tarefa: { delivery_type: string; title: string; description: string | null };
  depois: { delivery_type: string; title: string; description: string };
  proposta: { id: string; itens: Array<Record<string, unknown>> } | null;
  novoItem: Record<string, unknown>;
  trabalhos: TrabalhoDaTroca[];
  direcao: Record<string, unknown> | null;
}): PassoDaTroca[] {
  const passos: PassoDaTroca[] = [];
  const indice = e.proposta ? e.proposta.itens.findIndex((i) => !!i && i.task_id === e.taskId) : -1;
  if (e.proposta && indice >= 0) {
    passos.push({ tabela: "calendario_propostas", id: e.proposta.id, antes: { itens: e.proposta.itens }, depois: { itens: e.proposta.itens.map((i, j) => (j === indice ? e.novoItem : i)) } });
  }
  if (e.direcao) {
    for (const w of e.trabalhos.filter(trabalhoLivre)) passos.push({ tabela: "estudio_trabalhos", id: w.id, antes: { direcao: w.direcao, status: w.status }, depois: { direcao: e.direcao, status: "rascunho" } });
  }
  passos.push({
    tabela: "tasks",
    id: e.taskId,
    antes: { delivery_type: e.tarefa.delivery_type, title: e.tarefa.title, description: e.tarefa.description },
    depois: { delivery_type: e.depois.delivery_type, title: e.depois.title, description: e.depois.description },
  });
  return passos;
}
