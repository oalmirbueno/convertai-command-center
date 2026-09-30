/**
 * Preencher com IA (frente PIA, 30/09/2026): a parte pura da peça comum.
 *
 * Quem usa:
 * - a função `preencher-ia` (ações estimar e preencher);
 * - as funções das mesas que quiserem preencher campos por dentro, com as
 *   mesmas regras (importe daqui: esquema, pedido e limpeza).
 *
 * Arquivo sem import (roda no Deno e no vitest). Três peças:
 * 1. `esquemaDosCampos`: esquema JSON estrito montado dos campos (tipo,
 *    opções, máximos na descrição e conferidos por código na limpeza). As
 *    chaves do esquema são c0, c1... (a chave da tela pode ter ponto).
 * 2. `montarPedido`: sistema e mensagem, com as fontes lidas e a regra dura.
 * 3. `limparResposta`: a regra "nada inventado" conferida por código.
 *    - número, preço, data e hora: cada número do valor precisa aparecer no
 *      texto das fontes; senão o campo volta vazio, com aviso;
 *    - nome próprio: palavra com inicial maiúscula no meio da frase precisa
 *      aparecer nas fontes (menos no papel naming, que cria nomes);
 *    - escolha fora das opções, lista além do máximo e texto além do limite
 *      são cortados ou esvaziados, sempre com aviso;
 *    - campo que a IA deixou sem base volta vazio, com aviso.
 *
 * Por padrão só os campos vazios vão ao modelo (`camposAPreencher`); com
 * `substituir`, todos.
 *
 * UXM (30/09/2026, mudança de contrato da frente PIA, tudo opcional): a fonte
 * "base" (UI UX Pro Max 2.15.0) traz regras de DESIGN com apelidos b1..bN; o
 * esquema ganha a raiz `regras_usadas` (enum dos apelidos mostrados) e a
 * limpeza descarta apelido inventado e põe em `fontes` o rótulo humano da
 * regra. A base nunca é fonte de fato do cliente: fica fora da conferência de
 * número e nome.
 */

export type TipoDoCampo = "texto" | "texto_longo" | "lista" | "numero" | "escolha" | "objeto";

export interface CampoParaPreencher {
  /** Caminho do campo, ex. "capa.headline". */
  chave: string;
  /** Como a tela chama o campo. */
  rotulo: string;
  tipo: TipoDoCampo;
  /** Para "escolha". */
  opcoes?: string[];
  /** O que já está preenchido. */
  valorAtual?: unknown;
  /** Regra do campo (ex.: "até 8 palavras", "nunca inventar número"). */
  dica?: string;
  /** Caracteres (texto) ou itens (lista). */
  maximo?: number;
}

export type FonteDoPreenchimento = "contexto" | "briefing" | "dossie" | "arquivos" | "conversa" | "web" | "base";

export interface ResultadoDoPreenchimento {
  valores: Record<string, unknown>;
  modelo_id: string;
  custo_usd: number;
  fontes: string[];
  avisos: string[];
  /** UXM: as regras da base que o modelo disse que usou (id de citação e rótulo). */
  regras_usadas?: Array<{ id: string; rotulo: string }>;
}

/** Regra da base mostrada ao modelo (o apelido b1..bN e o rótulo humano da citação). */
export type RegraDaBaseNoPedido = { apelido: string; id: string; rotulo: string };

/** Uma fonte lida pelo servidor: o rótulo vai para a tela, o texto vai para o modelo e para a conferência. */
export type FonteLida = { id: FonteDoPreenchimento; rotulo: string; texto: string };

export const TIPOS_DE_CAMPO: TipoDoCampo[] = ["texto", "texto_longo", "lista", "numero", "escolha", "objeto"];
export const FONTES_DO_PREENCHIMENTO: FonteDoPreenchimento[] = ["contexto", "briefing", "dossie", "arquivos", "conversa", "web", "base"];
export const FONTES_PADRAO: FonteDoPreenchimento[] = ["contexto", "briefing", "dossie"];
/** Papéis em que a base de design (UI UX Pro Max) vale e entra por padrão. */
export const PAPEIS_COM_BASE = ["site", "identidade"];
export const fontesPadraoDoPapel = (papel: string): FonteDoPreenchimento[] => (PAPEIS_COM_BASE.indexOf(papel) >= 0 ? FONTES_PADRAO.concat(["base"]) : FONTES_PADRAO.slice());
/** Os 9 papéis das mesas novas (os mesmos de ia-motor.ts e src/lib/mesa/api.ts). Outro papel é recusado. */
export const PAPEIS_QUE_PREENCHEM = ["proposta", "contrato", "briefing", "conselho", "identidade", "naming", "site", "motion", "documento"] as const;
export type PapelQuePreenche = (typeof PAPEIS_QUE_PREENCHEM)[number];

/** 80: o "Preencher tudo" dos Dados do contrato com 3 serviços manda 43 campos (QA 30/09). */
export const MAX_CAMPOS = 80;
const MAX_CHAVE = 120;
const MAX_ROTULO = 120;
const MAX_DICA = 400;
const MAX_OPCOES = 40;
const MAX_TEXTO_DO_VALOR_ATUAL = 1200;
export const MAX_INSTRUCAO = 1500;
export const MAX_CONTEXTO_DA_TELA = 3000;

/** Tamanho de cada fonte no pedido (caracteres). */
export const TAMANHO_DA_FONTE: Record<FonteDoPreenchimento, number> = {
  contexto: 4000,
  briefing: 5000,
  dossie: 5000,
  arquivos: 5000,
  conversa: 3000,
  web: 0,
  base: 1500,
};

export function ehPapelQuePreenche(p: unknown): p is PapelQuePreenche {
  return typeof p === "string" && (PAPEIS_QUE_PREENCHEM as readonly string[]).indexOf(p) >= 0;
}

// ------------------------------------------------------------------ campos

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Campos que a tela mandou, validados. Lança Error com mensagem para gente quando não servem. */
export function normalizarCampos(bruto: unknown): CampoParaPreencher[] {
  if (!Array.isArray(bruto) || bruto.length === 0) throw new Error("Mande ao menos um campo para preencher.");
  if (bruto.length > MAX_CAMPOS) throw new Error(`No máximo ${MAX_CAMPOS} campos por vez.`);
  const vistos: Record<string, true> = {};
  const saida: CampoParaPreencher[] = [];
  for (const b of bruto) {
    if (!b || typeof b !== "object") throw new Error("Campo sem formato.");
    const o = b as Record<string, unknown>;
    const chave = texto(o.chave, MAX_CHAVE);
    const tipo = String(o.tipo || "") as TipoDoCampo;
    if (!chave) throw new Error("Todo campo precisa de chave.");
    if (vistos[chave]) throw new Error(`Campo repetido: ${chave}.`);
    if (TIPOS_DE_CAMPO.indexOf(tipo) < 0) throw new Error(`Tipo de campo desconhecido em ${chave}.`);
    vistos[chave] = true;
    const campo: CampoParaPreencher = { chave, rotulo: texto(o.rotulo, MAX_ROTULO) || chave, tipo };
    if (tipo === "escolha") {
      const opcoes = Array.isArray(o.opcoes) ? o.opcoes.map((x) => texto(x, 120)).filter(Boolean).slice(0, MAX_OPCOES) : [];
      if (!opcoes.length) throw new Error(`O campo ${campo.rotulo} é de escolha e veio sem opções.`);
      campo.opcoes = opcoes;
    }
    if (o.valorAtual !== undefined) campo.valorAtual = o.valorAtual;
    const dica = texto(o.dica, MAX_DICA);
    if (dica) campo.dica = dica;
    const maximo = Number(o.maximo);
    if (Number.isFinite(maximo) && maximo > 0) campo.maximo = Math.floor(maximo);
    saida.push(campo);
  }
  return saida;
}

/** Vazio: nada, texto em branco, lista vazia, objeto sem nenhum valor preenchido. */
export function campoVazio(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return !Number.isFinite(v);
  if (Array.isArray(v)) return v.every(campoVazio);
  if (typeof v === "object") return Object.keys(v as object).every((k) => campoVazio((v as Record<string, unknown>)[k]));
  return false;
}

/** Só vazios por padrão; com substituir, todos. */
export function camposAPreencher(campos: CampoParaPreencher[], substituir = false): CampoParaPreencher[] {
  return substituir ? campos.slice() : campos.filter((c) => campoVazio(c.valorAtual));
}

export function normalizarFontes(bruto: unknown): FonteDoPreenchimento[] {
  if (!Array.isArray(bruto)) return FONTES_PADRAO.slice();
  const saida: FonteDoPreenchimento[] = [];
  for (const f of bruto) if (FONTES_DO_PREENCHIMENTO.indexOf(f as FonteDoPreenchimento) >= 0 && saida.indexOf(f as FonteDoPreenchimento) < 0) saida.push(f as FonteDoPreenchimento);
  return saida;
}

// ------------------------------------------------------------------ esquema

const NOME_DE_PROPRIEDADE = /^[A-Za-z0-9_-]{1,64}$/;

function objetoSimples(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Forma de um campo "objeto": as chaves (lista = chave com lista de textos) e se o campo é uma lista de objetos. */
export type FormaDoObjeto = { chaves: Array<{ nome: string; lista: boolean; numero: boolean }>; ehLista: boolean };

/** Chaves escritas na dica no formato "{ nome, idade, dores[] }" (convenção das mesas). */
function chavesDaDica(dica: string | undefined): Array<{ nome: string; lista: boolean; numero: boolean }> {
  const m = /\{([^{}]*)\}/.exec(dica || "");
  if (!m) return [];
  const saida: Array<{ nome: string; lista: boolean; numero: boolean }> = [];
  for (const parte of m[1].split(",")) {
    const bruto = parte.trim();
    const lista = /\[\]$/.test(bruto);
    const nome = bruto.replace(/\[\]$/, "").trim();
    if (NOME_DE_PROPRIEDADE.test(nome) && !saida.some((c) => c.nome === nome)) saida.push({ nome, lista, numero: false });
  }
  return saida.slice(0, 20);
}

function chavesDoValor(v: Record<string, unknown>) {
  return Object.keys(v).filter((k) => NOME_DE_PROPRIEDADE.test(k)).slice(0, 20).map((k) => ({ nome: k, lista: Array.isArray(v[k]), numero: typeof v[k] === "number" }));
}

/**
 * Forma do campo "objeto": pelo valor atual (objeto, ou lista cujo primeiro
 * item é objeto) e, sem valor, pelas chaves da dica ("Lista de { situacao,
 * certo, errado }"). Sem forma conhecida, null (vai como texto JSON).
 * QA 30/09: "Exemplos por situação" da estratégia é uma lista de objetos e
 * voltava sempre vazio ("a resposta não veio no formato do campo").
 */
export function formaDoObjeto(c: CampoParaPreencher): FormaDoObjeto | null {
  const v = c.valorAtual;
  const ehLista = Array.isArray(v) || /^\s*lista\b/i.test(c.dica || "");
  let chaves: FormaDoObjeto["chaves"] = [];
  if (objetoSimples(v)) chaves = chavesDoValor(v);
  else if (Array.isArray(v) && objetoSimples(v[0])) chaves = chavesDoValor(v[0] as Record<string, unknown>);
  if (!chaves.length) chaves = chavesDaDica(c.dica);
  return chaves.length ? { chaves, ehLista } : null;
}

/** O que o modelo devolve quando a fonte não dá base, por tipo (sem null: ver propriedadeDoCampo). */
const VAZIO_DO_TIPO: Record<TipoDoCampo, string> = {
  texto: "texto vazio",
  texto_longo: "texto vazio",
  lista: "lista vazia",
  numero: "texto vazio",
  escolha: "texto vazio",
  objeto: "texto vazio",
};

function descricaoDoCampo(c: CampoParaPreencher): string {
  const partes = [c.rotulo];
  if (c.maximo) partes.push(c.tipo === "lista" ? `até ${c.maximo} itens` : c.tipo === "numero" ? "" : `até ${c.maximo} caracteres`);
  if (c.tipo === "numero") partes.push("só o número, em algarismos");
  if (c.dica) partes.push(c.dica);
  partes.push(`${VAZIO_DO_TIPO[c.tipo]} quando as fontes não dão base`);
  return partes.filter(Boolean).join(". ");
}

/**
 * Propriedade do campo SEM tipo união (nada de ["string","null"] nem anyOf).
 * A Anthropic (direta e pelo OpenRouter) recusa esquema com mais de 16
 * parâmetros com união ("Schemas contains too many parameters with union
 * types (19 ...) limit: 16"), visto em 30/09 no Preencher tudo do site com o
 * Opus 5.5 (18 campos). Antes disso, enum com tipo em lista também era
 * recusado. Por isso "sem base" é vazio: texto "", lista [], escolha "" (a
 * opção vazia entra no enum). Número vai como texto (algarismos) para poder
 * voltar vazio sem inventar 0; a limpeza converte e confere.
 */
function propriedadeDoCampo(c: CampoParaPreencher): Record<string, unknown> {
  const description = descricaoDoCampo(c);
  switch (c.tipo) {
    case "lista":
      return { type: "array", items: { type: "string" }, description };
    case "escolha":
      return { type: "string", enum: (c.opcoes || []).concat([""]), description };
    case "objeto": {
      const forma = formaDoObjeto(c);
      if (!forma) return { type: "string", description: `${description}. Objeto em texto JSON` };
      const properties: Record<string, unknown> = {};
      for (const k of forma.chaves) properties[k.nome] = k.lista ? { type: "array", items: { type: "string" } } : { type: "string" };
      const objeto = { type: "object", additionalProperties: false, required: forma.chaves.map((k) => k.nome), properties };
      if (forma.ehLista) return { type: "array", items: objeto, description: `${description}. Lista vazia quando as fontes não dão base` };
      return { ...objeto, description: `${description}. Chave sem base fica vazia` };
    }
    default:
      // texto, texto_longo e numero.
      return { type: "string", description };
  }
}

export type MapaDoEsquema = Record<string, CampoParaPreencher>;

/**
 * Esquema JSON estrito (OpenAI strict, Anthropic e OpenRouter): todas as
 * chaves obrigatórias, additionalProperties false, vazio para "sem base" e
 * nenhum tipo união (limite de 16 da Anthropic, ver propriedadeDoCampo).
 */
export function esquemaDosCampos(campos: CampoParaPreencher[], opcoes: { apelidos?: string[] } = {}): { nome: string; schema: Record<string, unknown>; mapa: MapaDoEsquema } {
  const mapa: MapaDoEsquema = {};
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  campos.forEach((c, i) => {
    const k = `c${i}`;
    mapa[k] = c;
    properties[k] = propriedadeDoCampo(c);
    required.push(k);
  });
  const apelidos = (opcoes.apelidos || []).filter((a) => /^b\d{1,2}$/.test(a));
  const raiz: Record<string, unknown> = apelidos.length
    ? { regras_usadas: { type: "array", items: { type: "string", enum: apelidos }, description: "Apelidos (b1, b2...) das regras da base de design que você seguiu. Vazio quando nenhuma." } }
    : {};
  return {
    nome: "preenchimento",
    mapa,
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["valores", "fontes_usadas", "citacoes", "avisos"].concat(apelidos.length ? ["regras_usadas"] : []),
      properties: {
        ...raiz,
        valores: { type: "object", additionalProperties: false, required, properties },
        fontes_usadas: { type: "array", items: { type: "string" }, description: "Rótulos das fontes que deram base (como vieram no pedido)" },
        citacoes: {
          type: "array",
          description: "Trecho literal que sustenta cada número, data ou nome; na web, com a url",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["campo", "trecho", "url"],
            properties: { campo: { type: "string" }, trecho: { type: "string" }, url: { type: "string", description: "url da web ou texto vazio" } },
          },
        },
        avisos: { type: "array", items: { type: "string" }, description: "O que ficou vazio e por quê" },
      },
    },
  };
}

// ------------------------------------------------------------------ pedido

function valorParaTexto(v: unknown, max = MAX_TEXTO_DO_VALOR_ATUAL): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.slice(0, max);
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v).slice(0, max);
  } catch {
    return "";
  }
}

const NOMES_DOS_TIPOS: Record<TipoDoCampo, string> = {
  texto: "texto curto",
  texto_longo: "texto longo",
  lista: "lista de itens",
  numero: "número",
  escolha: "uma das opções",
  objeto: "objeto",
};

export type PedidoDoPreenchimento = {
  papel: string;
  campos: CampoParaPreencher[];
  fontes: FonteLida[];
  contexto?: string | null;
  instrucao?: string | null;
  web?: boolean;
  substituir?: boolean;
  /** UXM: as regras da base mostradas (fonte "base"); vazio ou ausente, o esquema fica como antes. */
  regrasDaBase?: RegraDaBaseNoPedido[];
};

export function montarPedido(p: PedidoDoPreenchimento): { sistema: string; mensagem: string; esquema: ReturnType<typeof esquemaDosCampos> } {
  const regrasDaBase = p.regrasDaBase || [];
  const esquema = esquemaDosCampos(p.campos, { apelidos: regrasDaBase.map((r) => r.apelido) });
  const sistema = [
    `Você preenche campos de uma mesa de trabalho da agência Aceleriq (papel: ${p.papel}). Escreva em português do Brasil, direto, sem travessão.`,
    "Regra dura: use só o que está nas fontes do pedido, na instrução e no que a tela sabe" + (p.web ? " e o que achar na pesquisa na web, sempre com a url" : "") + ".",
    "Nunca invente número, preço, data, prazo, porcentagem, nome de pessoa, empresa, produto ou lugar. Se a fonte não traz, o campo fica vazio (texto vazio ou lista vazia) e vai um aviso curto dizendo o que faltou, citando o campo pelo nome (nunca c0, c1...).",
    "Para cada número, data ou nome que usar, ponha em citacoes o trecho literal da fonte (com a url quando vier da web).",
    "Respeite o tipo, as opções e o limite de cada campo. Em fontes_usadas, repita os rótulos das fontes como vieram (### rótulo).",
    p.substituir ? "Campos com valor atual podem ser reescritos; mantenha o que já estava certo." : "Os campos pedidos estão vazios.",
    regrasDaBase.length ? "A fonte da base de design (UI UX Pro Max) traz regras de forma e estrutura com apelidos (b1, b2...): use só como regra de design, nunca como fato do cliente, e ponha em regras_usadas o apelido das que seguiu." : "",
  ].filter(Boolean).join("\n");

  const blocos: string[] = [];
  if (p.instrucao && p.instrucao.trim()) blocos.push(`## Instrução da pessoa\n${p.instrucao.trim().slice(0, MAX_INSTRUCAO)}`);
  if (p.contexto && p.contexto.trim()) blocos.push(`## O que a tela sabe\n${p.contexto.trim().slice(0, MAX_CONTEXTO_DA_TELA)}`);
  const lidas = p.fontes.filter((f) => f.texto.trim());
  if (lidas.length) {
    blocos.push(`## Fontes\n${lidas.map((f) => `### ${f.rotulo}\n${f.texto.trim().slice(0, TAMANHO_DA_FONTE[f.id] || 4000)}`).join("\n\n")}`);
  } else {
    blocos.push("## Fontes\n(nenhuma fonte do painel trouxe texto)");
  }
  if (p.web) blocos.push("## Web\nVocê pode pesquisar na web. Dado da web só entra com a url em citacoes.");
  const linhas = Object.keys(esquema.mapa).map((k) => {
    const c = esquema.mapa[k];
    const partes = [`- ${k}: ${c.rotulo} (${NOMES_DOS_TIPOS[c.tipo]}`];
    if (c.maximo) partes.push(c.tipo === "lista" ? `, até ${c.maximo} itens` : c.tipo === "numero" ? "" : `, até ${c.maximo} caracteres`);
    partes.push(")");
    if (c.opcoes && c.opcoes.length) partes.push(`. Opções: ${c.opcoes.join(" | ")}`);
    if (c.dica) partes.push(`. Regra: ${c.dica}`);
    const atual = valorParaTexto(c.valorAtual);
    if (atual) partes.push(`. Valor atual: ${atual}`);
    return partes.join("");
  });
  blocos.push(`## Campos a preencher\n${linhas.join("\n")}`);
  return { sistema, mensagem: blocos.join("\n\n"), esquema };
}

// ------------------------------------------------------------------ estimativa

const SAIDA_POR_TIPO: Record<TipoDoCampo, number> = { texto: 80, texto_longo: 450, lista: 220, numero: 15, escolha: 15, objeto: 260 };
/** Entrada típica de cada fonte (tokens), para a estimativa antes de ler. */
export const ENTRADA_POR_FONTE: Record<FonteDoPreenchimento, number> = {
  contexto: 1200,
  briefing: 1500,
  dossie: 1500,
  arquivos: 1500,
  conversa: 900,
  web: 10_000,
  base: 450,
};

export type PartesDaEstimativa = {
  pedido: number;
  fontes: Array<{ fonte: FonteDoPreenchimento; tokens: number }>;
  saida: number;
  buscasWeb: number;
};

/** Tokens estimados (lado seguro) de um preenchimento, parte a parte. */
export function tokensDaEstimativa(campos: CampoParaPreencher[], fontes: FonteDoPreenchimento[], extras = 0): PartesDaEstimativa {
  const pedido = 450 + campos.length * 70 + Math.ceil(Math.max(0, extras) / 3.5);
  const saida = 250 + campos.reduce((s, c) => {
    const base = SAIDA_POR_TIPO[c.tipo] || 100;
    if (c.maximo && (c.tipo === "texto" || c.tipo === "texto_longo")) return s + Math.max(40, Math.min(base * 3, Math.ceil(c.maximo / 3)));
    if (c.maximo && c.tipo === "lista") return s + Math.max(60, c.maximo * 40);
    return s + base;
  }, 0);
  return {
    pedido,
    fontes: fontes.map((f) => ({ fonte: f, tokens: ENTRADA_POR_FONTE[f] })),
    saida,
    buscasWeb: fontes.indexOf("web") >= 0 ? 3 : 0,
  };
}

/** Teto de tokens de saída do pedido (margem sobre a estimativa). */
export function tetoDeSaida(campos: CampoParaPreencher[]): number {
  return Math.min(8000, Math.max(1200, Math.ceil(tokensDaEstimativa(campos, []).saida * 1.6)));
}

// ------------------------------------------------------------------ conferência

/** Minúsculas e sem acento (para comparar nomes). */
export function normalizarParaComparar(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

const NUMERO = /\d+(?:[.,]\d+)*/g;

/** Valor canônico de um número escrito (1.500 = 1500; 1,5 = 1.5; 1,500 = 1500). */
export function valorDoNumero(token: string): string {
  let t = token;
  if (t.indexOf(".") >= 0 && t.indexOf(",") >= 0) {
    t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (t.indexOf(",") >= 0) {
    t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, "") : t.replace(/,/g, ".");
  } else if (t.indexOf(".") >= 0) {
    if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, "");
  }
  const n = Number(t);
  return Number.isFinite(n) ? String(n) : token;
}

export type ReferenciaDasFontes = { numeros: Record<string, true>; digitos: Record<string, true>; texto: string };

/** Índice do texto de referência (fontes, instrução, contexto da tela, campo). */
export function referenciaDas(textos: string[]): ReferenciaDasFontes {
  const numeros: Record<string, true> = {};
  const digitos: Record<string, true> = {};
  const junto = textos.filter(Boolean).join("\n");
  const achados = junto.match(NUMERO) || [];
  for (const a of achados) {
    numeros[valorDoNumero(a)] = true;
    digitos[a.replace(/[.,]/g, "")] = true;
  }
  return { numeros, digitos, texto: " " + normalizarParaComparar(junto).replace(/\s+/g, " ") + " " };
}

/** Números do valor que não estão nas fontes. Inteiros até 10 soltos (sem %, sem moeda) ficam livres. */
export function numerosSemFonte(valor: string, ref: ReferenciaDasFontes): string[] {
  const faltam: string[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(NUMERO.source, "g");
  while ((m = re.exec(valor))) {
    const token = m[0];
    const depois = valor.slice(m.index + token.length).replace(/^\s+/, "").charAt(0);
    const antes = valor.slice(Math.max(0, m.index - 4), m.index);
    const pequeno = /^\d+$/.test(token) && Number(token) <= 10 && depois !== "%" && antes.indexOf("$") < 0;
    if (pequeno) continue;
    if (ref.numeros[valorDoNumero(token)] || ref.digitos[token.replace(/[.,]/g, "")]) continue;
    if (faltam.indexOf(token) < 0) faltam.push(token);
  }
  return faltam;
}

/** Palavras que aparecem com maiúscula sem ser nome inventado (plataformas, meses, siglas comuns). */
const LIVRES = [
  "instagram", "facebook", "whatsapp", "google", "tiktok", "youtube", "linkedin", "meta", "reels", "stories", "story",
  "pix", "ia", "seo", "cta", "brasil", "internet", "site", "email", "e-mail", "aceleriq", "kpi", "roi", "b2b", "b2c",
];

const PALAVRA = /[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ'’-]*/g;

/**
 * Nomes próprios do valor que não aparecem nas fontes: palavra com inicial
 * maiúscula que não abre frase. Texto em "Título Com Tudo Maiúsculo" (mais
 * da metade das palavras) não é conferido: não dá para separar nome de estilo.
 */
export function nomesSemFonte(valor: string, ref: ReferenciaDasFontes): string[] {
  const palavras: Array<{ p: string; i: number }> = [];
  const re = new RegExp(PALAVRA.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(valor))) palavras.push({ p: m[0], i: m.index });
  if (!palavras.length) return [];
  const maiusculas = palavras.filter((w) => w.p.charAt(0) !== w.p.charAt(0).toLowerCase());
  if (palavras.length >= 3 && maiusculas.length * 2 > palavras.length) return [];
  const faltam: string[] = [];
  for (const w of maiusculas) {
    if (w.p.length < 3) continue;
    const antes = valor.slice(0, w.i).replace(/\s+$/, "");
    const ultimo = antes.charAt(antes.length - 1);
    if (!antes || ".!?:;\n•-–—\"'(“[".indexOf(ultimo) >= 0) continue;
    const n = normalizarParaComparar(w.p).replace(/['’]s$/, "");
    if (LIVRES.indexOf(n) >= 0) continue;
    if (ref.texto.indexOf(n) >= 0) continue;
    if (faltam.indexOf(w.p) < 0) faltam.push(w.p);
  }
  return faltam;
}

/** Sem travessão (regra de escrita do painel). */
export function semTravessao(s: string): string {
  return s.replace(/\s*—\s*/g, ", ").replace(/\s+–\s+/g, ", ");
}

function cortarNoLimite(s: string, max: number): string {
  if (s.length <= max) return s;
  const corte = s.slice(0, max);
  const espaco = corte.lastIndexOf(" ");
  return (espaco > max * 0.6 ? corte.slice(0, espaco) : corte).replace(/[\s,;:.-]+$/, "");
}

export type ContextoDaLimpeza = {
  papel: string;
  /** Mapa c0 -> campo, de esquemaDosCampos. */
  mapa: MapaDoEsquema;
  /** Fontes lidas pelo servidor (o texto é a referência da conferência). */
  fontes: FonteLida[];
  instrucao?: string | null;
  contexto?: string | null;
  web?: boolean;
  substituir?: boolean;
  /** UXM: as regras da base mostradas ao modelo (apelido e rótulo da citação). */
  regrasDaBase?: RegraDaBaseNoPedido[];
};

type Conferencia = { valor: unknown; aviso: string | null };

function conferirTexto(s: string, ref: ReferenciaDasFontes, nomesEstritos: boolean): { valor: string | null; motivo: string | null } {
  const limpo = semTravessao(s.trim());
  if (!limpo) return { valor: null, motivo: null };
  const numeros = numerosSemFonte(limpo, ref);
  if (numeros.length) return { valor: null, motivo: `o número ${numeros.slice(0, 3).join(", ")} não aparece nas fontes` };
  if (nomesEstritos) {
    const nomes = nomesSemFonte(limpo, ref);
    if (nomes.length) return { valor: null, motivo: `o nome ${nomes.slice(0, 3).join(", ")} não aparece nas fontes` };
  }
  return { valor: limpo, motivo: null };
}

function conferirCampo(bruto: unknown, c: CampoParaPreencher, ref: ReferenciaDasFontes, nomesEstritos: boolean): Conferencia {
  const vazio = (motivo: string | null): Conferencia => ({ valor: undefined, aviso: motivo ? `${c.rotulo}: ficou vazio, ${motivo}.` : `${c.rotulo}: ficou vazio, as fontes não dão base.` });
  if (campoVazio(bruto)) return vazio(null);
  switch (c.tipo) {
    case "numero": {
      // Texto sem algarismo ("não informado") é sem base: nunca vira 0.
      if (typeof bruto !== "number" && !/\d/.test(String(bruto))) return vazio(null);
      const n = typeof bruto === "number" ? bruto : Number(valorDoNumero(String(bruto).replace(/[^\d.,-]/g, "")));
      if (!Number.isFinite(n)) return vazio("o valor não é um número");
      const s = String(n);
      // Inteiro pequeno (até 10, com sinal) fica livre, como no texto: escala de -2 a 2, nota de 1 a 5.
      const pequeno = Number.isInteger(n) && Math.abs(n) <= 10;
      if (!pequeno && !ref.numeros[valorDoNumero(s)] && !ref.digitos[s.replace(/[.,-]/g, "")]) return vazio(`o número ${s} não aparece nas fontes`);
      return { valor: n, aviso: null };
    }
    case "escolha": {
      const s = normalizarParaComparar(String(bruto).trim());
      const achada = (c.opcoes || []).filter((o) => normalizarParaComparar(o) === s)[0];
      if (!achada) return vazio("a resposta não é uma das opções");
      return { valor: achada, aviso: null };
    }
    case "lista": {
      const itens = Array.isArray(bruto) ? bruto : typeof bruto === "string" ? bruto.split(/\n+/) : [];
      const bons: string[] = [];
      const motivos: string[] = [];
      for (const it of itens) {
        const t = typeof it === "string" ? it.replace(/^\s*[-•*]\s*/, "") : valorParaTexto(it, 600);
        const r = conferirTexto(t, ref, nomesEstritos);
        if (r.valor) bons.push(r.valor);
        else if (r.motivo) motivos.push(r.motivo);
      }
      const avisos: string[] = [];
      if (motivos.length) avisos.push(`${motivos.length} ${motivos.length === 1 ? "item saiu" : "itens saíram"} (${motivos[0]})`);
      let lista = bons;
      if (c.maximo && lista.length > c.maximo) {
        avisos.push(`cortada em ${c.maximo} itens`);
        lista = lista.slice(0, c.maximo);
      }
      if (!lista.length) return vazio(motivos[0] || null);
      return { valor: lista, aviso: avisos.length ? `${c.rotulo}: ${avisos.join("; ")}.` : null };
    }
    case "objeto": {
      let obj: unknown = bruto;
      if (typeof bruto === "string") {
        try {
          obj = JSON.parse(bruto);
        } catch {
          return vazio("a resposta não veio no formato do campo");
        }
      }
      const forma = formaDoObjeto(c);
      // Chave que sai (número ou nome fora das fontes) sai sozinha, com aviso: o resto do objeto fica.
      const avisos: string[] = [];
      const limparObjeto = (o: Record<string, unknown>): Record<string, unknown> | null => {
        const saida: Record<string, unknown> = {};
        for (const k of Object.keys(o)) {
          if (forma && !forma.chaves.some((x) => x.nome === k)) continue;
          let v = o[k];
          // O esquema pede texto (sem união); a chave que era número volta número.
          const ehNumero = forma ? forma.chaves.some((x) => x.nome === k && x.numero) : false;
          if (ehNumero && typeof v === "string" && /\d/.test(v)) {
            const n = Number(valorDoNumero(v.replace(/[^\d.,-]/g, "")));
            if (Number.isFinite(n)) v = n;
          }
          if (campoVazio(v)) continue;
          const textoDoValor = valorParaTexto(v, 4000);
          const numeros = numerosSemFonte(textoDoValor, ref);
          if (numeros.length) {
            avisos.push(`${k} saiu (o número ${numeros.slice(0, 3).join(", ")} não aparece nas fontes)`);
            continue;
          }
          if (nomesEstritos) {
            const nomes = (Array.isArray(v) ? v : [v]).filter((x) => typeof x === "string").reduce((a: string[], x) => a.concat(nomesSemFonte(String(x), ref)), []);
            if (nomes.length) {
              avisos.push(`${k} saiu (o nome ${nomes.slice(0, 3).join(", ")} não aparece nas fontes)`);
              continue;
            }
          }
          saida[k] = typeof v === "string" ? semTravessao(v.trim()) : Array.isArray(v) ? v.map((x) => (typeof x === "string" ? semTravessao(x.trim()) : x)).filter((x) => !campoVazio(x)) : v;
        }
        return Object.keys(saida).length ? saida : null;
      };
      const comAvisos = (valor: unknown): Conferencia => ({ valor, aviso: avisos.length ? `${c.rotulo}: ${avisos.slice(0, 3).join("; ")}.` : null });
      if (Array.isArray(obj)) {
        let itens = obj.filter(objetoSimples).map(limparObjeto).filter((x): x is Record<string, unknown> => !!x);
        if (c.maximo && itens.length > c.maximo) {
          avisos.push(`cortada em ${c.maximo} itens`);
          itens = itens.slice(0, c.maximo);
        }
        if (!itens.length) return vazio(avisos[0] || null);
        return comAvisos(itens);
      }
      if (!objetoSimples(obj)) return vazio("a resposta não veio no formato do campo");
      const limpo = limparObjeto(obj);
      if (!limpo) return vazio(avisos[0] || null);
      return comAvisos(limpo);
    }
    default: {
      const s = typeof bruto === "string" ? bruto : valorParaTexto(bruto, 20_000);
      const r = conferirTexto(s, ref, nomesEstritos);
      if (!r.valor) return vazio(r.motivo);
      if (c.maximo && r.valor.length > c.maximo) return { valor: cortarNoLimite(r.valor, c.maximo), aviso: `${c.rotulo}: cortado em ${c.maximo} caracteres.` };
      return { valor: r.valor, aviso: null };
    }
  }
}

function listaDeTextos(v: unknown, max: number): string[] {
  return Array.isArray(v) ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => semTravessao(String(x).trim()).slice(0, 300)).slice(0, max) : [];
}

/**
 * A resposta do modelo, conferida: só as chaves pedidas, no tipo certo, sem
 * número ou nome fora das fontes. Devolve valores pela chave da tela.
 */
export function limparResposta(json: unknown, ctx: ContextoDaLimpeza): { valores: Record<string, unknown>; fontes: string[]; avisos: string[]; regras_usadas: Array<{ id: string; rotulo: string }> } {
  const raiz = objetoSimples(json) ? json : {};
  const brutos = objetoSimples(raiz.valores) ? raiz.valores : {};
  const citacoes = Array.isArray(raiz.citacoes) ? raiz.citacoes.filter(objetoSimples) : [];
  const daWeb = ctx.web
    ? citacoes.filter((c) => typeof c.url === "string" && /^https?:\/\//i.test(String(c.url)) && typeof c.trecho === "string")
    : [];
  // A base de design é regra de forma, nunca fato do cliente: fica fora da referência de número e nome.
  const deFato = ctx.fontes.filter((f) => f.id !== "base");
  const textos = deFato.map((f) => f.texto).concat([ctx.instrucao || "", ctx.contexto || ""]).concat(daWeb.map((c) => String(c.trecho)));
  const nomesEstritos = ctx.papel !== "naming";
  const valores: Record<string, unknown> = {};
  const avisos: string[] = [];
  const comAviso: Record<string, true> = {};
  for (const k of Object.keys(ctx.mapa)) {
    const c = ctx.mapa[k];
    if (!ctx.substituir && !campoVazio(c.valorAtual)) continue;
    // O próprio campo (rótulo, regra, opções e valor atual) também é referência.
    const ref = referenciaDas(textos.concat([c.rotulo, c.dica || "", (c.opcoes || []).join(" "), valorParaTexto(c.valorAtual, 20_000)]));
    const r = conferirCampo(brutos[k], c, ref, nomesEstritos);
    if (r.valor !== undefined) valores[c.chave] = r.valor;
    if (r.aviso) {
      avisos.push(r.aviso);
      comAviso[k] = true;
    }
  }
  // Avisos do modelo (curtos) depois dos da conferência, sem repetir: a chave
  // interna (c0, c1...) vira o nome do campo, e o aviso sobre um campo que a
  // conferência já avisou sai (visto em 30/09: "c5 ficou vazio" repetindo
  // "Sites que o cliente admira: ficou vazio").
  for (const bruto of listaDeTextos(raiz.avisos, 12)) {
    const citadas = (bruto.match(/\bc\d{1,2}\b/g) || []).filter((k) => !!ctx.mapa[k]);
    if (citadas.some((k) => comAviso[k])) continue;
    const a = bruto.replace(/\bc\d{1,2}\b/g, (k) => (ctx.mapa[k] ? ctx.mapa[k].rotulo : k));
    const rotuloRepetido = Object.keys(comAviso).some((k) => normalizarParaComparar(a).indexOf(normalizarParaComparar(ctx.mapa[k].rotulo)) === 0);
    if (!rotuloRepetido && avisos.indexOf(a) < 0) avisos.push(a);
  }

  // Fontes: só os rótulos que o servidor leu de fato, mais as urls da web citadas.
  const rotulos = deFato.filter((f) => f.texto.trim()).map((f) => f.rotulo);
  const citadas = listaDeTextos(raiz.fontes_usadas, 20).map(normalizarParaComparar);
  let fontes = rotulos.filter((r) => citadas.indexOf(normalizarParaComparar(r)) >= 0);
  if (!fontes.length) fontes = rotulos.slice();
  if (ctx.instrucao && ctx.instrucao.trim()) fontes.push("instrução da pessoa");
  for (const c of daWeb) {
    const url = String(c.url);
    if (fontes.indexOf(url) < 0 && fontes.length < 24) fontes.push(url);
  }
  if (daWeb.length) avisos.push("Dados da web: confira a fonte antes de aplicar.");
  // Regras da base citadas: só apelido que foi mostrado (inventado sai), com o rótulo humano nas fontes.
  const usados = Array.isArray(raiz.regras_usadas) ? (raiz.regras_usadas as unknown[]).map((x) => String(x == null ? "" : x).trim().toLowerCase()) : [];
  const regras_usadas = (ctx.regrasDaBase || []).filter((r) => usados.indexOf(r.apelido) >= 0).slice(0, 8).map((r) => ({ id: r.id, rotulo: r.rotulo }));
  for (const r of regras_usadas) if (fontes.indexOf(r.rotulo) < 0 && fontes.length < 30) fontes.push(r.rotulo);
  return { valores, fontes, avisos: avisos.slice(0, 30), regras_usadas };
}

/** Resultado sem IA (nada para preencher). */
export function resultadoVazio(modeloId: string, aviso: string): ResultadoDoPreenchimento {
  return { valores: {}, modelo_id: modeloId, custo_usd: 0, fontes: [], avisos: [aviso] };
}

/** Palavras dos rótulos, dicas e instrução para a busca simples nos arquivos (sem acento de SQL, só letras). */
const COMUNS = [
  "para", "como", "qual", "quais", "sobre", "entre", "mais", "menos", "cada", "todo", "toda", "todos", "todas", "texto", "campo",
  "nome", "lista", "valor", "itens", "item", "numero", "número", "descricao", "descrição", "titulo", "título", "até", "palavras",
  "caracteres", "nunca", "inventar", "sempre", "breve", "curto", "longo", "com", "sem", "pela", "pelo", "dos", "das", "uma", "que",
];

export function palavrasDeBusca(campos: CampoParaPreencher[], instrucao?: string | null, max = 6): string[] {
  const bruto = campos.map((c) => `${c.rotulo} ${c.dica || ""}`).join(" ") + " " + (instrucao || "");
  const saida: string[] = [];
  const re = new RegExp(PALAVRA.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(bruto))) {
    const p = m[0].toLowerCase().replace(/['’-]/g, "");
    if (p.length < 4 || COMUNS.indexOf(p) >= 0 || COMUNS.indexOf(normalizarParaComparar(p)) >= 0) continue;
    if (saida.indexOf(p) < 0) saida.push(p);
    if (saida.length >= max) break;
  }
  return saida;
}
