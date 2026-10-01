/**
 * Ajustes do estúdio de mockups (frente MCK, rodada 2): o geral vale para o lote inteiro e cada
 * mockup pode ter os seus (cor, posição, escala, giro, versão da logo, padrão, luz e fundo da
 * cena). Tudo puro: a tela guarda, o render lê, o teste confere.
 */

export type VarianteForcada = "auto" | "original" | "branca" | "preta";
export type ModoDaArte = "logo" | "padrao";
export type TipoDeFundoDaCena = "original" | "cor" | "degrade" | "textura";

export interface AjustesDoMockup {
  /** Índice da cor de fundo da arte na paleta. */
  fundo: number;
  /** Índice da segunda cor (verso, timbrado). */
  segunda: number;
  /** Tamanho da logo (0 = automático pelo papel do slot). */
  escala: number;
  /** Deslocamento da logo dentro da área segura: -1 (esquerda/topo) a 1 (direita/base). */
  posicaoX: number;
  posicaoY: number;
  /** Giro da logo em graus (-180 a 180). */
  rotacao: number;
  variante: VarianteForcada;
  modo: ModoDaArte;
  /** Luz da cena sobre a marca: 0 chapado, 1 como no mockup, 1,5 mais contraste. */
  luz: number;
  /** Brilho da marca (0,6 a 1,4). */
  brilho: number;
  /** Fundo da cena (só nos mockups com fundo trocável). */
  fundoCena: TipoDeFundoDaCena;
  /** Índice da cor do fundo da cena na paleta. */
  corDoFundoCena: number;
  /** Textura e desgaste (a textura é escolhida no geral). */
  textura: string;
  opacidade: number;
  desgaste: number;
}

export const AJUSTES_PADRAO: AjustesDoMockup = {
  fundo: 0,
  segunda: 1,
  escala: 0,
  posicaoX: 0,
  posicaoY: 0,
  rotacao: 0,
  variante: "auto",
  modo: "logo",
  luz: 1,
  brilho: 1,
  fundoCena: "original",
  corDoFundoCena: 0,
  textura: "",
  opacidade: 0.3,
  desgaste: 0,
};

const VARIANTES: VarianteForcada[] = ["auto", "original", "branca", "preta"];
const MODOS: ModoDaArte[] = ["logo", "padrao"];
const FUNDOS: TipoDeFundoDaCena[] = ["original", "cor", "degrade", "textura"];

function numero(v: unknown, min: number, max: number, padrao: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : padrao;
}

function inteiro(v: unknown, padrao: number): number {
  const n = numero(v, 0, 99, padrao);
  return Math.round(n);
}

/** Lê ajustes guardados (localStorage, config antiga) sem confiar em nada: o que falta vem do padrão. */
export function normalizarAjustes(v: unknown, base: AjustesDoMockup = AJUSTES_PADRAO): AjustesDoMockup {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return {
    fundo: inteiro(o.fundo, base.fundo),
    segunda: inteiro(o.segunda, base.segunda),
    escala: numero(o.escala, 0, 1, base.escala),
    posicaoX: numero(o.posicaoX, -1, 1, base.posicaoX),
    posicaoY: numero(o.posicaoY, -1, 1, base.posicaoY),
    rotacao: numero(o.rotacao, -180, 180, base.rotacao),
    variante: VARIANTES.indexOf(o.variante as VarianteForcada) >= 0 ? (o.variante as VarianteForcada) : base.variante,
    modo: MODOS.indexOf(o.modo as ModoDaArte) >= 0 ? (o.modo as ModoDaArte) : base.modo,
    luz: numero(o.luz, 0, 1.5, base.luz),
    brilho: numero(o.brilho, 0.6, 1.4, base.brilho),
    fundoCena: FUNDOS.indexOf(o.fundoCena as TipoDeFundoDaCena) >= 0 ? (o.fundoCena as TipoDeFundoDaCena) : base.fundoCena,
    corDoFundoCena: inteiro(o.corDoFundoCena, base.corDoFundoCena),
    textura: typeof o.textura === "string" ? o.textura.slice(0, 120) : base.textura,
    opacidade: numero(o.opacidade, 0, 0.8, base.opacidade),
    desgaste: numero(o.desgaste, 0, 0.8, base.desgaste),
  };
}

/** Só o que um mockup muda em relação ao geral (o que não está aqui segue o geral). */
export type AjustesProprios = Partial<AjustesDoMockup>;

/** O que vale para um mockup: o geral com os ajustes dele por cima. */
export function ajustesDoItem(geral: AjustesDoMockup, proprios: AjustesProprios | null | undefined): AjustesDoMockup {
  if (!proprios) return geral;
  return normalizarAjustes({ ...geral, ...proprios }, geral);
}

/** Limpa os ajustes próprios: guarda só o que difere do geral (ajuste igual ao geral some). */
export function soOQueMuda(geral: AjustesDoMockup, item: AjustesDoMockup): AjustesProprios {
  const out: AjustesProprios = {};
  (Object.keys(item) as Array<keyof AjustesDoMockup>).forEach((k) => {
    if (item[k] !== geral[k]) (out as Record<string, unknown>)[k] = item[k];
  });
  return out;
}

/** Chave estável do que muda a imagem (o render pula o mockup que não mudou). */
export function chaveDosAjustes(a: AjustesDoMockup, extra = ""): string {
  return [a.fundo, a.segunda, a.escala, a.posicaoX, a.posicaoY, a.rotacao, a.variante, a.modo, a.luz, a.brilho, a.fundoCena, a.corDoFundoCena, a.textura, a.opacidade, a.desgaste, extra].join("|");
}

/** As 9 posições rápidas (centro, cantos e meios) dentro da área segura. */
export const ANCORAS: Array<{ id: string; rotulo: string; x: number; y: number }> = [
  { id: "sup-esq", rotulo: "Em cima, à esquerda", x: -1, y: -1 },
  { id: "sup", rotulo: "Em cima, no meio", x: 0, y: -1 },
  { id: "sup-dir", rotulo: "Em cima, à direita", x: 1, y: -1 },
  { id: "esq", rotulo: "No meio, à esquerda", x: -1, y: 0 },
  { id: "centro", rotulo: "No centro", x: 0, y: 0 },
  { id: "dir", rotulo: "No meio, à direita", x: 1, y: 0 },
  { id: "inf-esq", rotulo: "Embaixo, à esquerda", x: -1, y: 1 },
  { id: "inf", rotulo: "Embaixo, no meio", x: 0, y: 1 },
  { id: "inf-dir", rotulo: "Embaixo, à direita", x: 1, y: 1 },
];

/**
 * Variações de cor para comparar lado a lado: pares (fundo, segunda) com cores diferentes, das
 * primeiras cores da paleta para as outras. Paleta de uma cor: só ela. Até `maximo`.
 */
export function variacoesDeCor(totalDeCores: number, maximo = 8): Array<{ fundo: number; segunda: number }> {
  const n = Math.max(0, Math.floor(totalDeCores));
  if (n <= 1) return [{ fundo: 0, segunda: 0 }];
  const out: Array<{ fundo: number; segunda: number }> = [];
  for (let passo = 1; passo < n && out.length < maximo; passo++) {
    for (let i = 0; i < n && out.length < maximo; i++) {
      const j = (i + passo) % n;
      if (!out.some((v) => v.fundo === i && v.segunda === j)) out.push({ fundo: i, segunda: j });
    }
  }
  return out.slice(0, maximo);
}

/** Nome da variação para a tela ("Fundo #1a1a1a, verso #ffffff"). */
export function rotuloDaVariacao(cores: string[], v: { fundo: number; segunda: number }): string {
  const c = (i: number) => cores[i % Math.max(1, cores.length)] || "";
  return `Fundo ${c(v.fundo)}, segunda ${c(v.segunda)}`;
}
