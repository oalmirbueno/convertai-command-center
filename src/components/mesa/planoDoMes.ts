import { supabase } from "@/integrations/supabase/client";
import {
  chamarFuncao,
  padraoPara,
  rotuloDoMes,
  saidaPorRaciocinio,
  TAMANHOS,
  type ModeloIa,
  type ParteDaEstimativa,
} from "@/lib/mesa/api";
import { MAX_ANEXOS, type ItemProposto } from "./mesaV4Api";

/**
 * Aba Mês, versão 6 (24/09): o agente do mês planeja o mês conversando e a
 * equipe apaga o conteúdo que não serviu.
 *
 * - planejar_mes: conversa sobre estratégia, datas, campanhas, frequência,
 *   formatos e pilares. O que ficar combinado vira o "plano do mês" (memória do
 *   estrategista, uma linha ativa por mês, texto "Plano do mês AAAA-MM: ..."),
 *   que o gerador de meses (propor_temas e detalhar) segue.
 * - A mudança que o agente sugere na proposta do mês chega como anexo da
 *   mensagem (tipo "mudanca", com a diferença) e só entra com aplicar_mudanca.
 * - tirar_item / repor_item: apagar e desfazer na proposta antes de gravar.
 * - arquivar_item_agenda / restaurar_item_agenda: apagar e desfazer na agenda.
 *
 * Tudo que as leituras devolvem é JSON puro (a Mesa guarda o cache no navegador).
 */

// ------------------------------------------------------------------ tipos

export type ModoDoAgente = "planejar" | "criar";

export interface PlanoCombinado {
  id: string;
  /** "AAAA-MM" */
  mes: string;
  texto: string;
  criado_em: string;
}

export interface ItemResumido {
  tema_id: string;
  tema: string;
  data: string;
  formato: string;
}

export interface DiferencaDaMudanca {
  entram: ItemResumido[];
  saem: ItemResumido[];
  mudam: (ItemResumido & { data_antes: string | null; campos: string[] })[];
  temas_entram: string[];
  temas_saem: string[];
  temas_mudam: string[];
}

export interface MudancaSugerida {
  tipo: "mudanca";
  alvo_proposta_id: string;
  base: string | null;
  periodo: { inicio: string; fim: string } | null;
  resumo: string;
  diferenca: DiferencaDaMudanca | null;
  ajustes: string[] | null;
  aplicada_em?: string | null;
  descartada_em?: string | null;
}

// ------------------------------------------------------------------ plano combinado

export const PREFIXO_PLANO = "Plano do mês ";
const MES_DO_PLANO = /^Plano do mês (\d{4}-\d{2}):\s*/;

/** Mês "AAAA-MM" do texto do plano, ou null. */
export function mesDoPlano(texto: string): string | null {
  const m = MES_DO_PLANO.exec(String(texto || ""));
  return m ? m[1] : null;
}

/** O texto do plano sem o cabeçalho "Plano do mês AAAA-MM:". */
export const corpoDoPlano = (texto: string) => String(texto || "").replace(MES_DO_PLANO, "").trim();

/** A primeira linha do plano (o resumo), cortada para caber numa frase. */
export function resumoDoPlano(texto: string, max = 220): string {
  const primeira = corpoDoPlano(texto).split("\n")[0] || "";
  return primeira.length > max ? `${primeira.slice(0, max).trim()}…` : primeira;
}

/** "outubro de 2026" a partir de "AAAA-MM" ou "AAAA-MM-01". */
export const nomeDoMes = (mes: string) => rotuloDoMes(`${String(mes).slice(0, 7)}-01`);

/** O plano mais novo de cada mês. As linhas chegam do mais novo para o mais antigo. */
export function planosPorMes(linhas: { id: string; texto: string; criado_em: string }[]): PlanoCombinado[] {
  const vistos: Record<string, boolean> = {};
  const saida: PlanoCombinado[] = [];
  for (const l of linhas) {
    const mes = mesDoPlano(l.texto);
    if (!mes || vistos[mes]) continue;
    vistos[mes] = true;
    saida.push({ id: String(l.id), mes, texto: String(l.texto), criado_em: String(l.criado_em || "") });
  }
  return saida.sort((a, b) => a.mes.localeCompare(b.mes));
}

export const chavesDoPlano = {
  planos: (clientId: string) => ["mesa", "planos-do-mes", clientId] as const,
};

export async function lerPlanosCombinados(clientId: string): Promise<PlanoCombinado[]> {
  const { data, error } = await (supabase as any)
    .from("agente_memoria")
    .select("id, texto, criado_em")
    .eq("client_id", clientId)
    .eq("agente", "estrategista")
    .eq("ativa", true)
    // O servidor grava o plano como preferência vinda de ajuste; o prefixo separa do resto.
    .eq("tipo", "preferencia")
    .eq("origem", "ajuste")
    .order("criado_em", { ascending: false })
    .limit(80);
  if (error) throw error;
  return planosPorMes((data || []) as { id: string; texto: string; criado_em: string }[]);
}

/** O plano deixa de valer (fica como histórico, inativo). */
export async function esquecerPlano(id: string, clientId: string): Promise<void> {
  const { error } = await (supabase as any).from("agente_memoria").update({ ativa: false }).eq("id", id).eq("client_id", clientId);
  if (error) throw error;
}

// ------------------------------------------------------------------ ações

export interface CorpoDoPlanejamento {
  clientId: string;
  mensagem: string;
  /** "AAAA-MM-01" ou "AAAA-MM" */
  mes: string;
  anexos?: string[];
  propostaId?: string | null;
}

export function corpoDoPlanejamento(p: CorpoDoPlanejamento): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "planejar_mes", client_id: p.clientId, mensagem: p.mensagem, mes: String(p.mes).slice(0, 7) };
  if (p.anexos && p.anexos.length) corpo.anexos = p.anexos.slice(0, MAX_ANEXOS);
  if (p.propostaId) corpo.proposta_id = p.propostaId;
  return corpo;
}

export const planejarMes = (p: CorpoDoPlanejamento) => chamarFuncao<any>("agente-calendario", corpoDoPlanejamento(p));

export const aplicarMudanca = (mensagemId: string, descartar = false) =>
  chamarFuncao<any>("agente-calendario", descartar ? { acao: "aplicar_mudanca", mensagem_id: mensagemId, descartar: true } : { acao: "aplicar_mudanca", mensagem_id: mensagemId });

export const tirarItem = (propostaId: string, temaId: string, indice: number) =>
  chamarFuncao<any>("agente-calendario", { acao: "tirar_item", proposta_id: propostaId, tema_id: temaId, indice });

export function reporItem(a: { propostaId: string; item: ItemProposto; indice: number; temaEscolhido?: boolean | null; memoriaId?: string | null }) {
  const corpo: Record<string, unknown> = { acao: "repor_item", proposta_id: a.propostaId, item: a.item, indice: a.indice };
  if (a.temaEscolhido === false) corpo.tema_escolhido = false;
  if (a.memoriaId) corpo.memoria_id = a.memoriaId;
  return chamarFuncao<any>("agente-calendario", corpo);
}

export function arquivarItemDaAgenda(clientId: string, taskId: string, confirmarArte = false) {
  const corpo: Record<string, unknown> = { acao: "arquivar_item_agenda", client_id: clientId, task_id: taskId };
  if (confirmarArte) corpo.confirmar_arte = true;
  return chamarFuncao<any>("agente-calendario", corpo);
}

export function restaurarItemDaAgenda(clientId: string, taskId: string, memoriaId?: string | null) {
  const corpo: Record<string, unknown> = { acao: "restaurar_item_agenda", client_id: clientId, task_id: taskId };
  if (memoriaId) corpo.memoria_id = memoriaId;
  return chamarFuncao<any>("agente-calendario", corpo);
}

// ------------------------------------------------------------------ estimativa

/**
 * Conversa de planejamento: uma chamada do estrategista com o contexto do
 * cliente e mais o do planejamento (publicado, aprovado, campanhas, hypes e a
 * agenda dos próximos meses), e as imagens anexadas.
 */
export const partesDoPlanejamento = (catalogo: ModeloIa[], anexos: number): ParteDaEstimativa[] => {
  const m = padraoPara(catalogo, "estrategista");
  return [
    {
      modeloId: m ? m.id : null,
      tipo: "texto",
      tokensEntrada: TAMANHOS.conversarMes.entrada + 8000 + anexos * TAMANHOS.imagemAnexos.entrada,
      tokensSaida: saidaPorRaciocinio("medium") + 2000,
    },
  ];
};

// ------------------------------------------------------------------ mensagens

/** Anexo de mudança sugerida numa mensagem do agente, ou null. */
export function mudancaDaMensagem(anexos: unknown[] | null | undefined): MudancaSugerida | null {
  for (const a of anexos || []) {
    const o = a && typeof a === "object" ? (a as Record<string, unknown>) : null;
    if (o && o.tipo === "mudanca" && o.alvo_proposta_id) return o as unknown as MudancaSugerida;
  }
  return null;
}

/** Meses ("AAAA-MM") cujo plano a mensagem atualizou. */
export function planosDaMensagem(anexos: unknown[] | null | undefined): string[] {
  const meses: string[] = [];
  for (const a of anexos || []) {
    const o = a && typeof a === "object" ? (a as Record<string, unknown>) : null;
    if (o && o.tipo === "plano" && typeof o.mes === "string") meses.push(o.mes);
  }
  return meses;
}

/** Os próximos n meses a partir de um mês "AAAA-MM-01" (inclusive). */
export function mesesAPartirDe(mes: string, n: number): string[] {
  const partes = String(mes).split("-").map(Number);
  const saida: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(partes[0], (partes[1] || 1) - 1 + i, 1, 12);
    saida.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`);
  }
  return saida;
}

// ------------------------------------------------------------------ ações na agenda

/**
 * Peças que o agente vai apagar ou mudar de data (anexo "acao_agenda" de
 * planejar_mes). Nada muda até a equipe confirmar (executar_acao_agenda), e
 * dá para desfazer (desfazer_acao_agenda).
 */
export interface ItemDaAcaoNaAgenda {
  task_id: string;
  titulo: string;
  data: string | null;
  formato: string;
  para?: string;
  /** Mudar formato: o formato novo (valor da tarefa) e o nome dele. */
  formato_para?: string;
  formato_para_nome?: string;
}

export interface EdicaoDeCampanha {
  campanha_id: string;
  nome_atual: string;
  campos: { nome?: string; status?: string; periodo_inicio?: string; periodo_fim?: string };
}

export interface ResultadoDaCampanhaEditada {
  campanha_id: string;
  titulo: string;
  ok: boolean;
  motivo?: string;
}

export interface ResultadoDaAcaoNaAgenda {
  task_id: string;
  titulo: string;
  ok: boolean;
  motivo?: string;
  de?: string | null;
  para?: string;
}

export interface AcaoNaAgenda {
  tipo: "acao_agenda";
  resumo: string;
  mes?: string;
  apagar: ItemDaAcaoNaAgenda[];
  mudar_data: ItemDaAcaoNaAgenda[];
  mudar_formato: ItemDaAcaoNaAgenda[];
  /** Saem da agenda e são geradas de novo pelo pedido livre (custo mostrado antes). */
  refazer: ItemDaAcaoNaAgenda[];
  editar_campanhas: EdicaoDeCampanha[];
  ignorados?: string[];
  executada_em?: string;
  descartada_em?: string;
  desfeita_em?: string;
  resultados?: ResultadoDaAcaoNaAgenda[];
  mudancas?: ResultadoDaAcaoNaAgenda[];
  refeitos?: ResultadoDaAcaoNaAgenda[];
  formatos?: ResultadoDaAcaoNaAgenda[];
  campanhas_editadas?: ResultadoDaCampanhaEditada[];
}

/** Anexo de ação na agenda numa mensagem do agente, ou null. */
export function acaoNaAgendaDaMensagem(anexos: unknown[] | null | undefined): AcaoNaAgenda | null {
  for (const a of anexos || []) {
    const o = a && typeof a === "object" ? (a as Record<string, unknown>) : null;
    if (o && o.tipo === "acao_agenda") {
      return {
        ...(o as unknown as AcaoNaAgenda),
        apagar: Array.isArray(o.apagar) ? (o.apagar as ItemDaAcaoNaAgenda[]) : [],
        mudar_data: Array.isArray(o.mudar_data) ? (o.mudar_data as ItemDaAcaoNaAgenda[]) : [],
        mudar_formato: Array.isArray(o.mudar_formato) ? (o.mudar_formato as ItemDaAcaoNaAgenda[]) : [],
        refazer: Array.isArray(o.refazer) ? (o.refazer as ItemDaAcaoNaAgenda[]) : [],
        editar_campanhas: Array.isArray(o.editar_campanhas) ? (o.editar_campanhas as EdicaoDeCampanha[]) : [],
      };
    }
  }
  return null;
}

export const executarAcaoNaAgenda = (mensagemId: string, descartar = false) =>
  chamarFuncao<any>("agente-calendario", descartar ? { acao: "executar_acao_agenda", mensagem_id: mensagemId, descartar: true } : { acao: "executar_acao_agenda", mensagem_id: mensagemId });

export const desfazerAcaoNaAgenda = (mensagemId: string) =>
  chamarFuncao<any>("agente-calendario", { acao: "desfazer_acao_agenda", mensagem_id: mensagemId });

/**
 * Texto do pedido livre que gera de novo as peças refeitas (mesmas datas e
 * formatos, abordagem nova). Espelho de pedidoParaRefazer em
 * supabase/functions/agente-calendario/acoes-agenda.ts.
 */
export function pedidoParaRefazer(itens: Array<Pick<ItemDaAcaoNaAgenda, "titulo" | "data" | "formato">>): string {
  const linhas = itens.map((i) => `- ${i.data || "sem data"} · ${i.formato} · no lugar de "${String(i.titulo || "").replace(/\s+/g, " ").trim().slice(0, 140)}"`);
  return `Refaça estes conteúdos que saíram da agenda, um para cada linha, na mesma data e no mesmo formato, com tema e abordagem novos (não repita o que saiu):\n${linhas.join("\n")}`;
}

/**
 * Meses inteiros que o agente propôs gerar (anexo "gerar_conteudos" de
 * planejar_mes). A tela mostra o custo e roda o gerador de meses
 * (PlanejamentoAutomatico) só ao confirmar; registrar_geracao marca na conversa.
 */
export interface GeracaoDeConteudos {
  tipo: "gerar_conteudos";
  resumo: string;
  meses: string[];
  frequencia_semanal: number;
  project_id: string | null;
  projeto_nome: string | null;
  executada_em?: string;
  descartada_em?: string;
}

export function geracaoDaMensagem(anexos: unknown[] | null | undefined): GeracaoDeConteudos | null {
  for (const a of anexos || []) {
    const o = a && typeof a === "object" ? (a as Record<string, unknown>) : null;
    if (o && o.tipo === "gerar_conteudos" && Array.isArray(o.meses)) {
      return { ...(o as unknown as GeracaoDeConteudos), meses: (o.meses as unknown[]).map(String), frequencia_semanal: Number(o.frequencia_semanal) || 3 };
    }
  }
  return null;
}

export const registrarGeracao = (mensagemId: string, descartar = false) =>
  chamarFuncao<any>("agente-calendario", descartar ? { acao: "registrar_geracao", mensagem_id: mensagemId, descartar: true } : { acao: "registrar_geracao", mensagem_id: mensagemId });

/**
 * Pedido de mexer na agenda já gravada (apagar, limpar, remover, excluir,
 * mudar a data, mover). No modo "Criar conteúdos" ele vai para o agente que
 * planeja o mês, que é quem lê a agenda e prepara a lista para confirmar.
 */
const PEDIDO_DE_AGENDA =
  /(^|[^a-zà-ú])(apag|limp[ae]|remov|exclu|delet|mud[ae]\S* (a |as |o |os )?(datas?|formatos?)|mov[ae] |refa[çc]a|refazer|gere de novo|troque o formato|(crie|gere|preencha) (todos os|todo o|os) (conte[úu]dos|m[êe]s|pr[óo]ximos))/i;

export const ehPedidoNaAgenda = (mensagem: string) => PEDIDO_DE_AGENDA.test(String(mensagem || ""));
