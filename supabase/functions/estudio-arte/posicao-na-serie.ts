/**
 * Posição do texto que varia na série (frente R5, 26/09/2026).
 *
 * Dono: "ajuda na continuação e dinâmica do carrossel, pra não ficar sempre
 * fixo de um lado, na mesma coisa". No modo normal (sem referência, foto,
 * recorte nem fundo contínuo; fora do anúncio), a zona do texto
 * (layout.zona_texto e alinhamento) roda entre as lâminas: nenhuma lâmina
 * repete a zona nem o eixo da anterior (esquerda, direita, topo, base,
 * centro, dividido), o mesmo lado não aparece três vezes seguidas e o eixo
 * menos usado na série vem primeiro. A continuidade vem da identidade da
 * série (R4) e da tipografia (T2), não da posição.
 *
 * Respeita o que a imagem pede: a descrição da imagem e do ponto focal diz de
 * que lado fica o assunto ("metade direita", "dois terços de cima"); o texto
 * fica do outro lado. Para trocar de lado, a descrição é espelhada junto
 * (direita vira esquerda, cima vira baixo), então imagem e texto nunca se
 * sobrepõem. Descrição ambígua: a zona fica.
 *
 * Ficam como estão: a capa (âncora), o fechamento, a lâmina com foto,
 * elemento ou referência própria, o contínuo, o anúncio, carrossel de 2 e a
 * lâmina já decidida (posicao_na_serie gravada). O plano é feito sobre a
 * direção inteira, na ordem, em código e sem custo: lâminas geradas em
 * paralelo chegam ao mesmo resultado. Com referência vale a regra da R3 por
 * nível (este módulo nem é chamado).
 */

import type { FormatoCriativo, FormatoDoPost, LayoutLamina, ZonaTexto } from "../_shared/direcao-arte.ts";
import { caixaDaZona, normalizarLayout, resumoDaComposicao } from "../_shared/direcao-arte.ts";

export type Eixo = "esquerda" | "direita" | "topo" | "base" | "centro" | "dividido";
export type Lado = "esquerda" | "centro" | "direita";
type Alinhamento = LayoutLamina["alinhamento"];

export type OpcaoDePosicao = { zona: ZonaTexto; alinhamento: Alinhamento; eixo: Eixo; lado: Lado; dividido: boolean };

/** Posições que a série pode usar, na ordem de desempate. "Dividido": título no alto e o texto na faixa de baixo. */
export const OPCOES_DE_POSICAO: OpcaoDePosicao[] = [
  { zona: "coluna-esquerda", alinhamento: "esquerda", eixo: "esquerda", lado: "esquerda", dividido: false },
  { zona: "centro-esquerda", alinhamento: "esquerda", eixo: "esquerda", lado: "esquerda", dividido: false },
  { zona: "topo-esquerda", alinhamento: "esquerda", eixo: "topo", lado: "esquerda", dividido: false },
  { zona: "topo-centro", alinhamento: "centro", eixo: "topo", lado: "centro", dividido: false },
  { zona: "coluna-direita", alinhamento: "esquerda", eixo: "direita", lado: "direita", dividido: false },
  { zona: "base-direita", alinhamento: "direita", eixo: "base", lado: "direita", dividido: false },
  { zona: "base-esquerda", alinhamento: "esquerda", eixo: "base", lado: "esquerda", dividido: false },
  { zona: "base-centro", alinhamento: "centro", eixo: "base", lado: "centro", dividido: false },
  { zona: "centro", alinhamento: "centro", eixo: "centro", lado: "centro", dividido: false },
  { zona: "topo-centro", alinhamento: "centro", eixo: "dividido", lado: "centro", dividido: true },
];

export function eixoDaZona(zona: ZonaTexto, dividido = false): Eixo {
  if (dividido) return "dividido";
  if (zona === "coluna-esquerda" || zona === "centro-esquerda") return "esquerda";
  if (zona === "coluna-direita") return "direita";
  if (zona === "topo-esquerda" || zona === "topo-centro") return "topo";
  if (zona === "centro") return "centro";
  return "base";
}

export function ladoDaZona(zona: ZonaTexto): Lado {
  if (zona === "coluna-esquerda" || zona === "centro-esquerda" || zona === "topo-esquerda" || zona === "base-esquerda") return "esquerda";
  if (zona === "coluna-direita" || zona === "base-direita") return "direita";
  return "centro";
}

// ------------------------------------------------------------------ o que a imagem pede

export type LadoDaImagem = "esquerda" | "direita" | "topo" | "base" | "ambiguo" | null;

const semAcento = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const FALA_DO_TEXTO = /\b(headline|titulo|texto|textos|copy|frase|legenda|cta|chamada|apoio)\b/;

/**
 * De que lado fica o assunto, pela descrição da imagem e do ponto focal. As
 * orações que falam do texto ("headline no topo") não contam. Dois lados
 * diferentes: ambíguo (a zona fica).
 */
export function ladoDaImagem(layout: { imagem?: string | null; ponto_focal?: string | null } | null | undefined): LadoDaImagem {
  if (!layout) return null;
  const oracoes = semAcento(`${layout.imagem || ""}. ${layout.ponto_focal || ""}`).split(/[.;,]|\s+e\s+|\s+com\s+/);
  const lados: LadoDaImagem[] = [];
  const pus = (l: LadoDaImagem) => {
    if (lados.indexOf(l) < 0) lados.push(l);
  };
  for (const o of oracoes) {
    if (!o.trim() || FALA_DO_TEXTO.test(o)) continue;
    if (/\bdireit[ao]s?\b/.test(o)) pus("direita");
    if (/\besquerd[ao]s?\b/.test(o)) pus("esquerda");
    if (/\b(inferior|inferiores|embaixo|de baixo|na base|da base)\b/.test(o)) pus("base");
    if (/\b(superior|superiores|no alto|em cima|de cima|no topo|do topo)\b/.test(o)) pus("topo");
  }
  if (!lados.length) return null;
  return lados.length === 1 ? lados[0] : "ambiguo";
}

/** A posição deixa o texto fora do lado do assunto? */
export function compativel(op: OpcaoDePosicao, lado: LadoDaImagem): boolean {
  switch (lado) {
    case null:
      return true;
    case "direita":
      return op.zona === "coluna-esquerda" || op.zona === "centro-esquerda";
    case "esquerda":
      return op.zona === "coluna-direita";
    case "base":
      return op.eixo === "topo";
    case "topo":
      return op.eixo === "base";
    default:
      return false;
  }
}

export type Espelho = "h" | "v";

const ESPELHOS: Record<Espelho, [string, string][]> = {
  h: [["direita", "esquerda"], ["esquerda", "direita"], ["direito", "esquerdo"], ["esquerdo", "direito"], ["direitas", "esquerdas"], ["esquerdas", "direitas"], ["direitos", "esquerdos"], ["esquerdos", "direitos"]],
  v: [
    ["superior", "inferior"], ["inferior", "superior"], ["superiores", "inferiores"], ["inferiores", "superiores"],
    ["de cima", "de baixo"], ["de baixo", "de cima"], ["em cima", "embaixo"], ["embaixo", "em cima"],
    ["no topo", "na base"], ["na base", "no topo"], ["do topo", "da base"], ["da base", "do topo"], ["no alto", "embaixo"],
  ],
};

const LETRA = "A-Za-zÀ-ÖØ-öø-ÿ";

/** Espelha as palavras de lado de uma descrição (direita e esquerda; cima e baixo), mantendo a maiúscula. */
export function espelharTexto(t: string, sentido: Espelho): string {
  const pares = ESPELHOS[sentido].slice().sort((a, b) => b[0].length - a[0].length);
  const mapa: Record<string, string> = {};
  pares.forEach(([de, para]) => {
    mapa[de] = para;
  });
  const re = new RegExp(`(^|[^${LETRA}])(${pares.map((p) => p[0]).join("|")})(?=[^${LETRA}]|$)`, "gi");
  return String(t || "").replace(re, (_m, antes: string, palavra: string) => {
    const troca = mapa[palavra.toLowerCase()] || palavra;
    return antes + (palavra[0] === palavra[0].toUpperCase() ? troca[0].toUpperCase() + troca.slice(1) : troca);
  });
}

const espelharLado = (l: LadoDaImagem, s: Espelho): LadoDaImagem =>
  s === "h" ? (l === "direita" ? "esquerda" : l === "esquerda" ? "direita" : l) : l === "topo" ? "base" : l === "base" ? "topo" : l;

// ------------------------------------------------------------------ plano da série

export type LaminaDaSerie = {
  ordem: number;
  funcao?: string | null;
  layout?: Partial<LayoutLamina> | null;
  imagens_ids?: string[] | null;
  fotos_livres?: unknown[] | null;
  referencias_ids?: string[] | null;
  posicao_na_serie?: unknown;
};

export type RegistroDaPosicao = {
  versao: number;
  zona: ZonaTexto;
  alinhamento: Alinhamento;
  eixo: Eixo;
  dividido: boolean;
  espelho: Espelho | null;
  de: { zona: ZonaTexto; alinhamento: Alinhamento };
};

export const VERSAO_DA_POSICAO = 1;

export function posicaoGravada(c: { posicao_na_serie?: unknown } | null | undefined): RegistroDaPosicao | null {
  const p = c && c.posicao_na_serie;
  if (!p || typeof p !== "object") return null;
  const r = p as Record<string, unknown>;
  return typeof r.zona === "string" ? r as unknown as RegistroDaPosicao : null;
}

export type PosicaoPlanejada = OpcaoDePosicao & {
  ordem: number;
  espelho: Espelho | null;
  /** Fica como está (capa, fechamento, foto, referência própria, já decidida, contínuo, anúncio). */
  fixa: boolean;
  /** A zona, o alinhamento ou o arranjo mudou em relação à direção. */
  mudou: boolean;
  de: { zona: ZonaTexto; alinhamento: Alinhamento };
};

const temFotoOuReferencia = (c: LaminaDaSerie) =>
  (c.imagens_ids || []).length > 0 || (c.fotos_livres || []).length > 0 || (c.referencias_ids || []).length > 0;

/**
 * Plano de posições da série inteira, na ordem. Para cada lâmina que pode
 * variar: a posição compatível com a imagem (ou espelhada) que não repete a
 * zona nem o eixo da anterior nem os da seguinte quando ela está fixa, sem o
 * mesmo lado três vezes, preferindo o eixo e o lado menos usados, a posição
 * da direção e a que não precisa espelhar. Determinístico.
 */
export function planoDePosicoes(cards: LaminaDaSerie[] | null | undefined, e: { continuo?: boolean; ads?: boolean } = {}): PosicaoPlanejada[] {
  const lista = (cards || []).filter((c) => c && Number.isFinite(Number(c.ordem))).slice().sort((a, b) => Number(a.ordem) - Number(b.ordem));
  const total = lista.length;
  const base = lista.map((c) => {
    const funcao = String(c.funcao || "conteudo");
    const layout = normalizarLayout(c.layout, funcao, c.ordem, total);
    const gravada = posicaoGravada(c);
    const dividido = !!(gravada && gravada.dividido && gravada.zona === layout.zona_texto);
    const fixa = !!e.ads || !!e.continuo || total < 3 || c.ordem === 1 || c.ordem === total || funcao === "capa" || funcao === "cta" || temFotoOuReferencia(c) || !!gravada;
    const atual: PosicaoPlanejada = {
      ordem: c.ordem,
      zona: layout.zona_texto,
      alinhamento: layout.alinhamento,
      eixo: eixoDaZona(layout.zona_texto, dividido),
      lado: ladoDaZona(layout.zona_texto),
      dividido,
      espelho: null,
      fixa,
      mudou: false,
      de: { zona: layout.zona_texto, alinhamento: layout.alinhamento },
    };
    return { c, layout, atual };
  });
  const saida: PosicaoPlanejada[] = [];
  const usosDoEixo: Record<string, number> = {};
  const usosDoLado: Record<string, number> = {};
  for (let i = 0; i < base.length; i++) {
    const { layout, atual } = base[i];
    const prev = saida[i - 1] || null;
    const prev2 = saida[i - 2] || null;
    const seguinte = base[i + 1] && base[i + 1].atual.fixa ? base[i + 1].atual : null;
    let escolhida = atual;
    if (!atual.fixa) {
      const lado = ladoDaImagem(layout);
      type Candidata = OpcaoDePosicao & { espelho: Espelho | null; daDirecao: boolean };
      const candidatas: Candidata[] = [{ zona: atual.zona, alinhamento: atual.alinhamento, eixo: atual.eixo, lado: atual.lado, dividido: false, espelho: null, daDirecao: true }];
      if (lado !== "ambiguo") {
        for (const op of OPCOES_DE_POSICAO) {
          if (op.dividido && lado !== null) continue;
          let espelho: Espelho | null = null;
          if (!compativel(op, lado)) {
            const s: Espelho | null = lado === "direita" || lado === "esquerda" ? "h" : lado === "topo" || lado === "base" ? "v" : null;
            if (!s || !compativel(op, espelharLado(lado, s))) continue;
            espelho = s;
          }
          if (candidatas.some((x) => x.zona === op.zona && x.alinhamento === op.alinhamento && x.dividido === op.dividido)) continue;
          candidatas.push({ ...op, espelho, daDirecao: false });
        }
      }
      const regras: ((x: Candidata) => boolean)[] = [
        (x) => !prev || (x.zona !== prev.zona && x.eixo !== prev.eixo),
        (x) => !seguinte || (x.zona !== seguinte.zona && x.eixo !== seguinte.eixo),
        (x) => !(prev && prev2 && x.lado !== "centro" && x.lado === prev.lado && prev.lado === prev2.lado),
      ];
      // Regras duras, soltas da última para a primeira quando nenhuma candidata passa.
      let validas: Candidata[] = [];
      for (let n = regras.length; n >= 0 && !validas.length; n--) validas = candidatas.filter((x) => regras.slice(0, n).every((r) => r(x)));
      if (!validas.length) validas = candidatas.filter((x) => !prev || x.zona !== prev.zona);
      if (!validas.length) validas = candidatas;
      const nota = (x: Candidata) =>
        (prev && x.lado !== "centro" && x.lado === prev.lado ? 2 : 0) +
        1.5 * (usosDoEixo[x.eixo] || 0) +
        0.5 * (usosDoLado[x.lado] || 0) +
        (x.espelho ? 1 : 0) +
        (x.dividido ? 0.5 : 0) -
        (x.daDirecao ? 1.5 : 0) -
        (x.eixo === atual.eixo ? 0.25 : 0);
      const melhor = validas.reduce((a, b) => (nota(b) < nota(a) - 1e-9 ? b : a));
      escolhida = {
        ...atual,
        zona: melhor.zona,
        alinhamento: melhor.alinhamento,
        eixo: melhor.eixo,
        lado: melhor.lado,
        dividido: melhor.dividido,
        espelho: melhor.espelho,
        mudou: melhor.zona !== atual.zona || melhor.alinhamento !== atual.alinhamento || melhor.dividido,
      };
    }
    usosDoEixo[escolhida.eixo] = (usosDoEixo[escolhida.eixo] || 0) + 1;
    usosDoLado[escolhida.lado] = (usosDoLado[escolhida.lado] || 0) + 1;
    saida.push(escolhida);
  }
  return saida;
}

type CardComLayout = LaminaDaSerie & { layout?: Partial<LayoutLamina> | null; ilustracao?: string; composicao?: string; [k: string]: unknown };

/**
 * A lâmina com a posição do plano: zona e alinhamento novos, a descrição da
 * imagem e do ponto focal espelhadas quando trocou de lado, o resumo da
 * composição refeito e o registro (posicao_na_serie) que fixa a decisão.
 */
export function aplicarPosicao<C extends CardComLayout>(card: C, p: PosicaoPlanejada, total: number): C {
  const funcao = String(card.funcao || "conteudo");
  const atual = normalizarLayout(card.layout, funcao, card.ordem, total);
  const espelhar = (t: string | undefined) => (p.espelho && t ? espelharTexto(t, p.espelho) : t);
  const layout = {
    ...(card.layout || atual),
    zona_texto: p.zona,
    alinhamento: p.alinhamento,
    imagem: espelhar(atual.imagem) || atual.imagem,
    ponto_focal: espelhar(atual.ponto_focal) || atual.ponto_focal,
  } as LayoutLamina;
  const registro: RegistroDaPosicao = {
    versao: VERSAO_DA_POSICAO,
    zona: p.zona,
    alinhamento: p.alinhamento,
    eixo: p.eixo,
    dividido: p.dividido,
    espelho: p.espelho,
    de: { zona: atual.zona_texto, alinhamento: atual.alinhamento },
  };
  return {
    ...card,
    layout,
    ...(typeof card.ilustracao === "string" ? { ilustracao: espelhar(card.ilustracao) } : {}),
    composicao: resumoDaComposicao(normalizarLayout(layout, funcao, card.ordem, total)),
    posicao_na_serie: registro,
  };
}

/** Zona a mais da área do texto (máscara da correção): no arranjo dividido, a faixa de baixo. */
export function zonaExtraDoTexto(card: { posicao_na_serie?: unknown; layout?: { zona_texto?: string } | null } | null | undefined): ZonaTexto | null {
  const p = posicaoGravada(card);
  return p && p.dividido && card && card.layout && card.layout.zona_texto === p.zona ? "base-centro" : null;
}

const pct = (v: number) => `${Math.round(v)}%`;

/**
 * Bloco do arranjo dividido: o título fica na área do texto (no alto) e o
 * apoio ou as partes descem para a faixa de baixo; a imagem ou o respiro fica
 * no meio. Vale sobre "headline e apoio formam um grupo".
 */
export function blocoDoArranjoDividido(e: { ordem: number; total: number; formato?: FormatoCriativo | null; post?: FormatoDoPost | null }): string {
  const c = caixaDaZona("base-centro", false, e.total > 1, e.formato ?? null, e.post ?? null);
  return [
    `ARRANJO DIVIDIDO (lâmina ${e.ordem} de ${e.total}, a série alterna a posição do texto): o texto não fica todo num lugar só.`,
    `- O título fica na área do texto indicada acima, no alto, alinhado ao centro.`,
    `- O apoio (ou as partes do texto) desce para a faixa de baixo: de ${pct(c.x0)} a ${pct(c.x1)} da largura e de ${pct(c.y0)} a ${pct(c.y1)} da altura do quadro, no mesmo alinhamento, sem encostar nas margens.`,
    "- Entre o título e o apoio fica a imagem ou o respiro da composição; nesta lâmina o título e o apoio NÃO formam um grupo colado (isto vale sobre a distância de 16 a 32 px entre eles).",
  ].join("\n");
}
