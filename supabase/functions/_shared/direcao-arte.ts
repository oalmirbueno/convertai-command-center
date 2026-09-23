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
 */

import { PADRAO_NA_IMAGEM } from "./conhecimento-design.ts";

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
};

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

export function caixaDaZona(zona: ZonaTexto, capa: boolean, carrossel = true): Caixa {
  const extra = capa ? CAPA_LATERAL_EXTRA : 0;
  const esq = AREA.x0 + MARGEM_X + extra;
  const dir = AREA.x1 - MARGEM_X - extra;
  const chegaNaDireita = zona === "topo-centro" || zona === "coluna-direita";
  const topo = AREA.y0 + (carrossel && chegaNaDireita ? TOPO_ABAIXO_DO_CONTADOR : MARGEM_TOPO);
  const base = AREA.y1 - MARGEM_BASE;
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
      fundo: "a própria fotografia, escurecida de forma sutil só na área do texto para garantir leitura",
      tratamento: "editorial, luz natural, contraste alto na headline",
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
  },
): string {
  const capa = card.funcao === "capa" || card.ordem === 1;
  const layout = normalizarLayout(card.layout, card.funcao, card.ordem, opcoes.total);
  const blocos = (card.blocos && card.blocos.length ? card.blocos : blocosDoTexto(card.texto_exato, card.funcao))
    .filter((b) => PAPEIS.includes(b.papel) && b.texto.trim());
  const caixa = caixaDaZona(layout.zona_texto, capa, opcoes.total > 1);

  const paleta = marca.paleta.filter((p) => hexOk(p.hex));
  const corFundo = layout.cor_fundo || papelDaCor(paleta, "fundo", "primaria", "primária");
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
    return `- ${b.papel.toUpperCase()}: "${b.texto.replace(/\n/g, " / ")}" (as barras indicam quebra de linha, não desenhe as barras), letra de cerca de ${t.px} px numa arte de 1080 x 1350, peso ${t.peso}` +
      `${fonte ? `, fonte ${fonte}` : ""}${cor ? `, cor ${cor}` : ""}.`;
  });

  const paletaTxt = paleta.length
    ? paleta.map((p) => `${p.nome || p.papel || "cor"} ${hexOk(p.hex)}${p.papel ? ` (${p.papel})` : ""}`).join(", ")
    : "paleta coerente com as artes da marca anexadas";

  return [
    `ARTE FINAL de ${opcoes.total > 1 ? `carrossel, lâmina ${card.ordem} de ${opcoes.total}` : "post único"} para o Instagram da marca. Função desta lâmina: ${capa ? "capa (parar a rolagem com um gancho forte)" : card.funcao === "cta" ? "fechamento com chamada para ação" : "conteúdo (uma ideia só)"}.`,
    opcoes.conceito ? `Conceito do conjunto: ${opcoes.conceito}` : "",
    "",
    "IMAGEM E COMPOSIÇÃO",
    opcoes.fotoReal
      ? `- Imagem: a FOTO REAL do cliente anexada como imagem 1 (${opcoes.fotoReal}) é a base desta lâmina. Não redesenhe a foto: pessoas, objetos, ambiente, luz e cores ficam exatamente como estão. Desenhe só o texto e, se precisar para a leitura, um painel ou véu suave dentro da área do texto.`
      : `- Imagem: ${layout.imagem}.${card.ilustracao && card.ilustracao !== layout.imagem ? ` Detalhe: ${card.ilustracao}.` : ""}`,
    opcoes.fioVisual && opcoes.total > 1
      ? `- CONTINUIDADE DA SÉRIE (obrigatório): ${opcoes.fioVisual.replace(/\s+/g, " ").slice(0, 600)} Mesma pessoa, mesmo cenário, mesma luz e paleta em todas as lâminas; varia só a pose, o gesto e o enquadramento.`
      : "",
    capa
      ? "- CAPA COM DESTAQUE A MAIS, dentro do sistema da marca: a maior headline do conjunto, em peso black, com a palavra-chave na cor de destaque, o maior contraste entre texto e fundo e um gesto visual forte; mesma luz, cenário e paleta das lâminas seguintes. Nada competindo com a headline."
      : "",
    opcoes.anteriores && opcoes.anteriores.length && opcoes.total > 1
      ? `- Lâminas anteriores desta série mostraram: ${opcoes.anteriores.map((a) => a.replace(/\s+/g, " ").slice(0, 160)).join(" | ")}. Mantenha a mesma protagonista, cenário e luz; mude só a pose e o enquadramento (não repita a pose da lâmina anterior).`
      : "",
    `- O sujeito da foto fica do lado oposto à área do texto (${layout.zona_texto.replace("-", " ")}); essa área é calma e uniforme na própria foto (parede, céu, sombra, fundo desfocado) ou recebe um painel da paleta alinhado ao grid.`,
    `- Ponto focal: ${layout.ponto_focal}.`,
    `- Fundo: ${layout.fundo}${corFundo ? ` (cor dominante ${corFundo})` : ""}.`,
    `- Tratamento: ${layout.tratamento}.`,
    marca.estilo ? `- Estilo visual da marca, obrigatório: ${marca.estilo}` : "",
    "",
    "TEXTO (escrito pela própria arte, integrado à composição)",
    `- Área do texto: ${descreverPosicao(caixa)}, alinhamento à ${layout.alinhamento === "centro" ? "centro" : layout.alinhamento}, todos os blocos no mesmo eixo e com a mesma margem.`,
    ...linhasBlocos,
    "- A headline tem cerca de 3 vezes a altura do texto de apoio e cada linha dela ocupa cerca de 9% da altura do quadro. O apoio ocupa uma coluna de no máximo 66% da largura, com linhas de 25 a 38 caracteres.",
    "- Headline e apoio formam um grupo, a 16 a 32 px um do outro; CTA, selo e logo ficam a pelo menos 96 px desse grupo. Entrelinha da headline de 1,0 a 1,1, sem acento encostando na linha de cima; entrelinha do apoio de 1,3 a 1,5.",
    "",
    "MARCA",
    `- Paleta (use só estas cores, na proporção 60-30-10, com um destaque único): ${paletaTxt}.`,
    fonteTitulo || fonteTexto
      ? `- Tipografia: títulos em ${fonteTitulo || fonteTexto}, texto em ${fonteTexto || fonteTitulo}. Se houver amostra da fonte anexada, siga o desenho exato das letras da amostra.`
      : "- Tipografia: siga a tipografia das artes da marca anexadas (mesma classificação, peso e caixa).",
    marca.tipografiaCitada?.observacao ? `- Observação da marca sobre tipografia: ${marca.tipografiaCitada.observacao}` : "",
    opcoes.levaLogo && marca.temLogo
      ? `- Logo oficial anexada, com 48 a 72 px de altura e no máximo 20% da largura, no canto ${layout.zona_texto === "base-esquerda" || layout.zona_texto === "base-centro" ? "superior esquerdo" : "inferior esquerdo"} dentro das margens, sem redesenhar, nunca no canto superior direito.` +
        (opcoes.logo
          ? opcoes.logo.clara
            ? " A logo é clara: o fundo atrás dela é escuro o bastante para ela aparecer inteira."
            : ` A logo é escura ou colorida${opcoes.logo.tom ? ` (tom dominante ${opcoes.logo.tom})` : ""}: o fundo atrás dela é claro e liso, nunca da mesma cor nem do mesmo valor da logo.`
          : " Nunca ponha a logo sobre fundo da mesma cor dela.")
      : opcoes.levaLogo
        ? "- A logo oficial ainda não foi enviada em imagem: NÃO desenhe nem invente logo, símbolo ou marca; deixe só um respiro no canto onde ela entraria."
        : "- Sem logo nesta lâmina.",
    marca.regras ? `- Regras da marca: ${marca.regras.replace(/\n+/g, " ")}` : "",
    "- Não escreva o nome da marca nem da empresa em lugar nenhum da arte: a marca aparece só pela logo oficial anexada.",
    "",
    "FORMATO",
    "- Arte vertical 4:5 (1080 x 1350), usando o quadro inteiro, sem bordas vazias.",
    `- Margens de segurança: 90 px nas laterais${capa ? " (mais 34 px na capa, que aparece recortada em 3:4 na grade do perfil)" : ""}, 100 px no topo e 106 px na base. Nenhum texto nem a logo encostam nas margens.`,
    opcoes.total > 1 ? "- Canto superior direito livre de texto (o Instagram mostra o contador do carrossel ali)." : "",
    opcoes.carrosselInfinito && opcoes.total > 1
      ? "- Carrossel contínuo: o que chega à borda continua na lâmina vizinha com a mesma posição, escala, perspectiva e luz; a última lâmina se conecta visualmente com a capa."
      : "",
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
export function caixaDaLogo(zona: ZonaTexto, capa: boolean): Caixa {
  const esq = AREA.x0 + MARGEM_X + (capa ? CAPA_LATERAL_EXTRA : 0);
  const alturaLogo = 6; // 72 px de 1350, com folga
  if (zona === "base-esquerda" || zona === "base-centro") {
    return { x0: esq, x1: esq + 22, y0: MARGEM_TOPO, y1: MARGEM_TOPO + alturaLogo };
  }
  const base = AREA.y1 - MARGEM_BASE;
  return { x0: esq, x1: esq + 22, y0: base - alturaLogo, y1: base };
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
