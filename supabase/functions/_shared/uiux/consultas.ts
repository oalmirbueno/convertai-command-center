/**
 * Consultas puras sobre a base UI UX Pro Max (frente UXM, 30/09/2026). Busca
 * exata e regra fixa, nunca julgamento (julgamento é do Jev, em
 * jev-da-base.ts): produto pelo número, estilos do produto (resolve "A + B",
 * apelido, estilo complementar e estilo obsoleto que redireciona), padrão de
 * landing do produto (pelos apelidos de landing.csv e pelo redirecionamento de
 * styles.csv), paleta do setor (1 para 1), pares do produto, regras de UX da
 * web e o gráfico pela forma do dado.
 *
 * As funções recebem a base como parâmetro: o servidor passa a base inteira
 * (base-completa.ts) e a tela passa o índice leve (src/lib/uiux/dados/indice-leve.ts,
 * carregado sob demanda). Este arquivo importa só TIPOS da base, então não
 * pesa em quem o importa. As regras de decisão da base (JSON) nunca são
 * avaliadas aqui: ficam como texto.
 *
 * Sem Deno, sem banco. Sem lookbehind, sem \p{}, sem .at(), sem travessão.
 */

import type { EstiloDaBase } from "./dados/estilos.ts";
import type { ProdutoDaBase } from "./dados/produtos.ts";
import type { RaciocinioDaBase } from "./dados/raciocinio.ts";
import type { PadraoDaBase } from "./dados/landing.ts";
import type { PaletaDaBase } from "./dados/paletas.ts";
import type { ParDaBase } from "./dados/pares.ts";
import type { FonteDaBase } from "./dados/fontes.ts";
import type { RegraDeUxDaBase } from "./dados/ux.ts";
import type { EstiloDeTipo } from "../tipografia-da-marca.ts";
import { estilosDeTipoDoHumor, GRAFICO_DA_FORMA, type FormaDoDado, type TipoDoGrafico } from "./mapeamentos.ts";

export type EstiloParaConsulta = Pick<
  EstiloDaBase,
  "id" | "nome" | "tipo" | "palavras" | "coresPrimarias" | "melhorPara" | "naoUsarPara" | "modoClaro" | "modoEscuro" | "modoPreferido" | "apelidos" | "status" | "pai" | "substitutoDominio" | "substituto"
>;
export type ProdutoParaConsulta = Pick<ProdutoDaBase, "no" | "nome" | "estiloPrincipal" | "estilosSecundarios" | "padrao">;
export type RaciocinioParaConsulta = Pick<RaciocinioDaBase, "no" | "categoria" | "padrao" | "humorDeTipo">;
export type PadraoParaConsulta = Pick<PadraoDaBase, "no" | "id" | "nome" | "apelidos" | "ordem" | "cta">;
export type RegraParaConsulta = Pick<RegraDeUxDaBase, "no" | "categoria" | "problema" | "plataforma" | "severidade" | "codigoBom">;

/** O que as consultas precisam (a tela manda o índice leve; o servidor, tudo). */
export type BaseParaConsulta = {
  estilos: EstiloParaConsulta[];
  produtos: ProdutoParaConsulta[];
  raciocinio: RaciocinioParaConsulta[];
  padroes: PadraoParaConsulta[];
  paletas?: PaletaDaBase[];
  pares?: ParDaBase[];
  fontes?: FonteDaBase[];
  ux?: RegraParaConsulta[];
};

export const VERSAO_DA_ESCOLHA = "uupm-2.15.0" as const;

const casefold = (s: unknown) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().toLowerCase();

// ------------------------------------------------------------------ produto

/** Chave do produto no Choice do Jev ("p40") e o número de volta ("40"). */
export const chaveDoProduto = (no: string) => `p${no}`;
export const noDaChaveDoProduto = (chave: string) => (/^p\d{1,4}$/.test(chave) ? chave.slice(1) : null);

export function produtoPorId(base: Pick<BaseParaConsulta, "produtos">, id: unknown): ProdutoParaConsulta | null {
  const s = String(id == null ? "" : id).trim();
  const no = /^p\d+$/.test(s) ? s.slice(1) : s;
  return base.produtos.filter((p) => p.no === no)[0] || null;
}

// ------------------------------------------------------------------ estilos

function identidadesDoEstilo(e: EstiloParaConsulta): string[] {
  return [e.id, e.nome].concat(String(e.apelidos || "").split("|")).map(casefold).filter(Boolean);
}

/** O estilo pelo id, nome ou apelido (sem redirecionar). */
export function estiloPorIdentidade(base: Pick<BaseParaConsulta, "estilos">, referencia: unknown): EstiloParaConsulta | null {
  const alvo = casefold(referencia);
  if (!alvo) return null;
  return base.estilos.filter((e) => identidadesDoEstilo(e).indexOf(alvo) >= 0)[0] || null;
}

/**
 * O estilo ATIVO a que uma referência chega: obsoleto segue o substituto do
 * domínio estilo (ou o pai); complementar sobe para o pai ativo. Obsoleto que
 * virou padrão de landing não é estilo (null).
 */
export function resolverEstilo(base: Pick<BaseParaConsulta, "estilos">, referencia: unknown): EstiloParaConsulta | null {
  let e = estiloPorIdentidade(base, referencia);
  const vistos: string[] = [];
  while (e && e.status !== "active") {
    if (vistos.indexOf(e.id) >= 0) return null;
    vistos.push(e.id);
    if (e.pai) e = base.estilos.filter((x) => x.id === e!.pai)[0] || null;
    else if (e.substitutoDominio === "style" && e.substituto) e = base.estilos.filter((x) => x.id === e!.substituto)[0] || null;
    else return null;
  }
  return e;
}

export const estilosAtivos = (base: Pick<BaseParaConsulta, "estilos">) => base.estilos.filter((e) => e.status === "active");

/** Estilos recomendados para o produto: principais ("A + B") e secundários ("C , D"), todos ativos e sem repetir. */
export function estilosDoProduto(base: Pick<BaseParaConsulta, "estilos">, produto: Pick<ProdutoParaConsulta, "estiloPrincipal" | "estilosSecundarios"> | null): { principais: string[]; secundarios: string[] } {
  if (!produto) return { principais: [], secundarios: [] };
  const ids = (lista: string[]) => {
    const saida: string[] = [];
    for (const nome of lista) {
      const e = resolverEstilo(base, nome);
      if (e && saida.indexOf(e.id) < 0) saida.push(e.id);
    }
    return saida;
  };
  const principais = ids(String(produto.estiloPrincipal || "").split("+"));
  const secundarios = ids(String(produto.estilosSecundarios || "").split(",")).filter((id) => principais.indexOf(id) < 0);
  return { principais, secundarios };
}

/** "Não usar para" que vale (a base escreve "None - ..." quando vale para todos). */
export function naoUsarParaDe(e: Pick<EstiloParaConsulta, "naoUsarPara"> | null): string {
  const t = String((e && e.naoUsarPara) || "").trim();
  return /^none\b/i.test(t) ? "" : t;
}

const SINONIMOS_DO_SETOR: Array<[RegExp, string[]]> = [
  [/legal|law|attorney/, ["legal", "law"]],
  [/health|medical|clinic|dental|pharma|patient|telemedicine|veterinary|senior/, ["healthcare", "health", "medical"]],
  [/bank|financ|fintech|insurance|invoice|expense|crypto/, ["financ", "banking", "fintech"]],
  [/government|civic|public service/, ["government", "public"]],
  [/kids|child|daycare|parenting|baby/, ["children", "kids", "family"]],
  [/luxury|premium/, ["luxury"]],
  [/enterprise|b2b|corporate/, ["enterprise", "corporate", "b2b"]],
];

/**
 * O "não usar para" do estilo bate com o tipo de produto? (aviso na tela,
 * regra fixa por palavra; quem julga de verdade é o Noul do rerank.)
 */
/** Palavras do nome do produto (mais de 3 letras) e os sinônimos do setor, para casar com textos da base. */
export function termosDoProduto(produto: Pick<ProdutoParaConsulta, "nome"> | null): string[] {
  if (!produto) return [];
  const nome = String(produto.nome || "").toLowerCase();
  const termos = nome.split(/[\s/&(),.-]+/).filter((p) => p.length > 3 && ["app", "platform", "tool", "service", "services"].indexOf(p) < 0);
  for (const [re, lista] of SINONIMOS_DO_SETOR) if (re.test(nome)) for (const t of lista) if (termos.indexOf(t) < 0) termos.push(t);
  return termos;
}

export function conflitaComProduto(estilo: Pick<EstiloParaConsulta, "naoUsarPara">, produto: Pick<ProdutoParaConsulta, "nome"> | null): boolean {
  const nao = naoUsarParaDe(estilo).toLowerCase();
  if (!nao || !produto) return false;
  return termosDoProduto(produto).some((t) => nao.indexOf(t) >= 0);
}

/** Busca simples da tela: todas as palavras aparecem (sem acento, sem caixa). */
export function casaComBusca(texto: string, busca: string): boolean {
  const limpa = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const alvo = limpa(texto);
  return limpa(busca).split(/\s+/).filter(Boolean).every((p) => alvo.indexOf(p) >= 0);
}

/** Modo que o estilo pede para o site: escuro quando o claro não é recomendado ou o preferido é escuro. */
export function modoDoEstilo(e: Pick<EstiloParaConsulta, "modoClaro" | "modoEscuro" | "modoPreferido">): "claro" | "escuro" | "os_dois" {
  if (e.modoPreferido === "dark" || e.modoClaro === "not-recommended") return "escuro";
  if (e.modoPreferido === "light" || e.modoEscuro === "not-recommended") return "claro";
  return "os_dois";
}

// ------------------------------------------------------------------ padrões de landing

function identidadesDoPadrao(p: PadraoParaConsulta): string[] {
  return [p.id, p.nome].concat(String(p.apelidos || "").split("|")).map(casefold).filter(Boolean);
}

/**
 * O padrão de landing de um nome (id, nome ou apelido de landing.csv). Nome
 * antigo que era estilo ("Trust & Authority") segue o substituto de
 * styles.csv; composição sem casamento ("Hero-Centric Design + Social Proof")
 * tenta a primeira parte.
 */
export function resolverPadrao(base: Pick<BaseParaConsulta, "padroes" | "estilos">, referencia: unknown): PadraoParaConsulta | null {
  const alvo = casefold(referencia);
  if (!alvo || /^n\/a\b/.test(alvo)) return null;
  const direto = base.padroes.filter((p) => identidadesDoPadrao(p).indexOf(alvo) >= 0)[0];
  if (direto) return direto;
  const antigo = estiloPorIdentidade(base, alvo);
  if (antigo && antigo.substitutoDominio === "landing" && antigo.substituto) {
    const p = base.padroes.filter((x) => x.id === antigo.substituto)[0];
    if (p) return p;
  }
  const partes = alvo.split("+").map((x) => x.trim()).filter(Boolean);
  if (partes.length > 1) return resolverPadrao(base, partes[0]);
  return null;
}

/** O padrão do produto: o do raciocínio (como o design system oficial), senão o de products.csv. */
export function padraoDoProduto(base: Pick<BaseParaConsulta, "padroes" | "estilos" | "raciocinio">, produto: Pick<ProdutoParaConsulta, "no" | "padrao"> | null): PadraoParaConsulta | null {
  if (!produto) return null;
  const r = base.raciocinio.filter((x) => x.no === produto.no)[0];
  return (r && resolverPadrao(base, r.padrao)) || resolverPadrao(base, produto.padrao);
}

// ------------------------------------------------------------------ paleta do setor

/** A paleta de referência do setor: mesma linha do produto (1 para 1, conferida pelo nome). */
export function paletaDoSetor(base: Pick<BaseParaConsulta, "paletas" | "produtos">, produtoNo: unknown): PaletaDaBase | null {
  const produto = produtoPorId(base, produtoNo);
  if (!produto || !base.paletas) return null;
  const p = base.paletas.filter((x) => x.no === produto.no)[0];
  return p && p.nome === produto.nome ? p : null;
}

// ------------------------------------------------------------------ pares de fontes

/** Par feito para escrita que não é latina (japonês, árabe...): fica na lista, mas não entra na sugestão. */
export function parDeOutraEscrita(par: Pick<ParDaBase, "humor" | "nome">): boolean {
  return /japanese|korean|chinese|arabic|thai|hebrew|vietnamese|multilingual/i.test(`${par.nome} ${par.humor}`);
}

export const chaveDoPar = (no: string) => `t${no}`;
export const noDaChaveDoPar = (chave: string) => (/^t\d{1,3}$/.test(chave) ? chave.slice(1) : null);

/**
 * Pares ordenados pelo encaixe: humor do par x humor de tipografia do produto
 * (raciocínio) e x estilos de tipo da personalidade (arquétipo e eixos). Regra
 * fixa, sem julgamento.
 */
export function paresDoProduto(
  base: Pick<BaseParaConsulta, "pares" | "raciocinio">,
  produto: Pick<ProdutoParaConsulta, "no" | "nome"> | null,
  estilosDaPersonalidade: EstiloDeTipo[] = [],
): Array<{ par: ParDaBase; encaixe: number; humor: EstiloDeTipo[] }> {
  const r = produto ? base.raciocinio.filter((x) => x.no === produto.no)[0] : null;
  const doProduto = r ? estilosDeTipoDoHumor(r.humorDeTipo) : [];
  const termos = termosDoProduto(produto as Pick<ProdutoParaConsulta, "nome"> | null);
  return (base.pares || [])
    .filter((p) => !parDeOutraEscrita(p))
    .map((par, i) => {
      const humor = estilosDeTipoDoHumor(`${par.humor} ${par.melhorPara}`);
      const comProduto = humor.filter((h) => doProduto.indexOf(h) >= 0).length;
      const comPersonalidade = humor.filter((h) => estilosDaPersonalidade.indexOf(h) >= 0).length;
      // O par que a base escreveu para o setor ("Law firms, legal services") vem na frente.
      const texto = `${par.melhorPara} ${par.humor}`.toLowerCase();
      const doSetor = termos.some((t) => texto.indexOf(t) >= 0) ? 3 : 0;
      return { par, encaixe: doSetor + comProduto * 2 + comPersonalidade, humor, i };
    })
    .sort((a, b) => b.encaixe - a.encaixe || a.i - b.i)
    .map((x) => ({ par: x.par, encaixe: x.encaixe, humor: x.humor }));
}

/** Pesos de uma família da base (para o endereço do Google Fonts), ou null quando não é da base. */
export function pesosDaFonte(base: Pick<BaseParaConsulta, "fontes">, familia: string): number[] | null {
  const f = (base.fontes || []).filter((x) => casefold(x.familia) === casefold(familia))[0];
  return f ? f.pesos.slice() : null;
}

// ------------------------------------------------------------------ regras de UX

export const regrasDeUxDaWeb = <R extends Pick<RegraParaConsulta, "plataforma">>(regras: R[]): R[] => regras.filter((r) => r.plataforma === "Web" || r.plataforma === "All");

// ------------------------------------------------------------------ gráfico pela forma do dado

export type PontoDaSerie = { rotulo: string; valor: number };
export type SerieReal = { pontos: PontoDaSerie[]; eixo?: "tempo" | "categoria"; parte_do_todo?: boolean; fonte: string };

/**
 * O gráfico pela forma do dado (regra fixa, a mesma que o Grafico.tsx da
 * casca aceita): série no tempo vira linha; parte do todo com 2 a 5 fatias
 * positivas vira rosca; de 2 a 8 categorias vira barras; o
 * resto fica só nos números grandes (null). Sem fonte ou sem 2 pontos
 * válidos, null: gráfico só com dado real.
 */
export function graficoParaDados(serie: SerieReal | null | undefined): { forma: FormaDoDado; tipo: TipoDoGrafico; no: string } | null {
  if (!serie || !String(serie.fonte || "").trim()) return null;
  const pontos = (serie.pontos || []).filter((p) => p && String(p.rotulo || "").trim() && typeof p.valor === "number" && isFinite(p.valor));
  if (pontos.length < 2) return null;
  let forma: FormaDoDado | null = null;
  const soma = pontos.reduce((t, p) => t + p.valor, 0);
  if (serie.eixo === "tempo") forma = "tempo";
  else if (serie.parte_do_todo && pontos.length <= 5 && pontos.every((p) => p.valor >= 0) && soma > 0) forma = "parte_do_todo";
  else if (pontos.length <= 8) forma = "categorias";
  if (!forma) return null;
  return { forma, ...GRAFICO_DA_FORMA[forma] };
}

/** A série real guardada (conteudo.serie_real do site), sem confiar em nada: até 12 pontos, fonte obrigatória. */
export function lerSerieReal(bruto: unknown): SerieReal | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const fonte = String(o.fonte == null ? "" : o.fonte).replace(/\s+/g, " ").trim().slice(0, 200);
  if (!fonte) return null;
  const pontos = (Array.isArray(o.pontos) ? o.pontos : [])
    .map((p) => (p && typeof p === "object" ? (p as Record<string, unknown>) : {}))
    .map((p) => ({ rotulo: String(p.rotulo == null ? "" : p.rotulo).replace(/\s+/g, " ").trim().slice(0, 40), valor: typeof p.valor === "number" ? p.valor : Number(String(p.valor == null ? "" : p.valor).replace(/\./g, "").replace(",", ".")) }))
    .filter((p) => p.rotulo && isFinite(p.valor))
    .slice(0, 12);
  if (pontos.length < 2) return null;
  return { pontos, fonte, eixo: o.eixo === "tempo" ? "tempo" : "categoria", parte_do_todo: o.parte_do_todo === true };
}

// ------------------------------------------------------------------ o que fica guardado (por marca)

export type OrigemDaEscolha = "jev" | "equipe";
/** `rotulo` é o nome em português gravado junto (a tela mostra sem carregar a base). */
export type EscolhaDaBase = { id: string; origem: OrigemDaEscolha; prob?: number; nota?: number; rotulo?: string };
export type EstadoDaRegra = "ok" | "nao_se_aplica";

/** sites.direcao.base_de_design (o site já é por cliente e marca). */
export type BaseDeDesign = {
  versao: typeof VERSAO_DA_ESCOLHA;
  produto: EscolhaDaBase | null;
  estilo: EscolhaDaBase | null;
  padrao: EscolhaDaBase | null;
  par: EscolhaDaBase | null;
  ux: Record<string, EstadoDaRegra>;
  sugestao?: { em: string; probabilidades: Record<string, Record<string, number>> };
};

/** dados.sistema.base_de_design da Identidade (por projeto, que é por marca). */
export type BaseDaMarca = { versao: typeof VERSAO_DA_ESCOLHA; produto: EscolhaDaBase | null; par: EscolhaDaBase | null; paleta_setor: EscolhaDaBase | null };

const ID_SEGURO = /^[a-z0-9][a-z0-9-]{0,63}$/i;

function escolha(v: unknown): EscolhaDaBase | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const id = String(o.id == null ? "" : o.id).trim();
  if (!ID_SEGURO.test(id)) return null;
  const e: EscolhaDaBase = { id, origem: o.origem === "jev" ? "jev" : "equipe" };
  if (typeof o.prob === "number" && isFinite(o.prob)) e.prob = Math.max(0, Math.min(1, o.prob));
  if (typeof o.nota === "number" && isFinite(o.nota)) e.nota = Math.round(o.nota * 1000) / 1000;
  if (typeof o.rotulo === "string" && o.rotulo.trim()) e.rotulo = o.rotulo.replace(/\s+/g, " ").trim().slice(0, 80);
  return e;
}

function probabilidadesGuardadas(v: unknown): Record<string, Record<string, number>> {
  const saida: Record<string, Record<string, number>> = {};
  if (!v || typeof v !== "object") return saida;
  for (const q of Object.keys(v as object).slice(0, 40)) {
    const d = (v as Record<string, unknown>)[q];
    if (!/^[a-z0-9_-]{1,80}$/i.test(q) || !d || typeof d !== "object") continue;
    const m: Record<string, number> = {};
    for (const k of Object.keys(d as object).slice(0, 260)) {
      const n = (d as Record<string, unknown>)[k];
      if (typeof n === "number" && isFinite(n) && /^[a-z0-9_-]{1,80}$/i.test(k)) m[k] = Math.round(n * 10000) / 10000;
    }
    saida[q] = m;
  }
  return saida;
}

/** Lê o que está guardado sem confiar em nada (a validação de que o id existe na base é do servidor). */
export function lerBaseDeDesign(bruto: unknown): BaseDeDesign {
  const o = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const ux: Record<string, EstadoDaRegra> = {};
  const u = o.ux && typeof o.ux === "object" ? (o.ux as Record<string, unknown>) : {};
  for (const k of Object.keys(u).slice(0, 200)) if (/^\d{1,3}$/.test(k) && (u[k] === "ok" || u[k] === "nao_se_aplica")) ux[k] = u[k] as EstadoDaRegra;
  const b: BaseDeDesign = { versao: VERSAO_DA_ESCOLHA, produto: escolha(o.produto), estilo: escolha(o.estilo), padrao: escolha(o.padrao), par: escolha(o.par), ux };
  const s = o.sugestao && typeof o.sugestao === "object" ? (o.sugestao as Record<string, unknown>) : null;
  if (s && typeof s.em === "string") b.sugestao = { em: s.em.slice(0, 40), probabilidades: probabilidadesGuardadas(s.probabilidades) };
  return b;
}

export function lerBaseDaMarca(bruto: unknown): BaseDaMarca {
  const o = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  return { versao: VERSAO_DA_ESCOLHA, produto: escolha(o.produto), par: escolha(o.par), paleta_setor: escolha(o.paleta_setor) };
}

/**
 * O que um site novo da mesma marca herda do último: só as escolhas (produto,
 * estilo, padrão e par). A sugestão do Jev (as probabilidades de todas as
 * opções) e as marcações de UX da Revisão são do site antigo.
 */
export function baseHerdada(b: BaseDeDesign): BaseDeDesign {
  return { versao: b.versao, produto: b.produto, estilo: b.estilo, padrao: b.padrao, par: b.par, ux: {} };
}

/**
 * sites.direcao como vai para o diretor de site (JSON dos DADOS): sem a
 * sugestão do Jev (milhares de números, fora do teto do bloco da base, e as
 * escolhas já vão no bloco b1..bN) e sem as marcações de UX. As escolhas ficam,
 * só com id, origem e rótulo.
 */
export function direcaoParaOAgente(direcao: unknown): Record<string, unknown> {
  const d = direcao && typeof direcao === "object" && !Array.isArray(direcao) ? (direcao as Record<string, unknown>) : {};
  if (d.base_de_design === undefined || d.base_de_design === null) return { ...d };
  const b = lerBaseDeDesign(d.base_de_design);
  const curta = (e: EscolhaDaBase | null) => (e ? { id: e.id, origem: e.origem, ...(e.rotulo ? { rotulo: e.rotulo } : {}) } : null);
  return { ...d, base_de_design: { produto: curta(b.produto), estilo: curta(b.estilo), padrao: curta(b.padrao), par: curta(b.par) } };
}

/**
 * Confere as escolhas contra a base (id que não existe sai). Estilo tem de ser
 * ativo; produto e par pelo número; padrão pelo id.
 */
export function validarBaseDeDesign(base: BaseParaConsulta, b: BaseDeDesign): BaseDeDesign {
  const ok = { ...b };
  if (ok.produto && !produtoPorId(base, ok.produto.id)) ok.produto = null;
  if (ok.estilo && !base.estilos.some((e) => e.id === ok.estilo!.id && e.status === "active")) ok.estilo = null;
  if (ok.padrao && !base.padroes.some((p) => p.id === ok.padrao!.id)) ok.padrao = null;
  if (ok.par && base.pares && !base.pares.some((p) => p.no === ok.par!.id)) ok.par = null;
  return ok;
}

/** A consulta em inglês (nomes exatos da base) que o agente do motor usa na busca da skill. */
export function consultaDaBase(base: BaseParaConsulta, b: Pick<BaseDeDesign, "produto" | "estilo">): string {
  const produto = b.produto ? produtoPorId(base, b.produto.id) : null;
  const estilo = b.estilo ? base.estilos.filter((e) => e.id === b.estilo!.id)[0] : null;
  const partes = [produto ? produto.nome : "", estilo ? estilo.nome : ""].filter(Boolean);
  return partes.join(" ").replace(/[()/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}
