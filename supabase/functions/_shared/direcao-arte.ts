/**
 * Compositor da direção de arte da Mesa.
 *
 * O diretor de arte (ou o roteiro do calendário, sem custo de IA) decide o
 * QUE vai em cada lâmina: blocos de texto por papel, zona do texto, imagem,
 * ponto focal, tratamento e cores. Este módulo transforma isso no prompt de
 * imagem, em código, sempre com as mesmas garantias:
 *   · posição do texto em percentuais do quadro final 4:5 (1080 x 1350),
 *     com as margens do grid; a arte é gerada direto em 4:5 e, se o
 *     provedor recusar o tamanho, em 2:3 com o quadro 4:5 no centro
 *     (formatoPara2x3);
 *   · tamanho de cada bloco pela quantidade de caracteres e pela hierarquia;
 *   · paleta da marca com hex, 60-30-10 e cor de destaque única;
 *   · fontes da marca (as amostras vão anexadas) e a tipografia citada;
 *   · logo só na capa e no final; canto superior direito livre (contador do
 *     carrossel no Instagram) e laterais da capa protegidas (recorte 3:4 da
 *     grade do perfil);
 *   · o padrão de design da base de conhecimento.
 * Assim a marca e as regras nunca ficam de fora e o diretor escreve menos.
 *
 * Criativo de anúncio (Estúdio Ads, docs/mesa-ads/SPEC.md): o card traz o
 * `formato` (feed 4:5, quadrado 1:1 ou stories 9:16) e o prompt é montado com
 * `anuncio: { formato }`: quadro e margens do formato, zona segura da Meta
 * (stories: nada nos 14% de cima e nos 20% de baixo), sem recorte da grade do
 * perfil, sem carrossel contínuo e com as regras do criativo
 * (conhecimento-ads.ts). A peça única é a capa; o carrossel de anúncio (cards
 * feed 4:5 em sequência) segue como série. Sem o formato, tudo segue
 * exatamente como no post.
 */

import { regrasDoCriativo, TAMANHO_DO_FORMATO, ZONA_SEGURA, type FormatoAds } from "./conhecimento-ads.ts";

/** Formato do criativo de anúncio (o carrossel de anúncio usa lâminas feed 4:5). */
export type FormatoCriativo = Exclude<FormatoAds, "carrossel">;
export const FORMATOS_CRIATIVO: FormatoCriativo[] = ["feed_4x5", "quadrado_1x1", "stories_9x16"];
/** Quadro final publicado por formato, em px. */
export const QUADRO_FINAL: Record<FormatoCriativo, { largura: number; altura: number }> = {
  feed_4x5: { largura: 1080, altura: 1350 },
  quadrado_1x1: { largura: 1080, altura: 1080 },
  stories_9x16: { largura: 1080, altura: 1920 },
};

/**
 * Formato do post orgânico (trabalho social), escolhido na tela para o
 * conjunto inteiro (no carrossel do Instagram todas as lâminas têm a mesma
 * proporção). Sem formato, 4:5 como sempre foi.
 *
 * 3:4 (1080 x 1440): o Instagram trocou a grade do perfil de 1:1 para 3:4 em
 * janeiro de 2025 e passou a aceitar foto 3:4 no feed em maio de 2025; é a
 * foto mais alta do feed e a única que aparece inteira na grade, sem corte.
 * Fontes consultadas em 25/09/2026: https://nealschaffer.com/instagram-post-size/
 * e https://influencermarketinghub.com/instagram-image-sizes/.
 */
export type FormatoDoPost = "feed_4x5" | "retrato_3x4" | "quadrado_1x1" | "stories_9x16";
export const FORMATOS_DO_POST: FormatoDoPost[] = ["feed_4x5", "retrato_3x4", "quadrado_1x1", "stories_9x16"];
export const FORMATO_PADRAO_DO_POST: FormatoDoPost = "feed_4x5";

/**
 * Quadro do post por formato: o final publicado e o tamanho pedido ao
 * gerador (múltiplos de 16, na mesma proporção ou a menos de 1% dela).
 */
export const QUADRO_DO_POST: Record<FormatoDoPost, {
  final: { largura: number; altura: number };
  gerador: { largura: number; altura: number };
  proporcao: string;
  rotulo: string;
}> = {
  feed_4x5: { final: { largura: 1080, altura: 1350 }, gerador: { largura: 1088, altura: 1360 }, proporcao: "4:5", rotulo: "Retrato 4:5 (1080 x 1350)" },
  retrato_3x4: { final: { largura: 1080, altura: 1440 }, gerador: { largura: 1104, altura: 1472 }, proporcao: "3:4", rotulo: "Retrato 3:4 (1080 x 1440)" },
  quadrado_1x1: { final: { largura: 1080, altura: 1080 }, gerador: { largura: 1088, altura: 1088 }, proporcao: "1:1", rotulo: "Quadrado 1:1 (1080 x 1080)" },
  stories_9x16: { final: { largura: 1080, altura: 1920 }, gerador: { largura: 1088, altura: 1920 }, proporcao: "9:16", rotulo: "Stories e Reels 9:16 (1080 x 1920)" },
};

/** Formato do post lido com cuidado (JSON do banco): o que não é conhecido vira 4:5. */
export function formatoDoPost(v: unknown): FormatoDoPost {
  return FORMATOS_DO_POST.indexOf(v as FormatoDoPost) >= 0 ? v as FormatoDoPost : FORMATO_PADRAO_DO_POST;
}

export type PapelBloco = "headline" | "subtitulo" | "apoio" | "numero" | "cta" | "selo";
export type BlocoTexto = { papel: PapelBloco; texto: string };
export type ZonaTexto =
  | "topo-esquerda" | "topo-centro" | "centro-esquerda" | "centro" | "base-esquerda" | "base-centro" | "base-direita" | "coluna-esquerda" | "coluna-direita";

export type LayoutLamina = {
  zona_texto: ZonaTexto;
  alinhamento: "esquerda" | "centro" | "direita";
  imagem: string;
  ponto_focal: string;
  fundo: string;
  tratamento: string;
  cor_fundo?: string | null;
  cor_texto?: string | null;
  cor_destaque?: string | null;
};

export type CardDirecao = {
  ordem: number;
  funcao: string;
  texto_exato: string;
  composicao: string;
  ilustracao: string;
  prompt_imagem: string;
  blocos?: BlocoTexto[];
  layout?: LayoutLamina;
  evitar?: string;
  /** Fotos reais do acervo (cliente_imagens) usadas como base desta lâmina. */
  imagens_ids?: string[];
  /** Referências escolhidas na tela para esta lâmina (sobrepõem as do conjunto; prefixo g: = banco global). */
  referencias_ids?: string[];
  /**
   * Fotos reais trazidas pela equipe (coladas, soltas ou escolhidas), no
   * bucket mesa: "fundo" é a foto de fundo da lâmina, mantida como está;
   * "elemento" é pessoa, rosto ou objeto real que entra na composição igual.
   */
  fotos_livres?: FotoLivre[];
  /** Só no trabalho de anúncio (tipo 'ads'): formato do criativo; sem ele, feed 4:5. */
  formato?: FormatoCriativo;
  /** Logo do kit escolhida para esta lâmina (sobrepõe a do conjunto); sem ela, a do conjunto ou a que contrasta. */
  logo?: EscolhaDaLogo;
};

/**
 * Qual logo do kit a lâmina usa (dono, 26/09: "escolher no kit de marca, ali
 * do lado, qual logo eu quero"): a principal, a alternativa ou "auto" (a que
 * contrasta melhor com o fundo). Na marca por projeto (Acerbi e CME) o kit já
 * vem da marca aberta (_shared/marca.ts), então só as logos dela aparecem.
 */
export type EscolhaDaLogo = "auto" | "principal" | "alternativa";
export const ESCOLHAS_DA_LOGO: EscolhaDaLogo[] = ["auto", "principal", "alternativa"];

/** Escolha lida com cuidado (JSON do banco ou da tela): o que não é conhecido vira null. */
export function escolhaDaLogo(v: unknown): EscolhaDaLogo | null {
  return ESCOLHAS_DA_LOGO.indexOf(v as EscolhaDaLogo) >= 0 ? v as EscolhaDaLogo : null;
}

/**
 * Logo da lâmina entre as do kit: a da lâmina, senão a do conjunto; "auto"
 * (ou a pedida que o kit não tem) fica com a que contrasta com o valor do
 * fundo (0 a 255: clara no escuro, escura no claro). Sem o valor do fundo, a
 * principal. Devolve null quando o kit não tem logo.
 */
export function logoDaLamina(
  logos: { id: "principal" | "alternativa"; clara: boolean | null }[],
  pedida: { lamina?: unknown; conjunto?: unknown },
  valorDoFundo: number | null,
): "principal" | "alternativa" | null {
  if (!logos.length) return null;
  const escolha = escolhaDaLogo(pedida.lamina) || escolhaDaLogo(pedida.conjunto) || "auto";
  if (escolha !== "auto" && logos.some((l) => l.id === escolha)) return escolha;
  const principal = logos.find((l) => l.id === "principal") || logos[0];
  if (valorDoFundo === null || !isFinite(valorDoFundo) || logos.length < 2) return principal.id;
  const querClara = valorDoFundo < 128;
  const contrasta = logos.find((l) => l.clara === querClara);
  return (contrasta || principal).id;
}

/** Claridade aproximada (0 a 255) de uma cor hex, para escolher a logo que contrasta sem abrir a imagem. */
export function valorDaCor(hex: string | null | undefined): number | null {
  const h = hexOk(hex);
  if (!h) return null;
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/**
 * Anexos da lâmina (dono, 26/09: "muitas alucinações nas demais lâminas"):
 * imagem demais, com legendas que puxavam para lados diferentes, fazia o
 * gerador inventar. Agora cada tipo tem teto e a chamada leva no máximo
 * MAX_ANEXOS_DA_LAMINA imagens, contando a imagem editada (foto, fatia ou
 * tela do recorte), nesta ordem de prioridade: fotos do cliente, referências
 * escolhidas pela equipe, logo, capa da série, fonte, arte da marca e selo.
 */
export type TipoDoAnexo = "foto_cliente" | "elemento" | "referencia_equipe" | "logo" | "capa" | "fonte" | "identidade" | "selo";
export const MAX_ANEXOS_DA_LAMINA = 6;
const PRIORIDADE_DO_ANEXO: Record<TipoDoAnexo, number> = {
  foto_cliente: 0,
  elemento: 1,
  referencia_equipe: 2,
  logo: 3,
  capa: 4,
  fonte: 5,
  identidade: 6,
  selo: 7,
};
const TETO_DO_TIPO: Record<TipoDoAnexo, number> = { foto_cliente: 1, elemento: 2, referencia_equipe: 2, logo: 1, capa: 1, fonte: 1, identidade: 1, selo: 1 };

/** Os anexos que entram, na ordem em que vão (a ordem da lista entre iguais é mantida). */
export function anexosDaLamina<T extends { tipo: TipoDoAnexo }>(candidatos: T[], opcoes: { base: boolean; max?: number }): T[] {
  const max = Math.max(0, (opcoes.max ?? MAX_ANEXOS_DA_LAMINA) - (opcoes.base ? 1 : 0));
  const contagem: Partial<Record<TipoDoAnexo, number>> = {};
  const ordenados = candidatos
    .map((c, i) => ({ c, i }))
    .sort((a, b) => PRIORIDADE_DO_ANEXO[a.c.tipo] - PRIORIDADE_DO_ANEXO[b.c.tipo] || a.i - b.i);
  const saida: T[] = [];
  for (const { c } of ordenados) {
    if (saida.length >= max) break;
    const n = contagem[c.tipo] || 0;
    if (n >= TETO_DO_TIPO[c.tipo]) continue;
    contagem[c.tipo] = n + 1;
    saida.push(c);
  }
  return saida;
}

export type FotoLivre = { caminho: string; papel: "fundo" | "elemento"; nota?: string; recortada?: boolean };

export type MarcaParaDirecao = {
  nomeCliente: string;
  paleta: { nome?: string; hex?: string; papel?: string }[];
  estilo: string | null;
  regras: string | null;
  fontes: { nome: string; papel: string }[];
  tipografiaCitada?: { titulo?: string | null; texto?: string | null; observacao?: string | null } | null;
  tomDeVoz?: string | null;
  temLogo: boolean;
};

const HEX = /^#[0-9a-f]{6}$/i;
const ZONAS: ZonaTexto[] = ["topo-esquerda", "topo-centro", "centro-esquerda", "centro", "base-esquerda", "base-centro", "base-direita", "coluna-esquerda", "coluna-direita"];
const PAPEIS: PapelBloco[] = ["headline", "subtitulo", "apoio", "numero", "cta", "selo"];

// Tudo em percentual do quadro final 4:5 (1080 x 1350).
const AREA = { x0: 0, x1: 100, y0: 0, y1: 100 };
const MARGEM_X = 8.3; // 90 px de 1080
const MARGEM_TOPO = 7.4; // 100 px de 1350
const MARGEM_BASE = 7.9; // 106 px de 1350
const CAPA_LATERAL_EXTRA = 3.1; // 34 px: recorte 3:4 da grade do perfil
const um = (v: number) => Math.round(v * 10) / 10;

type Caixa = { x0: number; x1: number; y0: number; y1: number };

// Contador do carrossel no Instagram: canto superior direito, x de 83,3% a 100% e y até 8,1%.
const TOPO_ABAIXO_DO_CONTADOR = 8.9;

type Margens = { x: number; topo: number; base: number; capaExtra: number };

/**
 * Margens do quadro em percentual. Sem formato: o grid do post 4:5. Com o
 * formato do anúncio: o mesmo grid (90 px nas laterais, 100 px no topo e
 * 106 px na base do quadro final) ou a zona segura do formato, o que for
 * maior; sem o recorte da grade do perfil (anúncio não aparece nela).
 */
export function margensDoQuadro(formato?: FormatoCriativo | null, post?: FormatoDoPost | null): Margens {
  if (post && post !== "feed_4x5") return margensDoPost(post);
  if (!formato) return { x: MARGEM_X, topo: MARGEM_TOPO, base: MARGEM_BASE, capaExtra: CAPA_LATERAL_EXTRA };
  const q = QUADRO_FINAL[formato];
  const z = ZONA_SEGURA[formato];
  return {
    x: um(Math.max(90 / q.largura, z.lados) * 100),
    topo: um(Math.max(100 / q.altura, z.topo) * 100),
    base: um(Math.max(106 / q.altura, z.base) * 100),
    capaExtra: 0,
  };
}

/**
 * Margens do post orgânico fora do 4:5: o mesmo grid em px (90 nas laterais,
 * 100 no topo e 106 na base do quadro final). Stories e Reels: a zona segura
 * da interface (14% em cima, 20% embaixo). Capa 1:1: a grade 3:4 do perfil
 * corta cerca de 135 px de cada lateral do quadrado; o 3:4 aparece inteiro.
 */
export function margensDoPost(post: FormatoDoPost): Margens {
  if (post === "feed_4x5") return { x: MARGEM_X, topo: MARGEM_TOPO, base: MARGEM_BASE, capaExtra: CAPA_LATERAL_EXTRA };
  const q = QUADRO_DO_POST[post].final;
  if (post === "stories_9x16") return { x: um((90 / q.largura) * 100), topo: 14, base: 20, capaExtra: 0 };
  return {
    x: um((90 / q.largura) * 100),
    topo: um((100 / q.altura) * 100),
    base: um((106 / q.altura) * 100),
    capaExtra: post === "quadrado_1x1" ? 12.5 : 0,
  };
}

export function caixaDaZona(zona: ZonaTexto, capa: boolean, carrossel = true, formato?: FormatoCriativo | null, post?: FormatoDoPost | null): Caixa {
  const m = margensDoQuadro(formato, post);
  const extra = capa ? m.capaExtra : 0;
  const esq = AREA.x0 + m.x + extra;
  const dir = AREA.x1 - m.x - extra;
  const chegaNaDireita = zona === "topo-centro" || zona === "coluna-direita";
  // O contador fica nos 110 px de cima: no 4:5 são 8,9% (valor de sempre); nos outros, pela altura.
  const abaixoDoContador = post && post !== "feed_4x5" ? um((120 / QUADRO_DO_POST[post].final.altura) * 100) : TOPO_ABAIXO_DO_CONTADOR;
  const topo = AREA.y0 + (carrossel && chegaNaDireita ? Math.max(abaixoDoContador, m.topo) : m.topo);
  const base = AREA.y1 - m.base;
  const altura = base - topo;
  const terco = um(altura / 3);
  const largura = dir - esq;
  switch (zona) {
    case "topo-esquerda": return { x0: esq, x1: esq + um(largura * 0.78), y0: topo, y1: topo + um(altura * 0.42) };
    case "topo-centro": return { x0: esq, x1: dir, y0: topo, y1: topo + um(altura * 0.4) };
    case "centro-esquerda": return { x0: esq, x1: esq + um(largura * 0.72), y0: topo + terco - 3, y1: topo + 2 * terco + 3 };
    case "centro": return { x0: esq, x1: dir, y0: topo + terco - 3, y1: topo + 2 * terco + 3 };
    case "base-esquerda": return { x0: esq, x1: esq + um(largura * 0.8), y0: base - um(altura * 0.45), y1: base };
    case "base-centro": return { x0: esq, x1: dir, y0: base - um(altura * 0.42), y1: base };
    case "base-direita": return { x0: esq + um(largura * 0.25), x1: dir, y0: base - um(altura * 0.45), y1: base };
    case "coluna-esquerda": return { x0: esq, x1: esq + um(largura * 0.5), y0: topo, y1: base };
    case "coluna-direita": return { x0: dir - um(largura * 0.5), x1: dir, y0: topo, y1: base };
  }
}

/**
 * Tamanho da letra (px numa arte de 1080 x 1350) pelo papel e pela quantidade
 * de caracteres, pela base de conhecimento: headline de capa 108 a 160 px e
 * de miolo 108 a 140 px, sempre pelo menos 3 vezes o apoio (36 a 44 px);
 * subtítulo é nível 2, como o apoio; nada abaixo de 28 px.
 */
export function tamanhoDoBloco(b: BlocoTexto, capa: boolean): { px: number; peso: string } {
  const n = b.texto.replace(/\s+/g, " ").trim().length;
  switch (b.papel) {
    case "headline": {
      const px = capa
        ? (n <= 16 ? 160 : n <= 28 ? 132 : n <= 44 ? 116 : 108)
        : (n <= 16 ? 140 : n <= 28 ? 124 : n <= 44 ? 112 : 108);
      return { px, peso: "extra negrito ou negrito" };
    }
    case "numero": return { px: 280, peso: "negrito" };
    case "subtitulo": return { px: 44, peso: "médio" };
    case "cta": return { px: 44, peso: "negrito" };
    case "selo": return { px: 30, peso: "médio, caixa alta com espacejamento aberto" };
    default: return { px: n <= 90 ? 40 : 36, peso: "regular" };
  }
}

/**
 * Tamanhos da lâmina inteira: a headline (ou o número) define o teto do nível
 * 2 (subtítulo, apoio, CTA) em um terço dela, nunca abaixo de 36 px. Assim a
 * razão de 3 vezes da base vale em qualquer lâmina.
 */
export function tamanhosDaLamina(blocos: BlocoTexto[], capa: boolean): { px: number; peso: string }[] {
  const base = blocos.map((b) => tamanhoDoBloco(b, capa));
  const n1 = blocos
    .map((b, i) => (b.papel === "headline" || b.papel === "numero" ? base[i].px : 0))
    .reduce((m, v) => Math.max(m, v), 0);
  if (!n1) return base;
  const teto = Math.max(36, Math.floor(n1 / 3));
  return base.map((t, i) => {
    const papel = blocos[i].papel;
    if (papel === "subtitulo" || papel === "apoio" || papel === "cta") return { ...t, px: Math.min(t.px, teto) };
    return t;
  });
}

function hexOk(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return HEX.test(s) ? s : null;
}

/** Luminância relativa (WCAG 2) de um hex #RRGGBB. */
function luminancia(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const NEUTRO_CLARO = "#F5F3EE";
const NEUTRO_ESCURO = "#111418";

/** Texto com contraste de pelo menos 4,5:1 sobre o fundo; senão, o neutro de maior contraste. */
function textoLegivel(corTexto: string | null, corFundo: string | null): string | null {
  if (!corFundo) return corTexto;
  if (corTexto && contraste(corTexto, corFundo) >= 4.5) return corTexto;
  return contraste(NEUTRO_CLARO, corFundo) >= contraste(NEUTRO_ESCURO, corFundo) ? NEUTRO_CLARO : NEUTRO_ESCURO;
}

function papelDaCor(paleta: MarcaParaDirecao["paleta"], ...nomes: string[]): string | null {
  for (const n of nomes) {
    const achada = paleta.find((p) => (p.papel || "").toLowerCase().indexOf(n) >= 0 && hexOk(p.hex));
    if (achada) return hexOk(achada.hex);
  }
  return null;
}

/** Quebra o texto exato em blocos por papel quando o diretor não mandou os blocos. */
export function blocosDoTexto(textoExato: string, funcao: string): BlocoTexto[] {
  const linhas = textoExato.split("\n").map((l) => l.trim()).filter(Boolean);
  if (!linhas.length) return [];
  const blocos: BlocoTexto[] = [];
  // Linhas curtas seguidas formam a headline (até 3 linhas ou 60 caracteres).
  let headline = "";
  let i = 0;
  while (i < linhas.length && i < 3 && (headline + " " + linhas[i]).trim().length <= 54) {
    headline = headline ? `${headline}\n${linhas[i]}` : linhas[i];
    i++;
  }
  if (!headline) {
    headline = linhas[0];
    i = 1;
  }
  blocos.push({ papel: /^\d{1,3}(%|x)?$/.test(headline.replace(/\s/g, "")) ? "numero" : "headline", texto: headline });
  const resto = linhas.slice(i);
  resto.forEach((l, k) => {
    const ultimo = k === resto.length - 1;
    const papel: PapelBloco = funcao === "cta" && ultimo ? "cta" : k === 0 && l.length <= 70 ? "subtitulo" : "apoio";
    blocos.push({ papel, texto: l });
  });
  return blocos;
}

/** Normaliza o que veio do diretor (ou do roteiro) antes de compor. */
export function normalizarLayout(l: Partial<LayoutLamina> | null | undefined, funcao: string, ordem: number, total: number): LayoutLamina {
  const padrao = layoutPadrao(funcao, ordem, total);
  const zona = ZONAS.includes(l?.zona_texto as ZonaTexto) ? l!.zona_texto as ZonaTexto : padrao.zona_texto;
  const alinhamento = l?.alinhamento === "centro" || l?.alinhamento === "direita" || l?.alinhamento === "esquerda" ? l.alinhamento : padrao.alinhamento;
  return {
    zona_texto: zona,
    alinhamento,
    imagem: (l?.imagem || "").trim() || padrao.imagem,
    ponto_focal: (l?.ponto_focal || "").trim() || padrao.ponto_focal,
    fundo: (l?.fundo || "").trim() || padrao.fundo,
    tratamento: (l?.tratamento || "").trim() || padrao.tratamento,
    cor_fundo: hexOk(l?.cor_fundo),
    cor_texto: hexOk(l?.cor_texto),
    cor_destaque: hexOk(l?.cor_destaque),
  };
}

/**
 * Layout padrão com variação controlada: a capa com headline grande na base,
 * o miolo alternando zonas e o final centrado no CTA. Serve para o roteiro do
 * calendário virar direção sem chamar IA.
 */
export function layoutPadrao(funcao: string, ordem: number, total: number): LayoutLamina {
  if (funcao === "capa" || ordem === 1) {
    return {
      zona_texto: "base-esquerda",
      alinhamento: "esquerda",
      imagem: "fotografia real e marcante do assunto, ocupando a lâmina inteira",
      ponto_focal: "o elemento principal da foto no terço superior, com a headline na base",
      fundo: "a própria fotografia, com uma área calma e uniforme na zona do texto para garantir leitura",
      tratamento: "editorial, luz natural, headline grande que para a rolagem, um elemento visual forte",
    };
  }
  if (funcao === "cta" || ordem === total) {
    return {
      zona_texto: "centro",
      alinhamento: "centro",
      imagem: "plano de fundo sólido da cor dominante da marca com um detalhe fotográfico ou gráfico que conecta com a capa",
      ponto_focal: "o CTA em destaque, com a logo abaixo",
      fundo: "cor dominante da marca",
      tratamento: "limpo, muito espaço negativo, destaque único no CTA",
    };
  }
  const variacoes: Pick<LayoutLamina, "zona_texto" | "alinhamento" | "imagem" | "ponto_focal" | "fundo">[] = [
    { zona_texto: "topo-esquerda", alinhamento: "esquerda", imagem: "fotografia ou objeto do assunto na metade inferior, recortado com profundidade", ponto_focal: "headline no topo e imagem na base", fundo: "tom claro ou escuro da paleta, liso" },
    { zona_texto: "coluna-esquerda", alinhamento: "esquerda", imagem: "fotografia vertical na metade direita, sangrando pela borda", ponto_focal: "divisão assimétrica entre texto e imagem", fundo: "cor secundária da paleta" },
    { zona_texto: "base-esquerda", alinhamento: "esquerda", imagem: "fotografia ampla ocupando os dois terços de cima", ponto_focal: "imagem no alto, texto ancorado na base", fundo: "a fotografia com área calma na base" },
    { zona_texto: "centro-esquerda", alinhamento: "esquerda", imagem: "elemento gráfico ou número grande de fundo em tom suave", ponto_focal: "o número ou a palavra-chave em escala grande", fundo: "cor dominante da marca" },
  ];
  const v = variacoes[(ordem - 2) % variacoes.length];
  return { ...v, tratamento: "mesmo sistema do carrossel (grid, margens, fontes), variando enquadramento e escala" };
}

function descreverPosicao(c: Caixa): string {
  const f = (v: number) => `${Math.round(v)}%`;
  return `de ${f(c.x0)} a ${f(c.x1)} da largura e de ${f(c.y0)} a ${f(c.y1)} da altura do quadro`;
}

// ---------------------------------------------------------------- logo
//
// Pedido do dono (26/09): "a logo do cliente não pode ficar pequenininha,
// mesmo com referência; a referência é só direcionamento" e "a logo tem que
// ser gerada junto com a arte, organizada de forma profissional na
// composição, como num gerador tradicional (não por camada)". O código não
// cola mais a logo em nenhum modo: o gerador desenha a logo oficial anexada
// (a versão limpa, que contrasta com o fundo) e o prompt fixa o TAMANHO
// mínimo pela proporção da logo e pelo quadro; a POSIÇÃO vem da composição
// (layout da lâmina ou referência escolhida). Onde a máscara limita o que o
// gerador pode desenhar (foto real fixa e carrossel contínuo), a área da
// logo entra aberta na máscara e é descrita no prompt.

/** Proporção usada quando a logo não pôde ser medida (largura / altura). */
export const ASPECTO_PADRAO_DA_LOGO = 3;
/** Logo com largura de pelo menos 2 vezes a altura é horizontal; abaixo disso, empilhada ou quadrada. */
export const LOGO_HORIZONTAL_A_PARTIR_DE = 2;

export type TamanhoDaLogo = {
  /** Tamanho pedido ao gerador, em px do quadro final. */
  largura: number;
  altura: number;
  /** O mesmo em percentual do quadro (1 casa). */
  larguraPct: number;
  alturaPct: number;
  /** Menor tamanho aceitável (px): abaixo disso a logo fica ilegível no feed. */
  alturaMinima: number;
  larguraMinima: number;
  horizontal: boolean;
  aspecto: number;
};

/**
 * Tamanho da logo pelo código, igual em todos os modos (normal, replicar
 * referência, foto real, recorte, contínuo e anúncio): proporcional ao quadro
 * e à forma da logo. Empilhada ou quadrada: altura de 11% do lado menor (faixa
 * de 9% a 12%), largura até 32% do quadro. Horizontal: largura de 30% do
 * quadro, sem passar de 12% do lado menor na altura. O mínimo legível é 80% do
 * pedido (nunca abaixo de 7% do lado menor na empilhada nem de 24% da largura
 * na horizontal).
 */
export function tamanhoDaLogo(quadro: { largura: number; altura: number }, aspectoBruto?: number | null): TamanhoDaLogo {
  const W = quadro.largura, H = quadro.altura;
  const menor = Math.min(W, H);
  const aspecto = typeof aspectoBruto === "number" && isFinite(aspectoBruto) && aspectoBruto >= 0.2 && aspectoBruto <= 12 ? aspectoBruto : ASPECTO_PADRAO_DA_LOGO;
  const horizontal = aspecto >= LOGO_HORIZONTAL_A_PARTIR_DE;
  let largura: number, altura: number;
  if (horizontal) {
    largura = Math.min(0.3 * W, 0.12 * menor * aspecto);
    altura = largura / aspecto;
  } else {
    altura = 0.11 * menor;
    largura = altura * aspecto;
    if (largura > 0.32 * W) {
      largura = 0.32 * W;
      altura = largura / aspecto;
    }
  }
  const alturaMinima = horizontal ? Math.round((0.24 * W) / aspecto) : Math.round(Math.max(0.07 * menor, altura * 0.8));
  const larguraMinima = horizontal ? Math.round(0.24 * W) : Math.round(alturaMinima * aspecto);
  return {
    largura: Math.round(largura),
    altura: Math.round(altura),
    larguraPct: um((largura / W) * 100),
    alturaPct: um((altura / H) * 100),
    alturaMinima: Math.min(Math.round(altura), alturaMinima),
    larguraMinima: Math.min(Math.round(largura), larguraMinima),
    horizontal,
    aspecto: Math.round(aspecto * 100) / 100,
  };
}

/** A logo que a lâmina usa (escolhida no kit): tom, claridade e proporção medidos em código. */
export type LogoMedida = { tom: string | null; clara: boolean; aspecto?: number | null };

/**
 * Legenda do anexo da logo (a imagem que o gerador copia): forte e sem
 * ambiguidade, porque a logo agora é desenhada pelo gerador.
 */
export const LEGENDA_DA_LOGO =
  "LOGO OFICIAL da marca: reproduza exatamente esta logo, com as mesmas letras, símbolo, cores e proporção; não redesenhe, não invente símbolo, não troque por texto e não ponha caixa ou fundo atrás dela";

/**
 * Bloco LOGO do prompt. `areaFixa`: a máscara só deixa o gerador desenhar ali
 * (foto real fixa e contínuo), então a logo vai dentro dela. `replicar`: no
 * lugar em que a referência põe a marca dela, mas no tamanho da marca (a
 * referência não diminui a logo).
 */
export function blocoDaLogo(e: {
  levaLogo: boolean;
  temLogo: boolean;
  quadro: { largura: number; altura: number };
  logo?: LogoMedida | null;
  areaFixa?: Caixa | null;
  replicar?: boolean;
  anuncio?: boolean;
  foto?: boolean;
}): string[] {
  if (!e.levaLogo) return ["- Sem logo nesta lâmina: não desenhe logo, símbolo nem marca."];
  if (!e.temLogo) return ["- A logo oficial ainda não foi enviada em imagem: NÃO desenhe nem invente logo, símbolo ou marca; deixe só um respiro no canto onde ela entraria."];
  const t = tamanhoDaLogo(e.quadro, e.logo?.aspecto ?? null);
  const margens = `dentro das margens${e.anuncio ? " e da zona segura" : ""}`;
  const lugar = e.areaFixa
    ? `- Lugar: dentro da área reservada para ela (${descreverPosicao(e.areaFixa)}), alinhada ao lado de fora dessa área; é a única área, além da do texto, em que a imagem muda.`
    : e.replicar
    ? `- Lugar: onde a referência põe a marca dela (sem marca na referência, alinhada ao bloco de texto), ${margens}. A referência só orienta o lugar: a logo fica no tamanho acima, nunca menor.`
    : `- Lugar: faz parte da composição, alinhada ao mesmo eixo e à mesma margem do bloco de texto (acima da headline ou abaixo do apoio ou do CTA) ou no ponto que o layout pedir, ${margens}, com respiro em volta; nunca no canto superior direito, nunca sobre rosto, mão ou produto.`;
  const contraste = e.logo
    ? e.logo.clara
      ? " A logo é clara: ela pousa numa parte escura da própria arte, direto sobre ela."
      : ` A logo é escura ou colorida${e.logo.tom ? ` (tom dominante ${e.logo.tom})` : ""}: ela pousa numa parte clara da própria arte, direto sobre ela, nunca sobre a mesma cor nem o mesmo valor da logo.`
    : " Nunca ponha a logo sobre fundo da mesma cor dela.";
  return [
    "- Logo oficial anexada, desenhada junto com a arte e idêntica ao anexo (mesmas letras, símbolo, cores e proporção); não redesenhe nem troque por texto. Uma logo só.",
    `- Tamanho: cerca de ${t.largura} x ${t.altura} px numa arte de ${e.quadro.largura} x ${e.quadro.altura} (${t.larguraPct}% da largura), nunca menor que ${t.larguraMinima} x ${t.alturaMinima} px: legível de longe, nunca um detalhe pequenininho.`,
    lugar,
    `-${contraste} A logo entra sem caixa, cartão, faixa, retângulo ou fundo branco atrás, exatamente como o desenho dela.`,
  ];
}

// ------------------------------------------------------------ padrão e proibições

/**
 * Padrão de design da lâmina, curto e sem repetir o que já está nos blocos
 * (mesmas regras de PADRAO_NA_IMAGEM, conhecimento-design.ts, na forma que o
 * gerador segue melhor: frases diretas, uma regra por linha).
 */
export const PADRAO_DA_LAMINA = [
  "PADRÃO DE DESIGN",
  "- No máximo 3 níveis de hierarquia e um só ponto focal; tudo no grid e nas margens; pelo menos 30% de respiro; texto só sobre área calma, painel sólido do grid ou gradiente local suave, legível até em preto e branco.",
  "- Letras nítidas e íntegras, no máximo 2 famílias, sem esticar, sem contorno, sem sombra pesada, nada justificado nem hifenizado; acentos do português exatos (ã, õ, ç, é, ê, á, ó); nenhuma palavra sozinha na última linha.",
  "- A cor de destaque (até 10% da área) só na palavra-chave, no número ou no CTA. Foto e texto na mesma cena, com uma luz coerente; acabamento de agência premium, com pele, mãos e rostos naturais.",
].join("\n");

/**
 * Proibições explícitas (dono, 26/09: "muitas alucinações nas demais
 * lâminas"): o gerador inventava texto, gente, objetos e marcas que ninguém
 * pediu. Valem em todos os modos.
 */
export function blocoDasProibicoes(e: { serie: boolean; replicar?: boolean }): string {
  return [
    "PROIBIDO",
    "- Nenhum texto além do texto exato: sem nome da marca ou da empresa, site, telefone, @, hashtag, preço, data, marca d'água, legenda ou letras de enfeite.",
    "- Nenhuma pessoa, rosto, mão, objeto, produto, animal, ícone ou marca que a direção não pediu; nenhuma logo de outra marca; nenhum elemento repetido ou duplicado.",
    "- Pessoas com anatomia correta e natural: cabeça alinhada ao corpo, pescoço natural, cinco dedos em cada mão, mãos segurando os objetos de um jeito possível, braços e pernas inteiros e na proporção certa.",
    e.replicar
      ? "- Sem moldura, borda, contorno ou cantos arredondados em volta da arte; o fundo vai até a borda. Faixas e formas gráficas só as da referência, nas cores da marca."
      : "- Sem moldura, borda, contorno ou cantos arredondados em volta da arte; o fundo vai até a borda. Faixas e formas gráficas só as do layout da marca.",
    "- Não escureça a imagem para criar destaque. Evite: tudo centralizado e do mesmo tamanho, faixa preta genérica, gradiente roxo e azul, neon, brilho, 3D plástico, ícones de banco.",
    e.serie ? "- Não copie o texto das outras lâminas da série." : "",
    "- Sem travessão no texto.",
  ].filter(Boolean).join("\n");
}

/** Prompt final da lâmina, montado em código a partir da direção e da marca. */
export function promptDaLamina(
  card: Pick<CardDirecao, "ordem" | "funcao" | "texto_exato" | "blocos" | "layout" | "evitar" | "ilustracao">,
  marca: MarcaParaDirecao,
  opcoes: {
    total: number;
    carrosselInfinito: boolean;
    levaLogo: boolean;
    conceito?: string | null;
    /** Mantido por compatibilidade: a continuidade vem do fio visual e da capa anexada (26/09). */
    anteriores?: string[];
    /** Fio visual do conjunto (protagonista, cenário, luz, tratamento), definido uma vez pelo diretor. */
    fioVisual?: string | null;
    /** Logo escolhida, medida em código: tom dominante, se é clara e a proporção (define tamanho e contraste). */
    logo?: LogoMedida | null;
    /** Descrição da foto real anexada como base: o gerador não redesenha a foto. */
    fotoReal?: string | null;
    /**
     * Área em que a máscara deixa o gerador desenhar a logo (foto real fixa e
     * carrossel contínuo), em percentual do quadro. Sem ela, o lugar vem da composição.
     */
    areaDaLogo?: Caixa | null;
    /** Criativo de anúncio (trabalho tipo 'ads'): quadro, zona segura e regras do formato. */
    anuncio?: { formato: FormatoCriativo } | null;
    /**
     * Modo replicar referência (blocoReplicarReferencia vem antes deste
     * prompt): a composição, a posição e a escala do texto vêm da referência
     * escolhida, não do layout da direção. `comFoto`: a foto do cliente é o assunto.
     */
    replicar?: { comFoto: boolean } | null;
    /** Formato do post orgânico (trabalho social); sem ele ou em 4:5, o prompt de sempre. */
    post?: FormatoDoPost | null;
  },
): string {
  const formato = opcoes.anuncio && FORMATOS_CRIATIVO.includes(opcoes.anuncio.formato) ? opcoes.anuncio.formato : null;
  const anuncio = !!formato;
  // Post fora do 4:5 (3:4, 1:1 ou 9:16): quadro, margens e zona do formato; o 4:5 segue exatamente como era.
  const post = !formato && opcoes.post && opcoes.post !== "feed_4x5" && FORMATOS_DO_POST.indexOf(opcoes.post) >= 0 ? opcoes.post : null;
  const quadro = formato ? QUADRO_FINAL[formato] : post ? QUADRO_DO_POST[post].final : { largura: 1080, altura: 1350 };
  // A peça única do anúncio é a própria capa; o carrossel de anúncio (cards
  // feed 4:5 em sequência) é série como o carrossel do post.
  const capa = card.funcao === "capa" || card.ordem === 1;
  const serie = opcoes.total > 1;
  const layout = normalizarLayout(card.layout, card.funcao, card.ordem, opcoes.total);
  const blocos = (card.blocos && card.blocos.length ? card.blocos : blocosDoTexto(card.texto_exato, card.funcao))
    .filter((b) => PAPEIS.includes(b.papel) && b.texto.trim());
  const caixa = caixaDaZona(layout.zona_texto, capa, serie, formato, post);
  const margens = margensDoQuadro(formato, post);
  const px = (pct: number, lado: number) => Math.round((pct / 100) * lado);
  // Cada linha da headline: cerca de 121 px (9% do quadro 4:5).
  const linhaHeadline = Math.round((121.5 / quadro.altura) * 100);

  const paleta = marca.paleta.filter((p) => hexOk(p.hex));
  const corFundo = layout.cor_fundo || papelDaCor(paleta, "fundo", "primaria", "primária", "principal");
  // Contraste conferido em código quando as duas cores são hex.
  const corTexto = textoLegivel(layout.cor_texto || papelDaCor(paleta, "texto"), corFundo);
  // A secundária é a cor dos 30%: não serve de acento. Sem destaque no kit, sem acento.
  const corDestaque = layout.cor_destaque || papelDaCor(paleta, "destaque", "acento");
  const fonteTitulo = marca.fontes.find((f) => f.papel === "titulo")?.nome || marca.tipografiaCitada?.titulo || null;
  const fonteTexto = marca.fontes.find((f) => f.papel === "texto")?.nome || marca.tipografiaCitada?.texto || fonteTitulo;

  const tamanhos = tamanhosDaLamina(blocos, capa);
  // Replicando a referência, posição, escala e peso do texto vêm dela (não da conta do layout).
  const replicar = !!opcoes.replicar;
  const linhasBlocos = blocos.map((b, i) => {
    const t = tamanhos[i];
    const fonte = b.papel === "headline" || b.papel === "numero" ? fonteTitulo : fonteTexto;
    const cor = b.papel === "cta" || b.papel === "numero" ? corDestaque || corTexto : corTexto;
    if (replicar) {
      return `- ${b.papel.toUpperCase()}: "${b.texto.replace(/\n/g, " / ")}"` +
        `${fonte ? `, fonte ${fonte}` : ""}${cor ? `, cor ${cor}` : ""}; mesma posição, escala e peso do texto equivalente da referência.`;
    }
    return `- ${b.papel.toUpperCase()}: "${b.texto.replace(/\n/g, " / ")}", letra de cerca de ${t.px} px numa arte de ${quadro.largura} x ${quadro.altura}, peso ${t.peso}` +
      `${fonte ? `, fonte ${fonte}` : ""}${cor ? `, cor ${cor}` : ""}.`;
  });
  const temBarra = blocos.some((b) => b.texto.indexOf("\n") >= 0);

  // Foto real como base (24/09): a foto já está decidida. Nada de véu ou painel
  // atrás do texto, nada de mudar pose ou enquadramento.
  const foto = !!opcoes.fotoReal;

  const paletaTxt = paleta.length
    ? paleta.map((p) => `${p.nome || p.papel || "cor"} ${hexOk(p.hex)}${p.papel ? ` (${p.papel})` : ""}`).join(", ")
    : "paleta coerente com as artes da marca anexadas";

  // Ordem do prompt (26/09, "seguir o mais próximo possível do prompt"): o
  // obrigatório primeiro (texto exato, logo, marca), depois a composição, o
  // formato e as proibições. Cada regra aparece uma vez só.
  return [
    formato
      ? `ARTE FINAL de criativo de anúncio para tráfego pago na Meta (Facebook e Instagram), formato ${TAMANHO_DO_FORMATO[formato].rotulo}${serie ? `, carrossel de anúncio, card ${card.ordem} de ${opcoes.total}` : ""}. ` +
        (serie
          ? `Função deste card: ${capa ? "capa (parar a rolagem da pessoa certa com o gancho)" : card.funcao === "cta" ? "fechamento com a oferta e a chamada para ação" : "um passo da sequência (uma ideia só)"}.`
          : "Uma peça só, com uma mensagem só: parar a rolagem da pessoa certa, fazer entender a oferta em 1 segundo e levar à ação.")
      : `ARTE FINAL de ${opcoes.total > 1 ? `carrossel, lâmina ${card.ordem} de ${opcoes.total}` : "post único"} para o Instagram da marca. Função desta lâmina: ${capa ? "capa (parar a rolagem com um gancho forte)" : card.funcao === "cta" ? "fechamento com chamada para ação" : "conteúdo (uma ideia só)"}.`,
    opcoes.conceito ? `Conceito do conjunto: ${opcoes.conceito}` : "",
    "PRIORIDADE, nesta ordem: 1) o texto exato, letra por letra; 2) a logo oficial no tamanho pedido; 3) as cores e as fontes da marca; 4) a composição; 5) o acabamento. Em conflito, vale o item de número menor.",
    "",
    "1. TEXTO EXATO (escreva só isto, com esta grafia e acentuação, e nenhuma outra palavra)",
    ...linhasBlocos,
    temBarra ? "- A barra ( / ) marca a quebra de linha: quebre a linha ali e não desenhe a barra." : "",
    replicar
      ? "- Posição, alinhamento e quebra do texto: os da referência, com o texto exato acima no lugar do texto dela (o título dela vira a headline, o texto menor vira o apoio)."
      : `- Área do texto: ${descreverPosicao(caixa)}, alinhamento à ${layout.alinhamento === "centro" ? "centro" : layout.alinhamento}, todos os blocos no mesmo eixo e com a mesma margem.`,
    replicar ? "" : `- A headline tem cerca de 3 vezes a altura do texto de apoio e cada linha dela ocupa cerca de ${linhaHeadline}% da altura do quadro. O apoio ocupa uma coluna de no máximo 66% da largura, com linhas de 25 a 38 caracteres.`,
    replicar
      ? "- Entrelinha da headline de 1,0 a 1,1, sem acento encostando na linha de cima."
      : "- Headline e apoio formam um grupo, a 16 a 32 px um do outro; CTA, selo e logo ficam a pelo menos 96 px desse grupo. Entrelinha da headline de 1,0 a 1,1, sem acento encostando na linha de cima; entrelinha do apoio de 1,3 a 1,5.",
    "",
    "2. LOGO",
    ...blocoDaLogo({
      levaLogo: opcoes.levaLogo,
      temLogo: marca.temLogo,
      quadro,
      logo: opcoes.logo ?? null,
      areaFixa: opcoes.areaDaLogo ?? null,
      replicar,
      anuncio,
      foto,
    }),
    "",
    "3. MARCA",
    `- Paleta (use só estas cores, na proporção 60-30-10, com um destaque único): ${paletaTxt}.`,
    fonteTitulo || fonteTexto
      ? `- Tipografia: títulos em ${fonteTitulo || fonteTexto}, texto em ${fonteTexto || fonteTitulo}. Se houver amostra da fonte anexada, siga o desenho exato das letras da amostra.`
      : "- Tipografia: siga a tipografia das artes da marca anexadas (mesma classificação, peso e caixa).",
    marca.tipografiaCitada?.observacao ? `- Observação da marca sobre tipografia: ${marca.tipografiaCitada.observacao}` : "",
    marca.estilo ? `- Estilo visual da marca, obrigatório: ${marca.estilo}` : "",
    marca.regras ? `- Regras da marca: ${marca.regras.replace(/\n+/g, " ")}` : "",
    "",
    "4. IMAGEM E COMPOSIÇÃO",
    replicar
      ? opcoes.replicar!.comFoto
        ? "- Imagem: a FOTO REAL do cliente anexada é o assunto desta lâmina, recomposta no layout da referência (veja MODO REPLICAR REFERÊNCIA), com a pessoa ou o produto idêntico."
        : `- Imagem: ${layout.imagem}. É o assunto desta lâmina, no lugar do assunto da referência.`
      : foto
      ? `- Imagem: a FOTO REAL do cliente anexada como imagem 1 (${opcoes.fotoReal}) é a base desta lâmina. Não redesenhe a foto: pessoas, objetos, ambiente, luz, cores, corte e enquadramento ficam exatamente como estão. Desenhe só o texto e a logo, direto sobre a foto, sem painel, véu, caixa ou desfoque atrás deles.`
      : `- Imagem: ${layout.imagem}.${card.ilustracao && card.ilustracao !== layout.imagem ? ` Detalhe: ${card.ilustracao}.` : ""} Só este assunto: nada além do que está descrito.`,
    replicar ? "- Composição, grid, recorte e tratamento da imagem: os da referência escolhida (veja MODO REPLICAR REFERÊNCIA), não um layout novo." : "",
    opcoes.fioVisual && serie && !foto && !opcoes.replicar?.comFoto
      ? `- CONTINUIDADE DA SÉRIE (obrigatório): ${opcoes.fioVisual.replace(/\s+/g, " ").trim().slice(0, 600).replace(/([^.!?])$/, "$1.")} Mantenha a mesma protagonista, cenário e luz em todas as lâminas; varia só a pose, o gesto e o enquadramento.`
      : "",
    replicar
      ? ""
      : foto && capa
      ? "- CAPA QUE PARA A ROLAGEM: a maior headline do conjunto, em peso black, com a palavra-chave na cor de destaque, legível até no tamanho da miniatura do feed. A foto já é o elemento visual forte: não mude a foto. Nada competindo com a headline."
      : anuncio && capa
      ? "- CRIATIVO QUE PARA A ROLAGEM: headline curta e grande, em peso black, com a palavra-chave na cor de destaque; o assunto descrito em Imagem em escala grande, ligado à oferta; contraste pela escala e pela cor de destaque, legível na tela do celular. Nada competindo com a headline."
      : capa
      ? "- CAPA QUE PARA A ROLAGEM: a maior headline do conjunto, em peso black, com a palavra-chave na cor de destaque; o assunto descrito em Imagem em escala grande e recorte ousado (pode sangrar pela borda); contraste pela escala e pela cor de destaque, legível até no tamanho da miniatura do feed. Nada competindo com a headline."
      : "",
    replicar
      ? ""
      : foto
      ? `- O texto fica na área indicada (${layout.zona_texto.replace("-", " ")}), sobre a parte mais calma da foto; o contraste vem da cor e do peso das letras, nunca de escurecer ou cobrir a foto.`
      : `- O sujeito da foto fica do lado oposto à área do texto (${layout.zona_texto.replace("-", " ")}); essa área é calma e uniforme na própria foto (parede, céu, sombra, fundo desfocado) ou recebe um painel da paleta alinhado ao grid.`,
    foto || replicar ? "" : `- Ponto focal: ${layout.ponto_focal}.`,
    foto || replicar ? "" : `- Fundo: ${layout.fundo}${corFundo ? ` (cor dominante ${corFundo})` : ""}.`,
    foto || replicar ? "" : `- Tratamento: ${layout.tratamento}.`,
    "",
    "5. FORMATO",
    ...(formato
      ? [
        `- Arte ${formato === "stories_9x16" ? "vertical 9:16" : formato === "quadrado_1x1" ? "quadrada 1:1" : "vertical 4:5"} (${quadro.largura} x ${quadro.altura}), usando o quadro inteiro, sem bordas vazias.`,
        `- Margens de segurança (zona segura do formato): ${px(margens.x, quadro.largura)} px nas laterais, ${px(margens.topo, quadro.altura)} px no topo e ${px(margens.base, quadro.altura)} px na base. Nenhum texto, logo, rosto ou produto encosta nelas.`,
        formato === "stories_9x16"
          ? `- Stories e Reels: a interface do Instagram e do Facebook cobre o topo (perfil) e a base (botão e legenda); nos ${px(margens.topo, quadro.altura)} px de cima e nos ${px(margens.base, quadro.altura)} px de baixo só a continuação do fundo.`
          : "",
        serie ? "- Canto superior direito livre de texto (a Meta mostra o contador do carrossel ali)." : "",
        "",
        regrasDoCriativo(formato),
      ]
      : post
      ? [
        `- Arte ${post === "stories_9x16" ? "vertical 9:16 para Stories e Reels" : post === "quadrado_1x1" ? "quadrada 1:1" : "vertical 3:4 (o retrato mais alto do feed, inteiro também na grade do perfil)"} (${quadro.largura} x ${quadro.altura}), usando o quadro inteiro, sem bordas vazias.`,
        `- Margens de segurança: ${px(margens.x, quadro.largura)} px nas laterais${capa && margens.capaExtra ? ` (mais ${px(margens.capaExtra, quadro.largura)} px na capa, que a grade 3:4 do perfil corta nas laterais do quadrado)` : ""}, ${px(margens.topo, quadro.altura)} px no topo e ${px(margens.base, quadro.altura)} px na base. Nenhum texto nem a logo encostam nas margens.`,
        post === "stories_9x16"
          ? `- Stories e Reels: a interface do Instagram cobre o topo (perfil) e a base (resposta, legenda e botões); nos ${px(margens.topo, quadro.altura)} px de cima e nos ${px(margens.base, quadro.altura)} px de baixo só a continuação do fundo.`
          : "",
        serie ? "- Canto superior direito livre de texto (o Instagram mostra o contador do carrossel ali)." : "",
      ]
      : [
        "- Arte vertical 4:5 (1080 x 1350), usando o quadro inteiro, sem bordas vazias.",
        `- Margens de segurança: 90 px nas laterais${capa ? " (mais 34 px na capa, que aparece recortada em 3:4 na grade do perfil)" : ""}, 100 px no topo e 106 px na base. Nenhum texto nem a logo encostam nas margens.`,
        serie ? "- Canto superior direito livre de texto (o Instagram mostra o contador do carrossel ali)." : "",
        opcoes.carrosselInfinito && serie
          ? "- Carrossel contínuo: o que chega à borda continua na lâmina vizinha com a mesma posição, escala, perspectiva e luz; a última lâmina se conecta visualmente com a capa."
          : "",
      ]),
    "",
    blocoDasProibicoes({ serie, replicar }),
    "",
    PADRAO_DA_LAMINA,
    card.evitar ? `\nEVITAR NESTA LÂMINA: ${card.evitar}` : "",
  ].filter((l) => l !== "").join("\n");
}

/**
 * Área reservada para a logo (percentual do quadro) quando a máscara limita o
 * que o gerador desenha (foto real fixa e contínuo): no canto superior
 * esquerdo quando o texto está na base, no inferior esquerdo nos demais, com o
 * tamanho de tamanhoDaLogo e uma folga para o gerador compor. `aspecto`: a
 * proporção da logo escolhida (sem ela, a de uma logo horizontal comum).
 */
export function caixaDaLogo(zona: ZonaTexto, capa: boolean, formato?: FormatoCriativo | null, post?: FormatoDoPost | null, aspecto?: number | null): Caixa {
  const m = margensDoQuadro(formato, post);
  const quadro = formato ? QUADRO_FINAL[formato] : post && post !== "feed_4x5" ? QUADRO_DO_POST[post].final : { largura: 1080, altura: 1350 };
  const t = tamanhoDaLogo(quadro, aspecto);
  const esq = AREA.x0 + m.x + (capa ? m.capaExtra : 0);
  // Folga de 15% na largura e 25% na altura: o gerador compõe a logo dentro dela.
  const largura = Math.min(AREA.x1 - m.x - esq, um(t.larguraPct * 1.15));
  const altura = um(t.alturaPct * 1.25);
  if (zona === "base-esquerda" || zona === "base-centro") {
    return { x0: esq, x1: um(esq + largura), y0: m.topo, y1: um(m.topo + altura) };
  }
  const base = AREA.y1 - m.base;
  return { x0: esq, x1: um(esq + largura), y0: um(base - altura), y1: base };
}

/**
 * Modo replicar referência (pedido do dono em 25/09: "escolhi a referência e
 * a imagem e gerou nada a ver"; "faz idêntico à referência com a identidade
 * visual da empresa, o conteúdo da empresa, com a foto"). Vai ANTES do prompt
 * da lâmina: a referência escolhida manda no layout; a marca manda nas cores,
 * nas fontes e na logo; o texto exato e a foto do cliente são o conteúdo.
 * Com duas referências, a 1ª dá a estrutura e a 2ª o tratamento. Os índices
 * são a posição de cada imagem anexada (1 = a primeira).
 */
export function blocoReplicarReferencia(e: {
  referencias: { indice: number; leitura?: string | null }[];
  fotos: { indice: number; descricao?: string | null; papel: "fundo" | "elemento" }[];
  logo?: number | null;
  capa?: boolean;
  /** A referência 1 é a imagem 1 editada (molde): quase idêntica, só trocam conteúdo e marca. */
  editando?: boolean;
}): string {
  const refs = e.referencias.slice(0, 2);
  if (!refs.length) return "";
  const leitura = (l?: string | null) => {
    const t = String(l || "").replace(/\s+/g, " ").trim().slice(0, 600);
    return t ? ` O que se vê nela: ${t}` : "";
  };
  const linhasDasRefs = refs.length === 1
    ? [
      `- Referência: imagem ${refs[0].indice}. Copie dela a estrutura do layout (grid, divisão da tela, posição de cada bloco de texto e de cada imagem), a escala e a hierarquia da tipografia (qual texto é o maior, peso, caixa alta ou baixa, alinhamento, quebra em linhas), o recorte e o tratamento da imagem (plano, enquadramento, recorte do assunto, fundo, luz, cor aplicada) e os elementos gráficos (faixas, formas, setas, texturas), na mesma proporção de espaço vazio.${leitura(refs[0].leitura)}`,
    ]
    : [
      `- Referência 1: imagem ${refs[0].indice}. Dela vem a ESTRUTURA: grid, divisão da tela, posição de cada bloco de texto e de cada imagem, escala e hierarquia da tipografia (qual texto é o maior, peso, caixa, alinhamento, quebra em linhas) e a proporção de espaço vazio.${leitura(refs[0].leitura)}`,
      `- Referência 2: imagem ${refs[1].indice}. Dela vem o TRATAMENTO: recorte e tratamento da imagem (plano, enquadramento, luz, cor aplicada, fundo), os elementos gráficos (faixas, formas, setas, texturas) e o acabamento.${leitura(refs[1].leitura)}`,
      "- Onde as duas brigarem, vale a referência 1 para posição e tamanho e a referência 2 para o acabamento.",
    ];
  const fotos = e.fotos.filter((f) => f.indice > 0);
  const nomeDasFotos = fotos.map((f) => `imagem ${f.indice}`).join(" e ");
  const linhasDoAssunto = fotos.length
    ? [
      `- Assunto: a pessoa ou o produto da foto real do cliente (${nomeDasFotos}) entra no lugar do assunto da referência. É a mesma pessoa, idêntica: mesmo rosto, feições, formato do rosto, olhos, nariz, boca, tom de pele, cabelo, idade, corpo e roupa. Produto idêntico: mesma forma, proporções, cores, rótulo e detalhes.`,
      "- Pode recortar, reposicionar, mudar a escala e integrar a foto à luz e ao layout da referência; não redesenhe nem troque a pessoa ou o produto, não mude a expressão e não escureça a foto.",
      fotos.length > 1 ? `- Use todas as fotos do cliente (${nomeDasFotos}) na composição, cada uma no espaço de imagem equivalente da referência.` : "",
    ]
    : [e.editando
      ? "- Assunto: se a referência tem pessoa, troque por outra pessoa diferente (não a da referência), com o mesmo enquadramento, pose e luz; se tem produto ou objeto de outra marca, troque pelo assunto desta lâmina (descrito em IMAGEM E COMPOSIÇÃO) no mesmo lugar e escala."
      : "- Assunto: o desta lâmina (descrito em IMAGEM E COMPOSIÇÃO), no lugar do assunto da referência."];
  return [
    `MODO REPLICAR REFERÊNCIA (prioridade máxima nesta lâmina)`,
    e.editando
      ? `EDITE a imagem 1: ela é a referência 1, o MOLDE desta lâmina. Mantenha quase idênticos a composição, o grid, a posição e o tamanho de cada bloco, os elementos gráficos, o estilo e a escala da tipografia, o recorte e o tratamento da imagem e o espaço vazio. Troque SÓ o que está listado em "Troque" abaixo; o resto fica como está na imagem 1.`
      : `A equipe escolheu ${refs.length === 1 ? "esta referência" : "estas duas referências"} para esta lâmina. Recrie a lâmina seguindo de perto a referência: quem olhar as duas lado a lado reconhece o mesmo layout, quase igual, só que com a marca e o conteúdo deste cliente.`,
    ...linhasDasRefs,
    ...linhasDoAssunto,
    `- Troque: o texto da referência pelo texto exato desta lâmina (mesmo papel e mesma posição: o título dela vira a headline, o texto menor vira o apoio); as cores dela pelas da paleta da marca, na mesma função (fundo por fundo, destaque por destaque); as fontes dela pelas da marca, com o mesmo peso e a mesma escala; a marca dela pela logo oficial${e.logo ? ` (imagem ${e.logo})` : ""}, desenhada junto com a arte no tamanho do bloco LOGO (a referência orienta o lugar, nunca diminui a logo).`,
    "- Não copie da referência: o texto, a logo, o nome ou o site de outra marca, marcas d'água e as pessoas dela.",
    e.capa ? "- Esta é a capa: a headline continua a maior da série e legível na miniatura do feed, na posição em que a referência põe o título." : "",
    "- Onde o padrão de design ou a composição descrita adiante divergirem da referência, vale a referência. Continuam valendo: o texto exato, a paleta, as fontes e a logo da marca (no tamanho pedido), as margens de segurança e a ortografia.",
  ].filter(Boolean).join("\n");
}

/**
 * Série do carrossel sem precisar do contínuo (pedido do dono em 25/09:
 * "reconhecer a capa e continuar a partir dela com os traços, linhas,
 * desenho; não reinventar, acompanhar"). Da lâmina 2 em diante a capa (a
 * versão atual dela, anexada) é o guia do sistema visual: o que se repete e o
 * que pode variar. A última lâmina fecha voltando à capa. `capa`: índice da
 * imagem anexada com a capa (null quando a capa ainda não tem arte).
 * `cenaFixa`: foto real ou fundo contínuo (só o texto e o acabamento seguem a capa).
 */
export function blocoDaSerie(e: { ordem: number; total: number; capa: number | null; cenaFixa?: boolean }): string {
  if (e.total < 2 || e.ordem < 2) return "";
  const final = e.ordem === e.total;
  const guia = e.capa ? `a capa (imagem ${e.capa})` : "a capa desta série";
  return [
    `SÉRIE DO CARROSSEL (lâmina ${e.ordem} de ${e.total}): esta lâmina continua ${guia}; não é uma peça nova.`,
    e.cenaFixa
      ? `- A cena desta lâmina já está decidida. Da capa vem o sistema do texto: a mesma tipografia (família, peso, caixa e escala relativa entre headline e apoio), as mesmas cores de texto e de destaque, o mesmo alinhamento e os mesmos elementos gráficos do texto (fios, sublinhados, marcadores), no mesmo traço e espessura.`
      : `- Repita o sistema visual da capa: o mesmo grid e as mesmas margens, as mesmas linhas, formas e elementos gráficos (mesmo traço, espessura, cantos, cor e posição relativa), a mesma tipografia (família, peso, caixa e escala relativa), a mesma paleta e proporção de cores e o mesmo tratamento de foto, luz e textura.`,
    "- Varie só o conteúdo: o texto, a imagem desta lâmina e a posição do bloco dentro do mesmo grid. Não reinvente o estilo, não troque de fonte nem de paleta e não crie elementos gráficos que a capa não tem.",
    "- Não copie o texto nem a composição exata da capa: é a mesma série, não a mesma lâmina.",
    final
      ? "- FECHAMENTO: esta é a última lâmina. Feche voltando à capa: a mesma cor dominante ou o mesmo elemento gráfico e o mesmo enquadramento da capa, como um espelho do começo, com o CTA em destaque."
      : "",
  ].filter(Boolean).join("\n");
}

/** Uma preferência do cliente lida da memória do diretor (agente_memoria). */
export type PreferenciaDoCliente = { tipo: string; texto: string; origem?: string | null };

/**
 * Preferências aprendidas com os ajustes pedidos pela equipe e com as
 * reprovações do cliente (memória do diretor, origem ajuste ou aprovacao):
 * entram no prompt como REGRAS DA MARCA, acima do padrão de design e abaixo do
 * texto exato e do kit (pedido do dono em 25/09: "aprender com os ajustes que
 * eu peço, memória por cliente"). As mais recentes primeiro, sem repetir, até
 * `max` linhas curtas.
 */
export function blocoDasPreferencias(lista: PreferenciaDoCliente[] | null | undefined, max = 8): string {
  const vistas: string[] = [];
  const linhas: string[] = [];
  for (const p of lista ?? []) {
    const t = String(p && p.texto || "").replace(/\s+/g, " ").trim().slice(0, 240);
    if (!t) continue;
    const chave = t.toLowerCase().slice(0, 80);
    if (vistas.indexOf(chave) >= 0) continue;
    vistas.push(chave);
    linhas.push(`- ${p.tipo === "evitar" ? "Evitar: " : ""}${t}`);
    if (linhas.length >= max) break;
  }
  if (!linhas.length) return "";
  return [
    "REGRAS DA MARCA APRENDIDAS COM ESTE CLIENTE (pedidos de ajuste da equipe e do cliente; valem como regra da marca, acima do padrão de design e abaixo do texto exato, da paleta e da logo):",
    ...linhas,
  ].join("\n");
}

/**
 * Lâmina com pessoa ou produto recortado (sem fundo, papel "elemento" com
 * `recortada`): o recorte é posto pelo código do lado oposto ao texto, nunca
 * embaixo dele. Devolve a zona do texto que combina com o lugar do recorte e a
 * caixa do recorte (fração do quadro, 0 a 1). Texto em cima: recorte na faixa
 * de baixo; texto numa coluna: recorte na outra metade, até o chão.
 */
export function lugarDoRecorte(zona: ZonaTexto): { zona: ZonaTexto; caixa: { x0: number; y0: number; x1: number; y1: number } } {
  switch (zona) {
    case "topo-esquerda":
    case "topo-centro":
      return { zona, caixa: { x0: 0.1, y0: 0.47, x1: 0.9, y1: 1 } };
    case "centro":
    case "base-centro":
      return { zona: "topo-centro", caixa: { x0: 0.1, y0: 0.47, x1: 0.9, y1: 1 } };
    case "coluna-direita":
    case "base-direita":
      return { zona: "coluna-direita", caixa: { x0: 0, y0: 0.1, x1: 0.5, y1: 1 } };
    default:
      return { zona: "coluna-esquerda", caixa: { x0: 0.5, y0: 0.1, x1: 1, y1: 1 } };
  }
}

/**
 * Quando o provedor não aceita 4:5, a arte sai em 1024 x 1536 e o quadro
 * 4:5 é o recorte central. O prompt ganha a instrução das faixas.
 */
export function formatoPara2x3(prompt: string): string {
  return `${prompt}\n\nFORMATO DESTA GERAÇÃO: a tela é 1024 x 1536. O quadro 4:5 descrito acima é o recorte central de y=128 a y=1408: componha tudo dentro dele. As faixas de 128 px no topo e na base serão cortadas e recebem só continuação do fundo, sem texto nem logo.`;
}

/** Texto de composição legível (para a tela) a partir do layout. */
export function resumoDaComposicao(layout: LayoutLamina): string {
  return `Texto em ${layout.zona_texto.replace("-", " ")}, alinhado à ${layout.alinhamento}. Ponto focal: ${layout.ponto_focal}. Fundo: ${layout.fundo}. Tratamento: ${layout.tratamento}.`;
}

/**
 * Direção montada do roteiro do calendário, sem IA: cada card do roteiro
 * (texto, ilustração, estilo) vira uma lâmina com layout de variação
 * controlada e prompt composto.
 */
export function direcaoDoRoteiro(
  roteiro: { ordem?: number; funcao?: string; texto?: string; ilustracao?: string; estilo?: string }[],
  marca: MarcaParaDirecao,
  opcoes: { postUnico: boolean; carrosselInfinito: boolean; conceito?: string | null; levaLogo: (ordem: number, total: number) => boolean },
): { conceito: string; carrossel_infinito: boolean; cards: CardDirecao[]; origem: "roteiro" } {
  const base = roteiro
    .filter((c) => c && typeof c.texto === "string" && c.texto.trim())
    .sort((a, b) => Number(a.ordem ?? 0) - Number(b.ordem ?? 0))
    .slice(0, opcoes.postUnico ? 1 : 20);
  const total = base.length;
  const cards: CardDirecao[] = base.map((c, i) => {
    const ordem = i + 1;
    const funcao = ordem === 1 ? "capa" : ordem === total && total > 1 ? "cta" : (c.funcao && /cta|chamada/i.test(c.funcao) ? "cta" : "conteudo");
    const layout = layoutPadrao(funcao, ordem, total);
    if (c.ilustracao) layout.imagem = c.ilustracao.trim();
    if (c.estilo) layout.tratamento = `${c.estilo.trim()}; ${layout.tratamento}`;
    const textoExato = String(c.texto).trim();
    const blocos = blocosDoTexto(textoExato, funcao);
    const card: CardDirecao = {
      ordem,
      funcao,
      texto_exato: textoExato,
      blocos,
      layout,
      composicao: resumoDaComposicao(layout),
      ilustracao: layout.imagem,
      prompt_imagem: "",
    };
    card.prompt_imagem = promptDaLamina(card, marca, {
      total,
      carrosselInfinito: opcoes.carrosselInfinito && total > 1,
      levaLogo: opcoes.levaLogo(ordem, total),
      conceito: opcoes.conceito,
    });
    return card;
  });
  return {
    conceito: opcoes.conceito || "Direção montada do roteiro do calendário, no sistema visual da marca.",
    carrossel_infinito: opcoes.carrosselInfinito && total > 1,
    cards,
    origem: "roteiro",
  };
}

// Carrossel contínuo: o panorama nasce em trechos de até 3 lâminas lado a lado
// (proporção até 2,4:1 no gerador); a primeira lâmina de cada trecho liga ao anterior.
export const LAMINAS_POR_TRECHO = 3;

/** Trecho do panorama que contém a lâmina: 1 a 3, depois 3 a 5, 5 a 7... (a primeira de cada trecho liga ao anterior). */
export function trechoDaLamina(ordem: number, total: number): { inicio: number; fim: number } {
  if (total <= LAMINAS_POR_TRECHO || ordem <= LAMINAS_POR_TRECHO) return { inicio: 1, fim: Math.min(LAMINAS_POR_TRECHO, total) };
  const j = Math.ceil((ordem - LAMINAS_POR_TRECHO) / (LAMINAS_POR_TRECHO - 1));
  const inicio = j * (LAMINAS_POR_TRECHO - 1) + 1;
  return { inicio, fim: Math.min(inicio + LAMINAS_POR_TRECHO - 1, total) };
}
