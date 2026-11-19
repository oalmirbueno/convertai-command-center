/**
 * Ateliê de Cor: o motor que escolhe as cores (19/11/2026). Sem IA e sem rede.
 *
 * A regra (reels do @jorgedaweb + teoria pública, docs/cores/PESQUISA.md):
 * uma cor dominante que ocupa as áreas grandes (60%), uma de apoio (30%) e um
 * destaque que só aparece no botão e no detalhe (10%). O destaque é forte de
 * verdade: croma alto, matiz oposto ou vizinho do oposto ao da marca e pelo
 * menos 3:1 contra a dominante (WCAG 1.4.11). Toda cor tem um texto que passa
 * de 4,5:1. Uma cor "sem graça" sozinha fica boa quando entra no trio certo.
 *
 * As três propostas têm estruturas de luminosidade diferentes (base clara,
 * base profunda, base de cor), para a escolha ser de verdade e não três
 * variações da mesma. A IA escreve o porquê depois; as cores são decididas aqui.
 */

import {
  ajustarAteContraste, contraste, cromaMaximo, difMatiz, distancia, hexParaOklch, hexValido, melhorTexto,
  nomeDaCor, oklchParaHex, simularDaltonismo, type Harmonia, type Oklch,
} from "./oklch.ts";
import { nichoPorTexto, type Nicho } from "./nichos.ts";

// ------------------------------------------------------------------ entrada

export type Preco = "acessivel" | "intermediario" | "premium" | "luxo";
export type Briefing = {
  marca: string;
  nicho?: string;
  subnicho?: string;
  oferta?: string;
  publico?: string;
  preco?: Preco | null;
  objetivo?: string;
  personalidade?: string[];
  estilos?: string[];
  /** Cor da marca que já existe: entra exata nas três propostas. */
  corPrincipal?: string | null;
  preferidas?: string[];
  evitar?: string[];
  /** Cores de marca (sem contar neutros): 1, 2, 3 ou 4. */
  quantas?: number;
  aplicacoes?: string[];
};

// ------------------------------------------------------------------ famílias de cor

type Familia = { id: string; nome: string; centro: Oklch; eh: (o: Oklch) => boolean };
const entre = (h: number, a: number, b: number) => (a <= b ? h >= a && h < b : h >= a || h < b);

export const FAMILIAS: Familia[] = [
  { id: "vermelho", nome: "Vermelho", centro: { l: 0.58, c: 0.2, h: 28 }, eh: (o) => o.c >= 0.1 && entre(o.h, 12, 40) && o.l >= 0.4 },
  { id: "rosa", nome: "Rosa", centro: { l: 0.72, c: 0.14, h: 355 }, eh: (o) => o.c >= 0.06 && entre(o.h, 335, 12) && o.l >= 0.45 },
  { id: "vinho", nome: "Vinho", centro: { l: 0.33, c: 0.11, h: 15 }, eh: (o) => o.c >= 0.06 && entre(o.h, 340, 35) && o.l < 0.45 },
  { id: "laranja", nome: "Laranja", centro: { l: 0.7, c: 0.18, h: 55 }, eh: (o) => o.c >= 0.1 && entre(o.h, 40, 72) && o.l >= 0.55 },
  { id: "terracota", nome: "Terracota", centro: { l: 0.6, c: 0.12, h: 45 }, eh: (o) => o.c >= 0.06 && o.c < 0.17 && entre(o.h, 30, 62) && o.l >= 0.45 && o.l < 0.74 },
  { id: "dourado", nome: "Dourado", centro: { l: 0.72, c: 0.12, h: 85 }, eh: (o) => o.c >= 0.08 && entre(o.h, 70, 100) && o.l >= 0.55 && o.l < 0.85 },
  { id: "amarelo", nome: "Amarelo", centro: { l: 0.88, c: 0.17, h: 100 }, eh: (o) => o.c >= 0.1 && entre(o.h, 88, 122) && o.l >= 0.75 },
  { id: "verde-oliva", nome: "Verde-oliva", centro: { l: 0.5, c: 0.09, h: 115 }, eh: (o) => o.c >= 0.04 && o.c < 0.15 && entre(o.h, 95, 135) && o.l < 0.7 },
  { id: "verde", nome: "Verde", centro: { l: 0.62, c: 0.15, h: 150 }, eh: (o) => o.c >= 0.06 && entre(o.h, 130, 175) },
  { id: "turquesa", nome: "Turquesa", centro: { l: 0.72, c: 0.12, h: 190 }, eh: (o) => o.c >= 0.06 && entre(o.h, 175, 215) },
  { id: "azul", nome: "Azul", centro: { l: 0.55, c: 0.17, h: 258 }, eh: (o) => o.c >= 0.06 && entre(o.h, 215, 285) && o.l >= 0.38 },
  { id: "azul-marinho", nome: "Azul-marinho", centro: { l: 0.28, c: 0.09, h: 262 }, eh: (o) => o.c >= 0.04 && entre(o.h, 230, 290) && o.l < 0.4 },
  { id: "roxo", nome: "Roxo", centro: { l: 0.45, c: 0.18, h: 305 }, eh: (o) => o.c >= 0.06 && entre(o.h, 285, 335) && o.l < 0.72 },
  { id: "lilas", nome: "Lilás", centro: { l: 0.8, c: 0.08, h: 310 }, eh: (o) => o.c >= 0.04 && entre(o.h, 280, 340) && o.l >= 0.72 },
  { id: "marrom", nome: "Marrom", centro: { l: 0.4, c: 0.07, h: 55 }, eh: (o) => o.c >= 0.03 && o.c < 0.13 && entre(o.h, 30, 95) && o.l < 0.55 },
  { id: "bege", nome: "Bege", centro: { l: 0.88, c: 0.04, h: 75 }, eh: (o) => o.c >= 0.015 && o.c < 0.08 && entre(o.h, 45, 105) && o.l >= 0.8 },
  { id: "preto", nome: "Preto", centro: { l: 0.15, c: 0, h: 0 }, eh: (o) => o.l < 0.25 && o.c < 0.05 },
  { id: "branco", nome: "Branco", centro: { l: 1, c: 0, h: 0 }, eh: (o) => o.l > 0.96 && o.c < 0.02 },
  { id: "cinza", nome: "Cinza", centro: { l: 0.6, c: 0, h: 0 }, eh: (o) => o.c < 0.025 && o.l >= 0.25 && o.l <= 0.96 },
];

function idDaFamilia(texto: string): string | null {
  const t = texto.trim().toLowerCase().replace("lilás", "lilas").replace("verde oliva", "verde-oliva").replace("azul marinho", "azul-marinho");
  const f = FAMILIAS.find((x) => x.id === t || x.nome.toLowerCase() === t);
  return f ? f.id : null;
}

/** As famílias a que a cor pertence (uma cor pode estar em duas, ex.: vinho e vermelho escuro). */
export function familiasDaCor(hex: string): string[] {
  const o = hexParaOklch(hex);
  return FAMILIAS.filter((f) => f.eh(o)).map((f) => f.id);
}

/** A cor cai numa família proibida, ou fica perto (ΔE < 0,06) de um HEX proibido? */
export function corProibida(hex: string, evitar: string[] = []): string | null {
  const minhas = familiasDaCor(hex);
  for (const e of evitar) {
    const h = hexValido(e);
    if (h) {
      if (distancia(h, hex) < 0.06) return e;
      continue;
    }
    const id = idDaFamilia(e);
    if (id && minhas.includes(id)) return e;
  }
  return null;
}

function centroDe(texto: string): Oklch | null {
  const h = hexValido(texto);
  if (h) return hexParaOklch(h);
  const id = idDaFamilia(texto);
  const f = FAMILIAS.find((x) => x.id === id);
  return f ? f.centro : null;
}

// ------------------------------------------------------------------ saída

export type PapelNaProposta = "dominante" | "apoio" | "destaque" | "extra";
export const ROTULO_DO_PAPEL: Record<PapelNaProposta, string> = { dominante: "Dominante", apoio: "Apoio", destaque: "Destaque", extra: "Extra" };
export const PESO_DO_PAPEL: Record<PapelNaProposta, number> = { dominante: 60, apoio: 30, destaque: 10, extra: 5 };

export type CorDaProposta = {
  papel: PapelNaProposta;
  hex: string;
  nome: string;
  /** Onde usar (regra; a IA pode reescrever). */
  uso: string;
  /** Por que esta cor (regra; a IA pode reescrever). */
  porque: string;
  /** A cor da marca que o cliente já tem. */
  fixa?: boolean;
  /** Texto que passa sobre esta cor, e a razão. */
  texto: string;
  razaoTexto: number;
};

export type Neutros = { tinta: string; papel: string; cinza: string };
export type Estrutura = "clara" | "profunda" | "cor";
export const ROTULO_DA_ESTRUTURA: Record<Estrutura, string> = { clara: "Base clara", profunda: "Base profunda", cor: "Base de cor" };

export type Etiquetas = { base: "Fundo claro" | "Fundo escuro" | "Fundo médio"; temperatura: "Quente" | "Fria" | "Mista"; intensidade: "Sóbria" | "Moderada" | "Intensa"; contraste: "Contraste alto" | "Contraste médio" | "Contraste baixo" };

export type Proposta = {
  id: string;
  estrutura: Estrutura;
  harmonia: Harmonia;
  titulo: string;
  frase: string;
  cores: CorDaProposta[];
  neutros: Neutros;
  etiquetas: Etiquetas;
  orientacoes: string[];
  /** Diagnóstico curto escrito pela regra; a IA troca por um melhor. */
  diagnostico: string;
};

// ------------------------------------------------------------------ ajustes do briefing

function fatorDeCroma(b: Briefing): number {
  let f = 1;
  const p = b.preco ?? "intermediario";
  f *= p === "luxo" ? 0.62 : p === "premium" ? 0.8 : p === "acessivel" ? 1.15 : 1;
  const todos = [...(b.personalidade ?? []), ...(b.estilos ?? [])].map((x) => x.toLowerCase());
  if (todos.some((x) => /ousad|divertid|vibrant|pop|energ/.test(x))) f *= 1.25;
  if (todos.some((x) => /elegant|sofistic|minimal|tradicion|clássic|classic|editorial/.test(x))) f *= 0.85;
  return Math.max(0.45, Math.min(1.4, f));
}

/** Quente (laranja, terra) ou fria (azul, verde-água) puxa o papel e a tinta. */
function quente(b: Briefing): boolean {
  const todos = [...(b.personalidade ?? []), ...(b.estilos ?? [])].map((x) => x.toLowerCase());
  return todos.some((x) => /acolhed|natural|orgân|organ|artesan|humana|calor/.test(x));
}

function matizDaMarca(b: Briefing, nicho: Nicho | null, variacao: number): number {
  const fixa = hexValido(b.corPrincipal);
  if (fixa) {
    const o = hexParaOklch(fixa);
    if (o.c >= 0.02) return o.h;
  }
  for (const p of b.preferidas ?? []) {
    const c = centroDe(p);
    if (c && c.c >= 0.03 && !corProibida(oklchParaHex(c), b.evitar)) return c.h;
  }
  const opcoes = (nicho?.matizes ?? [250, 150, 30]).filter((h) => !corProibida(oklchParaHex({ l: 0.5, c: 0.12, h }), b.evitar));
  const lista = opcoes.length ? opcoes : [250];
  return lista[variacao % lista.length];
}

// ------------------------------------------------------------------ peças

function neutrosDe(h: number, aquecer: boolean): Neutros {
  // Neutros levemente tingidos pelo matiz da marca (nunca #000 ou #FFF puros: inversão do modo escuro fica melhor).
  const hn = aquecer ? 70 : h;
  return {
    tinta: oklchParaHex({ l: 0.19, c: 0.018, h }),
    papel: oklchParaHex({ l: 0.985, c: aquecer ? 0.008 : 0.005, h: hn }),
    cinza: oklchParaHex({ l: 0.6, c: 0.012, h }),
  };
}

/** Ordem dos L tentados para o destaque: perto do preferido primeiro. */
function lsEmVolta(preferido: number): number[] {
  const todos = [0.3, 0.36, 0.42, 0.48, 0.54, 0.6, 0.66, 0.72, 0.78, 0.84, 0.88, 0.92];
  return todos.sort((a, b) => Math.abs(a - preferido) - Math.abs(b - preferido));
}

/**
 * O destaque: o mais vivo que cabe no matiz, com 3:1 contra a dominante e
 * diferente das outras cores. Tenta os matizes em ordem e os L em volta do
 * preferido. Só baixa o croma mínimo se nada passar.
 */
function destaqueVivo(matizes: number[], dominante: string, outras: string[], lPreferido: number, evitar: string[], cromaMin = 0.11, preferidos = 0): string {
  // A cor que o cliente pediu vem antes, mesmo um pouco menos viva (0,07); depois o círculo todo.
  const rodadas: Array<{ minimo: number; lista: number[] }> = [];
  if (preferidos > 0) rodadas.push({ minimo: 0.07, lista: matizes.slice(0, preferidos) });
  for (const minimo of [cromaMin, 0.08, 0.05, 0]) rodadas.push({ minimo, lista: matizes });
  for (const { minimo, lista } of rodadas) {
    for (const h of lista) {
      for (const l of lsEmVolta(lPreferido)) {
        // Amarelo e dourado só são vivos no claro; no meio e no escuro viram mostarda barrenta.
        if (entre(h, 70, 120) && l < 0.78) continue;
        const c = cromaMaximo(l, h) * 0.96;
        if (c < minimo) continue;
        const hex = oklchParaHex({ l, c, h });
        if (contraste(hex, dominante) < 3) continue;
        if (outras.some((o) => distancia(o, hex) < 0.12)) continue;
        if (corProibida(hex, evitar)) continue;
        return hex;
      }
    }
  }
  return melhorTexto(dominante).hex;
}

function preferidosDoDestaque(h0: number, b: Briefing): number[] {
  const preferidos: number[] = [];
  for (const p of b.preferidas ?? []) {
    const c = centroDe(p);
    if (c && c.c >= 0.05 && difMatiz(c.h, h0) >= 60) preferidos.push(c.h);
  }
  return preferidos;
}

function matizesDoDestaque(h0: number, b: Briefing, ordem: number[]): number[] {
  return [...preferidosDoDestaque(h0, b), ...ordem.map((g) => (h0 + g + 360) % 360)];
}

function etiquetasDe(cores: CorDaProposta[]): Etiquetas {
  const dom = cores.find((c) => c.papel === "dominante")!;
  const des = cores.find((c) => c.papel === "destaque");
  const ap = cores.find((c) => c.papel === "apoio");
  const od = hexParaOklch(dom.hex);
  const base = od.l > 0.8 ? "Fundo claro" : od.l < 0.38 ? "Fundo escuro" : "Fundo médio";
  let q = 0;
  let f = 0;
  for (const c of cores) {
    const o = hexParaOklch(c.hex);
    if (o.c < 0.03) continue;
    if (entre(o.h, 20, 110) || o.h >= 330) q += 1;
    else f += 1;
  }
  const temperatura = q && !f ? "Quente" : f && !q ? "Fria" : "Mista";
  const media = cores.reduce((s, c) => s + hexParaOklch(c.hex).c, 0) / cores.length;
  const intensidade = media < 0.06 ? "Sóbria" : media < 0.12 ? "Moderada" : "Intensa";
  const menor = Math.min(des ? contraste(des.hex, dom.hex) : 21, ap ? contraste(ap.hex, dom.hex) : 21);
  const nivel = menor >= 4.5 ? "Contraste alto" : menor >= 3 ? "Contraste médio" : "Contraste baixo";
  return { base, temperatura, intensidade, contraste: nivel };
}

const USO: Record<PapelNaProposta, string> = {
  dominante: "Fundos amplos, cabeçalho e as áreas grandes da peça (cerca de 60%).",
  apoio: "Cartões, faixas, seções alternadas e títulos (cerca de 30%).",
  destaque: "Só no que precisa chamar o olho: botão, link, selo, preço e ícone ativo (cerca de 10%).",
  extra: "Gráficos, ilustração e estados; nunca no lugar do destaque.",
};

/** Texto sobre a cor: os neutros tingidos da marca quando passam de 4,5:1; preto ou branco puros só se precisar. */
export function textoSobreACor(hex: string, neutros: Neutros): { hex: string; razao: number } {
  const n = melhorTexto(hex, [neutros.tinta, neutros.papel]);
  return n.razao >= 4.5 ? n : melhorTexto(hex, [neutros.tinta, neutros.papel, "#000000", "#FFFFFF"]);
}

function cor(papel: PapelNaProposta, hex: string, neutros: Neutros, porque: string, fixa = false): CorDaProposta {
  const t = textoSobreACor(hex, neutros);
  return { papel, hex, nome: nomeDaCor(hex), uso: USO[papel], porque, fixa: fixa || undefined, texto: t.hex, razaoTexto: Math.round(t.razao * 100) / 100 };
}

function orientacoesDe(p: { cores: CorDaProposta[]; neutros: Neutros }, b: Briefing): string[] {
  const dom = p.cores.find((c) => c.papel === "dominante")!;
  const ap = p.cores.find((c) => c.papel === "apoio");
  const des = p.cores.find((c) => c.papel === "destaque");
  const o: string[] = [];
  o.push(`Fundo das áreas grandes em ${dom.nome}, com texto em ${dom.texto} (${dom.razaoTexto.toFixed(1).replace(".", ",")}:1).`);
  if (ap) o.push(`${ap.nome} nos cartões, faixas e títulos; texto sobre ele em ${ap.texto}.`);
  if (des) {
    o.push(`${des.nome} só no botão, no link e no selo. Um botão principal por tela; não use em texto corrido.`);
    const r = contraste(des.hex, dom.hex);
    o.push(`O botão em ${des.nome} sobre ${dom.nome} tem ${r.toFixed(1).replace(".", ",")}:1, o bastante para saltar à vista (mínimo 3:1).`);
  }
  const ondes = (b.aplicacoes ?? []).map((x) => x.toLowerCase());
  if (!ondes.length || ondes.some((x) => /rede|social|instagram|post/.test(x))) {
    o.push(`Nas redes, alterne fundos em ${dom.nome}${ap ? ` e ${ap.nome}` : ""} para o feed ficar reconhecível; ${des ? des.nome : "o destaque"} só no que pede ação.`);
  }
  if (ap) {
    const logoSobre = contraste(ap.hex, dom.hex) >= 3 ? `logo em ${ap.nome} sobre ${dom.nome}` : `logo em ${dom.texto === p.neutros.papel ? "papel" : "tinta"} sobre ${dom.nome}`;
    o.push(`Logotipo: ${logoSobre}, e a versão negativa em ${p.neutros.papel} sobre ${ap.nome}.`);
  }
  return o;
}

function diagnosticoDaRegra(p: { estrutura: Estrutura; cores: CorDaProposta[] }, b: Briefing): string {
  const dom = p.cores.find((c) => c.papel === "dominante")!;
  const des = p.cores.find((c) => c.papel === "destaque");
  const ap = p.cores.find((c) => c.papel === "apoio");
  const estr = p.estrutura === "clara" ? "base clara, com respiro e leitura editorial" : p.estrutura === "profunda" ? "base profunda, com contraste forte e cara de marca premium" : "base de cor, em que a própria cor da marca ocupa as áreas grandes";
  return `${b.marca || "A marca"} ganha uma ${estr}. ${dom.nome} domina, ${ap ? `${ap.nome} sustenta os apoios` : "os neutros sustentam o texto"}${des ? ` e ${des.nome} fica reservado ao botão e aos detalhes, para guiar o olhar até a ação` : ""}.`;
}

// ------------------------------------------------------------------ as três estruturas

type Contexto = { b: Briefing; h0: number; fixa: string | null; k: number; aquecer: boolean; neutros: Neutros; variacao: number };

function corDaMarca(ctx: Contexto, l: number, cFator = 1): string {
  return oklchParaHex({ l, c: Math.min(cromaMaximo(l, ctx.h0) * 0.85, 0.16 * ctx.k * cFator), h: ctx.h0 });
}

function estruturaClara(ctx: Contexto): Proposta {
  const { neutros } = ctx;
  const fixaO = ctx.fixa ? hexParaOklch(ctx.fixa) : null;
  // Dominante: papel tingido; se a cor fixa já é clara, ela mesma.
  const dominante = fixaO && fixaO.l >= 0.88 ? ctx.fixa! : oklchParaHex({ l: 0.965, c: 0.014 * Math.min(1.2, ctx.k), h: ctx.aquecer ? 75 : ctx.h0 });
  let apoio = ctx.fixa && !(fixaO && fixaO.l >= 0.88) ? ctx.fixa : corDaMarca(ctx, 0.34);
  if (!ctx.fixa && contraste(apoio, dominante) < 4.5) apoio = ajustarAteContraste(apoio, dominante, 4.5) ?? apoio;
  const destaque = destaqueVivo(matizesDoDestaque(ctx.h0, ctx.b, [180, 150, 210, 120, 240]), dominante, [apoio, neutros.tinta], 0.6, ctx.b.evitar ?? [], preferidosDoDestaque(ctx.h0, ctx.b).length);
  const cores = [
    cor("dominante", dominante, neutros, "Fundo claro abre espaço, deixa a foto e o texto respirarem e faz o destaque aparecer mais.", dominante === ctx.fixa),
    cor("apoio", apoio, neutros, ctx.fixa && apoio === ctx.fixa ? "É a cor que a marca já tem: fica nos apoios e títulos, onde é reconhecida sem pesar." : "Tom profundo do matiz da marca: dá corpo aos títulos e cartões e passa firmeza.", apoio === ctx.fixa),
    cor("destaque", destaque, neutros, "Matiz do lado oposto do círculo e croma alto: é o que faz o botão saltar.", false),
  ];
  return montar("clara", "complementar", cores, ctx, "Clareza editorial com um botão que chama");
}

function estruturaProfunda(ctx: Contexto): Proposta {
  const { neutros } = ctx;
  const fixaO = ctx.fixa ? hexParaOklch(ctx.fixa) : null;
  // A cor fixa só vira o fundo profundo se for quase preta; senão ela é o apoio sobre um fundo mais escuro (a "base de cor" já a usa como fundo).
  // Cor fixa escura (mas não preta): o fundo desce bem mais para ela continuar visível como apoio.
  const fundoGerado = fixaO && fixaO.l < 0.5
    ? oklchParaHex({ l: Math.max(0.12, fixaO.l - 0.14), c: 0.02, h: ctx.h0 })
    : oklchParaHex({ l: 0.235, c: Math.min(0.06, 0.05 * ctx.k + 0.01), h: ctx.h0 });
  const dominante = fixaO && fixaO.l <= 0.25 ? ctx.fixa! : fundoGerado;
  let apoio = ctx.fixa && dominante !== ctx.fixa ? ctx.fixa : oklchParaHex({ l: 0.92, c: 0.025 * ctx.k, h: ctx.aquecer ? 70 : (ctx.h0 + 30) % 360 });
  if (contraste(apoio, dominante) < 3 && !(ctx.fixa && apoio === ctx.fixa)) apoio = ajustarAteContraste(apoio, dominante, 4.5) ?? apoio;
  const destaque = destaqueVivo(matizesDoDestaque(ctx.h0, ctx.b, [150, 210, 180, 120, 240, 90]), dominante, [apoio, neutros.papel], 0.84, ctx.b.evitar ?? [], 0.13, preferidosDoDestaque(ctx.h0, ctx.b).length);
  const cores = [
    cor("dominante", dominante, neutros, dominante === ctx.fixa ? "A cor da marca já é profunda: vira o fundo e dá peso premium." : "Fundo profundo no matiz da marca: valoriza o produto e deixa o destaque brilhar como neon.", dominante === ctx.fixa),
    cor("apoio", apoio, neutros, apoio === ctx.fixa ? "É a cor que a marca já tem: sobre o fundo profundo, ela vira assinatura." : "Claro suave para texto grande e cartões: alivia o escuro sem competir com o destaque.", apoio === ctx.fixa),
    cor("destaque", destaque, neutros, "Destaque claro e saturado sobre o escuro: a leitura do botão é imediata.", false),
  ];
  return montar("profunda", "dividida", cores, ctx, "Fundo profundo e um destaque que acende");
}

function estruturaDeCor(ctx: Contexto): Proposta {
  const { neutros } = ctx;
  const fixaO = ctx.fixa ? hexParaOklch(ctx.fixa) : null;
  // Cor fixa quase preta ou quase branca não é "cor": a base de cor usa o matiz da marca e a fixa vai para o apoio.
  const fixaNeutra = !!fixaO && (fixaO.l <= 0.25 || fixaO.l >= 0.9 || fixaO.c < 0.03);
  const dominante = ctx.fixa && !fixaNeutra ? ctx.fixa : corDaMarca(ctx, 0.42, 1.25);
  const od = hexParaOklch(dominante);
  const apoio = ctx.fixa && fixaNeutra ? ctx.fixa : neutros.papel;
  // Com a dominante no meio, o destaque precisa ir para longe no L para ter 3:1.
  const lAlvo = od.l < 0.55 ? 0.82 : 0.3;
  const destaque = destaqueVivo(matizesDoDestaque(ctx.h0, ctx.b, [180, 210, 150, 240, 120]), dominante, [apoio, neutros.tinta], lAlvo, ctx.b.evitar ?? [], 0.1, preferidosDoDestaque(ctx.h0, ctx.b).length);
  const cores = [
    cor("dominante", dominante, neutros, dominante === ctx.fixa ? "É a cor que a marca já tem: ocupando as áreas grandes, ela vira a marca inteira." : "A cor da marca em área grande: presença forte e reconhecimento rápido no feed.", dominante === ctx.fixa),
    cor("apoio", apoio, neutros, apoio === ctx.fixa ? "É a cor que a marca já tem: neutra, ela segura o texto e os cartões ao lado da cor forte." : "Quase branco para o texto e os cartões: equilibra a cor forte e dá leitura.", apoio === ctx.fixa),
    cor("destaque", destaque, neutros, "O oposto do círculo, longe no claro e escuro: o botão fica impossível de ignorar.", false),
  ];
  return montar("cor", "complementar", cores, ctx, "A cor da marca em primeiro plano");
}

function montar(estrutura: Estrutura, harmonia: Harmonia, coresBase: CorDaProposta[], ctx: Contexto, frase: string): Proposta {
  let cores = coresBase;
  const quantas = Math.max(1, Math.min(4, Math.round(ctx.b.quantas ?? 3)));
  if (quantas === 1) {
    // Uma cor: o apoio vira tom da própria cor e o destaque continua (o botão precisa de cor).
    cores = cores.map((c) => (c.papel === "apoio" && !c.fixa ? cor("apoio", oklchParaHex({ ...hexParaOklch(c.hex), h: ctx.h0 }), ctx.neutros, "Tom da mesma cor: uma marca de cor única, com variação de claro e escuro.") : c));
  }
  if (quantas >= 4) {
    const des = cores.find((c) => c.papel === "destaque")!;
    const od = hexParaOklch(des.hex);
    const extra = oklchParaHex({ l: Math.min(0.85, Math.max(0.45, od.l)), c: od.c * 0.7, h: (od.h + 40) % 360 });
    cores = [...cores, cor("extra", extra, ctx.neutros, "Vizinha do destaque, mais calma: para gráfico, ilustração e estados.")];
  }
  const dom = cores.find((c) => c.papel === "dominante")!;
  const des = cores.find((c) => c.papel === "destaque");
  const p = {
    id: `${estrutura}-${ctx.variacao}`,
    estrutura,
    harmonia,
    titulo: `${dom.nome} e ${des ? des.nome : cores[1].nome}`,
    frase,
    cores,
    neutros: ctx.neutros,
    etiquetas: etiquetasDe(cores),
    orientacoes: [] as string[],
    diagnostico: "",
  };
  p.orientacoes = orientacoesDe(p, ctx.b);
  p.diagnostico = diagnosticoDaRegra(p, ctx.b);
  return p;
}

const ESTRUTURAS: Array<(ctx: Contexto) => Proposta> = [estruturaClara, estruturaProfunda, estruturaDeCor];

/** A estrutura que melhor recebe a cor fixa (clara vai bem na base clara; escura, na profunda). */
function ordemDasEstruturas(fixa: string | null, b: Briefing): number[] {
  if (fixa) {
    const o = hexParaOklch(fixa);
    if (o.l >= 0.88) return [0, 1, 2];
    if (o.l <= 0.4) return [1, 0, 2];
    return [2, 0, 1];
  }
  const p = b.preco ?? "intermediario";
  if (p === "luxo" || p === "premium") return [1, 0, 2];
  if (p === "acessivel") return [2, 0, 1];
  return [0, 2, 1];
}

export type ResultadoDoMotor = { propostas: Proposta[]; nicho: Nicho | null; matiz: number };

/**
 * As três propostas, a recomendada primeiro. `variacao` gira o matiz do
 * nicho e a ordem dos destaques ("Novo conjunto de 3").
 */
export function gerarPropostas(b: Briefing, variacao = 0): ResultadoDoMotor {
  const nicho = nichoPorTexto(b.nicho) ?? nichoPorTexto(b.subnicho) ?? nichoPorTexto(b.oferta);
  const fixa = hexValido(b.corPrincipal);
  const h0 = matizDaMarca(b, nicho, variacao);
  const aquecer = quente(b);
  const ctx: Contexto = { b, h0, fixa, k: fatorDeCroma(b), aquecer, neutros: neutrosDe(h0, aquecer), variacao };
  const propostas = ordemDasEstruturas(fixa, b).map((i) => ESTRUTURAS[i](ctx));
  return { propostas, nicho, matiz: h0 };
}

/** Uma alternativa nova, diferente das que já existem (ΔE mínimo 0,07 entre propostas). */
export function novaAlternativa(b: Briefing, existentes: Proposta[], semente: number): Proposta {
  for (let v = semente; v < semente + 12; v++) {
    const r = gerarPropostas(b, v);
    for (const p of r.propostas) {
      if (existentes.every((e) => distanciaEntrePropostas(e, p) >= 0.07)) return { ...p, id: `${p.estrutura}-${v}-n` };
    }
  }
  const r = gerarPropostas(b, semente + 1);
  return { ...r.propostas[0], id: `${r.propostas[0].estrutura}-${semente}-n` };
}

/** Distância entre duas propostas: média do ΔE entre as cores do mesmo papel. */
export function distanciaEntrePropostas(a: Proposta, b: Proposta): number {
  const papeis: PapelNaProposta[] = ["dominante", "apoio", "destaque"];
  let s = 0;
  let n = 0;
  for (const p of papeis) {
    const x = a.cores.find((c) => c.papel === p);
    const y = b.cores.find((c) => c.papel === p);
    if (x && y) { s += distancia(x.hex, y.hex); n += 1; }
  }
  return n ? s / n : 0;
}

/** Recalcula nome, texto, etiquetas e orientações depois que a equipe troca uma cor ou um papel. */
export function recalcular(p: Proposta, b: Briefing, trocas: Partial<Record<PapelNaProposta, string>> = {}, manterNome = false): Proposta {
  const cores = p.cores.map((c) => {
    const novo = hexValido(trocas[c.papel]) ?? c.hex;
    const t = textoSobreACor(novo, p.neutros);
    return { ...c, hex: novo, nome: manterNome || novo === c.hex ? c.nome : nomeDaCor(novo), texto: t.hex, razaoTexto: Math.round(t.razao * 100) / 100 };
  });
  const q = { ...p, cores, etiquetas: etiquetasDe(cores) };
  q.orientacoes = orientacoesDe(q, b);
  return q;
}

/** Troca os papéis de duas cores (ex.: a dominante vira apoio e vice-versa). */
export function trocarPapeis(p: Proposta, b: Briefing, a: PapelNaProposta, c: PapelNaProposta): Proposta {
  const x = p.cores.find((k) => k.papel === a);
  const y = p.cores.find((k) => k.papel === c);
  if (!x || !y) return p;
  const cores = p.cores.map((k) => (k.papel === a ? { ...y, papel: a, uso: USO[a] } : k.papel === c ? { ...x, papel: c, uso: USO[c] } : k));
  return recalcular({ ...p, cores }, b, {}, true);
}

// ------------------------------------------------------------------ conferências

export type Conferencia = { id: string; titulo: string; ok: boolean; detalhe: string };

export function conferir(propostas: Proposta[], b: Briefing): Conferencia[] {
  const todas = propostas.flatMap((p) => p.cores);
  const fixa = hexValido(b.corPrincipal);
  const r: Conferencia[] = [];
  const invalidas = todas.filter((c) => !hexValido(c.hex));
  r.push({ id: "hex", titulo: "Códigos de cor válidos", ok: invalidas.length === 0, detalhe: invalidas.length ? `${invalidas.length} cor(es) fora do formato #RRGGBB.` : `${todas.length} cores no formato #RRGGBB.` });
  const proibidas = todas.map((c) => ({ c, motivo: corProibida(c.hex, b.evitar) })).filter((x) => x.motivo);
  r.push({ id: "proibidas", titulo: "Cores a evitar", ok: proibidas.length === 0, detalhe: !(b.evitar ?? []).length ? "Nenhuma cor proibida no briefing." : proibidas.length ? `${proibidas.map((x) => `${x.c.nome} (${x.motivo})`).join(", ")} caiu numa família proibida.` : `Nenhuma cor da família ${(b.evitar ?? []).join(", ")}.` });
  if (fixa) {
    const semFixa = propostas.filter((p) => !p.cores.some((c) => c.hex === fixa));
    r.push({ id: "fixa", titulo: "Cor da marca presente", ok: semFixa.length === 0, detalhe: semFixa.length ? `${semFixa.length} proposta(s) sem ${fixa}.` : `${fixa} está exata nas ${propostas.length} propostas.` });
  }
  const duplicadas = propostas.filter((p) => p.cores.some((x, i) => p.cores.some((y, j) => j > i && distancia(x.hex, y.hex) < 0.08)));
  r.push({ id: "duplicadas", titulo: "Cores bem separadas", ok: duplicadas.length === 0, detalhe: duplicadas.length ? `${duplicadas.map((p) => p.titulo).join(", ")} tem duas cores quase iguais.` : "Dentro de cada proposta, nenhuma cor repete a outra." });
  let menor = Infinity;
  for (let i = 0; i < propostas.length; i++) for (let j = i + 1; j < propostas.length; j++) menor = Math.min(menor, distanciaEntrePropostas(propostas[i], propostas[j]));
  if (propostas.length > 1) r.push({ id: "distintas", titulo: "Propostas diferentes de verdade", ok: menor >= 0.07, detalhe: `Menor distância entre propostas: ΔE ${menor.toFixed(3)} (mínimo 0,070).` });
  const semTexto = todas.filter((c) => c.razaoTexto < 4.5);
  r.push({ id: "texto", titulo: "Texto legível em toda cor (WCAG AA)", ok: semTexto.length === 0, detalhe: semTexto.length ? `${semTexto.map((c) => c.nome).join(", ")} não chega a 4,5:1 com nenhum texto.` : "Toda cor tem um texto com 4,5:1 ou mais." });
  const fracos = propostas.filter((p) => {
    const d = p.cores.find((c) => c.papel === "destaque");
    const m = p.cores.find((c) => c.papel === "dominante");
    return !d || !m || contraste(d.hex, m.hex) < 3;
  });
  r.push({ id: "destaque_salta", titulo: "Botão salta da dominante (3:1)", ok: fracos.length === 0, detalhe: fracos.length ? `${fracos.map((p) => p.titulo).join(", ")}: o destaque some no fundo.` : "Em todas, o destaque passa de 3:1 contra a dominante (WCAG 1.4.11)." });
  const apagados = propostas.filter((p) => {
    const d = p.cores.find((c) => c.papel === "destaque");
    return !d || hexParaOklch(d.hex).c < 0.08;
  });
  r.push({ id: "destaque_vivo", titulo: "Destaque forte de verdade", ok: apagados.length === 0, detalhe: apagados.length ? `${apagados.map((p) => p.titulo).join(", ")}: o destaque é apagado demais para um botão.` : "Todo destaque tem croma de cor viva, não de fundo." });
  const daltonicos = propostas.filter((p) => {
    const d = p.cores.find((c) => c.papel === "destaque");
    const m = p.cores.find((c) => c.papel === "dominante");
    if (!d || !m) return false;
    return (["protanopia", "deuteranopia", "tritanopia"] as const).some((t) => distancia(simularDaltonismo(d.hex, t), simularDaltonismo(m.hex, t)) < 0.1);
  });
  r.push({ id: "daltonismo", titulo: "Botão visível para daltônicos", ok: daltonicos.length === 0, detalhe: daltonicos.length ? `${daltonicos.map((p) => p.titulo).join(", ")}: em algum tipo de daltonismo o botão se confunde com o fundo.` : "Simulado em protanopia, deuteranopia e tritanopia: o botão continua separado do fundo." });
  return r;
}
