/**
 * Templates de design (frente T, 26/09/2026). Pesquisa e regras em
 * docs/estudio/ESTILO-DO-CLIENTE.md, seção "Templates e combinação".
 *
 * Pedido do dono: o agente de estilo cria REFERÊNCIAS e TEMPLATES com base no
 * que o cliente gosta, no que o dono gosta e no que vai ser montado. Um
 * template é um molde reaproveitável (post 4:5, carrossel com o papel de cada
 * lâmina, story, anúncio): grade e áreas, hierarquia tipográfica, cor com
 * função, tratamento de imagem, elementos, regras de capa, miolo e CTA, o que
 * evitar, a continuidade do carrossel e as imagens-âncora. "Quero usar esse
 * template que já gostei junto com essa referência": o agente COMBINA,
 * escolhe o melhor de cada fonte por dimensão (Jev) e propõe o template novo.
 *
 * É COMPLEMENTO: não troca o kit (paleta, logo e fontes ficam no kit; aqui só
 * a FUNÇÃO de cada cor), nem o estilo do cliente, nem a direção da lâmina. Na
 * geração só entra quando a equipe escolhe o template no trabalho
 * (direcao.template_de_design); "Nenhum" (o padrão) deixa tudo como hoje.
 *
 * Onde mora: tabela cliente_templates_design (SQL T-01 no scratchpad), uma
 * linha por template, do cliente (escopo cliente) ou da agência (escopo
 * agencia, lido por toda a equipe). Sem a tabela: um JSON por dono no bucket
 * mesa (<cliente>/estilo/templates.json e _agencia/estilo/templates.json),
 * com o mesmo formato; nada quebra.
 *
 * Puro: sem Deno. O banco e o Jev entram por parâmetro. Sem travessão.
 */

import {
  type LeituraDaContinuidade,
  laminaParaAOrdem,
  normalizarContinuidade,
  type PapelDaLamina,
  papelPelaOrdem,
} from "./continuidade-do-carrossel.ts";
import { type LaminaDeReferencia, normalizarLaminasDeReferencia } from "./referencia-de-carrossel.ts";
import { blocoDaMarcaTravada, type KitDaTrava, neutralizarMarcaDaReferencia } from "./trava-da-marca.ts";

// ------------------------------------------------------------------ tipos

export const FORMATOS_DO_TEMPLATE = ["post", "carrossel", "story", "anuncio"] as const;
export type FormatoDoTemplate = (typeof FORMATOS_DO_TEMPLATE)[number];
export const ROTULOS_DOS_FORMATOS: Record<FormatoDoTemplate, string> = {
  post: "Post 4:5",
  carrossel: "Carrossel",
  story: "Story",
  anuncio: "Anúncio",
};

export const DIMENSOES_DO_TEMPLATE = ["layout", "tipografia", "cor", "tratamento", "elementos", "capa", "miolo", "cta", "evitar"] as const;
export type DimensaoDoTemplate = (typeof DIMENSOES_DO_TEMPLATE)[number];
export type RegrasDoTemplate = Record<DimensaoDoTemplate, string[]>;

export const ROTULOS_DAS_DIMENSOES: Record<DimensaoDoTemplate, string> = {
  layout: "Layout e grade",
  tipografia: "Hierarquia tipográfica",
  cor: "Cor com função",
  tratamento: "Tratamento de imagem",
  elementos: "Elementos gráficos",
  capa: "Capa",
  miolo: "Miolo",
  cta: "CTA e fechamento",
  evitar: "Evitar",
};

/** Dimensões que a combinação julga (uma pergunta ao Jev por dimensão). */
export const DIMENSOES_DA_COMBINACAO = ["layout", "tipografia", "cor", "tratamento", "elementos", "capa", "cta"] as const;
export type DimensaoDaCombinacao = (typeof DIMENSOES_DA_COMBINACAO)[number];

export const AREAS_DO_TEMPLATE = ["titulo", "apoio", "imagem", "logo", "cta", "area_segura"] as const;
export type AreaDoTemplate = (typeof AREAS_DO_TEMPLATE)[number];
export const ROTULOS_DAS_AREAS: Record<AreaDoTemplate, string> = {
  titulo: "Título",
  apoio: "Apoio",
  imagem: "Imagem",
  logo: "Logo",
  cta: "CTA",
  area_segura: "Área segura",
};

export const ORIGENS_DA_ANCORA = ["arte_aprovada", "teste", "referencia", "perfil"] as const;
export type OrigemDaAncora = (typeof ORIGENS_DA_ANCORA)[number];
export type PapelDaAncora = PapelDaLamina | "geral";

/** Imagem-âncora do template: guia de acabamento, com o papel (capa, miolo, fechamento ou geral). */
export type AncoraDoTemplate = {
  id: string;
  origem: OrigemDaAncora;
  bucket: string;
  caminho: string;
  nome: string;
  papel: PapelDaAncora;
  leitura: string | null;
};

export type CorpoDoTemplate = {
  resumo: string;
  formato: FormatoDoTemplate;
  regras: RegrasDoTemplate;
  /** Onde fica cada área (texto curto: posição, margem, proporção). */
  areas: Partial<Record<AreaDoTemplate, string>>;
  /** Carrossel: lâminas, papéis e continuidade. Outros formatos: null. */
  continuidade: LeituraDaContinuidade | null;
  ancoras: AncoraDoTemplate[];
  /** Referência de carrossel: as lâminas na ordem, com as partes lidas. Template comum: vazio. */
  laminas_referencia: LaminaDeReferencia[];
};

/** template: molde descrito em regras. referencia_carrossel: carrossel guardado lâmina a lâmina, na ordem. */
export type TipoDoTemplate = "template" | "referencia_carrossel";

export type OrigemDoTemplate = "agente" | "equipe" | "combinacao" | "referencias" | "perfil" | "artes_aprovadas";
export type OrigemDaVersaoDoTemplate = OrigemDoTemplate | "voltou" | "teste_aprovado" | "ancoras";

/** O que veio de onde (combinação): dimensão, fonte (apelido e nome) e a frase curta. */
export type DeOnde = { dimensao: DimensaoDoTemplate | "continuidade"; fonte: string; nome: string; frase: string };

export type VersaoDoTemplate = {
  numero: number;
  corpo: CorpoDoTemplate;
  origem: OrigemDaVersaoDoTemplate;
  nota: string;
  criado_em: string;
  criado_por: string | null;
  de_onde: DeOnde[];
};

export type QuemGostou = "cliente" | "dono";
export type Gosto = { id: string; quem: QuemGostou; tipo: "gostou" | "nao_gostou"; texto: string; em: string; por: string | null };

export type TesteDoTemplate = {
  id: string;
  caminho: string;
  tema: string;
  versao: number;
  custo_usd: number;
  criado_em: string;
  status: "novo" | "aprovado" | "descartado";
};

export type EscopoDoTemplate = "cliente" | "agencia";
export type GuardadoEm = "tabela" | "arquivo";

export type TemplateDeDesign = {
  id: string;
  tipo: TipoDoTemplate;
  escopo: EscopoDoTemplate;
  client_id: string | null;
  marca_id: string | null;
  nome: string;
  formato: FormatoDoTemplate;
  status: "ativo" | "arquivado";
  origem: OrigemDoTemplate;
  versao_atual: number;
  versoes: VersaoDoTemplate[];
  gostos: Gosto[];
  testes: TesteDoTemplate[];
  /** Templates de onde este nasceu (combinação), por id. */
  fontes: string[];
  atualizado_em: string | null;
  guardado_em: GuardadoEm;
};

// ------------------------------------------------------------------ limites

export const MAX_ITENS_POR_DIMENSAO = 6;
export const MAX_TEXTO_DA_REGRA = 220;
export const MAX_RESUMO_DO_TEMPLATE = 500;
export const MAX_ANCORAS = 8;
/** Âncoras que vão ao gerador (depois das imagens da lâmina e do estilo). */
export const MAX_ANCORAS_NO_GERADOR = 2;
export const MAX_VERSOES_DO_TEMPLATE = 20;
export const MAX_GOSTOS = 40;
export const MAX_TESTES_DO_TEMPLATE = 16;
export const MAX_TEMPLATES = 60;
export const MAX_FONTES_DA_COMBINACAO = 3;
/** Teto do bloco TEMPLATE que vai ao gerador de imagem. */
export const TETO_DO_BLOCO_DO_TEMPLATE = 1_700;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

// ------------------------------------------------------------------ normalização

/** Tira travessão e hex (a cor exata mora no kit; o template fala da FUNÇÃO da cor). */
const umaLinha = (v: unknown, max: number) =>
  String(v ?? "")
    .replace(/[\u2014\u2013]/g, ",")
    .replace(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi, "cor do kit")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

function listaDeFrases(v: unknown): string[] {
  const bruta = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n|;/) : [];
  const saida: string[] = [];
  for (const item of bruta) {
    const f = umaLinha(item, MAX_TEXTO_DA_REGRA).replace(/^[-*•]\s*/, "");
    if (f && saida.indexOf(f) < 0) saida.push(f);
    if (saida.length >= MAX_ITENS_POR_DIMENSAO) break;
  }
  return saida;
}

export function regrasDoTemplateVazias(): RegrasDoTemplate {
  const r = {} as RegrasDoTemplate;
  for (const d of DIMENSOES_DO_TEMPLATE) r[d] = [];
  return r;
}

export function normalizarRegrasDoTemplate(v: unknown): RegrasDoTemplate {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const r = regrasDoTemplateVazias();
  for (const d of DIMENSOES_DO_TEMPLATE) r[d] = listaDeFrases(o[d]);
  // "foto" (vocabulário do estilo S2) vale como tratamento.
  if (!r.tratamento.length && o.foto) r.tratamento = listaDeFrases(o.foto);
  return r;
}

export const formatoValido = (v: unknown): FormatoDoTemplate =>
  (FORMATOS_DO_TEMPLATE as readonly string[]).indexOf(String(v)) >= 0 ? (v as FormatoDoTemplate) : "post";

export function normalizarAncora(v: unknown): AncoraDoTemplate | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const origem = (ORIGENS_DA_ANCORA as readonly string[]).indexOf(String(o.origem)) >= 0 ? (o.origem as OrigemDaAncora) : null;
  const bucket = umaLinha(o.bucket, 40);
  const caminho = String(o.caminho ?? "").trim().slice(0, 500);
  if (!ehUuid(o.id) || !origem || !bucket || !caminho || caminho.indexOf("..") >= 0) return null;
  const papel: PapelDaAncora = o.papel === "capa" || o.papel === "miolo" || o.papel === "fechamento" ? o.papel : "geral";
  const leitura = umaLinha(o.leitura, 500);
  return { id: String(o.id), origem, bucket, caminho, nome: umaLinha(o.nome, 120) || "âncora", papel, leitura: leitura || null };
}

export function normalizarCorpo(v: unknown, formatoPadrao: FormatoDoTemplate = "post"): CorpoDoTemplate {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const formato = o.formato ? formatoValido(o.formato) : formatoPadrao;
  const areasBrutas = o.areas && typeof o.areas === "object" ? (o.areas as Record<string, unknown>) : {};
  const areas: Partial<Record<AreaDoTemplate, string>> = {};
  for (const a of AREAS_DO_TEMPLATE) {
    const t = umaLinha(areasBrutas[a], 200);
    if (t) areas[a] = t;
  }
  const ancoras: AncoraDoTemplate[] = [];
  for (const a of Array.isArray(o.ancoras) ? o.ancoras : []) {
    const n = normalizarAncora(a);
    if (n && !ancoras.some((x) => x.id === n.id)) ancoras.push(n);
    if (ancoras.length >= MAX_ANCORAS) break;
  }
  const continuidade = formato === "carrossel" ? normalizarContinuidade(o.continuidade) : null;
  const laminas_referencia = normalizarLaminasDeReferencia(o.laminas_referencia);
  return { resumo: umaLinha(o.resumo, MAX_RESUMO_DO_TEMPLATE), formato, regras: normalizarRegrasDoTemplate(o.regras), areas, continuidade, ancoras, laminas_referencia };
}

export function corpoTemConteudo(c: CorpoDoTemplate | null | undefined): boolean {
  if (!c) return false;
  return !!c.resumo || DIMENSOES_DO_TEMPLATE.some((d) => c.regras[d].length > 0) || Object.keys(c.areas).length > 0 || !!c.continuidade || c.laminas_referencia.length > 0;
}

const ORIGENS_DO_TEMPLATE: OrigemDoTemplate[] = ["agente", "equipe", "combinacao", "referencias", "perfil", "artes_aprovadas"];
const ORIGENS_DA_VERSAO: OrigemDaVersaoDoTemplate[] = [...ORIGENS_DO_TEMPLATE, "voltou", "teste_aprovado", "ancoras"];

function normalizarDeOnde(v: unknown): DeOnde[] {
  const saida: DeOnde[] = [];
  for (const x of Array.isArray(v) ? v : []) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const d = String(o.dimensao || "");
    const dimensao = d === "continuidade" || (DIMENSOES_DO_TEMPLATE as readonly string[]).indexOf(d) >= 0 ? (d as DeOnde["dimensao"]) : null;
    const frase = umaLinha(o.frase, 200);
    if (!dimensao || !frase) continue;
    saida.push({ dimensao, fonte: umaLinha(o.fonte, 20).toLowerCase(), nome: umaLinha(o.nome, 120), frase });
    if (saida.length >= 12) break;
  }
  return saida;
}

function normalizarVersao(v: unknown, formato: FormatoDoTemplate): VersaoDoTemplate | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const numero = Number(o.numero);
  if (!Number.isInteger(numero) || numero < 1) return null;
  const origem = ORIGENS_DA_VERSAO.indexOf(o.origem as OrigemDaVersaoDoTemplate) >= 0 ? (o.origem as OrigemDaVersaoDoTemplate) : "equipe";
  return {
    numero,
    corpo: normalizarCorpo(o.corpo, formato),
    origem,
    nota: umaLinha(o.nota, 300),
    criado_em: String(o.criado_em || ""),
    criado_por: ehUuid(o.criado_por) ? String(o.criado_por) : null,
    de_onde: normalizarDeOnde(o.de_onde),
  };
}

function normalizarGosto(v: unknown): Gosto | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const t = umaLinha(o.texto, 300);
  if (!t) return null;
  return {
    id: umaLinha(o.id, 40) || `g${t.length}`,
    quem: o.quem === "dono" ? "dono" : "cliente",
    tipo: o.tipo === "nao_gostou" ? "nao_gostou" : "gostou",
    texto: t,
    em: String(o.em || ""),
    por: ehUuid(o.por) ? String(o.por) : null,
  };
}

function normalizarTesteDoTemplate(v: unknown): TesteDoTemplate | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const caminho = String(o.caminho ?? "").trim();
  const id = umaLinha(o.id, 60);
  if (!id || !caminho || caminho.indexOf("..") >= 0) return null;
  return {
    id,
    caminho,
    tema: umaLinha(o.tema, 200),
    versao: Number.isInteger(Number(o.versao)) ? Number(o.versao) : 0,
    custo_usd: typeof o.custo_usd === "number" && isFinite(o.custo_usd) ? o.custo_usd : 0,
    criado_em: String(o.criado_em || ""),
    status: o.status === "aprovado" || o.status === "descartado" ? o.status : "novo",
  };
}

const lista = <T>(v: unknown, f: (x: unknown) => T | null): T[] => (Array.isArray(v) ? v.map(f).filter((x): x is T => !!x) : []);

/** Linha (tabela ou arquivo) vira template. Sem id válido ou sem dono coerente: null. */
export function normalizarTemplate(linha: unknown, guardadoEm: GuardadoEm): TemplateDeDesign | null {
  if (!linha || typeof linha !== "object") return null;
  const o = linha as Record<string, unknown>;
  if (!ehUuid(o.id)) return null;
  const escopo: EscopoDoTemplate = o.escopo === "agencia" ? "agencia" : "cliente";
  const clientId = escopo === "cliente" && ehUuid(o.client_id) ? String(o.client_id) : null;
  if (escopo === "cliente" && !clientId) return null;
  const formato = formatoValido(o.formato);
  const versoes = lista(o.versoes, (x) => normalizarVersao(x, formato)).sort((a, b) => a.numero - b.numero);
  const atual = Number(o.versao_atual);
  const versaoAtual = versoes.some((v) => v.numero === atual) ? atual : versoes.length ? versoes[versoes.length - 1].numero : 0;
  return {
    id: String(o.id),
    tipo: o.tipo === "referencia_carrossel" ? "referencia_carrossel" : "template",
    escopo,
    client_id: clientId,
    marca_id: escopo === "cliente" && ehUuid(o.marca_id) ? String(o.marca_id) : null,
    nome: umaLinha(o.nome, 80) || "Template",
    formato,
    status: o.status === "arquivado" ? "arquivado" : "ativo",
    origem: ORIGENS_DO_TEMPLATE.indexOf(o.origem as OrigemDoTemplate) >= 0 ? (o.origem as OrigemDoTemplate) : "equipe",
    versao_atual: versaoAtual,
    versoes,
    gostos: lista(o.gostos, normalizarGosto),
    testes: lista(o.testes, normalizarTesteDoTemplate),
    fontes: (Array.isArray(o.fontes) ? o.fontes : []).filter(ehUuid).map(String).slice(0, MAX_FONTES_DA_COMBINACAO),
    atualizado_em: o.atualizado_em ? String(o.atualizado_em) : null,
    guardado_em: guardadoEm,
  };
}

// ------------------------------------------------------------------ versões e mudanças (puras)

export function corpoAtual(t: TemplateDeDesign | null | undefined): CorpoDoTemplate | null {
  if (!t) return null;
  const v = t.versoes.find((x) => x.numero === t.versao_atual);
  return v ? v.corpo : null;
}

export function templateNovo(e: {
  id: string;
  tipo?: TipoDoTemplate;
  escopo: EscopoDoTemplate;
  clientId: string | null;
  marcaId: string | null;
  nome: string;
  origem: OrigemDoTemplate;
  corpo: CorpoDoTemplate;
  nota: string;
  por: string | null;
  agora: string;
  deOnde?: DeOnde[];
  fontes?: string[];
}): TemplateDeDesign {
  const corpo = normalizarCorpo(e.corpo, e.corpo ? e.corpo.formato : "post");
  return {
    id: e.id,
    tipo: e.tipo === "referencia_carrossel" ? "referencia_carrossel" : "template",
    escopo: e.escopo,
    client_id: e.escopo === "cliente" ? e.clientId : null,
    marca_id: e.escopo === "cliente" ? e.marcaId : null,
    nome: umaLinha(e.nome, 80) || "Template",
    formato: corpo.formato,
    status: "ativo",
    origem: e.origem,
    versao_atual: 1,
    versoes: [{ numero: 1, corpo, origem: e.origem, nota: umaLinha(e.nota, 300), criado_em: e.agora, criado_por: e.por, de_onde: normalizarDeOnde(e.deOnde || []) }],
    gostos: [],
    testes: [],
    fontes: (e.fontes || []).filter(ehUuid).slice(0, MAX_FONTES_DA_COMBINACAO),
    atualizado_em: null,
    guardado_em: "tabela",
  };
}

export function comNovaVersaoDoTemplate(t: TemplateDeDesign, corpo: CorpoDoTemplate, origem: OrigemDaVersaoDoTemplate, nota: string, por: string | null, agora: string, deOnde: DeOnde[] = []): TemplateDeDesign {
  const numero = t.versoes.reduce((m, v) => Math.max(m, v.numero), 0) + 1;
  const c = normalizarCorpo(corpo, t.formato);
  const versao: VersaoDoTemplate = { numero, corpo: c, origem, nota: umaLinha(nota, 300), criado_em: agora, criado_por: por, de_onde: normalizarDeOnde(deOnde) };
  return { ...t, formato: c.formato, versoes: t.versoes.concat([versao]).slice(-MAX_VERSOES_DO_TEMPLATE), versao_atual: numero };
}

export function voltandoTemplatePara(t: TemplateDeDesign, numero: number, por: string | null, agora: string): TemplateDeDesign {
  const alvo = t.versoes.find((v) => v.numero === numero);
  if (!alvo) throw new Error("Versão não encontrada.");
  return comNovaVersaoDoTemplate(t, alvo.corpo, "voltou", `Voltou para a versão ${numero}.`, por, agora, alvo.de_onde);
}

/** Apagar é arquivar: some da lista e do seletor, continua guardado e volta com "desarquivar". */
export const arquivado = (t: TemplateDeDesign, sim: boolean): TemplateDeDesign => ({ ...t, status: sim ? "arquivado" : "ativo" });

export function comAncoras(t: TemplateDeDesign, entra: AncoraDoTemplate[], sai: string[], por: string | null, agora: string, nota: string): TemplateDeDesign {
  const c = corpoAtual(t) || normalizarCorpo({}, t.formato);
  const ancoras = c.ancoras.filter((a) => sai.indexOf(a.id) < 0);
  for (const a of entra) if (!ancoras.some((x) => x.id === a.id)) ancoras.push(a);
  return comNovaVersaoDoTemplate(t, { ...c, ancoras: ancoras.slice(-MAX_ANCORAS) }, "ancoras", nota, por, agora);
}

/** "cliente gostou: ...", "dono não gostou: ...", "gostou: ..." (cliente). */
export function lerGosto(bruto: unknown): { quem: QuemGostou; tipo: "gostou" | "nao_gostou"; texto: string } | null {
  const s = umaLinha(bruto, 320);
  if (!s) return null;
  const m = /^(?:(cliente|dono)\s+)?(n[aã]o[\s_]?gostou|gostou)\s*[:\-]\s*(.+)$/i.exec(s);
  if (!m) return { quem: "cliente", tipo: "gostou", texto: s.slice(0, 300) };
  const t = umaLinha(m[3], 300);
  return t ? { quem: m[1] && /^d/i.test(m[1]) ? "dono" : "cliente", tipo: /^n/i.test(m[2]) ? "nao_gostou" : "gostou", texto: t } : null;
}

export function comGosto(t: TemplateDeDesign, g: { quem: QuemGostou; tipo: "gostou" | "nao_gostou"; texto: string }, por: string | null, agora: string, id: string): TemplateDeDesign {
  const novo: Gosto = { id, quem: g.quem, tipo: g.tipo, texto: umaLinha(g.texto, 300), em: agora, por };
  return { ...t, gostos: t.gostos.concat([novo]).slice(-MAX_GOSTOS) };
}

export const semGosto = (t: TemplateDeDesign, id: string): TemplateDeDesign => ({ ...t, gostos: t.gostos.filter((g) => g.id !== id) });

export function comTestesDoTemplate(t: TemplateDeDesign, novos: TesteDoTemplate[]): TemplateDeDesign {
  let testes = t.testes.concat(novos);
  while (testes.length > MAX_TESTES_DO_TEMPLATE) {
    const i = testes.findIndex((x) => x.status !== "aprovado");
    testes = testes.filter((_, k) => k !== (i >= 0 ? i : 0));
  }
  return { ...t, testes };
}

export const comTesteDoTemplateMudado = (t: TemplateDeDesign, id: string, f: (x: TesteDoTemplate) => TesteDoTemplate): TemplateDeDesign => ({
  ...t,
  testes: t.testes.map((x) => (x.id === id ? f(x) : x)),
});

// ------------------------------------------------------------------ texto

/** O template legível (prompt do agente, estado de Jev e tela). */
export function corpoEmTexto(c: CorpoDoTemplate | null | undefined, dimensoes: readonly DimensaoDoTemplate[] = DIMENSOES_DO_TEMPLATE): string {
  if (!corpoTemConteudo(c)) return "vazio.";
  const x = c!;
  const linhas: string[] = [`Formato: ${ROTULOS_DOS_FORMATOS[x.formato]}`];
  if (x.resumo) linhas.push(`Resumo: ${x.resumo}`);
  for (const d of dimensoes) if (x.regras[d].length) linhas.push(`${ROTULOS_DAS_DIMENSOES[d]}: ${x.regras[d].join("; ")}`);
  const areas = AREAS_DO_TEMPLATE.filter((a) => x.areas[a]).map((a) => `${ROTULOS_DAS_AREAS[a]} ${x.areas[a]}`);
  if (areas.length) linhas.push(`Áreas: ${areas.join("; ")}`);
  if (x.continuidade) linhas.push(`Continuidade: ${x.continuidade.total} lâminas, ${x.continuidade.tipos.join(", ") || "sem tipo"}${x.continuidade.descricao ? `. ${x.continuidade.descricao}` : ""}`);
  if (x.ancoras.length) linhas.push(`Âncoras: ${x.ancoras.length}`);
  return linhas.join("\n");
}

// ------------------------------------------------------------------ na geração

/** O trabalho escolheu um template? Só um objeto com id UUID liga ("Nenhum", ausente ou outro valor: nada). */
export function templateEscolhidoNoTrabalho(direcao: unknown): { id: string } | null {
  if (!direcao || typeof direcao !== "object") return null;
  const t = (direcao as Record<string, unknown>).template_de_design;
  if (!t || typeof t !== "object") return null;
  const id = (t as Record<string, unknown>).id;
  return ehUuid(id) ? { id: String(id) } : null;
}

export const ROTULO_DA_ANCORA_DO_TEMPLATE =
  "âncora do TEMPLATE escolhido, só para acabamento (grade, hierarquia, tratamento e elementos); não copie texto, pessoa, produto nem marca dela";

export const ROTULO_DA_FAIXA_DA_BORDA =
  "faixa da borda direita da lâmina anterior deste carrossel, para encaixe da continuidade; não copie o texto dela";

const corta = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trim()}.` : s);

/** Âncoras que valem para a lâmina: as do papel dela primeiro, depois as gerais, depois as outras. */
export function ancorasParaALamina(c: CorpoDoTemplate, ordem: number, total: number): AncoraDoTemplate[] {
  const papel = papelPelaOrdem(ordem, total);
  const peso = (a: AncoraDoTemplate) => (a.papel === papel ? 0 : a.papel === "geral" ? 1 : 2);
  return c.ancoras.map((a, i) => ({ a, i })).sort((x, y) => peso(x.a) - peso(y.a) || x.i - y.i).map((x) => x.a);
}

/**
 * O bloco curto "TEMPLATE" que vai ao gerador quando a equipe escolhe um
 * template no trabalho. Entra DEPOIS do bloco do estilo (quando houver). No
 * carrossel, o papel da lâmina escolhe a parte: capa na 1, miolo no meio,
 * fechamento e CTA na última. Nunca passa de TETO_DO_BLOCO_DO_TEMPLATE. Corpo
 * vazio: "".
 */
export function blocoDoTemplateParaOGerador(
  nome: string,
  c: CorpoDoTemplate | null | undefined,
  e: { ordem: number; total: number; indicesDasAncoras?: number[]; continuidade?: string[]; kit?: KitDaTrava },
): string {
  if (!corpoTemConteudo(c)) return "";
  const kit = e.kit || null;
  const trava = blocoDaMarcaTravada(kit);
  const x = c!;
  const papel = papelPelaOrdem(e.ordem, e.total);
  const cabeca = `TEMPLATE "${umaLinha(nome, 60) || "escolhido"}" (molde escolhido pela equipe para esta peça; o texto exato, a logo e as referências da lâmina valem sobre ele):`;
  const topo: string[] = [];
  const lamina = x.continuidade ? laminaParaAOrdem(x.continuidade, e.ordem, e.total) : null;
  if (e.total > 1 || lamina) {
    const partes = [`${papel === "capa" ? "capa" : papel === "fechamento" ? "fechamento" : "miolo"} (lâmina ${e.ordem} de ${e.total})`];
    if (lamina && lamina.funcao) partes.push(lamina.funcao);
    if (lamina && lamina.hierarquia) partes.push(`texto: ${lamina.hierarquia}`);
    topo.push(`- PAPEL DESTA LÂMINA: ${partes.join("; ")}`);
  }
  const meio: string[] = [];
  if (x.resumo) meio.push(`- ${corta(x.resumo, 220)}`);
  const areas = AREAS_DO_TEMPLATE.filter((a) => x.areas[a]).map((a) => `${ROTULOS_DAS_AREAS[a].toLowerCase()} ${corta(x.areas[a]!, 80)}`);
  if (areas.length) meio.push(`- ÁREAS: ${areas.join("; ")}`);
  const dims: DimensaoDoTemplate[] = ["layout", "tipografia", "cor", "tratamento", "elementos"];
  if (papel === "capa") dims.push("capa");
  if (papel === "miolo") dims.push("miolo");
  if (papel === "fechamento") dims.push("miolo", "cta");
  if (e.total <= 1 && dims.indexOf("cta") < 0) dims.push("cta");
  for (const d of dims) {
    const r = x.regras[d].slice(0, 2).map((y) => corta(y, 130));
    if (r.length) meio.push(`- ${ROTULOS_DAS_DIMENSOES[d].toUpperCase()}: ${r.join("; ")}`);
  }
  const fim: string[] = (e.continuidade || []).map((l) => corta(l, 320));
  const evitar = x.regras.evitar.slice(0, 3).map((y) => corta(y, 110));
  if (evitar.length) fim.push(`- EVITAR: ${evitar.join("; ")}`);
  const idx = (e.indicesDasAncoras || []).filter((n) => Number.isInteger(n) && n > 0);
  if (idx.length) fim.push(`- ${idx.length === 1 ? `Imagem ${idx[0]}` : `Imagens ${idx.join(" e ")}`}: âncora do template, só para acabamento; não copie texto, pessoa nem produto dela.`);
  // Trava da marca: fonte, hex e cor que vieram de referência saem do texto; a regra da marca do cliente fecha o bloco.
  // Cabe no teto: corta do fim do meio (regras menos fortes) antes do papel, da continuidade, do EVITAR, das imagens e da trava.
  const montar = (m: string[]) => `${neutralizarMarcaDaReferencia([cabeca, ...topo, ...m, ...fim].join("\n"), kit)}\n${trava}`;
  let m = meio.slice();
  while (m.length && montar(m).length > TETO_DO_BLOCO_DO_TEMPLATE) m = m.slice(0, -1);
  const saida = montar(m);
  if (saida.length <= TETO_DO_BLOCO_DO_TEMPLATE) return saida;
  const semMeio = neutralizarMarcaDaReferencia([cabeca, ...topo, ...fim].join("\n"), kit);
  return `${semMeio.slice(0, Math.max(0, TETO_DO_BLOCO_DO_TEMPLATE - trava.length - 1)).trim()}\n${trava}`;
}

/** Prompt da imagem de teste do template (mesmo gerador do Estúdio, mesmo caminho do teste do estilo). */
export function promptDoTesteDoTemplate(t: { nome: string; corpo: CorpoDoTemplate }, e: { cliente: string; tema: string; paleta: string[]; indices: number[]; variacao: number; total: number }): string {
  const tema = umaLinha(e.tema, 200) || "post de apresentação do negócio";
  const bloco = blocoDoTemplateParaOGerador(t.nome, t.corpo, { ordem: 1, total: 1, indicesDasAncoras: e.indices });
  const paleta = e.paleta.filter((h) => /^#[0-9a-f]{6}$/i.test(h)).slice(0, 6);
  const formato = t.corpo.formato === "story" ? "story do Instagram (9:16)" : t.corpo.formato === "carrossel" ? "capa de carrossel do Instagram (4:5)" : t.corpo.formato === "anuncio" ? "anúncio estático (4:5)" : "post de Instagram (4:5)";
  const variacoes = ["composição fiel ao template", "mesmo template com o título na outra ponta da área de texto", "mesmo template com a imagem dominante", "mesmo template só tipográfico"];
  return [
    `Arte de TESTE de ${formato} para ${umaLinha(e.cliente, 80) || "o cliente"}, para a equipe ver se o template abaixo está certo.`,
    `Tema: ${tema}. Um título curto em português do Brasil, legível na miniatura, e no máximo uma linha de apoio.`,
    paleta.length ? `Paleta da marca (use com a função descrita no template): ${paleta.join(", ")}.` : "",
    e.total > 1 ? `Variação ${e.variacao} de ${e.total}: ${variacoes[(e.variacao - 1) % variacoes.length]}.` : "",
    bloco,
    "Sem logo inventada, sem marca d'água, sem texto de outra marca. Foto nunca escurecida para caber texto.",
  ].filter(Boolean).join("\n\n");
}

// ------------------------------------------------------------------ combinação (Jev escolhe, o diretor de arte redige)

/** Fonte de uma combinação: template (t*) ou referência (r*). */
export type FonteDaCombinacao = {
  apelido: string;
  nome: string;
  tipo: "template" | "referencia";
  /** Template: o corpo. Referência: leitura por visão em texto. */
  corpo?: CorpoDoTemplate | null;
  leitura?: string | null;
  gostos?: string[];
  id?: string | null;
};

/** A descrição de uma fonte numa dimensão (o que o Jev compara). */
export function descricaoNaDimensao(f: FonteDaCombinacao, d: DimensaoDoTemplate): string {
  if (f.corpo) {
    const r = f.corpo.regras[d];
    if (r.length) return r.join("; ");
    if (d === "layout") {
      const a = AREAS_DO_TEMPLATE.filter((k) => f.corpo!.areas[k]).map((k) => `${ROTULOS_DAS_AREAS[k]} ${f.corpo!.areas[k]}`);
      if (a.length) return a.join("; ");
    }
    return "";
  }
  return f.leitura ? `(leitura geral da referência) ${umaLinha(f.leitura, 500)}` : "";
}

export type ContextoDaCombinacao = {
  cliente: string;
  objetivo: string;
  negocio?: string | null;
  publico?: string | null;
  estilo_do_cliente?: string | null;
  aprendizados?: string[];
};

export type EscolhaNaDimensao = { fonte: string; confianca: number | null; duvida: boolean; por: "jev" | "unica" | "dono" };

export type EscolhaDaCombinacao =
  | { modo: "jev" | "dono"; escolhas: Partial<Record<DimensaoDaCombinacao, EscolhaNaDimensao>>; coerencia: number | null; variacoes: 1 | 2 }
  | { modo: "pedir_ao_dono"; motivo: string };

export const OPCAO_COMBINAR = "combinar";
/** Abaixo disso a escolha da dimensão fica marcada como dúvida (a tela mostra). */
export const CONFIANCA_MINIMA = 0.35;
/** Abaixo disso (coerência de 0 a 1) a proposta sai em 2 variações de uma vez, para o dono escolher. */
export const COERENCIA_MINIMA = 0.5;

export const NIVEIS_DA_COERENCIA = [
  "As escolhas brigam entre si: juntas não parecem uma marca só (por exemplo, letra pesada e cheia de efeito num layout delicado e vazio, ou duas paletas com funções opostas).",
  "Parte combina, mas há pelo menos um conflito visível que o designer teria que resolver antes de usar.",
  "Combinam bem; as diferenças são pequenas e o próprio molde resolve.",
  "Formam um sistema só, coerente e completo, como se tivessem nascido juntas para este cliente.",
];

type RespostaDoJev = { choice?: string; confidence?: number; score?: number };
export type PerguntarAoJev = (pedido: { state: unknown; questions: Record<string, unknown> }) => Promise<{ answers: Record<string, RespostaDoJev> }>;

/** Estado das perguntas (o Jev lê isto): cliente, objetivo e as fontes por dimensão. */
export function estadoDaCombinacao(fontes: FonteDaCombinacao[], ctx: ContextoDaCombinacao) {
  return {
    cliente: { nome: ctx.cliente, negocio: ctx.negocio ?? null, publico: ctx.publico ?? null, estilo_atual: ctx.estilo_do_cliente ?? null, o_que_ja_ensinou: (ctx.aprendizados || []).slice(0, 10) },
    objetivo_da_peca: ctx.objetivo || "peças do dia a dia do cliente",
    fontes: fontes.map((f) => ({
      opcao: f.apelido,
      nome: f.nome,
      tipo: f.tipo === "template" ? "template já aprovado" : "referência nova",
      gostos: (f.gostos || []).slice(0, 6),
      por_dimensao: Object.fromEntries(DIMENSOES_DA_COMBINACAO.map((d) => [d, descricaoNaDimensao(f, d) || "não diz nada"])),
    })),
  };
}

/** Uma pergunta Choice por dimensão (só as que mais de uma fonte descreve), com a opção "combinar". */
export function perguntasDaCombinacao(fontes: FonteDaCombinacao[]): { perguntas: Record<string, unknown>; unicas: Partial<Record<DimensaoDaCombinacao, string>> } {
  const perguntas: Record<string, unknown> = {};
  const unicas: Partial<Record<DimensaoDaCombinacao, string>> = {};
  for (const d of DIMENSOES_DA_COMBINACAO) {
    const com = fontes.filter((f) => !!descricaoNaDimensao(f, d));
    if (!com.length) continue;
    if (com.length === 1) {
      unicas[d] = com[0].apelido;
      continue;
    }
    const criteria: Record<string, string> = {};
    for (const f of com) criteria[f.apelido] = `Usar ${f.tipo === "template" ? "o template" : "a referência"} "${f.nome}" nesta dimensão: ${umaLinha(descricaoNaDimensao(f, d), 400)}`;
    criteria[OPCAO_COMBINAR] = `Combinar as fontes nesta dimensão: juntar o melhor de ${com.map((f) => f.apelido).join(" e ")} porque cada uma resolve uma parte e juntas ficam mais completas.`;
    perguntas[`dim_${d}`] = {
      type: "choice",
      instructions: `Dimensão "${ROTULOS_DAS_DIMENSOES[d]}" de um template de design para ESTE cliente e ESTE objetivo (\`cliente\` e \`objetivo_da_peca\`). Qual fonte em \`fontes\` resolve melhor esta dimensão, pensando no que o cliente e o dono já gostaram, no negócio e no público? Escolha combinar só quando as duas trazem partes que se completam de verdade.`,
      criteria,
    };
  }
  return { perguntas, unicas };
}

export function perguntaDeCoerencia() {
  return {
    type: "score",
    instructions: "As escolhas em `escolhas_por_dimensao` vão virar UM template de design para o cliente em `cliente`. Quão bem elas funcionam juntas como um sistema visual só?",
    criteria: NIVEIS_DA_COERENCIA,
  };
}

/**
 * Escolhe o melhor de cada fonte por dimensão. Dimensão que só uma fonte
 * descreve fica com ela (sem Jev). As outras: um Choice por dimensão (uma
 * chamada só). Depois, um Score de coerência do conjunto (segunda chamada: o
 * estado depende das escolhas). Sem laço: coerência baixa não refaz nada, só
 * pede 2 variações de uma vez para o dono escolher. Falha do Jev nas escolhas:
 * pedir_ao_dono (a tela mostra a grade para o dono escolher). Falha só na
 * coerência: segue sem ela.
 */
export async function escolherMelhoresPontos(fontes: FonteDaCombinacao[], ctx: ContextoDaCombinacao, perguntar: PerguntarAoJev): Promise<EscolhaDaCombinacao> {
  if (fontes.length < 2) return { modo: "pedir_ao_dono", motivo: "Escolha pelo menos duas fontes para combinar." };
  const { perguntas, unicas } = perguntasDaCombinacao(fontes);
  const escolhas: Partial<Record<DimensaoDaCombinacao, EscolhaNaDimensao>> = {};
  for (const d of Object.keys(unicas) as DimensaoDaCombinacao[]) escolhas[d] = { fonte: unicas[d]!, confianca: null, duvida: false, por: "unica" };
  const estado = estadoDaCombinacao(fontes, ctx);
  if (Object.keys(perguntas).length) {
    let r: { answers: Record<string, RespostaDoJev> };
    try {
      r = await perguntar({ state: estado, questions: perguntas });
    } catch {
      return { modo: "pedir_ao_dono", motivo: "O Jev não respondeu agora. Escolha você o que vem de cada fonte." };
    }
    const validas = fontes.map((f) => f.apelido).concat([OPCAO_COMBINAR]);
    for (const k of Object.keys(perguntas)) {
      const d = k.slice(4) as DimensaoDaCombinacao;
      const a = r && r.answers ? r.answers[k] : undefined;
      const fonte = a && typeof a.choice === "string" ? a.choice : "";
      if (validas.indexOf(fonte) < 0) return { modo: "pedir_ao_dono", motivo: "O Jev respondeu fora das opções. Escolha você o que vem de cada fonte." };
      const confianca = typeof a!.confidence === "number" && isFinite(a!.confidence) ? a!.confidence : null;
      escolhas[d] = { fonte, confianca, duvida: confianca !== null && confianca < CONFIANCA_MINIMA, por: "jev" };
    }
  }
  if (!Object.keys(escolhas).length) return { modo: "pedir_ao_dono", motivo: "As fontes não descrevem nada para combinar. Leia as referências antes." };
  const coerencia = await coerenciaDoConjunto(fontes, escolhas, estado, perguntar);
  return { modo: "jev", escolhas, coerencia, variacoes: coerencia !== null && coerencia < COERENCIA_MINIMA ? 2 : 1 };
}

async function coerenciaDoConjunto(
  fontes: FonteDaCombinacao[],
  escolhas: Partial<Record<DimensaoDaCombinacao, EscolhaNaDimensao>>,
  estado: ReturnType<typeof estadoDaCombinacao>,
  perguntar: PerguntarAoJev,
): Promise<number | null> {
  const porDimensao: Record<string, string> = {};
  for (const d of Object.keys(escolhas) as DimensaoDaCombinacao[]) {
    const e = escolhas[d]!;
    if (e.fonte === OPCAO_COMBINAR) {
      porDimensao[d] = `combinar: ${fontes.map((f) => descricaoNaDimensao(f, d)).filter(Boolean).map((s) => umaLinha(s, 200)).join(" + ")}`;
    } else {
      const f = fontes.find((x) => x.apelido === e.fonte);
      porDimensao[d] = f ? umaLinha(descricaoNaDimensao(f, d), 300) : "";
    }
  }
  try {
    const r = await perguntar({ state: { cliente: estado.cliente, objetivo_da_peca: estado.objetivo_da_peca, escolhas_por_dimensao: porDimensao }, questions: { coerencia: perguntaDeCoerencia() } });
    const s = r && r.answers && r.answers.coerencia ? r.answers.coerencia.score : undefined;
    return typeof s === "number" && isFinite(s) ? Math.max(0, Math.min(1, s / (NIVEIS_DA_COERENCIA.length - 1))) : null;
  } catch {
    return null;
  }
}

/** Escolhas feitas pelo dono na tela (quando o Jev falha ou ele quer mudar): só apelidos das fontes ou "combinar". */
export function escolhasDoDono(bruto: unknown, fontes: FonteDaCombinacao[]): EscolhaDaCombinacao | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const validas = fontes.map((f) => f.apelido).concat([OPCAO_COMBINAR]);
  const escolhas: Partial<Record<DimensaoDaCombinacao, EscolhaNaDimensao>> = {};
  for (const d of DIMENSOES_DA_COMBINACAO) {
    const v = String(o[d] ?? "").trim().toLowerCase();
    if (validas.indexOf(v) >= 0) escolhas[d] = { fonte: v, confianca: null, duvida: false, por: "dono" };
  }
  return Object.keys(escolhas).length ? { modo: "dono", escolhas, coerencia: null, variacoes: 1 } : null;
}

/** Texto da escolha para o diretor de arte redigir o template combinado. */
export function pedidoDaRedacao(fontes: FonteDaCombinacao[], escolha: Extract<EscolhaDaCombinacao, { escolhas: unknown }>, ctx: ContextoDaCombinacao, formato: FormatoDoTemplate): string {
  const linhas: string[] = [];
  linhas.push(`Monte UM template de ${ROTULOS_DOS_FORMATOS[formato]} para ${ctx.cliente}, combinando as fontes abaixo. Objetivo: ${ctx.objetivo || "peças do dia a dia do cliente"}.`);
  linhas.push("FONTES:");
  for (const f of fontes) {
    const corpo = f.corpo ? corpoEmTexto(f.corpo) : f.leitura ? `Leitura: ${umaLinha(f.leitura, 900)}` : "sem descrição";
    linhas.push(`[${f.apelido}] ${f.tipo === "template" ? "Template" : "Referência"} "${f.nome}"${f.gostos && f.gostos.length ? ` (gostos: ${f.gostos.slice(0, 4).join("; ")})` : ""}\n${corpo}`);
  }
  linhas.push("O QUE VEM DE ONDE (decidido antes, siga):");
  for (const d of DIMENSOES_DA_COMBINACAO) {
    const e = escolha.escolhas[d];
    if (!e) continue;
    linhas.push(`- ${ROTULOS_DAS_DIMENSOES[d]}: ${e.fonte === OPCAO_COMBINAR ? `combinar ${fontes.map((f) => f.apelido).join(" + ")}` : e.fonte}`);
  }
  if (formato === "carrossel") linhas.push("Carrossel: traga a continuidade (lâminas, papéis, o que cruza a borda) da fonte que tem continuidade; sem nenhuma, deixe continuidade nula.");
  linhas.push(escolha.variacoes === 2
    ? "O conjunto pode brigar: devolva DUAS variações de uma vez. A 1 segue exatamente o que vem de onde. A 2 usa a fonte mais escolhida como base inteira e traz das outras só o que não briga. O dono escolhe."
    : "Devolva UMA variação que siga exatamente o que vem de onde.");
  linhas.push("Em de_onde, uma frase curta por dimensão dizendo o que veio de qual fonte (use o apelido em fonte, ou combinar). Nunca repita hex nem arquivo de logo: diga a função da cor.");
  return linhas.join("\n");
}

export const SISTEMA_DA_REDACAO = `Você é o diretor de arte da Aceleriq. Redige templates de design reaproveitáveis (molde de post, carrossel, story ou anúncio) em regras curtas e concretas: posição, escala, peso, margem, cor com função. Português do Brasil, frases curtas, sem travessão. Não invente preferência que as fontes não mostram. Não copie texto, pessoa, produto nem marca de terceiro. Nunca escureça foto como regra. Responda só com o JSON pedido.`;

const ESQUEMA_DO_CORPO = {
  type: "object",
  additionalProperties: false,
  required: ["nome", "resumo", "regras", "areas", "continuidade", "de_onde"],
  properties: {
    nome: { type: "string" },
    resumo: { type: "string" },
    regras: {
      type: "object",
      additionalProperties: false,
      required: [...DIMENSOES_DO_TEMPLATE],
      properties: Object.fromEntries(DIMENSOES_DO_TEMPLATE.map((d) => [d, { type: "array", items: { type: "string" } }])),
    },
    areas: {
      type: "object",
      additionalProperties: false,
      required: [...AREAS_DO_TEMPLATE],
      properties: Object.fromEntries(AREAS_DO_TEMPLATE.map((a) => [a, { type: "string" }])),
    },
    continuidade: {
      type: ["object", "null"],
      additionalProperties: false,
      required: ["total", "laminas", "tipos", "descricao", "ritmo"],
      properties: {
        total: { type: "integer" },
        laminas: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["ordem", "papel", "funcao", "hierarquia", "corte_direita", "corte_y0", "corte_y1"],
            properties: {
              ordem: { type: "integer" },
              papel: { type: "string", enum: ["capa", "miolo", "fechamento"] },
              funcao: { type: "string" },
              hierarquia: { type: "string" },
              corte_direita: { type: "string" },
              corte_y0: { type: "number" },
              corte_y1: { type: "number" },
            },
          },
        },
        tipos: { type: "array", items: { type: "string" } },
        descricao: { type: "string" },
        ritmo: { type: "string" },
      },
    },
    de_onde: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["dimensao", "fonte", "frase"],
        properties: { dimensao: { type: "string" }, fonte: { type: "string" }, frase: { type: "string" } },
      },
    },
  },
};

/** Proposta de template (conversa e combinação): um corpo com nome, e na combinação o "de onde". */
export const ESQUEMA_DA_PROPOSTA_DE_TEMPLATE = { ...ESQUEMA_DO_CORPO, type: ["object", "null"] };

export const ESQUEMA_DA_COMBINACAO = {
  nome: "template_combinado",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["variacoes"],
    properties: { variacoes: { type: "array", items: ESQUEMA_DO_CORPO } },
  },
};

export type PropostaDeTemplate = { nome: string; corpo: CorpoDoTemplate; de_onde: DeOnde[] };

/** Proposta crua (do modelo) vira proposta normalizada; "de onde" só com fontes conhecidas. Vazia: null. */
export function normalizarProposta(bruta: unknown, formato: FormatoDoTemplate, fontes: FonteDaCombinacao[] = [], ancoras: AncoraDoTemplate[] = []): PropostaDeTemplate | null {
  if (!bruta || typeof bruta !== "object") return null;
  const o = bruta as Record<string, unknown>;
  const corpo = normalizarCorpo({ ...o, formato, ancoras }, formato);
  if (!corpoTemConteudo(corpo)) return null;
  const nomes = new Map(fontes.map((f) => [f.apelido.toLowerCase(), f.nome]));
  const deOnde = normalizarDeOnde(o.de_onde)
    .filter((x) => !fontes.length || x.fonte === OPCAO_COMBINAR || nomes.has(x.fonte))
    .map((x) => ({ ...x, nome: x.fonte === OPCAO_COMBINAR ? "combinação" : nomes.get(x.fonte) || x.nome }));
  return { nome: umaLinha(o.nome, 80) || "Template novo", corpo, de_onde: deOnde };
}

/** Âncoras que o template combinado herda: as das fontes-template, as de capa e fechamento primeiro, até o teto. */
export function ancorasDasFontes(fontes: FonteDaCombinacao[]): AncoraDoTemplate[] {
  const saida: AncoraDoTemplate[] = [];
  for (const f of fontes) for (const a of f.corpo ? f.corpo.ancoras : []) if (!saida.some((x) => x.id === a.id)) saida.push(a);
  const peso = (a: AncoraDoTemplate) => (a.papel === "capa" ? 0 : a.papel === "fechamento" ? 1 : a.papel === "miolo" ? 2 : 3);
  return saida.sort((a, b) => peso(a) - peso(b)).slice(0, MAX_ANCORAS);
}

// ------------------------------------------------------------------ banco

// deno-lint-ignore no-explicit-any
export type BancoDoTemplate = { from: (tabela: string) => any; storage: { from: (bucket: string) => any } };

export const TABELA_DOS_TEMPLATES = "cliente_templates_design";
export const BUCKET_DOS_TEMPLATES = "mesa";
const CAMPOS = "id, tipo, escopo, client_id, marca_id, nome, formato, status, origem, versao_atual, versoes, gostos, testes, fontes, atualizado_em";

export const caminhoDoArquivoDosTemplates = (escopo: EscopoDoTemplate, clientId: string | null) =>
  escopo === "agencia" ? "_agencia/estilo/templates.json" : `${clientId}/estilo/templates.json`;

export function semTabelaDosTemplates(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  const m = String(error.message || "");
  return error.code === "42P01" || error.code === "PGRST205" || /cliente_templates_design.*(does not exist|schema cache)|relation .*cliente_templates_design/i.test(m);
}

async function lerArquivo(db: BancoDoTemplate, escopo: EscopoDoTemplate, clientId: string | null): Promise<TemplateDeDesign[]> {
  try {
    const { data, error } = await db.storage.from(BUCKET_DOS_TEMPLATES).download(caminhoDoArquivoDosTemplates(escopo, clientId));
    if (error || !data) return [];
    const bruto = JSON.parse(await (data as Blob).text()) as { templates?: unknown[] };
    return lista(bruto && bruto.templates, (x) => normalizarTemplate(x, "arquivo")).filter((t) => t.escopo === escopo && (escopo === "agencia" || t.client_id === clientId));
  } catch {
    return [];
  }
}

async function gravarArquivo(db: BancoDoTemplate, escopo: EscopoDoTemplate, clientId: string | null, templates: TemplateDeDesign[]) {
  const corpo = JSON.stringify({ templates: templates.slice(-MAX_TEMPLATES).map((t) => linhaDoTemplate(t, t.atualizado_em || "", null)) });
  const { error } = await db.storage.from(BUCKET_DOS_TEMPLATES).upload(caminhoDoArquivoDosTemplates(escopo, clientId), new Blob([corpo], { type: "application/json" }), {
    upsert: true,
    contentType: "application/json",
  });
  if (error) throw new Error("Não foi possível guardar o template agora.");
}

function linhaDoTemplate(t: TemplateDeDesign, agora: string, por: string | null) {
  return {
    id: t.id,
    tipo: t.tipo,
    escopo: t.escopo,
    client_id: t.client_id,
    marca_id: t.marca_id,
    nome: t.nome,
    formato: t.formato,
    status: t.status,
    origem: t.origem,
    versao_atual: t.versao_atual,
    versoes: t.versoes,
    gostos: t.gostos,
    testes: t.testes,
    fontes: t.fontes,
    atualizado_em: agora,
    ...(por ? { atualizado_por: por } : {}),
  };
}

/**
 * Os templates que a equipe vê para o cliente: os dele (da marca pedida e os
 * sem marca) e os da agência. Arquivados só com `incluirArquivados`.
 */
export async function lerTemplates(
  db: BancoDoTemplate,
  clientId: string,
  marcaId: string | null,
  opcoes: { incluirArquivados?: boolean } = {},
): Promise<{ templates: TemplateDeDesign[]; guardado_em: GuardadoEm }> {
  const doCliente = await db.from(TABELA_DOS_TEMPLATES).select(CAMPOS).eq("escopo", "cliente").eq("client_id", clientId).order("atualizado_em", { ascending: false }).limit(MAX_TEMPLATES);
  let guardado: GuardadoEm = "tabela";
  let todos: TemplateDeDesign[];
  if (doCliente.error) {
    if (!semTabelaDosTemplates(doCliente.error)) throw new Error("Não foi possível ler os templates agora.");
    guardado = "arquivo";
    todos = (await lerArquivo(db, "cliente", clientId)).concat(await lerArquivo(db, "agencia", null));
  } else {
    const daAgencia = await db.from(TABELA_DOS_TEMPLATES).select(CAMPOS).eq("escopo", "agencia").order("atualizado_em", { ascending: false }).limit(MAX_TEMPLATES);
    todos = lista(doCliente.data, (x) => normalizarTemplate(x, "tabela")).concat(daAgencia.error ? [] : lista(daAgencia.data, (x) => normalizarTemplate(x, "tabela")));
  }
  // Frente MC (29/09): regra única de herança. marcaId só vem para a marca que não é a principal (chaveDaMarca):
  // ela vê os dela e os da agência, nunca os do cliente (os da Acerbi); sem marcaId, os do cliente e os da agência.
  const daMarca = (t: TemplateDeDesign) => t.escopo === "agencia" || (marcaId ? t.marca_id === marcaId : t.marca_id === null);
  return { templates: todos.filter((t) => daMarca(t) && (opcoes.incluirArquivados || t.status === "ativo")), guardado_em: guardado };
}

/** Um template pelo id, só se for do cliente ou da agência. Sem tabela: procura nos arquivos. */
export async function lerTemplate(db: BancoDoTemplate, clientId: string, id: string): Promise<TemplateDeDesign | null> {
  if (!ehUuid(id)) return null;
  const { data, error } = await db.from(TABELA_DOS_TEMPLATES).select(CAMPOS).eq("id", id).maybeSingle();
  let t: TemplateDeDesign | null;
  if (error) {
    if (!semTabelaDosTemplates(error)) throw new Error("Não foi possível ler o template agora.");
    const todos = (await lerArquivo(db, "cliente", clientId)).concat(await lerArquivo(db, "agencia", null));
    t = todos.find((x) => x.id === id) || null;
  } else {
    t = normalizarTemplate(data, "tabela");
  }
  if (!t) return null;
  return t.escopo === "agencia" || t.client_id === clientId ? t : null;
}

/**
 * Cria (id novo, `criar`) ou muda um template com trava otimista (atualizado_em).
 * Sem tabela: regrava o JSON do dono (cliente ou agência). Devolve o gravado.
 */
export async function mudarTemplate(
  db: BancoDoTemplate,
  clientId: string,
  id: string,
  mudar: (t: TemplateDeDesign | null) => TemplateDeDesign,
  por: string | null,
): Promise<TemplateDeDesign> {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const antes = await lerTemplate(db, clientId, id);
    const depois = mudar(antes);
    if (depois.id !== id) throw new Error("Template trocado no meio da mudança.");
    if (depois.escopo === "cliente" && depois.client_id !== clientId) throw new Error("Template de outro cliente.");
    const agora = new Date(Date.now() + tentativa).toISOString();
    const semTabela = await tabelaAusente(db);
    if (semTabela) {
      const donos = await lerArquivo(db, depois.escopo, depois.escopo === "agencia" ? null : clientId);
      const outros = donos.filter((x) => x.id !== id);
      const gravado = { ...depois, atualizado_em: agora, guardado_em: "arquivo" as const };
      await gravarArquivo(db, depois.escopo, depois.escopo === "agencia" ? null : clientId, outros.concat([gravado]));
      return gravado;
    }
    const linha = linhaDoTemplate(depois, agora, por);
    if (!antes) {
      const { data, error } = await db.from(TABELA_DOS_TEMPLATES).insert({ ...linha, criado_por: por }).select(CAMPOS).maybeSingle();
      if (!error && data) return normalizarTemplate(data, "tabela")!;
      if (error && error.code === "23505") continue;
      throw new Error("Não foi possível guardar o template agora.");
    }
    const { data, error } = await db.from(TABELA_DOS_TEMPLATES).update(linha).eq("id", id).eq("atualizado_em", antes.atualizado_em).select(CAMPOS).maybeSingle();
    if (error) throw new Error("Não foi possível guardar o template agora.");
    if (data) return normalizarTemplate(data, "tabela")!;
  }
  throw new Error("O template mudou várias vezes ao mesmo tempo. Tente de novo.");
}

async function tabelaAusente(db: BancoDoTemplate): Promise<boolean> {
  const { error } = await db.from(TABELA_DOS_TEMPLATES).select("id").limit(1);
  return semTabelaDosTemplates(error);
}
