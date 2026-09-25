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

import { PADRAO_NA_IMAGEM } from "./conhecimento-design.ts";
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
};

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

/** Prompt final da lâmina, montado em código a partir da direção e da marca. */
export function promptDaLamina(
  card: Pick<CardDirecao, "ordem" | "funcao" | "texto_exato" | "blocos" | "layout" | "evitar" | "ilustracao">,
  marca: MarcaParaDirecao,
  opcoes: {
    total: number;
    carrosselInfinito: boolean;
    levaLogo: boolean;
    conceito?: string | null;
    /** O que as lâminas anteriores mostram: a lâmina mantém protagonista, cenário e luz e muda só pose e enquadramento. */
    anteriores?: string[];
    /** Fio visual do conjunto (protagonista, cenário, luz, tratamento), definido uma vez pelo diretor. */
    fioVisual?: string | null;
    /** Logo medida em código: tom dominante e se é clara (define o fundo atrás dela). */
    logo?: { tom: string | null; clara: boolean } | null;
    /** Descrição da foto real anexada como base: o gerador não redesenha a foto. */
    fotoReal?: string | null;
    /** A logo oficial é aplicada pelo código depois (foto real fixa): o gerador não desenha logo. */
    logoNoCodigo?: boolean;
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
    /** Canto da logo quando o código muda o de sempre (recorte à esquerda: a logo vai para a direita). */
    cantoDaLogo?: string | null;
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
      return `- ${b.papel.toUpperCase()}: "${b.texto.replace(/\n/g, " / ")}" (as barras indicam quebra de linha, não desenhe as barras)` +
        `${fonte ? `, fonte ${fonte}` : ""}${cor ? `, cor ${cor}` : ""}; mesma posição, escala e peso do texto equivalente da referência.`;
    }
    return `- ${b.papel.toUpperCase()}: "${b.texto.replace(/\n/g, " / ")}" (as barras indicam quebra de linha, não desenhe as barras), letra de cerca de ${t.px} px numa arte de ${quadro.largura} x ${quadro.altura}, peso ${t.peso}` +
      `${fonte ? `, fonte ${fonte}` : ""}${cor ? `, cor ${cor}` : ""}.`;
  });

  // Foto real como base (24/09): a foto já está decidida. Nada de véu ou painel
  // atrás do texto, nada de mudar pose ou enquadramento, e a logo entra pelo
  // código (o gerador desenhava a logo torta dentro de uma caixa fosca).
  const foto = !!opcoes.fotoReal;
  const cantoDaLogo = opcoes.cantoDaLogo || (layout.zona_texto === "base-esquerda" || layout.zona_texto === "base-centro" ? "superior esquerdo" : "inferior esquerdo");

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
    "",
    "IMAGEM E COMPOSIÇÃO",
    replicar
      ? opcoes.replicar!.comFoto
        ? "- Imagem: a FOTO REAL do cliente anexada é o assunto desta lâmina, recomposta no layout da referência (veja MODO REPLICAR REFERÊNCIA), com a pessoa ou o produto idêntico."
        : `- Imagem: ${layout.imagem}. É o assunto desta lâmina, no lugar do assunto da referência.`
      : foto
      ? `- Imagem: a FOTO REAL do cliente anexada como imagem 1 (${opcoes.fotoReal}) é a base desta lâmina. Não redesenhe a foto: pessoas, objetos, ambiente, luz, cores, corte e enquadramento ficam exatamente como estão. Desenhe só o texto, direto sobre a foto, sem painel, véu, caixa ou desfoque atrás dele.`
      : `- Imagem: ${layout.imagem}.${card.ilustracao && card.ilustracao !== layout.imagem ? ` Detalhe: ${card.ilustracao}.` : ""}`,
    replicar ? "- Composição, grid, recorte e tratamento da imagem: os da referência escolhida (veja MODO REPLICAR REFERÊNCIA), não um layout novo." : "",
    opcoes.fioVisual && serie && !foto && !opcoes.replicar?.comFoto
      ? `- CONTINUIDADE DA SÉRIE (obrigatório): ${opcoes.fioVisual.replace(/\s+/g, " ").slice(0, 600)} Mesma pessoa, mesmo cenário, mesma luz e paleta em todas as lâminas; varia só a pose, o gesto e o enquadramento.`
      : "",
    replicar
      ? ""
      : foto && capa
      ? "- CAPA QUE PARA A ROLAGEM: a maior headline do conjunto, em peso black, com a palavra-chave na cor de destaque, legível até no tamanho da miniatura do feed. A foto já é o elemento visual forte: não mude a foto. Nada competindo com a headline."
      : anuncio && capa
      ? "- CRIATIVO QUE PARA A ROLAGEM: headline curta e grande, em peso black, com a palavra-chave na cor de destaque; um elemento visual forte e inesperado ligado à oferta (escala grande, recorte ousado, produto ou serviço em ação, rosto ou olhar para a câmera); contraste pela escala e pela cor de destaque, legível na tela do celular. Não escureça a imagem para criar destaque. Nada competindo com a headline."
      : capa
      ? "- CAPA QUE PARA A ROLAGEM: quem está rolando o feed tem que parar aqui. A maior headline do conjunto, em peso black, com a palavra-chave na cor de destaque; um elemento visual forte e inesperado (escala grande, recorte ousado, objeto cortado pela borda, rosto ou olhar para a câmera, gesto em ação); contraste pela escala e pela cor de destaque, legível até no tamanho da miniatura do feed; mesma luz, cenário e paleta das lâminas seguintes. Não escureça a imagem para criar destaque. Nada competindo com a headline."
      : "",
    opcoes.anteriores && opcoes.anteriores.length && serie && !foto && !replicar
      ? `- Lâminas anteriores desta série mostraram: ${opcoes.anteriores.map((a) => a.replace(/\s+/g, " ").slice(0, 160)).join(" | ")}. Mantenha a mesma protagonista, cenário e luz; mude só a pose e o enquadramento (não repita a pose da lâmina anterior).`
      : "",
    replicar
      ? ""
      : foto
      ? `- O texto fica na área indicada (${layout.zona_texto.replace("-", " ")}), sobre a parte mais calma da foto; o contraste vem da cor e do peso das letras, nunca de escurecer ou cobrir a foto.`
      : `- O sujeito da foto fica do lado oposto à área do texto (${layout.zona_texto.replace("-", " ")}); essa área é calma e uniforme na própria foto (parede, céu, sombra, fundo desfocado) ou recebe um painel da paleta alinhado ao grid.`,
    foto || replicar ? "" : `- Ponto focal: ${layout.ponto_focal}.`,
    foto || replicar ? "" : `- Fundo: ${layout.fundo}${corFundo ? ` (cor dominante ${corFundo})` : ""}.`,
    foto || replicar ? "" : `- Tratamento: ${layout.tratamento}.`,
    marca.estilo ? `- Estilo visual da marca, obrigatório: ${marca.estilo}` : "",
    "",
    "TEXTO (escrito pela própria arte, integrado à composição)",
    replicar
      ? "- Posição, alinhamento e quebra do texto: os da referência, com o texto exato abaixo no lugar do texto dela (o título dela vira a headline, o texto menor vira o apoio)."
      : `- Área do texto: ${descreverPosicao(caixa)}, alinhamento à ${layout.alinhamento === "centro" ? "centro" : layout.alinhamento}, todos os blocos no mesmo eixo e com a mesma margem.`,
    ...linhasBlocos,
    replicar ? "" : `- A headline tem cerca de 3 vezes a altura do texto de apoio e cada linha dela ocupa cerca de ${linhaHeadline}% da altura do quadro. O apoio ocupa uma coluna de no máximo 66% da largura, com linhas de 25 a 38 caracteres.`,
    replicar
      ? "- Entrelinha da headline de 1,0 a 1,1, sem acento encostando na linha de cima."
      : "- Headline e apoio formam um grupo, a 16 a 32 px um do outro; CTA, selo e logo ficam a pelo menos 96 px desse grupo. Entrelinha da headline de 1,0 a 1,1, sem acento encostando na linha de cima; entrelinha do apoio de 1,3 a 1,5.",
    "",
    "MARCA",
    `- Paleta (use só estas cores, na proporção 60-30-10, com um destaque único): ${paletaTxt}.`,
    fonteTitulo || fonteTexto
      ? `- Tipografia: títulos em ${fonteTitulo || fonteTexto}, texto em ${fonteTexto || fonteTitulo}. Se houver amostra da fonte anexada, siga o desenho exato das letras da amostra.`
      : "- Tipografia: siga a tipografia das artes da marca anexadas (mesma classificação, peso e caixa).",
    marca.tipografiaCitada?.observacao ? `- Observação da marca sobre tipografia: ${marca.tipografiaCitada.observacao}` : "",
    opcoes.logoNoCodigo && opcoes.levaLogo
      ? `- Logo: NÃO desenhe logo, símbolo nem marca. A logo oficial é aplicada depois pelo sistema no canto ${cantoDaLogo}; deixe esse canto limpo, só com ${foto ? "a foto" : "o fundo da arte"}, sem texto, sem nenhuma forma e sem caixa, cartão, faixa ou mancha clara reservando lugar para ela.`
      : opcoes.levaLogo && marca.temLogo
      ? (replicar
        ? `- Logo oficial anexada, sem redesenhar, no lugar em que a referência põe a marca dela (se a referência não tem marca, no canto ${cantoDaLogo}), com 48 a 72 px de altura e no máximo 20% da largura, dentro das margens${anuncio ? " e da zona segura" : ""}.`
        : `- Logo oficial anexada, com 48 a 72 px de altura e no máximo 20% da largura, no canto ${cantoDaLogo} dentro das margens${anuncio ? " e da zona segura" : ""}, sem redesenhar, nunca no canto superior direito.`) +
        // Nunca "fundo claro e liso atrás da logo": o gerador desenhava uma caixa branca (dono, 25/09).
        (opcoes.logo
          ? opcoes.logo.clara
            ? " A logo é clara: ela pousa numa parte escura da própria arte, direto sobre ela."
            : ` A logo é escura ou colorida${opcoes.logo.tom ? ` (tom dominante ${opcoes.logo.tom})` : ""}: ela pousa numa parte clara da própria arte, direto sobre ela, nunca sobre a mesma cor nem o mesmo valor da logo.`
          : " Nunca ponha a logo sobre fundo da mesma cor dela.") +
        " A logo entra sem caixa, cartão, faixa, retângulo ou fundo branco atrás, exatamente como o desenho dela."
      : opcoes.levaLogo
        ? "- A logo oficial ainda não foi enviada em imagem: NÃO desenhe nem invente logo, símbolo ou marca; deixe só um respiro no canto onde ela entraria."
        : "- Sem logo nesta lâmina.",
    marca.regras ? `- Regras da marca: ${marca.regras.replace(/\n+/g, " ")}` : "",
    "- Não escreva o nome da marca nem da empresa em lugar nenhum da arte: a marca aparece só pela logo oficial anexada.",
    "",
    "FORMATO",
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
    PADRAO_NA_IMAGEM,
    card.evitar ? `\nEVITAR NESTA LÂMINA: ${card.evitar}` : "",
  ].filter((l) => l !== "").join("\n");
}

/**
 * Quando o provedor não aceita 4:5, a arte sai em 1024 x 1536 e o quadro
 * 4:5 é o recorte central. O prompt ganha a instrução das faixas.
 */
/**
 * Área da logo (percentual do quadro) no mesmo canto que o prompt descreve:
 * superior esquerdo quando o texto está na base, inferior esquerdo nos demais.
 */
export function caixaDaLogo(zona: ZonaTexto, capa: boolean, formato?: FormatoCriativo | null, post?: FormatoDoPost | null): Caixa {
  const m = margensDoQuadro(formato, post);
  const esq = AREA.x0 + m.x + (capa ? m.capaExtra : 0);
  // 72 px de 1350, com folga (81 px); no anúncio e nos outros formatos do post, os mesmos 81 px na altura do quadro.
  const alturaLogo = post && post !== "feed_4x5"
    ? um((81 / QUADRO_DO_POST[post].final.altura) * 100)
    : formato ? um((81 / QUADRO_FINAL[formato].altura) * 100) : 6;
  if (zona === "base-esquerda" || zona === "base-centro") {
    return { x0: esq, x1: esq + 22, y0: m.topo, y1: m.topo + alturaLogo };
  }
  const base = AREA.y1 - m.base;
  return { x0: esq, x1: esq + 22, y0: base - alturaLogo, y1: base };
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
  /** A logo oficial é aplicada depois pelo código (a marca da referência só sai). */
  logoNoCodigo?: boolean;
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
    : ["- Assunto: o desta lâmina (descrito em IMAGEM E COMPOSIÇÃO), no lugar do assunto da referência."];
  return [
    `MODO REPLICAR REFERÊNCIA (prioridade máxima nesta lâmina)`,
    `A equipe escolheu ${refs.length === 1 ? "esta referência" : "estas duas referências"} para esta lâmina. Recrie a lâmina seguindo de perto a referência: quem olhar as duas lado a lado reconhece o mesmo layout, quase igual, só que com a marca e o conteúdo deste cliente.`,
    ...linhasDasRefs,
    ...linhasDoAssunto,
    `- Troque: o texto da referência pelo texto exato desta lâmina (mesmo papel e mesma posição: o título dela vira a headline, o texto menor vira o apoio); as cores dela pelas da paleta da marca, na mesma função (fundo por fundo, destaque por destaque); as fontes dela pelas da marca, com o mesmo peso e a mesma escala; ${e.logoNoCodigo ? "a marca dela sai (a logo oficial desta marca é aplicada depois pelo sistema; não desenhe logo nem caixa para ela)" : `a marca dela pela logo oficial${e.logo ? ` (imagem ${e.logo})` : ""}`}.`,
    "- Não copie da referência: o texto, a logo, o nome ou o site de outra marca, marcas d'água e as pessoas dela.",
    e.capa ? "- Esta é a capa: a headline continua a maior da série e legível na miniatura do feed, na posição em que a referência põe o título." : "",
    "- Onde o padrão de design ou a composição descrita adiante divergirem da referência, vale a referência. Continuam valendo: o texto exato, a paleta, as fontes e a logo da marca, as margens de segurança e a ortografia.",
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
