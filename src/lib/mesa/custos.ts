import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { inicioDoMes, somarMeses } from "@/lib/mesa/api";

/**
 * Custos de produção da Mesa (pedido do dono em 24/09: "quanto 1 dólar dá de
 * carrossel, post, imagem e criativo, tudo bem organizadinho").
 *
 * Fonte única: a RPC mesa_custos_producao (docs/mesa/v6/migrations/
 * 20260924180000_mesa_custos_e_fila.sql, formato documentado no topo). Enquanto
 * ela não está no banco, a leitura direta pelo RLS da equipe monta o MESMO
 * formato aqui (montarLinhasDeCusto). Nada é estimado: gasto é o que a
 * carteira registrou em ia_usos; peça é trabalho do Estúdio com arte gerada.
 */

export const RPC_DE_CUSTOS = "mesa_custos_producao";

/** Uma linha por cliente e mês (calendário de São Paulo). */
export interface LinhaDeCusto {
  client_id: string;
  nome: string;
  mes: string;
  gasto_total_usd: number;
  gasto_planejamento_usd: number;
  gasto_imagem_usd: number;
  gasto_conferencia_usd: number;
  gasto_leitura_usd: number;
  usos: number;
  imagens_geradas: number;
  conferencias: number;
  posts: number;
  carrosseis: number;
  laminas: number;
  laminas_carrossel: number;
  criativos: number;
  versoes: number;
  refacoes: number;
  correcoes_automaticas: number;
  custo_posts_usd: number;
  custo_carrosseis_usd: number;
  custo_criativos_usd: number;
}

export interface RespostaDeCustos {
  versao: number;
  inicio: string;
  fim: string;
  linhas: LinhaDeCusto[];
  /** "banco" = RPC; "direto" = leitura das tabelas enquanto a RPC não existe. */
  origem: "banco" | "direto";
}

const CAMPOS_NUMERICOS: (keyof LinhaDeCusto)[] = [
  "gasto_total_usd",
  "gasto_planejamento_usd",
  "gasto_imagem_usd",
  "gasto_conferencia_usd",
  "gasto_leitura_usd",
  "usos",
  "imagens_geradas",
  "conferencias",
  "posts",
  "carrosseis",
  "laminas",
  "laminas_carrossel",
  "criativos",
  "versoes",
  "refacoes",
  "correcoes_automaticas",
  "custo_posts_usd",
  "custo_carrosseis_usd",
  "custo_criativos_usd",
];

const numero = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return isFinite(n) ? n : 0;
};

export function linhaVazia(client_id: string, nome: string, mes: string): LinhaDeCusto {
  const linha = { client_id, nome, mes } as LinhaDeCusto;
  for (const c of CAMPOS_NUMERICOS) (linha as any)[c] = 0;
  return linha;
}

/** Aceita qualquer coisa que o banco devolva; o que não tem forma vira lista vazia. */
export function normalizarCustos(data: unknown, origem: "banco" | "direto" = "banco"): RespostaDeCustos {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const linhas: LinhaDeCusto[] = [];
  const brutas = Array.isArray(d.linhas) ? d.linhas : [];
  for (const b of brutas) {
    if (!b || typeof b !== "object") continue;
    const r = b as Record<string, unknown>;
    if (typeof r.client_id !== "string" || !r.client_id) continue;
    const linha = linhaVazia(r.client_id, typeof r.nome === "string" && r.nome ? r.nome : "Cliente", typeof r.mes === "string" ? r.mes.slice(0, 10) : "");
    for (const c of CAMPOS_NUMERICOS) (linha as any)[c] = numero(r[c]);
    linhas.push(linha);
  }
  return {
    versao: numero(d.versao) || 1,
    inicio: typeof d.inicio === "string" ? d.inicio.slice(0, 10) : "",
    fim: typeof d.fim === "string" ? d.fim.slice(0, 10) : "",
    linhas,
    origem,
  };
}

// ------------------------------------------------------------------ contas

export interface Totais {
  gasto: number;
  planejamento: number;
  imagem: number;
  conferencia: number;
  leitura: number;
  usos: number;
  imagensGeradas: number;
  conferencias: number;
  posts: number;
  carrosseis: number;
  laminas: number;
  laminasCarrossel: number;
  criativos: number;
  versoes: number;
  refacoes: number;
  automaticas: number;
  custoPosts: number;
  custoCarrosseis: number;
  custoCriativos: number;
}

export function somarLinhas(linhas: LinhaDeCusto[]): Totais {
  const t: Totais = {
    gasto: 0,
    planejamento: 0,
    imagem: 0,
    conferencia: 0,
    leitura: 0,
    usos: 0,
    imagensGeradas: 0,
    conferencias: 0,
    posts: 0,
    carrosseis: 0,
    laminas: 0,
    laminasCarrossel: 0,
    criativos: 0,
    versoes: 0,
    refacoes: 0,
    automaticas: 0,
    custoPosts: 0,
    custoCarrosseis: 0,
    custoCriativos: 0,
  };
  for (const l of linhas) {
    t.gasto += l.gasto_total_usd;
    t.planejamento += l.gasto_planejamento_usd;
    t.imagem += l.gasto_imagem_usd;
    t.conferencia += l.gasto_conferencia_usd;
    t.leitura += l.gasto_leitura_usd;
    t.usos += l.usos;
    t.imagensGeradas += l.imagens_geradas;
    t.conferencias += l.conferencias;
    t.posts += l.posts;
    t.carrosseis += l.carrosseis;
    t.laminas += l.laminas;
    t.laminasCarrossel += l.laminas_carrossel;
    t.criativos += l.criativos;
    t.versoes += l.versoes;
    t.refacoes += l.refacoes;
    t.automaticas += l.correcoes_automaticas;
    t.custoPosts += l.custo_posts_usd;
    t.custoCarrosseis += l.custo_carrosseis_usd;
    t.custoCriativos += l.custo_criativos_usd;
  }
  return t;
}

/** Divisão que não inventa: sem quantidade, sem média (null). */
export function media(custo: number, quantidade: number): number | null {
  if (!quantidade || quantidade <= 0 || !isFinite(custo)) return null;
  return custo / quantidade;
}

/** Quantas unidades US$ 1 compra a esse custo médio (null sem média ou custo zero). */
export function porUmDolar(custoMedio: number | null): number | null {
  if (custoMedio === null || !(custoMedio > 0)) return null;
  return 1 / custoMedio;
}

export interface Medias {
  post: number | null;
  carrossel: number | null;
  /** Lâmina de post ou carrossel (custo das duas peças dividido pelas lâminas). */
  lamina: number | null;
  criativo: number | null;
  /** Imagem gerada: gasto com imagem dividido pelas imagens pagas. */
  imagem: number | null;
  /** Custo cheio: todo o gasto do período (planejamento e contexto inclusos) por peça feita. */
  pecaCheia: number | null;
}

export function mediasDe(t: Totais): Medias {
  const pecas = t.posts + t.carrosseis + t.criativos;
  return {
    post: media(t.custoPosts, t.posts),
    carrossel: media(t.custoCarrosseis, t.carrosseis),
    lamina: media(t.custoPosts + t.custoCarrosseis, t.laminas),
    criativo: media(t.custoCriativos, t.criativos),
    imagem: media(t.imagem, t.imagensGeradas),
    pecaCheia: media(t.gasto, pecas),
  };
}

export interface ParteDoGasto {
  chave: "planejamento" | "imagem" | "conferencia" | "leitura";
  rotulo: string;
  detalhe: string;
  valor: number;
  /** 0 a 100, arredondado. */
  pct: number;
}

export function quebraDoGasto(t: Totais): ParteDoGasto[] {
  const partes: ParteDoGasto[] = [
    { chave: "imagem", rotulo: "Imagens", detalhe: "geração, refações e correções", valor: t.imagem, pct: 0 },
    { chave: "planejamento", rotulo: "Texto e planejamento", detalhe: "calendário, direção de arte, legendas, ads", valor: t.planejamento, pct: 0 },
    { chave: "conferencia", rotulo: "Conferência", detalhe: "Jev e leitura da arte pronta", valor: t.conferencia, pct: 0 },
    { chave: "leitura", rotulo: "Leitura", detalhe: "referências e contexto do cliente", valor: t.leitura, pct: 0 },
  ];
  const total = partes.reduce((s, p) => s + p.valor, 0);
  for (const p of partes) p.pct = total > 0 ? Math.round((p.valor / total) * 100) : 0;
  return partes;
}

/** Soma as linhas de cada cliente (uma linha por cliente, nome da mais recente), maior gasto primeiro. */
export function agruparPorCliente(linhas: LinhaDeCusto[]): { client_id: string; nome: string; totais: Totais }[] {
  const grupos: Record<string, { client_id: string; nome: string; linhas: LinhaDeCusto[] }> = {};
  const ordem: string[] = [];
  for (const l of linhas) {
    if (!grupos[l.client_id]) {
      grupos[l.client_id] = { client_id: l.client_id, nome: l.nome, linhas: [] };
      ordem.push(l.client_id);
    }
    grupos[l.client_id].linhas.push(l);
    grupos[l.client_id].nome = l.nome || grupos[l.client_id].nome;
  }
  return ordem
    .map((id) => ({ client_id: id, nome: grupos[id].nome, totais: somarLinhas(grupos[id].linhas) }))
    .sort((a, b) => b.totais.gasto - a.totais.gasto || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Soma por mês, do mais recente para o mais antigo. */
export function agruparPorMes(linhas: LinhaDeCusto[]): { mes: string; totais: Totais }[] {
  const grupos: Record<string, LinhaDeCusto[]> = {};
  for (const l of linhas) {
    if (!grupos[l.mes]) grupos[l.mes] = [];
    grupos[l.mes].push(l);
  }
  return Object.keys(grupos)
    .sort()
    .reverse()
    .map((mes) => ({ mes, totais: somarLinhas(grupos[mes]) }));
}

// ------------------------------------------------------------------ período

export type ChaveDoPeriodo = "mes" | "mes_passado" | "tres_meses" | "ano" | "tudo";

export const PERIODOS: { chave: ChaveDoPeriodo; rotulo: string }[] = [
  { chave: "mes", rotulo: "Este mês" },
  { chave: "mes_passado", rotulo: "Mês passado" },
  { chave: "tres_meses", rotulo: "Últimos 3 meses" },
  { chave: "ano", rotulo: "Este ano" },
  { chave: "tudo", rotulo: "Tudo" },
];

/** Início incluído e fim excluído (AAAA-MM-DD), em meses cheios. */
export function limitesDoPeriodo(chave: ChaveDoPeriodo, agora = new Date()): { inicio: string; fim: string } {
  const atual = inicioDoMes(agora);
  const seguinte = somarMeses(atual, 1);
  if (chave === "mes_passado") return { inicio: somarMeses(atual, -1), fim: atual };
  if (chave === "tres_meses") return { inicio: somarMeses(atual, -2), fim: seguinte };
  if (chave === "ano") return { inicio: `${agora.getFullYear()}-01-01`, fim: seguinte };
  if (chave === "tudo") return { inicio: "2026-01-01", fim: seguinte };
  return { inicio: atual, fim: seguinte };
}

// ------------------------------------------------------------------ leitura direta (sem a RPC)

/** Mês de São Paulo (UTC-3 fixo desde 2019, sem horário de verão) de um instante ISO. */
export function mesDeSaoPaulo(iso: string): string {
  const ms = Date.parse(iso);
  if (!isFinite(ms)) return "";
  const d = new Date(ms - 3 * 3600_000);
  const m = d.getUTCMonth() + 1;
  return `${d.getUTCFullYear()}-${m < 10 ? "0" : ""}${m}-01`;
}

/** Instante ISO do começo de um dia de São Paulo. */
export const inicioEmSaoPaulo = (dia: string) => `${dia}T00:00:00-03:00`;

export type CategoriaDoUso = "planejamento" | "imagem" | "conferencia" | "leitura";

/** Mesma regra do CASE da RPC. */
export function categoriaDoUso(u: { tarefa?: string | null; agente?: string | null }): CategoriaDoUso {
  const tarefa = u.tarefa || "";
  const agente = u.agente || "";
  if (agente === "gerador_imagem") return "imagem";
  if (agente === "jev" || tarefa === "verificacao") return "conferencia";
  if (tarefa === "leitura_referencia" || tarefa === "contexto" || agente === "leitor" || agente === "contexto") return "leitura";
  return "planejamento";
}

export interface UsoBruto {
  client_id: string;
  tarefa: string | null;
  agente: string | null;
  imagens: number | null;
  custo_usd: number | string | null;
  referencia_tipo?: string | null;
  referencia_id?: string | null;
  criado_em: string;
}

export interface TrabalhoBruto {
  id: string;
  client_id: string;
  tipo?: string | null;
  task_id: string | null;
  cards: unknown;
  custo_usd: number | string | null;
  criado_em: string;
}

export type Peca = "post" | "carrossel" | "criativo";

/** Lâminas distintas, versões e correções automáticas guardadas nos cards de um trabalho. */
export function contarCards(cards: unknown): { laminas: number; versoes: number; automaticas: number } {
  const lista = Array.isArray(cards) ? cards : [];
  const ordens: string[] = [];
  let automaticas = 0;
  for (const c of lista) {
    if (!c || typeof c !== "object") continue;
    const card = c as Record<string, unknown>;
    if (card.ordem !== undefined && card.ordem !== null) {
      const k = String(card.ordem);
      if (ordens.indexOf(k) < 0) ordens.push(k);
    }
    if (card.autocorrecao && typeof card.autocorrecao === "object") automaticas++;
  }
  return { laminas: Math.max(ordens.length, 1), versoes: lista.length, automaticas };
}

export function pecaDoTrabalho(tipo: string | null | undefined, formato: string | null | undefined, laminas: number): Peca {
  if (tipo === "ads") return "criativo";
  if (formato === "carousel" || laminas > 1) return "carrossel";
  return "post";
}

/**
 * Monta as linhas no formato da RPC a partir das tabelas lidas direto.
 * `custoPorTrabalho` soma os usos ligados a cada trabalho (em qualquer data);
 * sem uso ligado, vale o custo guardado no trabalho.
 */
export function montarLinhasDeCusto(
  usos: UsoBruto[],
  trabalhos: TrabalhoBruto[],
  formatoPorTarefa: Record<string, string | null>,
  custoPorTrabalho: Record<string, number>,
  nomes: Record<string, string>,
): LinhaDeCusto[] {
  const linhas: Record<string, LinhaDeCusto> = {};
  const chaves: string[] = [];
  const linha = (clientId: string, mes: string) => {
    const k = `${clientId}|${mes}`;
    if (!linhas[k]) {
      linhas[k] = linhaVazia(clientId, nomes[clientId] || "Cliente", mes);
      chaves.push(k);
    }
    return linhas[k];
  };

  for (const u of usos) {
    const mes = mesDeSaoPaulo(u.criado_em);
    if (!mes || !u.client_id) continue;
    const l = linha(u.client_id, mes);
    const custo = numero(u.custo_usd);
    const cat = categoriaDoUso(u);
    l.gasto_total_usd += custo;
    if (cat === "imagem") l.gasto_imagem_usd += custo;
    else if (cat === "conferencia") l.gasto_conferencia_usd += custo;
    else if (cat === "leitura") l.gasto_leitura_usd += custo;
    else l.gasto_planejamento_usd += custo;
    l.usos += 1;
    if (u.agente === "gerador_imagem") l.imagens_geradas += numero(u.imagens);
    if (u.tarefa === "verificacao" && u.agente !== "jev" && u.agente !== "gerador_imagem") l.conferencias += 1;
  }

  for (const t of trabalhos) {
    const cont = contarCards(t.cards);
    if (!Array.isArray(t.cards) || (t.cards as unknown[]).length === 0) continue;
    const mes = mesDeSaoPaulo(t.criado_em);
    if (!mes || !t.client_id) continue;
    const l = linha(t.client_id, mes);
    const formato = t.task_id ? formatoPorTarefa[t.task_id] || null : null;
    const peca = pecaDoTrabalho(t.tipo || "social", formato, cont.laminas);
    const ligado = custoPorTrabalho[t.id];
    const custo = ligado && ligado > 0 ? ligado : numero(t.custo_usd);
    if (peca === "criativo") {
      l.criativos += 1;
      l.custo_criativos_usd += custo;
    } else {
      if (peca === "carrossel") {
        l.carrosseis += 1;
        l.laminas_carrossel += cont.laminas;
        l.custo_carrosseis_usd += custo;
      } else {
        l.posts += 1;
        l.custo_posts_usd += custo;
      }
      l.laminas += cont.laminas;
    }
    l.versoes += cont.versoes;
    l.refacoes += Math.max(cont.versoes - cont.laminas, 0);
    l.correcoes_automaticas += cont.automaticas;
  }

  return chaves
    .map((k) => linhas[k])
    .sort((a, b) => (a.mes === b.mes ? a.nome.localeCompare(b.nome, "pt-BR") : a.mes < b.mes ? -1 : 1));
}

/** A RPC ainda não existe no banco (PostgREST responde PGRST202 ou 42883). */
export function rpcAusente(err: unknown): boolean {
  const e = (err || {}) as { code?: string; message?: string };
  if (e.code === "PGRST202" || e.code === "42883") return true;
  const msg = String(e.message || "");
  return msg.indexOf("Could not find the function") >= 0 || msg.indexOf("does not exist") >= 0;
}

const PAGINA = 1000;
const LOTE = 100;

async function lerTudo<T>(montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; de < 20 * PAGINA; de += PAGINA) {
    const { data, error } = await montar(de, de + PAGINA - 1);
    if (error) throw error;
    const lote = data || [];
    for (const x of lote) saida.push(x);
    if (lote.length < PAGINA) break;
  }
  return saida;
}

function emLotes<T>(lista: T[]): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += LOTE) lotes.push(lista.slice(i, i + LOTE));
  return lotes;
}

/** Leitura direta das tabelas (RLS da equipe) no formato da RPC. */
export async function lerCustosDireto(inicio: string, fim: string, nomes: Record<string, string>): Promise<RespostaDeCustos> {
  const sb = supabase as any;
  const de = inicioEmSaoPaulo(inicio);
  const ate = inicioEmSaoPaulo(fim);
  const [usos, trabalhos] = await Promise.all([
    lerTudo<UsoBruto>((a, b) =>
      sb
        .from("ia_usos")
        .select("client_id, tarefa, agente, imagens, custo_usd, referencia_tipo, referencia_id, criado_em")
        .gte("criado_em", de)
        .lt("criado_em", ate)
        .order("criado_em", { ascending: true })
        .range(a, b),
    ),
    lerTudo<TrabalhoBruto>((a, b) =>
      sb
        .from("estudio_trabalhos")
        .select("id, client_id, tipo, task_id, cards, custo_usd, criado_em")
        .gte("criado_em", de)
        .lt("criado_em", ate)
        .order("criado_em", { ascending: true })
        .range(a, b),
    ),
  ]);

  const comArte = trabalhos.filter((t) => Array.isArray(t.cards) && (t.cards as unknown[]).length > 0);
  const formatoPorTarefa: Record<string, string | null> = {};
  const custoPorTrabalho: Record<string, number> = {};
  const idsDeTarefa: string[] = [];
  for (const t of comArte) if (t.task_id && idsDeTarefa.indexOf(t.task_id) < 0) idsDeTarefa.push(t.task_id);
  for (const lote of emLotes(idsDeTarefa)) {
    const { data, error } = await sb.from("tasks").select("id, delivery_type").in("id", lote);
    if (error) throw error;
    for (const r of (data || []) as { id: string; delivery_type: string | null }[]) formatoPorTarefa[r.id] = r.delivery_type;
  }
  for (const lote of emLotes(comArte.map((t) => t.id))) {
    const { data, error } = await sb
      .from("ia_usos")
      .select("referencia_id, custo_usd")
      .eq("referencia_tipo", "estudio_trabalho")
      .in("referencia_id", lote)
      .limit(PAGINA * 5);
    if (error) throw error;
    for (const r of (data || []) as { referencia_id: string; custo_usd: number | string }[]) {
      custoPorTrabalho[r.referencia_id] = (custoPorTrabalho[r.referencia_id] || 0) + numero(r.custo_usd);
    }
  }

  return {
    versao: 1,
    inicio,
    fim,
    linhas: montarLinhasDeCusto(usos, comArte, formatoPorTarefa, custoPorTrabalho, nomes),
    origem: "direto",
  };
}

/** RPC primeiro; sem ela no banco, a leitura direta. */
export async function lerCustos(inicio: string, fim: string, nomes: Record<string, string>): Promise<RespostaDeCustos> {
  const { data, error } = await (supabase as any).rpc(RPC_DE_CUSTOS, { _inicio: inicio, _fim: fim });
  if (!error) return normalizarCustos(data, "banco");
  if (rpcAusente(error)) return lerCustosDireto(inicio, fim, nomes);
  throw error;
}

export const chaveDosCustos = (inicio: string, fim: string) => ["mesa", "custos", inicio, fim] as const;

export function useCustosDeProducao(inicio: string, fim: string, nomes: Record<string, string>, ativo = true) {
  return useQuery({
    queryKey: chaveDosCustos(inicio, fim),
    enabled: ativo,
    queryFn: () => lerCustos(inicio, fim, nomes),
  });
}

// ------------------------------------------------------------------ CSV

const csvNumero = (n: number, casas = 4) => n.toFixed(casas).replace(".", ",");
const csvTexto = (t: string) => `"${String(t || "").replace(/"/g, '""')}"`;

/** CSV por cliente e mês, separado por ponto e vírgula (abre certo no Excel em português). */
export function paraCsv(linhas: LinhaDeCusto[]): string {
  const cabecalho = [
    "Cliente",
    "Mês",
    "Posts",
    "Carrosséis",
    "Lâminas",
    "Criativos",
    "Imagens geradas",
    "Refações",
    "Correções automáticas",
    "Conferências",
    "Gasto total (US$)",
    "Texto e planejamento (US$)",
    "Imagens (US$)",
    "Conferência (US$)",
    "Leitura (US$)",
    "Custo dos posts (US$)",
    "Custo dos carrosséis (US$)",
    "Custo dos criativos (US$)",
    "Custo médio por post (US$)",
    "Custo médio por carrossel (US$)",
    "Custo médio por criativo (US$)",
  ];
  const linhasCsv = [cabecalho.map(csvTexto).join(";")];
  for (const l of linhas) {
    const mp = media(l.custo_posts_usd, l.posts);
    const mc = media(l.custo_carrosseis_usd, l.carrosseis);
    const mcr = media(l.custo_criativos_usd, l.criativos);
    linhasCsv.push(
      [
        csvTexto(l.nome),
        l.mes.slice(0, 7),
        l.posts,
        l.carrosseis,
        l.laminas,
        l.criativos,
        l.imagens_geradas,
        l.refacoes,
        l.correcoes_automaticas,
        l.conferencias,
        csvNumero(l.gasto_total_usd),
        csvNumero(l.gasto_planejamento_usd),
        csvNumero(l.gasto_imagem_usd),
        csvNumero(l.gasto_conferencia_usd),
        csvNumero(l.gasto_leitura_usd),
        csvNumero(l.custo_posts_usd),
        csvNumero(l.custo_carrosseis_usd),
        csvNumero(l.custo_criativos_usd),
        mp === null ? "" : csvNumero(mp),
        mc === null ? "" : csvNumero(mc),
        mcr === null ? "" : csvNumero(mcr),
      ].join(";"),
    );
  }
  return linhasCsv.join("\r\n");
}
