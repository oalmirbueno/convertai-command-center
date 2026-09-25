import { useEffect, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  chamarFuncao,
  extensao,
  padraoPara,
  saidaPorRaciocinio,
  TAMANHOS,
  type ModeloIa,
  type ParteDaEstimativa,
} from "@/lib/mesa/api";

/**
 * Mesa, versão 4 (23/09): agente do mês, hypes da semana e campanhas.
 * Contrato em docs/mesa-do-cliente/CONTRATOS-V4.md. Este arquivo junta as
 * chamadas, as leituras diretas (RLS da equipe), as chaves de cache e as
 * partes das estimativas. Tudo que volta das leituras é JSON puro: a Mesa
 * guarda o cache no navegador.
 */

// ------------------------------------------------------------------ tipos

export interface CardDoRoteiro {
  ordem: number;
  funcao?: string;
  texto?: string;
  ilustracao?: string;
  estilo?: string;
}

export interface ItemProposto {
  tema_id?: string;
  data?: string;
  formato?: string;
  tema?: string;
  pilar?: string;
  fase?: string | number;
  gancho?: string;
  resumo?: string;
  copy?: string;
  cta?: string;
  objetivo?: string;
  carrossel_infinito?: boolean;
  cards?: CardDoRoteiro[];
  task_id?: string | null;
  campanha_id?: string | null;
}

export interface PropostaV4 {
  id: string;
  client_id?: string;
  project_id: string | null;
  periodo_inicio: string;
  periodo_fim: string;
  parametros: Record<string, any> | null;
  status: "temas" | "detalhando" | "pronta" | "gravada" | "descartada";
  diagnostico?: string | null;
  itens: ItemProposto[];
  conversa_id: string | null;
  task_ids: string[] | null;
  gravada_em: string | null;
  criado_em?: string;
}

export interface AnexoDaMensagem {
  proposta_id?: string;
  caminho?: string;
}

export interface MensagemDoAgente {
  id: string;
  papel: "usuario" | "agente" | "sistema";
  conteudo: string;
  anexos: AnexoDaMensagem[] | null;
  criado_em: string;
}

export interface ConversaDoAgente {
  conversaId: string | null;
  mensagens: MensagemDoAgente[];
}

export type JanelaDoHype = "hoje" | "esta_semana" | "proximas_semanas";

export interface Hype {
  titulo: string;
  o_que_e?: string;
  por_que_agora?: string;
  fonte?: string;
  janela?: JanelaDoHype | string;
  como_usar?: string;
  formato?: string;
  cuidado?: string;
  nota?: number | null;
}

export interface HypesDaSemana {
  id?: string;
  client_id: string;
  semana: string;
  itens: Hype[];
  resumo: string | null;
  custo_usd?: number;
  criado_em: string;
}

export interface CorDeApoio {
  nome?: string;
  hex?: string;
}

export interface IdentidadeDaCampanha {
  tema_visual?: string;
  paleta_apoio?: CorDeApoio[];
  tipografia?: string;
  elementos?: string;
  tom?: string;
  selo?: { texto?: string; descricao?: string };
}

export type EstadoDaCampanha = "planejada" | "gravada" | "encerrada";

/**
 * Campanha completa (25/09): briefing, imagens do acervo com papel e o plano
 * de imagens (qual imagem vai em qual lâmina e por quê). Colunas em
 * docs/mesa/migrations/20260925120000_mesa_campanhas_completas.sql; ausentes
 * antes do SQL, por isso opcionais.
 */
export interface BriefingDaCampanha {
  produtos: { nome: string; por_que: string }[];
  oferta: string;
  mensagem_central: string;
  publico: string;
  provas: string[];
  tom: string;
  cta: string;
}

export type PapelDaImagemDaCampanha = "heroi" | "apoio" | "ambiente";

export interface ImagemDaCampanha {
  imagem_id: string;
  papel: PapelDaImagemDaCampanha;
  nota: string;
}

export interface PecaDoPlanoDeImagens {
  tema_id: string;
  ordem: number;
  imagem_id: string | null;
  candidatas: string[];
  uso: "fundo" | "elemento";
  por_que: string;
  escolha: "estrategista" | "jev";
  confianca: number | null;
  aviso: string | null;
}

export interface PlanoDeImagens {
  gerado_em: string;
  assinatura: string;
  fonte: "campanha" | "acervo";
  resumo: string;
  analise: { imagem_id: string; o_que_mostra: string; forca: string; serve_para: string }[];
  pecas: PecaDoPlanoDeImagens[];
  lacunas: string[];
  jev_erro: string | null;
}

export interface Campanha {
  id: string;
  client_id: string;
  nome: string;
  pedido: string | null;
  objetivo: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  conceito: string | null;
  identidade: IdentidadeDaCampanha | null;
  referencias_ids: string[] | null;
  selo_path: string | null;
  proposta_id: string | null;
  status: EstadoDaCampanha;
  custo_usd: number | null;
  criado_em: string;
  atualizado_em?: string;
  briefing?: Partial<BriefingDaCampanha> | null;
  imagens?: ImagemDaCampanha[] | null;
  plano_imagens?: PlanoDeImagens | null;
}

// ------------------------------------------------------------------ chaves

export const chaves = {
  agente: (clientId: string) => ["mesa", "agente-do-mes", clientId] as const,
  conversa: (clientId: string) => ["mesa", "agente-do-mes", clientId, "conversa"] as const,
  propostas: (clientId: string, ids: string[]) => ["mesa", "agente-do-mes", clientId, "propostas", ids.join(",")] as const,
  proposta: (id: string) => ["mesa", "proposta-v4", id] as const,
  hypes: (clientId: string) => ["mesa", "hypes", clientId] as const,
  campanhas: (clientId: string) => ["mesa", "campanhas", clientId] as const,
  projetosSocial: (clientId: string) => ["mesa", "projetos-social", clientId] as const,
};

/** Depois de gravar: a agenda, o Estúdio e as propostas relêem já. */
export function atualizarAgenda(qc: QueryClient, clientId: string) {
  void qc.invalidateQueries({ queryKey: ["mesa", "agenda-do-mes", clientId] });
  void qc.invalidateQueries({ queryKey: ["mesa", "itens-do-mes", clientId] });
  void qc.invalidateQueries({ queryKey: ["mesa", "propostas", clientId] });
}

// ------------------------------------------------------------------ datas

const dois = (n: number) => (n < 10 ? `0${n}` : String(n));

export const dataIso = (d: Date) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;

export const hojeIso = () => dataIso(new Date());

function paraData(iso: string): Date {
  const p = iso.split("-").map(Number);
  return new Date(p[0], (p[1] || 1) - 1, p[2] || 1, 12);
}

export function somarDiasIso(iso: string, n: number): string {
  const d = paraData(iso);
  d.setDate(d.getDate() + n);
  return dataIso(d);
}

export function diasEntreIso(a: string, b: string): number {
  return Math.round((paraData(b).getTime() - paraData(a).getTime()) / 86400000);
}

/** Segunda-feira da semana de uma data (como o servidor guarda a semana dos hypes). */
export function segundaDaSemanaIso(iso: string): string {
  const d = paraData(iso).getDay();
  return somarDiasIso(iso, d === 0 ? -6 : 1 - d);
}

export const DIAS_MAX_CAMPANHA = 62;
export const DIAS_PADRAO_CAMPANHA = 21;

/** "12/10" ou "12/10 a 02/11". */
export function periodoCurto(inicio?: string | null, fim?: string | null): string {
  const f = (iso?: string | null) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
  if (!inicio && !fim) return "sem período";
  if (!fim || inicio === fim) return f(inicio);
  return `${f(inicio)} a ${f(fim)}`;
}

/** "qua., 23/09" (a data do item sem hora). */
export function diaCurto(iso?: string | null): string {
  if (!iso) return "sem data";
  const d = paraData(iso.slice(0, 10));
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });
}

export const mesDaData = (iso?: string | null) => (iso && iso.length >= 7 ? `${iso.slice(0, 7)}-01` : "");

// ------------------------------------------------------------------ anexos

export const MAX_ANEXOS = 6;
export const MAX_BYTES_ANEXO = 12 * 1024 * 1024;
const TIPOS_ACEITOS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const EXTENSOES_ACEITAS: Record<string, string> = { jpg: "jpg", jpeg: "jpg", png: "png", webp: "webp" };

/** Extensão aceita do arquivo (jpg, png ou webp) ou null. */
export function extensaoDoAnexo(arquivo: { type?: string; name?: string }): string | null {
  const tem = Object.prototype.hasOwnProperty;
  const tipo = String(arquivo.type || "");
  if (tem.call(TIPOS_ACEITOS, tipo)) return TIPOS_ACEITOS[tipo];
  const ext = extensao(String(arquivo.name || ""));
  return tem.call(EXTENSOES_ACEITAS, ext) ? EXTENSOES_ACEITAS[ext] : null;
}

export const caminhoDoAnexo = (clientId: string, id: string, ext: string) => `${clientId}/pedidos/${id}.${ext}`;

/** Sobe uma imagem do pedido no bucket mesa e devolve o caminho. */
export async function subirAnexo(clientId: string, arquivo: File): Promise<string> {
  const ext = extensaoDoAnexo(arquivo);
  if (!ext) throw new Error("Só imagens JPG, PNG ou WEBP.");
  if (arquivo.size > MAX_BYTES_ANEXO) throw new Error("Imagem acima de 12 MB.");
  const caminho = caminhoDoAnexo(clientId, crypto.randomUUID(), ext);
  const tipo = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
  const { error } = await supabase.storage.from("mesa").upload(caminho, arquivo, { contentType: tipo, upsert: false });
  if (error) throw error;
  return caminho;
}

// ------------------------------------------------------------------ leituras

export async function lerConversaDoAgente(clientId: string): Promise<ConversaDoAgente> {
  const { data: conversas, error } = await (supabase as any)
    .from("agente_conversas")
    .select("id")
    .eq("client_id", clientId)
    .eq("referencia_tipo", "agente_do_mes")
    .order("criado_em", { ascending: false })
    .limit(1);
  if (error) throw error;
  const conversaId: string | null = conversas && conversas[0] ? String(conversas[0].id) : null;
  if (!conversaId) return { conversaId: null, mensagens: [] };
  const { data, error: erroMsgs } = await (supabase as any)
    .from("agente_mensagens")
    .select("id, papel, conteudo, anexos, criado_em")
    .eq("conversa_id", conversaId)
    .order("criado_em", { ascending: false })
    .limit(60);
  if (erroMsgs) throw erroMsgs;
  const mensagens = ((data || []) as MensagemDoAgente[]).slice().reverse().map((m) => ({
    id: String(m.id),
    papel: m.papel,
    conteudo: String(m.conteudo || ""),
    anexos: Array.isArray(m.anexos) ? m.anexos : [],
    criado_em: String(m.criado_em || ""),
  }));
  return { conversaId, mensagens };
}

const COLUNAS_DA_PROPOSTA = "id, client_id, project_id, periodo_inicio, periodo_fim, parametros, status, diagnostico, itens, conversa_id, task_ids, gravada_em, criado_em";

export async function lerPropostas(ids: string[]): Promise<PropostaV4[]> {
  if (!ids.length) return [];
  const { data, error } = await (supabase as any).from("calendario_propostas").select(COLUNAS_DA_PROPOSTA).in("id", ids);
  if (error) throw error;
  return (data || []) as PropostaV4[];
}

export async function lerProposta(id: string): Promise<PropostaV4 | null> {
  const { data, error } = await (supabase as any).from("calendario_propostas").select(COLUNAS_DA_PROPOSTA).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data || null) as PropostaV4 | null;
}

/** A busca de hypes mais recente do cliente (a da semana, ou a última que houve). */
export async function lerHypes(clientId: string): Promise<HypesDaSemana | null> {
  const { data, error } = await (supabase as any)
    .from("mesa_hypes")
    .select("id, client_id, semana, itens, resumo, custo_usd, criado_em")
    .eq("client_id", clientId)
    .order("semana", { ascending: false })
    .limit(1);
  if (error) throw error;
  const linha = data && data[0];
  if (!linha) return null;
  return { ...linha, itens: Array.isArray(linha.itens) ? linha.itens : [] } as HypesDaSemana;
}

export async function lerCampanhas(clientId: string): Promise<Campanha[]> {
  const { data, error } = await (supabase as any)
    .from("mesa_campanhas")
    .select("*")
    .eq("client_id", clientId)
    .order("criado_em", { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data || []) as Campanha[];
}

export async function salvarReferenciasDaCampanha(id: string, ids: string[]): Promise<void> {
  const { error } = await (supabase as any).from("mesa_campanhas").update({ referencias_ids: ids }).eq("id", id);
  if (error) throw error;
}

export interface ProjetoDoCliente {
  id: string;
  name: string;
  status: string;
  project_type: string | null;
}

export async function lerProjetosDoCliente(clientId: string): Promise<ProjetoDoCliente[]> {
  const { data, error } = await (supabase as any)
    .from("projects")
    .select("id, name, status, project_type")
    .eq("client_id", clientId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as ProjetoDoCliente[];
}

// ------------------------------------------------------------------ ações

export interface CorpoDoPedido {
  clientId: string;
  mensagem: string;
  anexos?: string[];
  campanhaId?: string | null;
  dataInicio?: string;
}

export function corpoDoPedidoLivre(p: CorpoDoPedido): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "pedido_livre", client_id: p.clientId, mensagem: p.mensagem };
  if (p.anexos && p.anexos.length) corpo.anexos = p.anexos.slice(0, MAX_ANEXOS);
  if (p.campanhaId) corpo.campanha_id = p.campanhaId;
  if (p.dataInicio) corpo.data_inicio = p.dataInicio;
  return corpo;
}

export const pedidoLivre = (p: CorpoDoPedido) => chamarFuncao<any>("agente-calendario", corpoDoPedidoLivre(p));

export const buscarHypes = (clientId: string, forcar: boolean) =>
  chamarFuncao<any>("agente-calendario", forcar ? { acao: "buscar_hypes", client_id: clientId, forcar: true } : { acao: "buscar_hypes", client_id: clientId });

export const gravarProposta = (propostaId: string, projectId?: string | null) =>
  chamarFuncao<any>("agente-calendario", projectId ? { acao: "gravar", proposta_id: propostaId, project_id: projectId } : { acao: "gravar", proposta_id: propostaId });

export const ajustarProposta = (propostaId: string, mensagem: string) =>
  chamarFuncao<any>("agente-calendario", { acao: "conversar", proposta_id: propostaId, mensagem });

export interface CorpoDaCampanha {
  clientId: string;
  pedido: string;
  periodoInicio?: string;
  periodoFim?: string;
  quantidade?: number | null;
  anexos?: string[];
  referenciasIds?: string[];
  hype?: Hype | null;
  /** O que a equipe já definiu; vale sobre o que o estrategista sugerir. */
  briefing?: BriefingDaCampanha | null;
  imagens?: ImagemDaCampanha[];
}

export function corpoDaCampanha(c: CorpoDaCampanha): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "campanha_criar", client_id: c.clientId, pedido: c.pedido };
  if (c.periodoInicio) corpo.periodo_inicio = c.periodoInicio;
  if (c.periodoFim) corpo.periodo_fim = c.periodoFim;
  if (c.quantidade) corpo.quantidade = c.quantidade;
  if (c.anexos && c.anexos.length) corpo.anexos = c.anexos.slice(0, MAX_ANEXOS);
  if (c.referenciasIds && c.referenciasIds.length) corpo.referencias_ids = c.referenciasIds.slice(0, 8);
  if (c.hype) corpo.hype = c.hype;
  if (c.briefing && !briefingEstaVazio(c.briefing)) corpo.briefing = c.briefing;
  if (c.imagens && c.imagens.length) corpo.imagens = c.imagens.slice(0, 12);
  return corpo;
}

/** Briefing sem nada preenchido (não vai no corpo). */
export function briefingEstaVazio(b: Partial<BriefingDaCampanha> | null | undefined): boolean {
  if (!b) return true;
  const tem = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  const produtos = Array.isArray(b.produtos) ? b.produtos.filter((p) => p && tem(p.nome)) : [];
  const provas = Array.isArray(b.provas) ? b.provas.filter(tem) : [];
  return !produtos.length && !provas.length && !tem(b.oferta) && !tem(b.mensagem_central) && !tem(b.publico) && !tem(b.tom) && !tem(b.cta);
}

export const campanhaCriar = (c: CorpoDaCampanha) => chamarFuncao<any>("agente-calendario", corpoDaCampanha(c));

export const campanhaAjustar = (campanhaId: string, mensagem: string) =>
  chamarFuncao<any>("agente-calendario", { acao: "campanha_ajustar", campanha_id: campanhaId, mensagem });

export const campanhaSelo = (campanhaId: string) => chamarFuncao<any>("agente-calendario", { acao: "campanha_selo", campanha_id: campanhaId });

// ------------------------------------------------------------------ hypes

export const ROTULO_DA_JANELA: Record<string, string> = {
  hoje: "hoje",
  esta_semana: "esta semana",
  proximas_semanas: "próximas semanas",
};

/** Pedido ao agente do mês montado a partir do hype. */
export function mensagemDoHype(h: Hype): string {
  const partes = [`Um conteúdo sobre o assunto em alta "${h.titulo}".`];
  if (h.como_usar) partes.push(`Como usar: ${h.como_usar}`);
  if (h.formato) partes.push(`Formato: ${h.formato === "estatico" ? "estático" : h.formato}.`);
  if (h.janela) partes.push(`Janela: ${ROTULO_DA_JANELA[String(h.janela)] || h.janela}${h.janela === "hoje" ? ", para publicar hoje" : ""}.`);
  if (h.cuidado) partes.push(`Cuidado: ${h.cuidado}`);
  return partes.join(" ");
}

/** Texto inicial do pedido de campanha que nasce de um hype. */
export const pedidoDaCampanhaDoHype = (h: Hype) =>
  [`Campanha a partir do assunto em alta "${h.titulo}".`, h.como_usar ? `Ideia: ${h.como_usar}` : ""].filter(Boolean).join(" ");

/** Link seguro (só http e https) ou null. */
export function linkSeguro(fonte?: string | null): string | null {
  const t = String(fonte || "").trim();
  if (t.indexOf("http://") === 0 || t.indexOf("https://") === 0) return t;
  return null;
}

export function dominioDoLink(url: string): string {
  const semProtocolo = url.replace("https://", "").replace("http://", "");
  const barra = semProtocolo.indexOf("/");
  const host = barra >= 0 ? semProtocolo.slice(0, barra) : semProtocolo;
  return host.indexOf("www.") === 0 ? host.slice(4) : host;
}

// ------------------------------------------------------------------ estimativas

const modeloDoEstrategista = (catalogo: ModeloIa[]) => {
  const m = padraoPara(catalogo, "estrategista");
  return m ? m.id : null;
};

/** Pedido livre: uma chamada de texto do estrategista, mais a leitura das imagens. */
export const partesDoPedido = (catalogo: ModeloIa[], anexos: number): ParteDaEstimativa[] => [
  {
    modeloId: modeloDoEstrategista(catalogo),
    tipo: "texto",
    tokensEntrada: TAMANHOS.conversarMes.entrada + anexos * TAMANHOS.imagemAnexos.entrada,
    tokensSaida: saidaPorRaciocinio("medium"),
  },
];

/** Ajuste dos conteúdos numa proposta (conversar). */
export const partesDoAjuste = (catalogo: ModeloIa[]): ParteDaEstimativa[] => [
  { modeloId: modeloDoEstrategista(catalogo), tipo: "texto", tokensEntrada: TAMANHOS.conversarMes.entrada, tokensSaida: TAMANHOS.conversarMes.saida },
];

/** Busca de hypes: pesquisa na web e a nota do Jev (centavos). */
export const partesDosHypes = (catalogo: ModeloIa[]): ParteDaEstimativa[] => [
  { modeloId: modeloDoEstrategista(catalogo), tipo: "texto", tokensEntrada: TAMANHOS.proporTemas.entrada, tokensSaida: saidaPorRaciocinio("medium"), buscasWeb: TAMANHOS.proporTemas.buscasWeb },
];

export const partesDaCampanha = (catalogo: ModeloIa[], quantidade: number | null, anexos: number): ParteDaEstimativa[] => [
  {
    modeloId: modeloDoEstrategista(catalogo),
    tipo: "texto",
    tokensEntrada: 35000 + anexos * TAMANHOS.imagemAnexos.entrada,
    tokensSaida: saidaPorRaciocinio("medium") + (quantidade || 6) * TAMANHOS.detalhar.saidaPorItem,
  },
];

export const partesDoAjusteDaCampanha = (catalogo: ModeloIa[]): ParteDaEstimativa[] => [
  { modeloId: modeloDoEstrategista(catalogo), tipo: "texto", tokensEntrada: TAMANHOS.ajuste.entrada, tokensSaida: saidaPorRaciocinio("low") },
];

export const partesDoSelo = (catalogo: ModeloIa[]): ParteDaEstimativa[] => {
  const m = padraoPara(catalogo, "imagem");
  return [{ modeloId: m ? m.id : null, tipo: "imagem", imagens: 1, qualidade: "media" }];
};

/** Quantas lâminas o item tem (estático é 1). */
export const laminasDoItem = (item: ItemProposto) => {
  const n = (item.cards || []).length;
  if (n) return n;
  return item.formato === "estatico" ? 1 : 0;
};

export const rotuloDoFormato = (f?: string) => (f === "estatico" ? "Estático" : f === "carrossel" ? "Carrossel" : f || "Formato livre");

// ------------------------------------------------------------------ tela

/**
 * A tela casa com a consulta de mídia (ex.: "(min-width: 1280px)"). Usa
 * addListener, que o Safari antigo entende; sem matchMedia, vale `padrao`.
 */
export function useMidia(consulta: string, padrao = false): boolean {
  const ler = () => {
    try {
      return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(consulta).matches : padrao;
    } catch {
      return padrao;
    }
  };
  const [casa, setCasa] = useState(ler);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(consulta);
    const mudou = () => setCasa(mql.matches);
    mudou();
    if (typeof mql.addListener === "function") mql.addListener(mudou);
    return () => {
      if (typeof mql.removeListener === "function") mql.removeListener(mudou);
    };
  }, [consulta]);
  return casa;
}
