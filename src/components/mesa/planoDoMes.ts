import type { DirecaoDeVideoDaPauta } from "../../../supabase/functions/_shared/video-da-pauta";
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
// 02/10: peça de foto (Mesa Foto) e a conferência da cadência pedida, do mesmo módulo do servidor.
import { resumoDaDirecaoDeFoto, type DirecaoDeFoto } from "../../../supabase/functions/agente-calendario/modulos/peca-de-foto";
import type { CadenciaDoMes, ConferenciaDoMes } from "../../../supabase/functions/agente-calendario/modulos/cadencia-do-mes";

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
  /** Arquivos lidos no navegador (leituraDeArquivos.ts): texto dos lidos e motivo dos não lidos. */
  arquivos?: { lidos: unknown[]; nao_lidos: unknown[] } | null;
}

export function corpoDoPlanejamento(p: CorpoDoPlanejamento): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "planejar_mes", client_id: p.clientId, mensagem: p.mensagem, mes: String(p.mes).slice(0, 7) };
  if (p.anexos && p.anexos.length) corpo.anexos = p.anexos.slice(0, MAX_ANEXOS);
  if (p.propostaId) corpo.proposta_id = p.propostaId;
  if (p.arquivos && (p.arquivos.lidos.length || p.arquivos.nao_lidos.length)) corpo.arquivos = p.arquivos;
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

// ------------------------------------------------------------------ agente do Mês v2 (26/09)

/**
 * Espelhos de supabase/functions/agente-calendario/agente-mes-v2.ts (o teste
 * agente-mes-v2 confere que batem): o agente do Mês usa o GPT-6 Sol com
 * raciocínio alto; um modelo marcado no catálogo com o papel "agente_mes"
 * vale por cima. As outras telas seguem o padrão do estrategista.
 */
export const MODELO_DO_AGENTE_DO_MES = "openrouter:openai/gpt-6-sol";
export const RACIOCINIO_DO_AGENTE_DO_MES = "high";
export const PAPEL_DO_AGENTE_DO_MES = "agente_mes";
export const CHARS_POR_TOKEN = 3.2;
/** Contexto fixo do planejamento v2: cliente, agenda de 12 meses com o detalhe de cada peça, MCP e plano. */
export const TOKENS_DO_CONTEXTO_DO_MES = 90_000;

/** Modelo do agente do Mês no catálogo da tela (mesma regra do servidor); sem ele, o do estrategista. */
export function modeloDoAgenteDoMes(catalogo: ModeloIa[]): ModeloIa | null {
  const ativos = (catalogo || []).filter((m) => m && m.ativo !== false && (m as { disponivel?: boolean }).disponivel !== false && (!m.tipo || m.tipo === "texto"));
  const doPapel = ativos.find((m) => (m.padrao_para || []).indexOf(PAPEL_DO_AGENTE_DO_MES) >= 0);
  if (doPapel) return doPapel;
  return ativos.find((m) => m.id === MODELO_DO_AGENTE_DO_MES) || padraoPara(catalogo, "estrategista");
}

/**
 * Conversa de planejamento: uma chamada do agente do Mês (GPT-6 Sol, alto)
 * com o contexto do cliente, o do planejamento, a agenda dos próximos 12
 * meses, o MCP, a mensagem e os arquivos lidos (caracteres) e as imagens.
 */
export const partesDoPlanejamento = (catalogo: ModeloIa[], anexos: number, caracteres = 0): ParteDaEstimativa[] => {
  const m = modeloDoAgenteDoMes(catalogo);
  return [
    {
      modeloId: m ? m.id : null,
      tipo: "texto",
      tokensEntrada: TOKENS_DO_CONTEXTO_DO_MES + Math.ceil(Math.max(0, caracteres) / CHARS_POR_TOKEN) + anexos * TAMANHOS.imagemAnexos.entrada,
      tokensSaida: saidaPorRaciocinio(RACIOCINIO_DO_AGENTE_DO_MES) + 6000,
    },
  ];
};

/** Conteúdos novos a partir de material colado ou anexado (anexo "criar_conteudos" de planejar_mes). */
export interface ItemParaCriar {
  data: string;
  formato: "carrossel" | "estatico" | "foto" | "video";
  formato_pedido?: string | null;
  tema: string;
  referencia: string;
  /** Peça de foto: a direção para a Mesa Foto (contrato em modulos/peca-de-foto.ts). */
  foto?: DirecaoDeFoto | null;
  video?: DirecaoDeVideoDaPauta | null;
}

export interface CriacaoDeConteudos {
  tipo: "criar_conteudos";
  resumo: string;
  orientacao: string;
  itens: ItemParaCriar[];
  ignorados?: number;
  /** 02/10: a conta por semana contra a cadência pedida ("12 posts: 8 fotos e 4 carrosséis, 3 por semana."). */
  conferencia?: (Partial<ConferenciaDoMes> & { cadencia?: CadenciaDoMes | null; avisos?: string[] }) | null;
}

export function criacaoDaMensagem(anexos: unknown[] | null | undefined): CriacaoDeConteudos | null {
  for (const a of anexos || []) {
    const o = a && typeof a === "object" ? (a as Record<string, unknown>) : null;
    if (o && o.tipo === "criar_conteudos" && Array.isArray(o.itens)) {
      return { ...(o as unknown as CriacaoDeConteudos), orientacao: String(o.orientacao || ""), itens: o.itens as ItemParaCriar[] };
    }
  }
  return null;
}

/** Espelho de LOTE_DA_CRIACAO (uma geração do pedido livre por lote). */
export const LOTE_DA_CRIACAO = 12;

/**
 * Texto do pedido livre de um lote da criação. Espelho de pedidoParaCriar em
 * supabase/functions/agente-calendario/agente-mes-v2.ts.
 */
export function pedidoParaCriar(itens: Array<Pick<ItemParaCriar, "data" | "formato" | "tema" | "referencia" | "foto" | "video">>, orientacao?: string | null): string {
  const linhas = itens.map((i) => {
    const ref = String((i.referencia || "") + (i.video ? ` Direção do vídeo: ${JSON.stringify(i.video)}` : "")).replace(/\s+/g, " ").trim();
    const foto = i.formato === "foto" && i.foto ? `\n  Direção da foto: ${resumoDaDirecaoDeFoto(i.foto)}` : "";
    const rotulo = i.formato === "video" ? "vídeo rápido" : i.formato === "estatico" ? "estático" : i.formato === "foto" ? "foto" : "carrossel";
    return `- ${i.data} · ${rotulo} · ${String(i.tema || "").replace(/\s+/g, " ").trim()}${ref ? `\n  Referência do material: ${ref}` : ""}${foto}`;
  });
  const base = `Crie estes conteúdos, um para cada linha, exatamente na data e no formato indicados. Siga o tema e a referência do material de cada linha, adaptando ao cliente (negócio, oferta, público e tom de voz do contexto):\n${linhas.join("\n")}`;
  const o = String(orientacao || "").replace(/\s+/g, " ").trim().slice(0, 600);
  return o ? `${base}\nOrientação da equipe para todos: ${o}` : base;
}

/** Decisão do Jev sobre o público do pedido (anexo "decisao_publico"). */
export interface DecisaoDoPublico {
  decisao: "adaptar" | "manter" | "perguntar" | "sem_publico_novo" | "indisponivel";
  traz: number | null;
  coerente: number | null;
  frase: string;
}

export function decisaoDoPublicoDaMensagem(anexos: unknown[] | null | undefined): DecisaoDoPublico | null {
  for (const a of anexos || []) {
    const o = a && typeof a === "object" ? (a as Record<string, unknown>) : null;
    if (o && o.tipo === "decisao_publico" && typeof o.decisao === "string") return o as unknown as DecisaoDoPublico;
  }
  return null;
}

/** O que o agente leu nesta resposta (anexo "contexto_usado"). */
export interface ContextoUsado {
  modelo: string;
  raciocinio: string | null;
  tokens: number;
  pecas: number;
  mcp: number;
  arquivos: number;
  cortes: string[];
}

export function contextoUsadoDaMensagem(anexos: unknown[] | null | undefined): ContextoUsado | null {
  for (const a of anexos || []) {
    const o = a && typeof a === "object" ? (a as Record<string, unknown>) : null;
    if (o && o.tipo === "contexto_usado") return o as unknown as ContextoUsado;
  }
  return null;
}

/** Frase curta do que o agente leu: "Li 312 peças, 4 itens do MCP e 3 arquivos." */
export function fraseDoContextoUsado(c: ContextoUsado | null): string {
  if (!c) return "";
  const partes: string[] = [];
  if (c.pecas) partes.push(`${c.pecas} ${c.pecas === 1 ? "peça" : "peças"} da agenda`);
  if (c.mcp) partes.push(`${c.mcp} ${c.mcp === 1 ? "item" : "itens"} do MCP`);
  if (c.arquivos) partes.push(`${c.arquivos} ${c.arquivos === 1 ? "arquivo" : "arquivos"}`);
  const lista = partes.length > 1 ? `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}` : partes[0] || "";
  return lista ? `Li ${lista}.${c.cortes && c.cortes.length ? " Parte do contexto foi resumida para caber." : ""}` : "";
}

/** Arquivos que foram num pedido do dono (anexo "arquivos_lidos" da mensagem dele). */
export interface ArquivosLidosDaMensagem {
  lidos: { nome: string; tipo: string; tamanho: number; caracteres: number; origem: string | null }[];
  nao_lidos: { nome: string; motivo: string }[];
}

export function arquivosDaMensagem(anexos: unknown[] | null | undefined): ArquivosLidosDaMensagem | null {
  for (const a of anexos || []) {
    const o = a && typeof a === "object" ? (a as Record<string, unknown>) : null;
    if (o && o.tipo === "arquivos_lidos") {
      return { lidos: Array.isArray(o.lidos) ? (o.lidos as ArquivosLidosDaMensagem["lidos"]) : [], nao_lidos: Array.isArray(o.nao_lidos) ? (o.nao_lidos as ArquivosLidosDaMensagem["nao_lidos"]) : [] };
    }
  }
  return null;
}

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
  /** Reescrever textos: a peça antes e relida do banco depois de gravar (a prova do que mudou). */
  antes?: { title?: string | null } | null;
  depois?: { title?: string | null; description?: string | null } | null;
}

/** Uma das peças iguais ou parecidas do "Qual delas?" (o pedido citou uma, a agenda tem mais de uma). */
export interface OpcaoDaEscolha extends ItemDaAcaoNaAgenda {
  status: string | null;
  detalhe: string;
}

/** Reescrever textos de uma peça gravada (sem gerar do zero). */
export interface EdicaoDeTextoNaAgenda extends ItemDaAcaoNaAgenda {
  campos: { titulo?: string; tema?: string; gancho?: string; copy?: string; cta?: string; publico?: string; cards?: { ordem: number; texto: string }[] };
}

export interface AcaoNaAgenda {
  tipo: "acao_agenda";
  resumo: string;
  mes?: string;
  /** 29/09: as palavras do dono no pedido (o refazer usa como orientação para as peças novas). */
  pedido?: string;
  apagar: ItemDaAcaoNaAgenda[];
  mudar_data: ItemDaAcaoNaAgenda[];
  mudar_formato: ItemDaAcaoNaAgenda[];
  /** Saem da agenda e são geradas de novo pelo pedido livre (custo mostrado antes). */
  refazer: ItemDaAcaoNaAgenda[];
  editar_campanhas: EdicaoDeCampanha[];
  /** Título, tema, gancho, lâminas, copy, CTA e público novos, sem gerar do zero (sem custo). */
  editar_textos: EdicaoDeTextoNaAgenda[];
  ignorados?: string[];
  textos?: ResultadoDaAcaoNaAgenda[];
  executada_em?: string;
  descartada_em?: string;
  desfeita_em?: string;
  resultados?: ResultadoDaAcaoNaAgenda[];
  mudancas?: ResultadoDaAcaoNaAgenda[];
  refeitos?: ResultadoDaAcaoNaAgenda[];
  formatos?: ResultadoDaAcaoNaAgenda[];
  campanhas_editadas?: ResultadoDaCampanhaEditada[];
  /** "Qual delas?": a mudança vale para uma destas peças; a equipe escolhe e só ela muda. */
  escolher_um?: { task_ids: string[]; opcoes: OpcaoDaEscolha[]; motivo: "iguais" | "parecidas" };
  /** A peça escolhida (depois de confirmar). */
  escolhida?: string;
  /** Peça repetida na agenda e afins: só aviso, nunca trava a mudança. */
  avisos?: string[];
}

const LISTAS_DE_PECAS = ["apagar", "mudar_data", "mudar_formato", "refazer", "editar_textos"] as const;

/**
 * A ação com a escolha do "Qual delas?" aplicada: as outras opções saem de
 * todas as listas (espelho de acaoComEscolha em
 * supabase/functions/agente-calendario/alvo-citado.ts). Sem escolha, igual.
 */
export function acaoComEscolha(acao: AcaoNaAgenda, escolha: string | null | undefined): AcaoNaAgenda {
  const e = acao.escolher_um;
  if (!e || !e.task_ids.length || !escolha) return acao;
  const saida: AcaoNaAgenda = { ...acao };
  for (const k of LISTAS_DE_PECAS) {
    (saida as unknown as Record<string, unknown>)[k] = (acao[k] as ItemDaAcaoNaAgenda[]).filter((i) => e.task_ids.indexOf(i.task_id) < 0 || i.task_id === escolha);
  }
  return saida;
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
        editar_textos: Array.isArray(o.editar_textos) ? (o.editar_textos as EdicaoDeTextoNaAgenda[]) : [],
      };
    }
  }
  return null;
}

export const executarAcaoNaAgenda = (mensagemId: string, descartar = false, escolha?: string | null) =>
  chamarFuncao<any>(
    "agente-calendario",
    descartar
      ? { acao: "executar_acao_agenda", mensagem_id: mensagemId, descartar: true }
      : escolha
        ? { acao: "executar_acao_agenda", mensagem_id: mensagemId, escolha }
        : { acao: "executar_acao_agenda", mensagem_id: mensagemId },
  );

export const desfazerAcaoNaAgenda = (mensagemId: string) =>
  chamarFuncao<any>("agente-calendario", { acao: "desfazer_acao_agenda", mensagem_id: mensagemId });

/**
 * Texto do pedido livre que gera de novo as peças refeitas (mesmas datas e
 * formatos, abordagem nova). Espelho de pedidoParaRefazer em
 * supabase/functions/agente-calendario/acoes-agenda.ts.
 */
export function pedidoParaRefazer(itens: Array<Pick<ItemDaAcaoNaAgenda, "titulo" | "data" | "formato">>, orientacao?: string | null): string {
  const linhas = itens.map((i) => `- ${i.data || "sem data"} · ${i.formato} · no lugar de "${String(i.titulo || "").replace(/\s+/g, " ").trim().slice(0, 140)}"`);
  const base = `Refaça estes conteúdos que saíram da agenda, um para cada linha, na mesma data e no mesmo formato, com tema e abordagem novos (não repita o que saiu):\n${linhas.join("\n")}`;
  // 29/09: 1200 caracteres, o pedido inteiro do dono cabe (antes 400 e só o resumo do agente).
  const o = String(orientacao || "").replace(/\s+/g, " ").trim().slice(0, 1200);
  return o ? `${base}\nOrientação da equipe para todas: ${o}` : base;
}

/** Lote de uma geração do refazer (espelho de MAX_REFAZER_POR_PEDIDO no servidor). */
export const LOTE_DO_REFAZER = 12;

/** Divide as peças em lotes de LOTE_DO_REFAZER, na ordem da agenda. */
export function lotesDoRefazer<T>(itens: T[], tamanho = LOTE_DO_REFAZER): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));
  return lotes;
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
  /** 02/10: a cadência pedida (por semana, mistura e dias); o gerador segue a grade dela. */
  cadencia?: CadenciaDoMes | null;
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
  /(^|[^a-zà-ú])(apag|limp[ae]|remov|exclu|delet|mud[ae]\S* (a |as |o |os )?(datas?|formatos?)|mov[ae] |refa[çc]a|refazer|gere de novo|troque o formato|(crie|gere|preencha) (todos os|todo o|os) (conte[úu]dos|m[êe]s|pr[óo]ximos)|revis[ae]\S* (todos|todas|tudo|os meses|a agenda)|reescrev|troque o p[úu]blico)/i;

export const ehPedidoNaAgenda = (mensagem: string) => PEDIDO_DE_AGENDA.test(String(mensagem || ""));
