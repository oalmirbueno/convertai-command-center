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
import { type FidelidadeDaReferencia, FIDELIDADES } from "./fidelidade-da-referencia.ts";

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
  /** Fidelidade à referência desta lâmina (sobrepõe o padrão do trabalho); sem ela, o do trabalho ou Idêntica. */
  fidelidade_referencia?: FidelidadeDaReferencia;
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
export type TipoDoAnexo = "foto_cliente" | "elemento" | "referencia_equipe" | "logo" | "capa" | "sequencia" | "fonte" | "identidade" | "selo";
export const MAX_ANEXOS_DA_LAMINA = 6;
const PRIORIDADE_DO_ANEXO: Record<TipoDoAnexo, number> = {
  foto_cliente: 0,
  elemento: 1,
  referencia_equipe: 2,
  logo: 3,
  capa: 4,
  // Frente E (25/09): quadro de sequência da prancha de referência, logo depois da capa (lâminas 2..N).
  sequencia: 4.5,
  fonte: 5,
  identidade: 6,
  selo: 7,
};
const TETO_DO_TIPO: Record<TipoDoAnexo, number> = { foto_cliente: 1, elemento: 2, referencia_equipe: 2, logo: 1, capa: 1, sequencia: 1, fonte: 1, identidade: 1, selo: 1 };

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

/**
 * A logo que a lâmina usa (escolhida no kit): tom, claridade, proporção e as
 * cores (até 3, da maior para a menor) medidos em código.
 */
export type LogoMedida = { tom: string | null; clara: boolean; aspecto?: number | null; cores?: string[] | null };

/**
 * Leitura por visão do ARQUIVO da logo (feita uma vez e guardada): o texto
 * exatamente como está escrito na logo, as partes com a cor de cada uma e o
 * símbolo. Dono, 26/09: "a logo não tem nada a ver". Sem o nome escrito no
 * prompt, o gerador via só o "iq" verde da AcelerIQ (o "Aceler" é branco) e
 * inventava o resto.
 */
export type LeituraDaLogo = {
  texto: string;
  partes: { texto: string; cor: string }[];
  simbolo: string | null;
};

/** Leitura da logo lida com cuidado (JSON do cache ou do leitor): sem texto nem símbolo, null. */
export function normalizarLeituraDaLogo(bruto: unknown): LeituraDaLogo | null {
  const o = bruto && typeof bruto === "object" ? bruto as Record<string, unknown> : null;
  if (!o) return null;
  const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  const texto = limpo(o.texto ?? o.texto_da_logo, 60);
  const partes = (Array.isArray(o.partes) ? o.partes : [])
    .map((p) => {
      const x = p && typeof p === "object" ? p as Record<string, unknown> : {};
      const cor = [limpo(x.cor_nome, 30), hexOk(x.cor_hex) || hexOk(x.cor) || ""].filter(Boolean).join(" ") || limpo(x.cor, 40);
      return { texto: limpo(x.texto, 40), cor };
    })
    .filter((p) => p.texto && p.cor)
    .slice(0, 4);
  const simbolo = limpo(o.simbolo, 200) || null;
  if (o.confianca === "baixa") return null;
  if (!texto && !simbolo) return null;
  return { texto, partes: texto ? partes : [], simbolo };
}

/**
 * O que a logo é, por escrito, para o prompt: o texto exato (da leitura por
 * visão do arquivo; sem ela, o nome da marca como referência de grafia), as
 * cores de cada parte e o símbolo. Nada inventado: sem leitura, só o nome e as
 * cores medidas em código.
 */
export function descricaoDaLogo(e: { nome?: string | null; leitura?: LeituraDaLogo | null; medida?: LogoMedida | null }): string | null {
  const l = e.leitura;
  const cores = (e.medida?.cores ?? []).filter((c) => hexOk(c)).map((c) => `${nomeDaCor(c)} ${c}`);
  if (l && (l.texto || l.simbolo)) {
    const partes = l.partes.length > 1 || (l.partes.length === 1 && l.partes[0].texto !== l.texto)
      ? ` (${l.partes.map((p) => `"${p.texto}" em ${p.cor}`).join(", ")})`
      : l.partes.length === 1 ? ` em ${l.partes[0].cor}` : "";
    const texto = l.texto ? `As letras da logo formam exatamente "${l.texto}"${partes}, com estas maiúsculas e minúsculas.` : "A logo não tem letras: é só o símbolo.";
    return `${texto}${l.simbolo ? ` Símbolo: ${l.simbolo}.` : ""}${cores.length ? ` Cores medidas no arquivo: ${cores.join(", ")}.` : ""}`;
  }
  const nome = String(e.nome || "").trim();
  if (!nome && !cores.length) return null;
  return `${nome ? `A logo é a da marca ${nome}: copie as letras exatamente como estão no anexo (todas elas, inclusive as brancas ou claras), sem trocar nem tirar nenhuma.` : ""}${cores.length ? ` Cores medidas no arquivo: ${cores.join(", ")}.` : ""}`.trim();
}

/** A cor mais escura da paleta (para a área da logo clara) ou a mais clara (para a logo escura). */
export function corOpostaNaPaleta(paleta: MarcaParaDirecao["paleta"], logoClara: boolean | null): string | null {
  if (logoClara === null) return null;
  const cores = paleta.map((p) => hexOk(p.hex)).filter(Boolean) as string[];
  if (!cores.length) return null;
  return cores.reduce((m, c) => ((logoClara ? luminancia(c) < luminancia(m) : luminancia(c) > luminancia(m)) ? c : m));
}

/** Nome simples de uma cor hex (para o gerador ler "branco", "verde"...). */
export function nomeDaCor(hex: string): string {
  const h = hexOk(hex);
  if (!h) return "cor";
  const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 28) return max > 225 ? "branco" : max < 45 ? "preto" : max > 160 ? "cinza claro" : "cinza";
  const matiz = (() => {
    const d = max - min;
    let m = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    m *= 60;
    return m < 0 ? m + 360 : m;
  })();
  if (matiz < 15 || matiz >= 345) return "vermelho";
  if (matiz < 40) return "laranja";
  if (matiz < 65) return "amarelo";
  if (matiz < 165) return "verde";
  if (matiz < 200) return "ciano";
  if (matiz < 255) return "azul";
  if (matiz < 290) return "roxo";
  return "rosa";
}

/**
 * Legenda do anexo da logo. O anexo é a logo ACHATADA sobre um fundo liso de
 * contraste (logoSobreContraste, imagem-local.ts): cinza-escuro para a logo
 * clara, quase branco para a escura. A legenda avisa que esse fundo é só para
 * enxergar as letras e repete o texto exato da logo.
 */
export function legendaDaLogo(e: { clara?: boolean | null; texto?: string | null; comFundo?: boolean }): string {
  const fundo = e.comFundo === false
    ? ""
    : e.clara
    ? " Ela está sobre um fundo cinza-escuro liso SÓ para você enxergar as partes claras; esse fundo não faz parte da logo e não vai para a arte."
    : " Ela está sobre um fundo claro liso SÓ para você enxergar a logo; esse fundo não faz parte da logo e não vai para a arte.";
  return `LOGO OFICIAL da marca${e.texto ? ` (as letras dizem "${e.texto}")` : ""}: reproduza exatamente esta logo, com todas as letras, o símbolo, as cores e a proporção; não redesenhe, não invente símbolo e não ponha caixa ou retângulo atrás dela.${fundo}`;
}

/** Mantido para quem ainda importa a constante (sem o fundo de contraste). */
export const LEGENDA_DA_LOGO = legendaDaLogo({ comFundo: false });

/**
 * Bloco LOGO do prompt. `areaFixa`: a máscara só deixa o gerador desenhar ali
 * (foto real fixa e contínuo), então a logo vai dentro dela. `lugarNoMolde`:
 * replicando a referência, o lugar da marca dela (medido), mas no tamanho da
 * marca deste cliente (a referência não diminui a logo). `descricao`: o texto
 * exato e as cores da logo (descricaoDaLogo).
 */
export function blocoDaLogo(e: {
  levaLogo: boolean;
  temLogo: boolean;
  quadro: { largura: number; altura: number };
  logo?: LogoMedida | null;
  areaFixa?: Caixa | null;
  replicar?: boolean;
  lugarNoMolde?: Caixa | null;
  anuncio?: boolean;
  foto?: boolean;
  descricao?: string | null;
  /**
   * Cor dominante do fundo da lâmina (hex) e a cor da paleta para a área da
   * logo quando o fundo tem o mesmo valor dela (logo clara em fundo claro): a
   * composição ganha uma parte escura (ou clara) do grid para a logo pousar.
   */
  fundoDaLamina?: string | null;
  corParaALogo?: string | null;
}): string[] {
  if (!e.levaLogo) return ["- Sem logo nesta lâmina: não desenhe logo, símbolo nem marca."];
  if (!e.temLogo) return ["- A logo oficial ainda não foi enviada em imagem: NÃO desenhe nem invente logo, símbolo ou marca; deixe só um respiro no canto onde ela entraria."];
  const t = tamanhoDaLogo(e.quadro, e.logo?.aspecto ?? null);
  const margens = `dentro das margens${e.anuncio ? " e da zona segura" : ""}`;
  const lugar = e.areaFixa
    ? `- Lugar: dentro da área reservada para ela (${descreverPosicao(e.areaFixa)}), alinhada ao lado de fora dessa área; é a única área, além da do texto, em que a imagem muda.`
    : e.lugarNoMolde
    ? `- Lugar: onde a referência põe a marca dela (${descreverPosicao(e.lugarNoMolde)}), ${margens}. A referência só orienta o lugar: a logo fica no tamanho acima, nunca menor.`
    : e.replicar
    ? `- Lugar: alinhada ao bloco de texto principal, numa área sem texto, ${margens}. A logo fica no tamanho acima, nunca menor.`
    : `- Lugar: faz parte da composição, alinhada ao mesmo eixo e à mesma margem do bloco de texto (acima da headline ou abaixo do apoio ou do CTA) ou no ponto que o layout pedir, ${margens}, com respiro em volta; nunca no canto superior direito, nunca sobre rosto, mão ou produto.`;
  const contraste = e.logo
    ? e.logo.clara
      ? " A logo tem letras ou partes claras: ela fica sobre uma área ESCURA da própria arte (fundo escuro, sombra, parte escura da foto), inteira, com todas as letras legíveis; nunca sobre fundo claro, onde as partes claras somem."
      : ` A logo é escura ou colorida${e.logo.tom ? ` (tom dominante ${e.logo.tom})` : ""}: ela fica sobre uma área CLARA da própria arte, inteira e legível, nunca sobre a mesma cor nem o mesmo valor da logo.`
    : " Nunca ponha a logo sobre fundo da mesma cor dela.";
  // Logo clara em lâmina clara (ou escura em escura): a logo branca da AcelerIQ sumia no fundo claro (26/09).
  const valorDoFundo = valorDaCor(e.fundoDaLamina ?? null);
  const semContraste = !!e.logo && !e.areaFixa && valorDoFundo !== null && (e.logo.clara ? valorDoFundo >= 160 : valorDoFundo <= 90);
  const areaDaLogo = semContraste
    ? `- O fundo desta lâmina é ${e.logo!.clara ? "claro" : "escuro"} e a logo é ${e.logo!.clara ? "clara" : "escura"}: a composição tem uma parte ${e.logo!.clara ? "escura" : "clara"} para ela (uma faixa do grid de borda a borda${e.corParaALogo ? ` em ${e.corParaALogo}` : ""}, uma área de sombra ou um objeto ${e.logo!.clara ? "escuro" : "claro"} da cena) e a logo fica nessa parte, nunca direto no fundo ${e.logo!.clara ? "claro" : "escuro"}.`
    : "";
  return [
    "- Logo oficial anexada, desenhada junto com a arte e idêntica ao anexo (mesmas letras, símbolo, cores e proporção); não redesenhe nem troque por outro texto. Uma logo só.",
    e.descricao ? `- O que a logo é: ${e.descricao}` : "",
    `- Tamanho: cerca de ${t.largura} x ${t.altura} px numa arte de ${e.quadro.largura} x ${e.quadro.altura} (${t.larguraPct}% da largura), nunca menor que ${t.larguraMinima} x ${t.alturaMinima} px: legível de longe, nunca um detalhe pequenininho.`,
    lugar,
    `-${contraste} A logo entra direto sobre a arte, sem caixa, cartão, retângulo ou fundo próprio atrás, exatamente como o desenho dela.`,
    areaDaLogo,
  ].filter(Boolean);
}

// ------------------------------------------------------------ padrão e proibições

/**
 * Padrão de design da lâmina, curto e sem repetir o que já está nos blocos
 * (mesmas regras de PADRAO_NA_IMAGEM, conhecimento-design.ts, na forma que o
 * gerador segue melhor: frases diretas, uma regra por linha).
 */
/**
 * 27/09 (dono: "não usa as técnicas, está feio, não está igual ao começo"): o
 * padrão tinha sido cortado para 3 linhas em 26/09 e perdeu as técnicas que
 * estavam no prompt de 23 e 24/09 (PADRAO_NA_IMAGEM): planos de profundidade,
 * recorte intencional, cores da foto puxadas para a paleta, eixo e margem
 * comuns, agrupamento e o "rei da lâmina". Voltaram, uma regra por linha, sem
 * a linha "nunca escreva o nome da marca" (contradizia a logo com letras).
 */
export const PADRAO_DA_LAMINA = [
  "PADRÃO DE DESIGN (técnicas que valem em toda lâmina)",
  "- Hierarquia: no máximo 3 níveis e um só ponto focal (o rei da lâmina); a headline domina, com pelo menos 3 vezes a altura do apoio, e o segundo maior elemento tem no máximo metade do primeiro.",
  "- Grid: todos os blocos no mesmo eixo e na mesma margem; texto do mesmo assunto agrupado e blocos diferentes bem afastados; pelo menos 30% da arte em respiro ou fundo calmo.",
  "- Profundidade: foto e texto na mesma cena, em planos (fundo, texto, sujeito), com recorte intencional, uma luz coerente e as cores da foto puxadas para a paleta; objeto recortado pousa com sombra de contato, sem halo nem caixa.",
  "- Leitura: texto só sobre área calma e uniforme da foto, painel sólido do grid ou gradiente local suave; contraste forte, legível até em preto e branco e no tamanho da miniatura do feed.",
  "- Letras nítidas e íntegras, no máximo 2 famílias, sem esticar, sem contorno, sem sombra pesada, nada justificado nem hifenizado; acentos do português exatos (ã, õ, ç, é, ê, á, ó); nenhuma palavra sozinha na última linha.",
  "- Cor: paleta da marca em 60-30-10; a cor de destaque (até 10% da área) só na palavra-chave, no número ou no CTA.",
  "- Acabamento de agência premium: foto real do nicho, pele, mãos e rostos naturais, sombras coerentes, grão sutil só se o estilo pedir.",
].join("\n");

/**
 * Proibições explícitas (dono, 26/09: "muitas alucinações nas demais
 * lâminas"): o gerador inventava texto, gente, objetos e marcas que ninguém
 * pediu. Valem em todos os modos.
 *
 * 27/09: duas linhas de 26/09 pioravam a arte. "Nenhum texto... sem nome da
 * marca" brigava com a logo (que TEM o nome escrito) e ajudava o gerador a
 * cortar as letras da logo; "nenhuma pessoa, mão, objeto... que a direção não
 * pediu" esvaziava a cena (lâmina sem objetos de apoio, feia). Agora o texto
 * da logo é a exceção declarada e a regra da cena veta o que sobra (pessoa a
 * mais, objeto solto, outra marca, duplicado), não o cenário natural.
 */
export function blocoDasProibicoes(e: { serie: boolean; replicar?: boolean }): string {
  return [
    "PROIBIDO",
    "- Nenhum texto além do texto exato e das letras da própria logo oficial: sem o nome da marca escrito fora da logo, site, telefone, @, hashtag, preço, data, marca d'água, legenda ou letras de enfeite.",
    "- Nenhuma logo ou marca de outra empresa, pessoa a mais, objeto solto sem função, ícone de banco de imagens ou elemento repetido ou duplicado; os objetos de apoio são só os que a cena pede ou teria naturalmente.",
    "- Pessoas com anatomia correta e natural: cabeça alinhada ao corpo, pescoço natural, cinco dedos em cada mão, mãos segurando os objetos de um jeito possível, braços e pernas inteiros e na proporção certa.",
    e.replicar
      ? "- Sem moldura, borda, contorno ou cantos arredondados em volta da arte; o fundo vai até a borda. Faixas e formas gráficas só as da referência, nas cores da marca."
      : "- Sem moldura, borda, contorno ou cantos arredondados em volta da arte; o fundo vai até a borda. Faixas e formas gráficas só as do layout da marca.",
    e.replicar
      ? "- Não escureça a imagem para criar destaque. Evite: neon, brilho, 3D plástico, gradiente roxo e azul que a referência não tenha."
      : "- Não escureça a imagem para criar destaque. Evite: tudo centralizado e do mesmo tamanho, faixa preta genérica, gradiente roxo e azul, neon, brilho, 3D plástico, ícones de banco.",
    e.serie ? "- Não copie o texto das outras lâminas da série." : "",
    "- Sem travessão no texto.",
  ].filter(Boolean).join("\n");
}

/**
 * Prompt final da lâmina, montado em código a partir da direção e da marca
 * (modos normal, série, foto real, recorte, contínuo e anúncio; o replicar
 * referência tem prompt próprio, promptDoReplicar, sem a cena do diretor).
 *
 * Ordem (27/09, volta à de 23 e 24/09, quando o dono aprovou): primeiro a
 * IMAGEM E COMPOSIÇÃO (o que a arte é), depois o TEXTO EXATO, a LOGO, a
 * MARCA, o FORMATO, o padrão de design e as proibições. Em 26/09 a imagem
 * tinha ido para o 4º lugar com "4) a composição" na lista de prioridade: o
 * gerador passou a tratar a cena como detalhe e a arte ficou pobre. A regra de
 * desempate continua (texto, logo, marca, composição), escrita por nome.
 */
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
    /** Logo escolhida, medida em código: tom dominante, se é clara, a proporção e as cores. */
    logo?: LogoMedida | null;
    /** O que a logo é por escrito (texto exato e cores, descricaoDaLogo). */
    logoDescricao?: string | null;
    /** Descrição da foto real anexada como base: o gerador não redesenha a foto. */
    fotoReal?: string | null;
    /**
     * Área em que a máscara deixa o gerador desenhar a logo (foto real fixa e
     * carrossel contínuo), em percentual do quadro. Sem ela, o lugar vem da composição.
     */
    areaDaLogo?: Caixa | null;
    /** Criativo de anúncio (trabalho tipo 'ads'): quadro, zona segura e regras do formato. */
    anuncio?: { formato: FormatoCriativo } | null;
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
  const linhasBlocos = blocos.map((b, i) => {
    const t = tamanhos[i];
    const fonte = b.papel === "headline" || b.papel === "numero" ? fonteTitulo : fonteTexto;
    const cor = b.papel === "cta" || b.papel === "numero" ? corDestaque || corTexto : corTexto;
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

  return [
    formato
      ? `ARTE FINAL de criativo de anúncio para tráfego pago na Meta (Facebook e Instagram), formato ${TAMANHO_DO_FORMATO[formato].rotulo}${serie ? `, carrossel de anúncio, card ${card.ordem} de ${opcoes.total}` : ""}. ` +
        (serie
          ? `Função deste card: ${capa ? "capa (parar a rolagem da pessoa certa com o gancho)" : card.funcao === "cta" ? "fechamento com a oferta e a chamada para ação" : "um passo da sequência (uma ideia só)"}.`
          : "Uma peça só, com uma mensagem só: parar a rolagem da pessoa certa, fazer entender a oferta em 1 segundo e levar à ação.")
      : `ARTE FINAL de ${opcoes.total > 1 ? `carrossel, lâmina ${card.ordem} de ${opcoes.total}` : "post único"} para o Instagram da marca. Função desta lâmina: ${capa ? "capa (parar a rolagem com um gancho forte)" : card.funcao === "cta" ? "fechamento com chamada para ação" : "conteúdo (uma ideia só)"}.`,
    opcoes.conceito ? `Conceito do conjunto: ${opcoes.conceito}` : "",
    "Em conflito entre regras, vale nesta ordem: o texto exato, a logo oficial no tamanho pedido, as cores e as fontes da marca, a composição e o acabamento.",
    "",
    "1. IMAGEM E COMPOSIÇÃO",
    foto
      ? `- Imagem: a FOTO REAL do cliente anexada como imagem 1 (${opcoes.fotoReal}) é a base desta lâmina. Não redesenhe a foto: pessoas, objetos, ambiente, luz, cores, corte e enquadramento ficam exatamente como estão. Desenhe só o texto e a logo, direto sobre a foto, sem painel, véu, caixa ou desfoque atrás deles.`
      : `- Imagem: ${layout.imagem}.${card.ilustracao && card.ilustracao !== layout.imagem ? ` Detalhe: ${card.ilustracao}.` : ""}`,
    opcoes.fioVisual && serie && !foto
      ? `- CONTINUIDADE DA SÉRIE (obrigatório): ${opcoes.fioVisual.replace(/\s+/g, " ").trim().slice(0, 600).replace(/([^.!?])$/, "$1.")} Mantenha a mesma protagonista, cenário e luz em todas as lâminas; varia só a pose, o gesto e o enquadramento.`
      : "",
    foto && capa
      ? "- CAPA QUE PARA A ROLAGEM: a maior headline do conjunto, em peso black, com a palavra-chave na cor de destaque, legível até no tamanho da miniatura do feed. A foto já é o elemento visual forte: não mude a foto. Nada competindo com a headline."
      : anuncio && capa
      ? "- CRIATIVO QUE PARA A ROLAGEM: headline curta e grande, em peso black, com a palavra-chave na cor de destaque; um elemento visual forte e inesperado ligado à oferta (escala grande, recorte ousado, produto ou serviço em ação, rosto ou olhar para a câmera); contraste pela escala e pela cor de destaque, legível na tela do celular. Nada competindo com a headline."
      : capa
      ? "- CAPA QUE PARA A ROLAGEM: quem está rolando o feed tem que parar aqui. A maior headline do conjunto, em peso black, com a palavra-chave na cor de destaque; um elemento visual forte e inesperado (escala grande, recorte ousado, objeto cortado pela borda, rosto ou olhar para a câmera, gesto em ação); contraste pela escala e pela cor de destaque, legível até no tamanho da miniatura do feed; mesma luz, cenário e paleta das lâminas seguintes. Nada competindo com a headline."
      : "",
    foto
      ? `- O texto fica na área indicada (${layout.zona_texto.replace("-", " ")}), sobre a parte mais calma da foto; o contraste vem da cor e do peso das letras, nunca de escurecer ou cobrir a foto.`
      : `- O sujeito da foto fica do lado oposto à área do texto (${layout.zona_texto.replace("-", " ")}); essa área é calma e uniforme na própria foto (parede, céu, sombra, fundo desfocado) ou recebe um painel da paleta alinhado ao grid.`,
    foto ? "" : `- Ponto focal: ${layout.ponto_focal}.`,
    foto ? "" : `- Fundo: ${layout.fundo}${corFundo ? ` (cor dominante ${corFundo})` : ""}.`,
    foto ? "" : `- Tratamento: ${layout.tratamento}.`,
    marca.estilo && !foto ? `- Estilo visual da marca, obrigatório: ${marca.estilo}` : "",
    "",
    "2. TEXTO EXATO (escrito pela própria arte, integrado à composição; só isto, com esta grafia e acentuação, e nenhuma outra palavra)",
    `- Área do texto: ${descreverPosicao(caixa)}, alinhamento ${layout.alinhamento === "centro" ? "ao centro" : `à ${layout.alinhamento}`}, todos os blocos no mesmo eixo e com a mesma margem.`,
    ...linhasBlocos,
    temBarra ? "- A barra ( / ) marca a quebra de linha: quebre a linha ali e não desenhe a barra." : "",
    `- A headline tem cerca de 3 vezes a altura do texto de apoio e cada linha dela ocupa cerca de ${linhaHeadline}% da altura do quadro. O apoio ocupa uma coluna de no máximo 66% da largura, com linhas de 25 a 38 caracteres.`,
    "- Headline e apoio formam um grupo, a 16 a 32 px um do outro; CTA, selo e logo ficam a pelo menos 96 px desse grupo. Entrelinha da headline de 1,0 a 1,1, sem acento encostando na linha de cima; entrelinha do apoio de 1,3 a 1,5.",
    "",
    "3. LOGO",
    ...blocoDaLogo({
      levaLogo: opcoes.levaLogo,
      temLogo: marca.temLogo,
      quadro,
      logo: opcoes.logo ?? null,
      areaFixa: opcoes.areaDaLogo ?? null,
      anuncio,
      foto,
      descricao: opcoes.logoDescricao ?? null,
      fundoDaLamina: foto ? null : corFundo,
      corParaALogo: corOpostaNaPaleta(paleta, opcoes.logo ? opcoes.logo.clara : null),
    }),
    "",
    "4. MARCA",
    `- Paleta (use só estas cores, na proporção 60-30-10, com um destaque único): ${paletaTxt}.`,
    fonteTitulo || fonteTexto
      ? `- Tipografia: títulos em ${fonteTitulo || fonteTexto}, texto em ${fonteTexto || fonteTitulo}. Se houver amostra da fonte anexada, siga o desenho exato das letras da amostra.`
      : "- Tipografia: siga a tipografia das artes da marca anexadas (mesma classificação, peso e caixa).",
    marca.tipografiaCitada?.observacao ? `- Observação da marca sobre tipografia: ${marca.tipografiaCitada.observacao}` : "",
    marca.estilo && foto ? `- Estilo visual da marca, no texto e nos elementos gráficos: ${marca.estilo}` : "",
    marca.regras ? `- Regras da marca: ${marca.regras.replace(/\n+/g, " ")}` : "",
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
    PADRAO_DA_LAMINA,
    "",
    blocoDasProibicoes({ serie }),
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

// ------------------------------------------------------ modo replicar referência
//
// Dono, 25/09: "escolhi a referência e a imagem e gerou nada a ver"; "faz
// idêntico à referência com a identidade visual da empresa, o conteúdo da
// empresa, com a foto". Dono, 26/09: "está errando tudo, não segue nada da
// referência, não usa as técnicas".
//
// Causa medida em 26/09 (trabalhos 615faaf6 e ad77eb82): o prompt do replicar
// era o bloco da referência SEGUIDO do prompt inteiro da lâmina, com a cena do
// diretor ("Imagem: mão segurando uma folha de checklist..."), o fio visual da
// série, o conceito, o estilo da marca (cenas de escritório), a zona do texto,
// o padrão ("nada centralizado", "texto sobre área calma") e as proibições
// ("nenhuma pessoa que a direção não pediu"). A referência, sem nenhuma
// medida (3 das 4 escolhidas nem tinham leitura), perdia para essa descrição
// detalhada e saía a cena do diretor. Agora o replicar tem prompt PRÓPRIO:
// nada da cena do diretor, e o layout vem do MOLDE, a leitura por visão da
// referência como especificação (blocos com posição e tamanho em %, caixa,
// família, peso, cor por papel, assunto e enquadramento, elementos, fundo),
// feita uma vez e guardada. Cada bloco do molde é mapeado em código para um
// bloco de texto desta lâmina.

/** Versão do formato do molde guardado: sobe quando o esquema muda (o cache antigo é lido de novo). */
export const VERSAO_DO_MOLDE = 1;

export type PapelNoMolde = "titulo" | "subtitulo" | "texto" | "rotulo" | "cta" | "numero" | "marca" | "perfil";
const PAPEIS_NO_MOLDE: PapelNoMolde[] = ["titulo", "subtitulo", "texto", "rotulo", "cta", "numero", "marca", "perfil"];

export type BlocoDoMolde = Caixa & {
  papel: PapelNoMolde;
  /** Altura de uma letra maiúscula, em % da altura do quadro. */
  altura_da_letra: number;
  linhas: number;
  caixa_alta: boolean;
  familia: string;
  largura_da_letra: string;
  peso: string;
  cor: string | null;
  alinhamento: "esquerda" | "centro" | "direita";
};

export type MoldeDaReferencia = {
  versao: number;
  proporcao: string;
  fundo: string;
  cor_do_fundo: string | null;
  grade: string;
  assunto: (Caixa & { tipo: "pessoa" | "produto" | "objeto" | "cena" | "nenhum"; descricao: string; enquadramento: string }) | null;
  blocos: BlocoDoMolde[];
  elementos: (Caixa & { descricao: string; cor: string | null })[];
  tratamento: string;
};

const caixaNoEsquema = { x0: { type: "number" }, y0: { type: "number" }, x1: { type: "number" }, y1: { type: "number" } };

/** Esquema da leitura do molde (visão, modelo de leitura do catálogo). */
export const ESQUEMA_MOLDE = {
  nome: "molde_da_referencia",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["proporcao", "fundo", "cor_do_fundo", "grade", "assunto", "blocos", "elementos", "tratamento"],
    properties: {
      proporcao: { type: "string" },
      fundo: { type: "string" },
      cor_do_fundo: { type: "string" },
      grade: { type: "string" },
      assunto: {
        type: "object",
        additionalProperties: false,
        required: ["tipo", "descricao", "enquadramento", "x0", "y0", "x1", "y1"],
        properties: {
          tipo: { type: "string", enum: ["pessoa", "produto", "objeto", "cena", "nenhum"] },
          descricao: { type: "string" },
          enquadramento: { type: "string" },
          ...caixaNoEsquema,
        },
      },
      blocos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["papel", "x0", "y0", "x1", "y1", "altura_da_letra", "linhas", "caixa_alta", "familia", "largura_da_letra", "peso", "cor", "alinhamento"],
          properties: {
            papel: { type: "string", enum: PAPEIS_NO_MOLDE },
            ...caixaNoEsquema,
            altura_da_letra: { type: "number" },
            linhas: { type: "integer" },
            caixa_alta: { type: "boolean" },
            familia: { type: "string", enum: ["sem serifa", "serifada", "manuscrita", "display", "monoespacada"] },
            largura_da_letra: { type: "string", enum: ["condensada", "normal", "larga"] },
            peso: { type: "string", enum: ["black", "negrito", "medio", "regular", "fino"] },
            cor: { type: "string" },
            alinhamento: { type: "string", enum: ["esquerda", "centro", "direita"] },
          },
        },
      },
      elementos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["descricao", "cor", "x0", "y0", "x1", "y1"],
          properties: { descricao: { type: "string" }, cor: { type: "string" }, ...caixaNoEsquema },
        },
      },
      tratamento: { type: "string" },
    },
  },
};

export const SISTEMA_MOLDE = `Você mede o LAYOUT de uma peça de referência para um estúdio replicar a mesma estrutura com outra marca e outro texto. Meça; não copie o texto nem a marca da peça.
Coordenadas: porcentagem do quadro da imagem, de 0 a 100, com 0 no canto superior esquerdo (x para a direita, y para baixo). Cada caixa é a menor caixa que contém o elemento.
- blocos: CADA bloco de texto visível, do maior para o menor, inclusive textos pequenos de canto, o @perfil (papel perfil) e a marca ou logo da peça (papel marca). papel: titulo (o maior texto), subtitulo, texto (corrido), rotulo (texto pequeno de canto, selo, data), cta (chamada para ação ou botão), numero (número protagonista). altura_da_letra: altura de uma letra maiúscula em % da altura do quadro. linhas: quantas linhas o bloco tem. caixa_alta: se está todo em maiúsculas. familia, largura_da_letra (condensada, normal, larga) e peso como se veem. cor: hex aproximado da letra. alinhamento do bloco.
- assunto: o elemento visual principal (pessoa, produto, objeto, cena; nenhum quando a peça é só tipografia), com a caixa dele, uma descrição curta SEM marcas nem nomes e o enquadramento (plano, ângulo, recorte pela borda, olhar).
- elementos: formas, faixas, fios, setas, telas de celular, molduras, ícones, texturas e fotos secundárias, até 8, com caixa e cor em hex.
- fundo: como é o fundo (cor lisa, foto, gradiente, textura); cor_do_fundo: hex da cor dominante do fundo.
- grade: em até 2 frases, a divisão do quadro (ex.: título ocupa a faixa de cima inteira; pessoa centralizada da metade para baixo; textos pequenos nos quatro cantos).
- tratamento: em até 2 frases, luz, contraste, textura e acabamento.
Na grade, no fundo, no tratamento e nas descrições não cite cores por nome nem em hex: as cores vão só nos campos de cor, porque serão trocadas pelas da outra marca.
- proporcao: largura:altura aproximada do quadro (ex.: 4:5).
Escreva em português, sem travessão.`;

const numeroPct = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10) / 10)) : 0;
};
const caixaPct = (o: Record<string, unknown>): Caixa => {
  const xa = numeroPct(o.x0), xb = numeroPct(o.x1), ya = numeroPct(o.y0), yb = numeroPct(o.y1);
  return { x0: Math.min(xa, xb), x1: Math.max(xa, xb), y0: Math.min(ya, yb), y1: Math.max(ya, yb) };
};
const textoCurto = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").split(String.fromCharCode(8212)).join(",").split(String.fromCharCode(8211)).join(",").trim().slice(0, max) : "");
const umDe = <T extends string>(v: unknown, lista: readonly T[], padrao: T): T => (lista.indexOf(v as T) >= 0 ? v as T : padrao);

/** Molde lido com cuidado (JSON do leitor ou do cache): números no quadro, textos curtos, listas com teto. Null quando não há bloco de texto nenhum. */
export function normalizarMolde(bruto: unknown): MoldeDaReferencia | null {
  const o = bruto && typeof bruto === "object" ? bruto as Record<string, unknown> : null;
  if (!o) return null;
  const blocos: BlocoDoMolde[] = (Array.isArray(o.blocos) ? o.blocos : [])
    .filter((b) => b && typeof b === "object")
    .map((b) => {
      const x = b as Record<string, unknown>;
      const c = caixaPct(x);
      return {
        ...c,
        papel: umDe(x.papel, PAPEIS_NO_MOLDE, "texto"),
        altura_da_letra: Math.max(0.5, Math.min(40, Number(x.altura_da_letra) || 2)),
        linhas: Math.max(1, Math.min(12, Math.round(Number(x.linhas) || 1))),
        caixa_alta: x.caixa_alta === true,
        familia: umDe(x.familia, ["sem serifa", "serifada", "manuscrita", "display", "monoespacada"] as const, "sem serifa"),
        largura_da_letra: umDe(x.largura_da_letra, ["condensada", "normal", "larga"] as const, "normal"),
        peso: umDe(x.peso, ["black", "negrito", "medio", "regular", "fino"] as const, "regular"),
        cor: hexOk(x.cor),
        alinhamento: umDe(x.alinhamento, ["esquerda", "centro", "direita"] as const, "esquerda"),
      };
    })
    .filter((b) => b.x1 - b.x0 >= 0.5 && b.y1 - b.y0 >= 0.3)
    .slice(0, 12);
  if (!blocos.some((b) => b.papel !== "marca" && b.papel !== "perfil")) return null;
  const a = o.assunto && typeof o.assunto === "object" ? o.assunto as Record<string, unknown> : null;
  const tipo = a ? umDe(a.tipo, ["pessoa", "produto", "objeto", "cena", "nenhum"] as const, "nenhum") : "nenhum";
  const elementos = (Array.isArray(o.elementos) ? o.elementos : [])
    .filter((e) => e && typeof e === "object")
    .map((e) => {
      const x = e as Record<string, unknown>;
      return { ...caixaPct(x), descricao: textoCurto(x.descricao, 120), cor: hexOk(x.cor) };
    })
    .filter((e) => e.descricao)
    .slice(0, 8);
  return {
    versao: VERSAO_DO_MOLDE,
    proporcao: textoCurto(o.proporcao, 10),
    fundo: textoCurto(o.fundo, 200),
    cor_do_fundo: hexOk(o.cor_do_fundo),
    grade: textoCurto(o.grade, 300),
    assunto: a && tipo !== "nenhum"
      ? { ...caixaPct(a), tipo, descricao: textoCurto(a.descricao, 200), enquadramento: textoCurto(a.enquadramento, 160) }
      : null,
    blocos,
    elementos,
    tratamento: textoCurto(o.tratamento, 300),
  };
}

/**
 * O molde no quadro desta lâmina: a imagem 1 (o molde editado) é a referência
 * recortada em "cover" pelo centro no quadro da lâmina (cobrir), então as
 * posições medidas no quadro da referência são convertidas para o recorte.
 * Blocos que caem inteiros fora do recorte saem.
 */
export function moldeNoQuadro(m: MoldeDaReferencia, origem: { largura: number; altura: number } | null, quadro: { largura: number; altura: number }): MoldeDaReferencia {
  if (!origem || !origem.largura || !origem.altura) return m;
  const ro = origem.largura / origem.altura, rq = quadro.largura / quadro.altura;
  if (Math.abs(ro - rq) / rq < 0.02) return m;
  const fx = ro > rq ? rq / ro : 1;
  const fy = ro > rq ? 1 : ro / rq;
  const cx = (v: number) => numeroPct((v - (1 - fx) * 50) / fx);
  const cy = (v: number) => numeroPct((v - (1 - fy) * 50) / fy);
  const conv = <T extends Caixa>(c: T): T => ({ ...c, x0: cx(c.x0), x1: cx(c.x1), y0: cy(c.y0), y1: cy(c.y1) });
  const visivel = (c: Caixa) => c.x1 - c.x0 >= 0.5 && c.y1 - c.y0 >= 0.3;
  return {
    ...m,
    blocos: m.blocos.map((b) => ({ ...conv(b), altura_da_letra: Math.round((b.altura_da_letra / fy) * 10) / 10 })).filter(visivel),
    elementos: m.elementos.map(conv).filter(visivel),
    assunto: m.assunto ? conv(m.assunto) : null,
  };
}

/** O lugar de cada bloco de texto desta lâmina no molde, os blocos do molde que ficam sem texto e o lugar da marca. */
export type MapaNoMolde = {
  lugares: { bloco: BlocoTexto; alvo: BlocoDoMolde | null }[];
  vagos: BlocoDoMolde[];
  marca: BlocoDoMolde | null;
};

/**
 * Mapeia o texto desta lâmina nos blocos do molde, em código: a headline (ou
 * o número) vai no maior título; o CTA no CTA (senão no menor que sobrar); o
 * subtítulo no subtítulo; apoio no texto corrido; selo no rótulo; o resto
 * pelo tamanho. Blocos do molde sem texto correspondente ficam vagos (sem
 * texto: nunca se inventa texto para preencher). Marca ou @perfil do molde é
 * o lugar da logo.
 */
export function mapearNoMolde(blocos: BlocoTexto[], m: MoldeDaReferencia): MapaNoMolde {
  const area = (b: Caixa) => (b.x1 - b.x0) * (b.y1 - b.y0);
  const livres = m.blocos
    .filter((b) => b.papel !== "marca" && b.papel !== "perfil")
    .sort((a, b) => b.altura_da_letra - a.altura_da_letra || area(b) - area(a));
  const tirar = (...testes: ((b: BlocoDoMolde) => boolean)[]) => {
    for (const t of testes) {
      const i = livres.findIndex(t);
      if (i >= 0) return livres.splice(i, 1)[0];
    }
    return null;
  };
  const qualquer = () => true;
  const ordem: PapelBloco[] = ["headline", "numero", "subtitulo", "apoio", "cta", "selo"];
  const alvos = new Map<number, BlocoDoMolde | null>();
  blocos
    .map((b, i) => ({ b, i }))
    .sort((x, y) => ordem.indexOf(x.b.papel) - ordem.indexOf(y.b.papel) || x.i - y.i)
    .forEach(({ b, i }) => {
      let alvo: BlocoDoMolde | null = null;
      if (b.papel === "headline" || b.papel === "numero") alvo = tirar((x) => x.papel === "titulo" || x.papel === "numero", qualquer);
      else if (b.papel === "cta") alvo = tirar((x) => x.papel === "cta", (x) => x.papel === "rotulo", (x) => x.papel === "texto", (x) => x.papel !== "titulo" && x.papel !== "numero");
      else if (b.papel === "subtitulo") alvo = tirar((x) => x.papel === "subtitulo", (x) => x.papel === "texto", (x) => x.papel !== "cta");
      else if (b.papel === "selo") alvo = tirar((x) => x.papel === "rotulo", (x) => x.papel !== "cta" && x.papel !== "titulo");
      else alvo = tirar((x) => x.papel === "texto", (x) => x.papel === "subtitulo", (x) => x.papel === "rotulo", (x) => x.papel !== "cta");
      alvos.set(i, alvo);
    });
  return {
    lugares: blocos.map((b, i) => ({ bloco: b, alvo: alvos.get(i) ?? null })),
    vagos: livres,
    marca: m.blocos.find((b) => b.papel === "marca") || m.blocos.find((b) => b.papel === "perfil") || null,
  };
}

/** Saturação (0 a 1) de um hex, para saber se a cor é neutra (preto, branco, cinza) ou colorida. */
function saturacao(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/**
 * A cor da marca que faz o papel da cor da referência: neutra (preto, branco,
 * cinza) vira a neutra da paleta de claridade mais próxima; colorida vira o
 * destaque da marca (ou a colorida da paleta). Sem paleta, null.
 */
export function corDaMarcaNoPapel(corDaReferencia: string | null, paleta: MarcaParaDirecao["paleta"]): string | null {
  const h = hexOk(corDaReferencia);
  const cores = paleta.map((p) => hexOk(p.hex)).filter(Boolean) as string[];
  if (!h || !cores.length) return null;
  const neutras = cores.filter((c) => saturacao(c) < 0.25);
  const coloridas = cores.filter((c) => saturacao(c) >= 0.25);
  const maisPerto = (lista: string[]) => lista.reduce((m, c) => (Math.abs(luminancia(c) - luminancia(h)) < Math.abs(luminancia(m) - luminancia(h)) ? c : m));
  if (saturacao(h) < 0.25) return maisPerto(neutras.length ? neutras : cores);
  return papelDaCor(paleta, "destaque", "acento") || (coloridas.length ? coloridas[0] : maisPerto(cores));
}

/** Cor de texto legível (contraste de 3:1 para letra grande) sobre o fundo; senão, a neutra da paleta de maior contraste. */
function corLegivelNoFundo(cor: string | null, fundo: string | null, paleta: MarcaParaDirecao["paleta"]): string | null {
  if (!cor || !fundo) return cor;
  if (contraste(cor, fundo) >= 3) return cor;
  const cores = (paleta.map((p) => hexOk(p.hex)).filter(Boolean) as string[]).concat([NEUTRO_CLARO, NEUTRO_ESCURO]);
  return cores.reduce((m, c) => (contraste(c, fundo) > contraste(m, fundo) ? c : m));
}

const ROTULO_DO_PAPEL_NO_MOLDE: Record<PapelNoMolde, string> = {
  titulo: "TÍTULO", subtitulo: "SUBTÍTULO", texto: "TEXTO", rotulo: "TEXTO PEQUENO", cta: "CTA", numero: "NÚMERO", marca: "MARCA", perfil: "@PERFIL",
};

/** Texto do bloco no molde: em caixa alta quando o bloco da referência é todo em maiúsculas. */
const textoNoMolde = (b: BlocoTexto, alvo: BlocoDoMolde | null) => (alvo && alvo.caixa_alta ? b.texto.toLocaleUpperCase("pt-BR") : b.texto);

/** Texto exato da lâmina com a caixa alta do molde aplicada (a conferência compara sem caixa). */
export function textoExatoNoMolde(textoExato: string, mapa: MapaNoMolde | null): string {
  if (!mapa) return textoExato;
  let saida = textoExato;
  for (const { bloco, alvo } of mapa.lugares) {
    if (!alvo || !alvo.caixa_alta) continue;
    const alto = bloco.texto.toLocaleUpperCase("pt-BR");
    for (const forma of [bloco.texto, bloco.texto.replace(/\n/g, " ")]) {
      if (forma && saida.indexOf(forma) >= 0) {
        saida = saida.split(forma).join(alto.replace(/\n/g, forma === bloco.texto ? "\n" : " "));
        break;
      }
    }
  }
  return saida;
}

export type EntradaDoReplicar = {
  card: Pick<CardDirecao, "ordem" | "funcao" | "texto_exato" | "blocos">;
  marca: MarcaParaDirecao;
  total: number;
  /** Referências anexadas (1 ou 2), com o índice da imagem e o molde medido (null quando a leitura falhou). */
  referencias: { indice: number; molde: MoldeDaReferencia | null }[];
  /** A referência 1 é a imagem 1, a base editada. */
  editando: boolean;
  /** Fotos do cliente anexadas: o assunto desta lâmina. */
  fotos: { indice: number; descricao?: string | null; papel: "fundo" | "elemento" }[];
  logo: { leva: boolean; indice: number | null; medida: LogoMedida | null; descricao: string | null };
  quadro: { largura: number; altura: number };
  anuncio?: { formato: FormatoCriativo } | null;
  post?: FormatoDoPost | null;
  /**
   * Fidelidade à referência (frente E, 25/09 à noite; fidelidade-da-referencia.ts).
   * Sem ela, ou "identica", o prompt é o de sempre, byte a byte. Próxima muda o
   * cabeçalho, o layout (elementos secundários livres) e o assunto (pose e
   * enquadramento livres). Inspirada e Criativa mudam também o texto (sem
   * posição), o lugar da logo, o formato e a linha das formas gráficas.
   */
  fidelidade?: FidelidadeDaReferencia | null;
};

/**
 * Prompt do modo replicar referência, completo e sem a cena do diretor (nada
 * de layout.imagem, ilustração, ponto focal, fundo, tratamento, zona do texto,
 * tamanhos de bloco, fio visual, conceito, estilo de cena nem série). Entra só:
 * o molde (a regra de layout), o texto exato por papel mapeado no molde, a
 * marca (paleta, fontes, logo com o texto dela) e o assunto (a foto do
 * cliente, quando há). `textoExato` volta com a caixa alta do molde aplicada,
 * para as regras finais repetirem o mesmo texto.
 */
export function promptDoReplicar(e: EntradaDoReplicar): { prompt: string; textoExato: string; mapa: MapaNoMolde | null } {
  const refs = e.referencias.slice(0, 2);
  const r1 = refs[0];
  const r2 = refs.length > 1 ? refs[1] : null;
  const m = r1 ? r1.molde : null;
  const capa = e.card.funcao === "capa" || e.card.ordem === 1;
  const serie = e.total > 1;
  const formato = e.anuncio && FORMATOS_CRIATIVO.includes(e.anuncio.formato) ? e.anuncio.formato : null;
  const post = !formato && e.post && e.post !== "feed_4x5" && FORMATOS_DO_POST.indexOf(e.post) >= 0 ? e.post : null;
  const margens = margensDoQuadro(formato, post);
  const Q = e.quadro;
  const px = (pct: number, lado: number) => Math.round((pct / 100) * lado);
  const blocos = (e.card.blocos && e.card.blocos.length ? e.card.blocos : blocosDoTexto(e.card.texto_exato, e.card.funcao))
    .filter((b) => PAPEIS.includes(b.papel) && b.texto.trim());
  const paleta = e.marca.paleta.filter((p) => hexOk(p.hex));
  const fonteTitulo = e.marca.fontes.find((f) => f.papel === "titulo")?.nome || e.marca.tipografiaCitada?.titulo || null;
  const fonteTexto = e.marca.fontes.find((f) => f.papel === "texto")?.nome || e.marca.tipografiaCitada?.texto || fonteTitulo;
  const corDestaque = papelDaCor(paleta, "destaque", "acento");
  const fundoNaMarca = m ? corDaMarcaNoPapel(m.cor_do_fundo, paleta) : null;
  const mapa = m ? mapearNoMolde(blocos, m) : null;
  const temBarra = blocos.some((b) => b.texto.indexOf("\n") >= 0);
  const img = (i: number) => `imagem ${i}`;
  const paletaTxt = paleta.length
    ? paleta.map((p) => `${p.nome || p.papel || "cor"} ${hexOk(p.hex)}${p.papel ? ` (${p.papel})` : ""}`).join(", ")
    : "a paleta das artes da marca";

  // Fidelidade (frente E): Idêntica (ou nenhuma) é o prompt de sempre; os outros níveis trocam só os blocos abaixo.
  const fid: FidelidadeDaReferencia = e.fidelidade && FIDELIDADES.indexOf(e.fidelidade) >= 0 ? e.fidelidade : "identica";
  const solta = fid === "inspirada" || fid === "criativa";
  const peca = formato ? "peça" : `lâmina${serie ? ` (${e.card.ordem} de ${e.total})` : ""}`;
  const ref2Solta = r2 ? `Referência 2 (${img(r2.indice)}): dela vem só o acabamento (luz, textura, tratamento de cor e os elementos gráficos).` : "";

  // Cabeçalho: o que é a imagem 1 e o que troca.
  const cabecalho = fid === "identica"
    ? [
      `MODO REPLICAR REFERÊNCIA: esta ${formato ? "peça" : `lâmina${serie ? ` (${e.card.ordem} de ${e.total})` : ""}`} é a referência escolhida pela equipe, refeita com o texto, a marca e o assunto deste cliente. Quem olhar as duas lado a lado reconhece o mesmo layout.`,
      r1 && e.editando
        ? `A imagem 1 é a BASE A EDITAR: é a referência 1, já no quadro desta lâmina. Mantenha dela a composição, a grade, a posição e a escala de cada bloco, os elementos gráficos, o recorte e o tratamento da imagem e o espaço vazio. Troque só o que está abaixo: o texto, as cores (pelas da marca, na mesma função), as fontes, a marca dela (pela logo oficial) e o assunto.`
        : r1
        ? `Referência 1 (${img(r1.indice)}): recrie a lâmina seguindo de perto o layout dela, trocando só o texto, as cores, as fontes, a marca e o assunto como abaixo.`
        : "",
      r2 ? `Referência 2 (${img(r2.indice)}): dela vem só o acabamento (luz, textura, tratamento de cor e os elementos gráficos); a posição e o tamanho dos blocos são os da referência 1.` : "",
    ]
    : fid === "proxima"
    ? [
      `MODO REFERÊNCIA PRÓXIMA: esta ${peca} segue o layout e a grade da referência escolhida pela equipe, com o texto, a marca e o assunto deste cliente. Quem olhar as duas reconhece a mesma estrutura, mas não uma cópia: a pose, o enquadramento, os elementos secundários e os detalhes são novos.`,
      r1 ? `Referência 1 (${img(r1.indice)}): dela vêm a grade, a posição e a escala de cada bloco de texto, o fundo e a proporção de espaço vazio. Não copie dela a pose, o enquadramento exato nem os elementos secundários.` : "",
      r2 ? `Referência 2 (${img(r2.indice)}): dela vem só o acabamento (luz, textura, tratamento de cor e os elementos gráficos); a posição e o tamanho dos blocos são os da referência 1.` : "",
    ]
    : fid === "inspirada"
    ? [
      `MODO REFERÊNCIA INSPIRADA: esta ${peca} é uma composição NOVA para este cliente, no estilo da referência escolhida pela equipe. Quem olhar as duas reconhece a mesma família visual (tipografia, sistema gráfico, tratamento), não o mesmo layout.`,
      r1 ? `Referência 1 (${img(r1.indice)}): é o guia de estilo e do sistema gráfico. Não copie a grade, a posição dos blocos, o enquadramento nem a pose dela.` : "",
      ref2Solta,
    ]
    : [
      `MODO REFERÊNCIA CRIATIVA: esta ${peca} é uma ideia e uma composição NOVAS para este cliente. Da referência escolhida pela equipe vêm só o clima, a energia e o jeito de usar a cor; nada do layout, da cena nem dos elementos dela.`,
      r1 ? `Referência 1 (${img(r1.indice)}): só o clima (luz, contraste, ritmo, energia) e o jeito de usar a cor. Não copie a grade, a posição dos blocos, o assunto, a pose nem os elementos gráficos dela.` : "",
      ref2Solta,
    ];

  // Layout medido (a regra de layout desta lâmina).
  const pos = (c: Caixa) => descreverPosicao(c);
  const titulosDoMolde = m ? m.blocos.filter((b) => b.papel !== "marca" && b.papel !== "perfil").sort((a, b) => b.altura_da_letra - a.altura_da_letra) : [];
  const desenho = (b: BlocoDoMolde) => [b.familia, b.largura_da_letra !== "normal" ? b.largura_da_letra : "", `peso ${b.peso}`, b.caixa_alta ? "caixa alta" : ""].filter(Boolean).join(", ");
  const layout: string[] = fid === "inspirada"
    ? m
      ? [
        "SISTEMA GRÁFICO DA REFERÊNCIA 1 (guia de estilo; a composição desta lâmina é nova)",
        titulosDoMolde.length
          ? `- Tipografia: o título no desenho do título dela (${desenho(titulosDoMolde[0])})${titulosDoMolde.length > 1 ? `; os textos menores no desenho dos dela (${desenho(titulosDoMolde[titulosDoMolde.length - 1])})` : ""}, com o mesmo contraste de escala.`
          : "",
        m.elementos.length
          ? `- Elementos gráficos do mesmo tipo, traço e acabamento dos dela, em outra posição e outra composição, nas cores da marca: ${m.elementos.map((x) => x.descricao).join("; ")}.`
          : "",
        `- Fundo do mesmo tipo (${m.fundo || "o da referência"})${fundoNaMarca ? `, na marca ${fundoNaMarca}` : ""}.`,
        m.tratamento ? `- Tratamento: ${m.tratamento}` : "",
        `- Composição nova: outra grade, outro lugar para o título e para o assunto, outro enquadramento${m.grade ? `; não repita a divisão da tela da referência (${m.grade})` : ""}.`,
      ]
      : r1
      ? [
        "SISTEMA GRÁFICO DA REFERÊNCIA 1 (guia de estilo; a composição desta lâmina é nova)",
        "- Absorva dela a tipografia (peso, caixa, largura da letra, contraste de escala), o tipo de elemento gráfico e o tratamento da imagem. A composição é nova: outra grade, outro lugar para o título e para o assunto, outro enquadramento.",
      ]
      : []
    : fid === "criativa"
    ? r1
      ? [
        "CLIMA DA REFERÊNCIA 1 (só inspiração; a ideia e a composição desta lâmina são novas)",
        m && m.tratamento ? `- Luz e acabamento: ${m.tratamento}` : "- Luz, contraste e acabamento no clima da referência.",
        "- Cor: a mesma proporção entre fundo, texto e destaque da referência, com as cores da marca.",
        "- Crie uma ideia visual própria para o tema desta lâmina: outra grade, outro assunto em cena ou outro ponto de vista, outro tipo de elemento gráfico.",
      ]
      : []
    : m
    ? [
      "LAYOUT DA REFERÊNCIA 1 (medido na imagem; é a regra de layout desta lâmina, posições em % do quadro)",
      m.grade ? `- Grade: ${m.grade}` : "",
      `- Fundo: ${m.fundo || "o da referência"}${fundoNaMarca ? `; na marca, ${fundoNaMarca}${m.cor_do_fundo ? ` no lugar de ${m.cor_do_fundo}` : ""}` : ""}.`,
      m.assunto
        ? `- Assunto da referência: ${m.assunto.descricao || m.assunto.tipo}, ${pos(m.assunto)}${m.assunto.enquadramento ? `, ${m.assunto.enquadramento}` : ""}.${fid === "proxima" ? " Aqui ele ocupa o mesmo espaço, com outra pose e outro enquadramento." : ""}`
        : "- A referência não tem assunto fotográfico: só fundo, tipografia e elementos gráficos.",
      m.elementos.length
        ? fid === "proxima"
          ? `- Elementos gráficos da referência (o principal fica; os secundários podem mudar de forma, quantidade e lugar dentro da mesma grade), com a cor da marca na mesma função: ${m.elementos.map((x) => `${x.descricao} (${pos(x)}${x.cor ? `, ${corDaMarcaNoPapel(x.cor, paleta) || x.cor}` : ""})`).join("; ")}.`
          : `- Elementos gráficos, nos mesmos lugares e na mesma escala, com a cor trocada pela da marca na mesma função: ${m.elementos.map((x) => `${x.descricao} (${pos(x)}${x.cor ? `, ${corDaMarcaNoPapel(x.cor, paleta) || x.cor}` : ""})`).join("; ")}.`
        : "",
      m.tratamento ? `- Tratamento: ${m.tratamento}` : "",
    ]
    : r1
    ? [
      "LAYOUT DA REFERÊNCIA 1",
      `- Copie dela a estrutura do layout (grade, divisão da tela, posição de cada bloco de texto e de cada imagem), a escala e a hierarquia da tipografia (qual texto é o maior, peso, caixa alta ou baixa, largura da letra, alinhamento, quebra em linhas), o recorte e o tratamento da imagem e os elementos gráficos, na mesma proporção de espaço vazio.${fid === "proxima" ? " A pose, o enquadramento e os elementos secundários são novos." : ""}`,
    ]
    : [];

  // Texto exato por papel, no lugar do bloco equivalente do molde.
  const linhaDoBloco = (b: BlocoTexto, alvo: BlocoDoMolde | null) => {
    const titulo = b.papel === "headline" || b.papel === "numero";
    const fonte = titulo ? fonteTitulo : fonteTexto;
    const t = textoNoMolde(b, alvo).replace(/\n/g, " / ");
    if (!alvo) {
      return `- ${b.papel.toUpperCase()}: "${t}"${fonte ? `, fonte ${fonte}` : ""}; ${m ? "a referência não tem bloco para ele: fica logo abaixo do bloco de texto principal, na mesma coluna e no mesmo alinhamento, menor que ele" : "no lugar e na escala do texto equivalente da referência (o título dela vira a headline, o texto menor vira o apoio)"}.`;
    }
    const corNaMarca = corLegivelNoFundo(corDaMarcaNoPapel(alvo.cor, paleta), fundoNaMarca, paleta);
    const altura = Math.max(2.1, alvo.altura_da_letra);
    const estilo = [alvo.familia, alvo.largura_da_letra !== "normal" ? alvo.largura_da_letra : "", `peso ${alvo.peso}`].filter(Boolean).join(", ");
    // Texto maior que o bloco da referência (caracteres por linha pela altura da letra): cresce em linhas a partir do mesmo lugar.
    const porLinha = Math.max(4, Math.floor((((alvo.x1 - alvo.x0) / 100) * Q.largura) / (px(altura, Q.altura) * 0.62)));
    const cabe = porLinha * Math.max(1, alvo.linhas);
    const tamanhoDoTexto = b.texto.replace(/\s+/g, " ").trim().length;
    const cresce = !titulo && tamanhoDoTexto > cabe * 1.3
      ? `; o texto é maior que o da referência: use mais linhas (cerca de ${Math.ceil(tamanhoDoTexto / porLinha)}) crescendo a partir desse lugar, no mesmo alinhamento, sem invadir o título nem o assunto`
      : "";
    return `- ${b.papel.toUpperCase()}: "${t}" no lugar do ${ROTULO_DO_PAPEL_NO_MOLDE[alvo.papel]} da referência, ${pos(alvo)}, ` +
      `${alvo.caixa_alta ? "em CAIXA ALTA, " : ""}letra maiúscula com cerca de ${Math.round(altura * 10) / 10}% da altura do quadro (${px(altura, Q.altura)} px), ` +
      `${alvo.linhas > 1 && b.texto.indexOf("\n") < 0 && !cresce ? `em cerca de ${alvo.linhas} linhas, ` : ""}alinhado ${alvo.alinhamento === "centro" ? "ao centro" : `à ${alvo.alinhamento}`}` +
      `${fonte ? `, fonte ${fonte} com o desenho da referência (${estilo})` : `, no desenho da referência (${estilo})`}${corNaMarca ? `, cor ${corNaMarca}` : ""}${cresce}.`;
  };
  // Inspirada e Criativa: o texto não tem posição (a composição é nova); na Inspirada o desenho da letra ainda vem do molde.
  const linhaSolta = (b: BlocoTexto, alvo: BlocoDoMolde | null) => {
    const titulo = b.papel === "headline" || b.papel === "numero";
    const fonte = titulo ? fonteTitulo : fonteTexto;
    const doMolde = fid === "inspirada" ? alvo : null;
    const t = (doMolde ? textoNoMolde(b, doMolde) : b.texto).replace(/\n/g, " / ");
    const papel = titulo ? "o maior texto da lâmina" : b.papel === "cta" ? "a chamada para ação, destacada" : b.papel === "selo" ? "texto pequeno de selo" : "menor que o título e agrupado com ele";
    return `- ${b.papel.toUpperCase()}: "${t}", ${papel}${fonte ? `, fonte ${fonte}` : ""}${doMolde ? `, no desenho da referência (${desenho(doMolde)})` : ""}.`;
  };
  const texto = solta
    ? [
      "1. TEXTO EXATO (só isto, com esta grafia e acentuação, e nenhuma outra palavra)",
      ...(mapa && fid === "inspirada" ? mapa.lugares.map((l) => linhaSolta(l.bloco, l.alvo)) : blocos.map((b) => linhaSolta(b, null))),
      temBarra ? "- A barra ( / ) marca a quebra de linha: quebre a linha ali e não desenhe a barra." : "",
      "- O lugar de cada bloco segue a composição nova desta lâmina, com hierarquia clara, os blocos no mesmo eixo e respiro em volta.",
      "- Entrelinha dos títulos de 1,0 a 1,1, sem acento encostando na linha de cima; nenhuma letra cortada nem deformada.",
    ]
    : [
    "1. TEXTO EXATO (só isto, com esta grafia e acentuação, e nenhuma outra palavra)",
    ...(mapa ? mapa.lugares.map((l) => linhaDoBloco(l.bloco, l.alvo)) : blocos.map((b) => linhaDoBloco(b, null))),
    temBarra ? "- A barra ( / ) marca a quebra de linha: quebre a linha ali e não desenhe a barra." : "",
    mapa && mapa.vagos.length
      ? `- Blocos de texto da referência sem texto nesta lâmina (${mapa.vagos.map((v) => `${ROTULO_DO_PAPEL_NO_MOLDE[v.papel].toLowerCase()} em ${pos(v)}`).join("; ")}): ficam sem texto nenhum; o espaço continua vazio ou com o elemento gráfico da referência.`
      : "",
    "- Entrelinha dos títulos de 1,0 a 1,1, sem acento encostando na linha de cima; nenhuma letra cortada nem deformada.",
  ];

  // Logo: lugar da marca da referência (medido), tamanho e contraste da marca deste cliente.
  const logo = [
    "2. LOGO",
    ...blocoDaLogo({
      levaLogo: e.logo.leva,
      temLogo: e.logo.indice !== null,
      quadro: Q,
      logo: e.logo.medida,
      replicar: true,
      lugarNoMolde: solta ? null : mapa?.marca ?? null,
      anuncio: !!formato,
      descricao: e.logo.descricao,
      fundoDaLamina: fundoNaMarca,
      corParaALogo: corOpostaNaPaleta(paleta, e.logo.medida ? e.logo.medida.clara : null),
    }),
    e.logo.leva && e.logo.indice !== null ? `- A logo é a ${img(e.logo.indice)}; a marca, o nome e o site da referência não entram.` : "",
  ];

  const marca = [
    "3. MARCA",
    `- Paleta (só estas cores, cada uma na função que a cor equivalente tem na referência: fundo por fundo, título por título, destaque por destaque): ${paletaTxt}.`,
    corDestaque ? `- O que é colorido e chama atenção na referência (título colorido, faixa, seta, botão) fica em ${corDestaque} ou na cor da marca de mesma função, sempre legível.` : "",
    fonteTitulo || fonteTexto
      ? `- Fontes da marca: títulos em ${fonteTitulo || fonteTexto}, texto em ${fonteTexto || fonteTitulo}, com o peso, a largura (condensada, normal) e a escala do texto equivalente da referência. Se houver amostra da fonte anexada, siga o desenho das letras dela.`
      : "- Tipografia: a da referência, na mesma escala e peso.",
    e.marca.regras ? `- Regras da marca: ${e.marca.regras.replace(/\n+/g, " ")}` : "",
  ];

  const fotos = e.fotos.filter((f) => f.indice > 0);
  const nomes = fotos.map((f) => img(f.indice)).join(" e ");
  const tema = blocos.find((b) => b.papel === "headline" || b.papel === "numero")?.texto.replace(/\s+/g, " ").trim() || "";
  const identica = "É a mesma pessoa, idêntica: mesmo rosto, feições, olhos, nariz, boca, tom de pele, cabelo, idade, corpo e roupa. Produto idêntico: mesma forma, cores, rótulo e detalhes.";
  const naoCopie = "- Não copie da referência: o texto, a logo, o nome ou o site de outra marca, marcas d'água e as pessoas dela.";
  const semMarca = "sem marca, logo ou texto de outra empresa";
  const assunto = fid === "proxima"
    ? [
      "4. ASSUNTO",
      fotos.length
        ? `- A pessoa ou o produto da foto real do cliente (${nomes}) ocupa o espaço do assunto da referência${m && m.assunto ? ` (${pos(m.assunto)})` : ""}, com recorte e escala livres dentro dele. ${identica}`
        : m && m.assunto
        ? m.assunto.tipo === "pessoa"
          ? "- Pessoa: outra pessoa (nunca a da referência), no mesmo espaço, com outra pose, outro gesto e outro ângulo de câmera, a mesma luz, roupa neutra e sem marcas."
          : `- ${m.assunto.tipo === "cena" ? "Cena" : "Objeto"}: no mesmo espaço, com outro enquadramento, um${m.assunto.tipo === "cena" ? "a cena equivalente" : " objeto neutro"} ligado ao tema${tema ? ` "${tema}"` : " desta lâmina"}, ${semMarca}.`
        : `- Assunto: o mesmo tipo de assunto da referência, no mesmo espaço e com outro enquadramento; se ela tem pessoa, outra pessoa em outra pose; se tem produto de outra marca, um objeto neutro ligado ao tema, sem marca.`,
      fotos.length
        ? "- Pode recortar, reposicionar, mudar a escala e integrar a foto à luz e ao layout da referência; não redesenhe nem troque a pessoa ou o produto, não mude a expressão e não escureça a foto."
        : "",
      fotos.length > 1 ? `- Use todas as fotos do cliente (${nomes}), cada uma no espaço de imagem equivalente da referência.` : "",
      naoCopie,
    ]
    : solta
    ? [
      "4. ASSUNTO",
      fotos.length
        ? `- A pessoa ou o produto da foto real do cliente (${nomes}) é o assunto desta lâmina, num enquadramento novo (não o da referência). ${identica}`
        : fid === "criativa"
        ? `- Assunto: o que a ideia pedir para o tema${tema ? ` "${tema}"` : " desta lâmina"} (pessoa, objeto ou cena), pensado para esta lâmina; pessoa, se houver, nunca a da referência; ${semMarca}.`
        : m && m.assunto
        ? m.assunto.tipo === "pessoa"
          ? "- Pessoa: outra pessoa (nunca a da referência), em pose, ângulo e enquadramento novos, com a luz e o tratamento da referência, roupa neutra e sem marcas."
          : `- ${m.assunto.tipo === "cena" ? "Cena" : "Objeto"}: um${m.assunto.tipo === "cena" ? "a cena" : " objeto neutro"} ligado ao tema${tema ? ` "${tema}"` : " desta lâmina"}, em composição nova, ${semMarca}.`
        : "- Assunto: o mesmo tipo de assunto da referência, em composição nova; se ela tem pessoa, outra pessoa; se tem produto de outra marca, um objeto neutro ligado ao tema, sem marca.",
      fotos.length
        ? "- Pode recortar, reposicionar, mudar a escala e integrar a foto à luz da composição; não redesenhe nem troque a pessoa ou o produto, não mude a expressão e não escureça a foto."
        : "",
      fotos.length > 1 ? `- Use todas as fotos do cliente (${nomes}).` : "",
      naoCopie,
    ]
    : [
    "4. ASSUNTO",
    fotos.length
      ? `- A pessoa ou o produto da foto real do cliente (${nomes}) entra no lugar do assunto da referência${m && m.assunto ? ` (${pos(m.assunto)})` : ""}, com o mesmo enquadramento e a mesma escala. É a mesma pessoa, idêntica: mesmo rosto, feições, olhos, nariz, boca, tom de pele, cabelo, idade, corpo e roupa. Produto idêntico: mesma forma, cores, rótulo e detalhes.`
      : m && m.assunto
      ? m.assunto.tipo === "pessoa"
        ? `- Pessoa: outra pessoa (nunca a da referência), com a mesma pose, enquadramento, escala e luz, roupa neutra e sem marcas.`
        : `- ${m.assunto.tipo === "cena" ? "Cena" : "Objeto"}: no mesmo lugar, escala e enquadramento, um${m.assunto.tipo === "cena" ? "a cena equivalente" : " objeto neutro"} ligado ao tema${tema ? ` "${tema}"` : " desta lâmina"}, sem marca, logo ou texto de outra empresa.`
      : "- Assunto: o mesmo tipo de assunto da referência, no mesmo lugar e escala; se ela tem pessoa, outra pessoa; se tem produto de outra marca, um objeto neutro ligado ao tema, sem marca.",
    fotos.length
      ? "- Pode recortar, reposicionar, mudar a escala e integrar a foto à luz e ao layout da referência; não redesenhe nem troque a pessoa ou o produto, não mude a expressão e não escureça a foto."
      : "",
    fotos.length > 1 ? `- Use todas as fotos do cliente (${nomes}), cada uma no espaço de imagem equivalente da referência.` : "",
    "- Não copie da referência: o texto, a logo, o nome ou o site de outra marca, marcas d'água e as pessoas dela.",
  ];

  const formatoTxt = solta
    ? [
      "5. FORMATO",
      `- Arte ${Q.largura} x ${Q.altura}, usando o quadro inteiro, sem bordas vazias. Margens de segurança: ${px(margens.x, Q.largura)} px nas laterais, ${px(margens.topo, Q.altura)} px no topo e ${px(margens.base, Q.altura)} px na base.`,
      capa ? "- Esta é a capa: a headline continua a maior da série e legível na miniatura do feed." : "",
      formato ? regrasDoCriativo(formato) : "",
    ]
    : [
    "5. FORMATO",
    `- Arte ${Q.largura} x ${Q.altura}, usando o quadro inteiro, sem bordas vazias. Margens de segurança: ${px(margens.x, Q.largura)} px nas laterais, ${px(margens.topo, Q.altura)} px no topo e ${px(margens.base, Q.altura)} px na base. Onde a referência encosta texto ou logo na borda, aproxime do lugar dela sem passar da margem.`,
    capa ? "- Esta é a capa: a headline continua a maior da série e legível na miniatura do feed, na posição em que a referência põe o título." : "",
    formato ? regrasDoCriativo(formato) : "",
  ];

  const proibicoes = blocoDasProibicoes({ serie, replicar: true });
  const prompt = [
    ...cabecalho,
    ...layout,
    ...texto,
    ...logo,
    ...marca,
    ...assunto,
    ...formatoTxt,
    // Inspirada e Criativa podem ter formas novas (a variedade pede outro elemento gráfico), sempre nas cores da marca.
    solta ? proibicoes.replace(FORMAS_SO_DA_REFERENCIA, FORMAS_NO_ESTILO) : proibicoes,
  ].filter((l) => l !== "").join("\n");
  const mapaUsado = fid === "criativa" ? null : mapa;
  return { prompt, textoExato: textoExatoNoMolde(e.card.texto_exato, mapaUsado), mapa: mapaUsado };
}

const FORMAS_SO_DA_REFERENCIA = "Faixas e formas gráficas só as da referência, nas cores da marca.";
const FORMAS_NO_ESTILO = "Faixas e formas gráficas no estilo da referência ou da marca, sempre nas cores da marca.";

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
