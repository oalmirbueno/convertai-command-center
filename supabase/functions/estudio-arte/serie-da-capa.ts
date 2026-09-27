/**
 * O que a série herda da capa (frente R4, 26/09/2026).
 *
 * Pedido do dono: "Na referência da capa, ele fica puxando praticamente tudo
 * para a segunda lâmina, detalhes de tudo. É legal, mas ele tem que entender
 * que às vezes tem elementos que são só da capa; não faz sentido puxar para a
 * segunda."
 *
 * Os elementos da capa se separam em dois grupos:
 *   (a) IDENTIDADE DA SÉRIE: fundo e textura, paleta com a função de cada cor,
 *       tipografia e hierarquia, grafismo pequeno que se repete, margens,
 *       lugar da logo e tratamento de foto. Todas as lâminas seguem.
 *   (b) SÓ DA CAPA: título gigante, selo, etiqueta ou sticker de oferta, foto
 *       herói ou pessoa em destaque, palavra decorativa gigante, seta ou sinal
 *       de arraste, chamada da capa e outros elementos de gancho. Não vão para
 *       as lâminas 2 em diante (a pessoa ou o produto só se a direção da
 *       lâmina pedir, e então menor).
 *
 * Com a referência lida por visão (o molde, já guardado), cada bloco e cada
 * elemento é separado em código pelo papel e por regras claras. O que fica
 * ambíguo (texto pequeno de canto, forma média sem nome claro, cena de fundo)
 * vai a um Choice do Jev por elemento, todos numa chamada só, guardada por
 * referência (<cliente>/estudio/leituras/serie-<ref>.json). Sem Jev: a regra
 * de tamanho (e nada é guardado, para tentar de novo). Sem laço de correção.
 *
 * Quando vale (a ligação está em index.ts, gerarCard):
 *   A. Lâmina 2 em diante que herdaria a referência do CONJUNTO (a da capa),
 *      sem referência própria, sem foto nem elemento, sem quadro de sequência
 *      de prancha, fora do contínuo e do anúncio: se a referência tem algo só
 *      da capa, esta lâmina não replica a capa; vira lâmina de conteúdo da
 *      série, com a referência anexada como guia da identidade. Sem nada só da
 *      capa, replica como hoje.
 *   B. Lâmina 2 em diante que segue a capa gerada: o bloco da série diz o que
 *      herdar e o que não repetir; quando a capa veio de uma referência com o
 *      molde guardado, a lista é a dessa referência.
 * A capa não muda. A lâmina com referência própria não muda (Idêntica
 * respeita a referência dela). Anúncio (Mesa Ads) fica como está.
 * Puro, com as dependências de rede injetadas. Sem travessão.
 */

import type { BlocoDoMolde, MarcaParaDirecao, MoldeDaReferencia } from "../_shared/direcao-arte.ts";
import { corDaMarcaNoPapel } from "../_shared/direcao-arte.ts";
import { zonaDaCaixa } from "../_shared/fidelidade-da-referencia.ts";
import type { PerguntaJev, RespostaJev, ResultadoJev } from "../_shared/jev.ts";
import { type KitDaTrava, neutralizarMarcaDaReferencia } from "../_shared/trava-da-marca.ts";
import { caminhoDaLeituraDoConteudo, chaveDoTexto, normalizarLeituraDoConteudo, VERSAO_DA_LEITURA_DO_CONTEUDO } from "./referencia-adapta-copy.ts";

export const VERSAO_DA_SERIE = 1;
/** Altura da letra (em % do quadro) a partir da qual o título da referência é o título gigante da capa. */
export const LETRA_GIGANTE = 6;
/** Número protagonista a partir desta altura de letra é o número da capa. */
export const NUMERO_GIGANTE = 4;
/** Elemento com menos que esta área (% do quadro) e sem nome de gancho é grafismo pequeno da série. */
export const AREA_PEQUENA = 4;
/** Sem resposta do Jev, o elemento ambíguo desta área para cima fica só na capa. */
export const AREA_GRANDE = 12;
/** Cena que ocupa esta área (% do quadro) ou mais funciona como fundo: ambígua. */
export const AREA_DE_FUNDO = 60;

export type ClasseNaSerie = "identidade" | "so_da_capa";
export const CLASSES_NA_SERIE: ClasseNaSerie[] = ["identidade", "so_da_capa"];
export type TipoDoItem = "titulo" | "texto" | "rotulo" | "cta" | "numero" | "decorativo" | "marca" | "assunto" | "elemento";
export type OrigemDaClasse = "papel" | "regra" | "tamanho" | "jev";

/** Um bloco, elemento ou o assunto da capa de referência, com a classe dele na série. */
export type ItemDaCapa = {
  /** b<i> (bloco), e<i> (elemento) ou assunto. */
  chave: string;
  tipo: TipoDoItem;
  /** Curta, sem texto nem marca da referência. */
  descricao: string;
  /** Onde fica, em palavras ("no topo, à esquerda"). */
  posicao: string;
  /** Área em % do quadro. */
  area: number;
  /** Cor da referência (hex): no prompt vira a da marca na mesma função, nunca vai crua. */
  cor: string | null;
  classe: ClasseNaSerie;
  origem: OrigemDaClasse;
};

export type SeparacaoDaSerie = {
  versao: number;
  itens: ItemDaCapa[];
  /** nao_precisou (nada ambíguo), respondeu, guardado (cache) ou falhou (regra de tamanho). */
  jev: "nao_precisou" | "respondeu" | "guardado" | "falhou";
};

/** Item antes da decisão: classe null = ambíguo (vai ao Jev); `padrao` vale sem resposta. */
export type ItemBruto = Omit<ItemDaCapa, "classe" | "origem"> & { classe: ClasseNaSerie | null; origem: OrigemDaClasse; padrao: ClasseNaSerie };

type Caixa = { x0: number; y0: number; x1: number; y1: number };
const areaDe = (c: Caixa) => Math.round(((Math.max(0, c.x1 - c.x0) * Math.max(0, c.y1 - c.y0)) / 100) * 10) / 10;
const posicaoDe = (c: Caixa) => {
  const z = zonaDaCaixa(c);
  return z ? z.texto : "";
};
const curto = (v: unknown, max: number) => (typeof v === "string" ? v.split(String.fromCharCode(8212)).join(",").split(String.fromCharCode(8211)).join(",").replace(/\s+/g, " ").trim().slice(0, max) : "");

// Nome de gancho da capa: selo, oferta, seta, arraste, preço, sticker.
const DA_CAPA = /\b(selo|selos|badge|etiqueta|sticker|adesivo|carimbo|explos|estrela de|starburst|seta|setas|flecha|arrast|desliz|swipe|cursor|clique|oferta|desconto|promo|pre[çc]o|frete|lan[çc]amento|novidade|gancho|bal[ãa]o|emoji|cupom|brinde|gr[áa]tis)|%/i;
// Forma que emoldura o assunto principal (a foto herói) é da composição da capa.
const EM_VOLTA_DO_ASSUNTO = /(atr[áa]s|em volta|ao redor|envolvendo|emoldurando|moldurando|contornando)\s+d[aoe]s?\s+(pessoa|modelo|mulher|homem|produto|assunto|foto|rosto)/i;
// Grafismo de sistema: fio, linha, moldura, textura, numeração, marca.
const DA_SERIE = /\b(fio|fios|linha|linhas|tra[çc]o|filete|moldura|borda|cantoneira|canto|cantos|textura|gr[ãa]o|ru[íi]do|papel|padr[ãa]o|pattern|grade|grid|pontilhad|pontos|numera[çc][ãa]o|pagina[çc][ãa]o|contador|indicador|progresso|rodap[ée]|cabe[çc]alho|sublinhad|marcador|logo|marca|divis[óo]ria|divisor)/i;

/**
 * Separação em código, pelo papel de cada bloco do molde e por regras claras
 * nos elementos. Classe null = ambíguo (vai ao Jev).
 */
export function itensDaCapa(m: MoldeDaReferencia | null): ItemBruto[] {
  if (!m) return [];
  const saida: ItemBruto[] = [];
  const item = (chave: string, tipo: TipoDoItem, c: Caixa, descricao: string, cor: string | null, classe: ClasseNaSerie | null, origem: OrigemDaClasse, padrao?: ClasseNaSerie): ItemBruto => ({
    chave,
    tipo,
    descricao,
    posicao: posicaoDe(c),
    area: areaDe(c),
    cor,
    classe,
    origem,
    padrao: padrao || classe || "so_da_capa",
  });
  m.blocos.forEach((b: BlocoDoMolde, i) => {
    const k = `b${i}`;
    switch (b.papel) {
      case "titulo":
        saida.push(b.altura_da_letra >= LETRA_GIGANTE
          ? item(k, "titulo", b, "o título gigante de impacto", b.cor, "so_da_capa", "papel")
          : item(k, "titulo", b, "o título", b.cor, "identidade", "papel"));
        break;
      case "numero":
        saida.push(b.altura_da_letra >= NUMERO_GIGANTE
          ? item(k, "numero", b, "o número gigante da capa", b.cor, "so_da_capa", "papel")
          : item(k, "numero", b, "o número", b.cor, "identidade", "papel"));
        break;
      case "decorativo":
        saida.push(item(k, "decorativo", b, "a palavra decorativa gigante de fundo", b.cor, "so_da_capa", "papel"));
        break;
      case "cta":
        saida.push(item(k, "cta", b, "a chamada da capa", b.cor, "so_da_capa", "papel"));
        break;
      case "marca":
      case "perfil":
        saida.push(item(k, "marca", b, "o lugar da marca", b.cor, "identidade", "papel"));
        break;
      case "rotulo":
        // Selo de oferta (só da capa) ou rótulo de categoria que a série repete: ambíguo.
        saida.push(item(k, "rotulo", b, "o texto pequeno de canto, como selo ou etiqueta", b.cor, null, "tamanho", "so_da_capa"));
        break;
      default:
        saida.push(item(k, "texto", b, "o texto de apoio", b.cor, "identidade", "papel"));
    }
  });
  if (m.assunto) {
    const a = m.assunto;
    const desc = curto(a.descricao, 120);
    if (a.tipo === "pessoa") saida.push(item("assunto", "assunto", a, `a pessoa em destaque como foto herói${desc ? `, ${desc}` : ""}`, null, "so_da_capa", "papel"));
    else if (a.tipo === "produto" || a.tipo === "objeto") saida.push(item("assunto", "assunto", a, `o ${a.tipo} em destaque como foto herói${desc ? `, ${desc}` : ""}`, null, "so_da_capa", "papel"));
    else {
      const ampla = areaDe(a) >= AREA_DE_FUNDO;
      saida.push(item("assunto", "assunto", a, `a cena da capa${desc ? `, ${desc}` : ""}`, null, ampla ? null : "so_da_capa", ampla ? "tamanho" : "papel", "so_da_capa"));
    }
  }
  m.elementos.forEach((e, i) => {
    const k = `e${i}`;
    const d = curto(e.descricao, 120);
    const area = areaDe(e);
    if (DA_CAPA.test(d) || EM_VOLTA_DO_ASSUNTO.test(d)) saida.push(item(k, "elemento", e, d, e.cor, "so_da_capa", "regra"));
    else if (DA_SERIE.test(d)) saida.push(item(k, "elemento", e, d, e.cor, "identidade", "regra"));
    else if (area < AREA_PEQUENA) saida.push(item(k, "elemento", e, d, e.cor, "identidade", "tamanho"));
    else saida.push(item(k, "elemento", e, d, e.cor, null, "tamanho", area >= AREA_GRANDE ? "so_da_capa" : "identidade"));
  });
  return saida;
}

export const ambiguos = (itens: ItemBruto[]) => itens.filter((x) => x.classe === null);

// ------------------------------------------------------------------ Jev

const OPCOES = {
  identidade_da_serie: {
    what: "Parte do sistema visual que toda lâmina do carrossel repete: fundo ou textura, fio, moldura, cantoneira, grafismo pequeno recorrente, marcador, rótulo de categoria ou numeração da série, o lugar da marca.",
    not_for: "Elementos que existem para chamar atenção só na abertura do carrossel.",
  },
  so_da_capa: {
    what: "Existe para o gancho da capa: selo, etiqueta ou sticker de oferta, preço, seta ou sinal de arraste, foto herói ou pessoa em destaque, palavra gigante decorativa, forma grande que emoldura o assunto principal, título de impacto.",
    not_for: "Detalhes pequenos que se repetem em toda a série.",
  },
};
const CHAVE_DA_OPCAO: Record<keyof typeof OPCOES, ClasseNaSerie> = { identidade_da_serie: "identidade", so_da_capa: "so_da_capa" };

/** Um Choice por item ambíguo (id q_<chave>), com a opção de cada lado bem definida. */
export function perguntasDaSerie(itens: ItemBruto[]): Record<string, PerguntaJev> {
  const q: Record<string, PerguntaJev> = {};
  for (const x of ambiguos(itens)) {
    q[`q_${x.chave}`] = {
      type: "choice",
      instructions: `A peça em \`capa\` é a CAPA de referência de um carrossel do Instagram. Nas lâminas seguintes, que são de conteúdo, o item \`itens.${x.chave}\` deve se repetir como parte da identidade visual da série, ou ele só faz sentido na capa?`,
      criteria: OPCOES,
    };
  }
  return q;
}

/** Estado em campos nomeados: a capa (grade, fundo, tratamento, assunto, o texto e o gancho quando lidos) e os itens ambíguos. */
export function estadoDaSerie(m: MoldeDaReferencia, itens: ItemBruto[], leitura?: { texto_escrito?: string; sentido?: string; gancho?: string } | null): Record<string, unknown> {
  const doMolde = itensDaCapa(m);
  return {
    capa: {
      grade: m.grade || null,
      fundo: m.fundo || null,
      tratamento: m.tratamento || null,
      assunto: m.assunto ? `${m.assunto.tipo}: ${curto(m.assunto.descricao, 120)} (${posicaoDe(m.assunto)})` : "sem assunto fotográfico",
      elementos: m.elementos.map((e) => `${curto(e.descricao, 120)} (${posicaoDe(e)}, cerca de ${areaDe(e)}% do quadro)`),
      textos: doMolde.filter((x) => x.chave.charAt(0) === "b").map((x) => `${x.descricao} (${x.posicao})`),
      ...(leitura && leitura.texto_escrito ? { texto_escrito: leitura.texto_escrito } : {}),
      ...(leitura && leitura.sentido ? { sentido: leitura.sentido } : {}),
      ...(leitura && leitura.gancho ? { estrategia_do_gancho: leitura.gancho } : {}),
    },
    itens: Object.fromEntries(ambiguos(itens).map((x) => [x.chave, {
      tipo: x.tipo === "rotulo" ? "texto pequeno de canto" : x.tipo === "assunto" ? "cena fotográfica" : "elemento gráfico",
      descricao: x.descricao,
      posicao: x.posicao,
      tamanho: `cerca de ${x.area}% do quadro`,
    }])),
  };
}

/** Aplica as respostas: a opção escolhida vale; sem resposta válida, o padrão do item (regra de tamanho). */
export function decidirSerie(itens: ItemBruto[], answers: Record<string, RespostaJev> | null | undefined): { itens: ItemDaCapa[]; respondidas: number } {
  let respondidas = 0;
  const saida = itens.map((x): ItemDaCapa => {
    const { padrao: _padrao, ...resto } = x;
    if (x.classe) return { ...resto, classe: x.classe };
    const r = answers ? answers[`q_${x.chave}`] : undefined;
    const escolha = r && typeof r.choice === "string" ? CHAVE_DA_OPCAO[r.choice as keyof typeof OPCOES] : undefined;
    if (escolha) {
      respondidas++;
      return { ...resto, classe: escolha, origem: "jev" };
    }
    return { ...resto, classe: x.padrao, origem: "tamanho" };
  });
  return { itens: saida, respondidas };
}

// ------------------------------------------------------------------ separação guardada

export type DepsDaSerie = {
  pasta: string;
  lerGuardado: (caminho: string) => Promise<Record<string, unknown> | null>;
  guardar: (caminho: string, valor: unknown) => Promise<void>;
  perguntarJev: (state: unknown, questions: Record<string, PerguntaJev>) => Promise<ResultadoJev>;
  cobrarJev: (r: ResultadoJev) => Promise<unknown>;
};

const seguro = (id: string) => id.replace(/[^0-9a-z-]/gi, "-").slice(0, 90);
export const caminhoDaSerie = (pasta: string, refId: string) => `${pasta}/serie-${seguro(refId)}.json`;

/** Assinatura do que a regra viu: molde relido (ou mudado) faz a separação de novo. */
export function assinaturaDaSerie(itens: ItemBruto[]): string {
  return chaveDoTexto(JSON.stringify(itens.map((x) => [x.chave, x.tipo, x.descricao, x.classe, x.posicao])));
}

function itensGuardados(v: unknown): ItemDaCapa[] | null {
  if (!Array.isArray(v)) return null;
  const saida: ItemDaCapa[] = [];
  for (const bruto of v) {
    if (!bruto || typeof bruto !== "object") return null;
    const o = bruto as Record<string, unknown>;
    if (typeof o.chave !== "string" || CLASSES_NA_SERIE.indexOf(o.classe as ClasseNaSerie) < 0) return null;
    saida.push({
      chave: o.chave,
      tipo: String(o.tipo || "elemento") as TipoDoItem,
      descricao: curto(o.descricao, 160),
      posicao: curto(o.posicao, 60),
      area: Number(o.area) || 0,
      cor: typeof o.cor === "string" ? o.cor : null,
      classe: o.classe as ClasseNaSerie,
      origem: (["papel", "regra", "tamanho", "jev"].indexOf(String(o.origem)) >= 0 ? o.origem : "papel") as OrigemDaClasse,
    });
  }
  return saida;
}

/**
 * A separação da referência da capa: regra em código e, se sobrar item
 * ambíguo, UM pedido ao Jev (um Choice por item), guardado por referência.
 * Refazer ou gerar a próxima lâmina não paga de novo. Falha do Jev: a regra de
 * tamanho, sem guardar. Sem molde: null. Nunca lança.
 */
export async function separarIdentidadeDaCapa(e: { refId: string; molde: MoldeDaReferencia | null }, deps: DepsDaSerie): Promise<SeparacaoDaSerie | null> {
  try {
    if (!e.molde) return null;
    const brutos = itensDaCapa(e.molde);
    if (!brutos.length) return null;
    const assinatura = assinaturaDaSerie(brutos);
    const caminho = caminhoDaSerie(deps.pasta, e.refId);
    const guardado = await deps.lerGuardado(caminho).catch(() => null);
    if (guardado && guardado.versao === VERSAO_DA_SERIE && guardado.assinatura === assinatura) {
      const itens = itensGuardados(guardado.itens);
      if (itens && itens.length === brutos.length) return { versao: VERSAO_DA_SERIE, itens, jev: "guardado" };
    }
    const duvidas = ambiguos(brutos);
    if (!duvidas.length) {
      const r = decidirSerie(brutos, null);
      await deps.guardar(caminho, { versao: VERSAO_DA_SERIE, assinatura, em: new Date().toISOString(), jev: "nao_precisou", itens: r.itens }).catch(() => null);
      return { versao: VERSAO_DA_SERIE, itens: r.itens, jev: "nao_precisou" };
    }
    // A leitura do conteúdo (texto escrito, gancho) ajuda o Jev quando já está guardada; nunca é lida só para isto.
    const lida = await deps.lerGuardado(caminhoDaLeituraDoConteudo(deps.pasta, e.refId)).catch(() => null);
    const leitura = lida && lida.versao === VERSAO_DA_LEITURA_DO_CONTEUDO ? normalizarLeituraDoConteudo(lida.leitura) : null;
    let res: ResultadoJev;
    try {
      res = await deps.perguntarJev(
        estadoDaSerie(e.molde, brutos, leitura ? { texto_escrito: leitura.conteudo.texto_escrito, sentido: leitura.conteudo.sentido, gancho: leitura.estetica.estrategia_do_gancho } : null),
        perguntasDaSerie(brutos),
      );
    } catch {
      return { versao: VERSAO_DA_SERIE, itens: decidirSerie(brutos, null).itens, jev: "falhou" };
    }
    await deps.cobrarJev(res).catch(() => null);
    const r = decidirSerie(brutos, res.answers);
    if (!r.respondidas) return { versao: VERSAO_DA_SERIE, itens: r.itens, jev: "falhou" };
    await deps.guardar(caminho, { versao: VERSAO_DA_SERIE, assinatura, em: new Date().toISOString(), jev: "respondeu", itens: r.itens }).catch(() => null);
    return { versao: VERSAO_DA_SERIE, itens: r.itens, jev: "respondeu" };
  } catch {
    return null;
  }
}

export const soDaCapa = (s: SeparacaoDaSerie | null | undefined): ItemDaCapa[] => (s ? s.itens.filter((x) => x.classe === "so_da_capa") : []);
export const temAlgoSoDaCapa = (s: SeparacaoDaSerie | null | undefined) => soDaCapa(s).length > 0;

/** O que a versão guarda da separação (sem texto da referência). */
export function registroDaSerie(s: SeparacaoDaSerie, origem: "referencia_do_conjunto" | "capa_gerada", refId: string) {
  return {
    origem,
    referencia_id: refId,
    jev: s.jev,
    so_da_capa: soDaCapa(s).map((x) => x.chave),
    identidade: s.itens.filter((x) => x.classe === "identidade").map((x) => x.chave),
  };
}

// ------------------------------------------------------------------ quando vale

/**
 * Caso A: a lâmina 2 em diante herdaria a referência do conjunto (a da capa)
 * sem referência própria, foto, elemento nem quadro de prancha, fora do
 * contínuo e do anúncio. Só então a separação é feita.
 */
export function herdaReferenciaDaCapa(e: {
  ordem: number;
  total: number;
  ads: boolean;
  refsDaLamina: number;
  refs: number;
  quadroDaPrancha: boolean;
  panorama: boolean;
  foto: boolean;
  elementos: number;
}): boolean {
  return e.ordem >= 2 && e.total >= 2 && !e.ads && e.refsDaLamina === 0 && e.refs > 0 && !e.quadroDaPrancha && !e.panorama && !e.foto && e.elementos === 0;
}

/**
 * Caso B: a capa gerada (versão atual da lâmina 1) veio do modo replicar
 * referência? Devolve o id da referência e o id do molde guardado (o quadro
 * da prancha tem molde próprio, <id>-q<n>). Senão null.
 */
export function referenciaDaCapaGerada(v: unknown): { refId: string; moldeId: string } | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.modo !== "replicar_referencia") return null;
  const refs = Array.isArray(o.referencias) ? o.referencias.filter((x) => typeof x === "string" && x) as string[] : [];
  if (!refs.length) return null;
  const refId = refs[0];
  const prancha = Array.isArray(o.prancha) ? o.prancha as { referencia_id?: unknown; quadro?: unknown }[] : [];
  const q = prancha.filter((p) => p && p.referencia_id === refId && Number.isInteger(Number(p.quadro)) && Number(p.quadro) > 0)[0];
  return { refId, moldeId: q ? `${refId}-q${Number(q.quadro)}` : refId };
}

// ------------------------------------------------------------------ texto ao gerador

const desenhoDo = (b: BlocoDoMolde) => [b.familia, b.largura_da_letra !== "normal" ? b.largura_da_letra : "", `peso ${b.peso}`, b.caixa_alta ? "caixa alta" : ""].filter(Boolean).join(", ");

/**
 * Bloco geral da série para o post orgânico (o anúncio segue com blocoDaSerie
 * de direcao-arte.ts, como está): da lâmina 2 em diante, o que herdar da capa
 * (identidade) e o que não repetir (só da capa). O fechamento volta à capa
 * pela identidade. Capa e post único: vazio.
 */
export function blocoDaIdentidadeDaSerie(e: { ordem: number; total: number; capa: number | null; cenaFixa?: boolean }): string {
  if (e.total < 2 || e.ordem < 2) return "";
  const final = e.ordem === e.total;
  const guia = e.capa ? `a capa (imagem ${e.capa})` : "a capa desta série";
  return [
    `SÉRIE DO CARROSSEL (lâmina ${e.ordem} de ${e.total}): esta lâmina continua ${guia}; não é uma peça nova e também não é uma cópia da capa.`,
    e.cenaFixa
      ? "- A cena desta lâmina já está decidida. Da capa vem o sistema do texto: a mesma tipografia (família, peso, caixa e escala relativa entre headline e apoio), as mesmas cores de texto e de destaque, o mesmo alinhamento e os mesmos grafismos do texto (fios, sublinhados, marcadores), no mesmo traço e espessura."
      : "- Herde da capa a IDENTIDADE DA SÉRIE: o mesmo fundo e textura, a mesma paleta com a mesma função de cada cor, a mesma tipografia (família, peso, caixa e hierarquia entre título e apoio), as mesmas linhas, formas e elementos gráficos pequenos que se repetem (mesmo traço, espessura, cantos e cor), as mesmas margens e o mesmo tratamento de foto, luz e textura; quando a lâmina leva logo, no mesmo lugar e tamanho da capa.",
    "- Não repita o que é SÓ DA CAPA: o título gigante de impacto, selo, etiqueta ou sticker de oferta, a foto herói ou a pessoa em destaque (só entra se a direção desta lâmina pedir, e então menor e a serviço do conteúdo), a palavra decorativa gigante de fundo, a seta ou o sinal de arraste e qualquer outro elemento de gancho.",
    "- Não reinvente o estilo: não troque de fonte nem de paleta. Os cartões, conectores, colunas e ícones do conteúdo desta lâmina são desenhados nesse mesmo sistema (mesmo traço, cantos e cores).",
    "- Não copie o texto nem a composição da capa: é a mesma série, não a mesma lâmina.",
    final
      ? "- FECHAMENTO: esta é a última lâmina. Feche voltando à capa pela identidade (a mesma cor dominante ou o mesmo grafismo), como um espelho do começo, com o CTA em destaque; sem repetir o título, o selo nem a foto herói da capa."
      : "",
  ].filter(Boolean).join("\n");
}

/** Legenda da capa anexada nas lâminas 2 em diante (post orgânico, fora da cena fixa). */
export function rotuloDaCapaNaSerie(final: boolean): string {
  return `CAPA desta série (lâmina 1), já aprovada: é o guia do sistema visual; herde dela o fundo e a textura, a paleta na mesma função, a tipografia e a hierarquia, os grafismos pequenos que se repetem (mesmo traço, espessura e cor), as margens e o tratamento de foto e luz; não repita dela o título gigante, selo ou etiqueta, a foto herói ou a pessoa em destaque, a palavra gigante de fundo, a seta ou o sinal de arraste; não copie o texto nem a composição dela${final ? "; o final fecha voltando a ela" : ""}`;
}

/** Legenda da referência do conjunto quando ela vira guia da identidade (caso A). */
export const ROTULO_DA_REFERENCIA_NA_SERIE =
  "REFERÊNCIA DA CAPA escolhida pela equipe: guia da IDENTIDADE da série (fundo e textura, paleta na função, tipografia, grafismos pequenos, lugar da logo, tratamento); não é o layout desta lâmina e o que é só da capa não entra aqui (lista no texto)";

/**
 * Lista específica da referência da capa (lida por visão), depois do bloco
 * geral da série: o que herdar (fundo, tratamento, tipografia, grafismos
 * pequenos, alinhamento e lugar da logo) e o que não repetir. Cores sempre as
 * da marca na mesma função; o texto passa pela trava da marca. Capa: vazio.
 */
export function blocoDaSerieDaReferencia(e: {
  ordem: number;
  total: number;
  molde: MoldeDaReferencia | null;
  separacao: SeparacaoDaSerie | null;
  paleta: MarcaParaDirecao["paleta"];
  kit?: KitDaTrava;
  /** Imagem da referência anexada (caso A); null quando só a capa gerada vai junto. */
  indiceDaReferencia: number | null;
  levaLogo: boolean;
  cenaFixa?: boolean;
}): string {
  if (e.total < 2 || e.ordem < 2 || !e.molde || !e.separacao) return "";
  const m = e.molde;
  const kit: KitDaTrava = e.kit === undefined ? { paleta: e.paleta } : e.kit;
  const limpo = (s: string) => neutralizarMarcaDaReferencia(s, kit).replace(/[\s.;,]+$/, "");
  const cor = (hex: string | null) => (hex ? corDaMarcaNoPapel(hex, e.paleta) : null);
  const itens = e.separacao.itens;
  const so = itens.filter((x) => x.classe === "so_da_capa");
  const grafismos = itens.filter((x) => x.classe === "identidade" && x.tipo === "elemento").slice(0, 4);
  const leitura = m.blocos.filter((b) => b.papel !== "marca" && b.papel !== "perfil" && b.papel !== "decorativo").sort((a, b) => b.altura_da_letra - a.altura_da_letra);
  const titulo = leitura[0] || null;
  const menor = leitura.length > 1 ? leitura[leitura.length - 1] : null;
  const marca = itens.filter((x) => x.tipo === "marca")[0] || null;
  const fundo = cor(m.cor_do_fundo);
  const herde: string[] = [];
  if (!e.cenaFixa) {
    if (m.fundo) herde.push(`o fundo (${limpo(m.fundo)})${fundo ? `, em ${fundo}` : ""}`);
    if (m.tratamento) herde.push(`o tratamento (${limpo(m.tratamento)})`);
  }
  if (titulo) {
    herde.push(`a tipografia: título no desenho ${desenhoDo(titulo)}${menor ? `, textos menores no desenho ${desenhoDo(menor)}` : ""}, com o título bem maior que o apoio e alinhado ${titulo.alinhamento === "centro" ? "ao centro" : `à ${titulo.alinhamento}`}`);
  }
  if (grafismos.length && !e.cenaFixa) {
    herde.push(`os grafismos pequenos que se repetem, no mesmo traço: ${grafismos.map((g) => {
      const c = cor(g.cor);
      return `${limpo(g.descricao)} (${g.posicao}${c ? `, ${c}` : ""})`;
    }).join(", ")}`);
  }
  if (e.levaLogo && marca && marca.posicao) herde.push(`a logo no lugar da marca da referência (${marca.posicao})`);
  const assunto = so.filter((x) => x.tipo === "assunto")[0] || null;
  const listaSo = so.slice(0, 7).map((x) => `${limpo(x.descricao)}${x.posicao ? ` (${x.posicao})` : ""}`);
  const onde = e.indiceDaReferencia ? `a referência da capa é a imagem ${e.indiceDaReferencia}` : "a lista vem da referência que fez a capa";
  return [
    `O QUE ESTA LÂMINA HERDA DA CAPA (lâmina ${e.ordem} de ${e.total}; ${onde}, lida por visão): é lâmina de conteúdo, não outra capa.`,
    herde.length ? `- Herde (identidade da série): ${herde.join("; ")}.` : "",
    listaSo.length ? `- Não repita da capa (é só dela): ${listaSo.join("; ")}.` : "",
    herde.length ? "- Fundo, tratamento, tipografia e grafismos: os desta lista valem sobre os da composição acima, para a lâmina ser da mesma série da capa." : "",
    assunto
      ? "- A pessoa ou o produto em destaque da capa só entra se a direção desta lâmina pedir: menor, a serviço do conteúdo, sem a pose e o enquadramento de herói da capa."
      : "",
  ].filter(Boolean).join("\n");
}
