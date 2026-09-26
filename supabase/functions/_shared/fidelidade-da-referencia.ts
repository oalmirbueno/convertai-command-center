/**
 * Fidelidade à referência e variedade com memória (Estúdio, frente E, 25/09
 * à noite). Puro: sem Deno, sem banco, sem IA. Sem travessão.
 *
 * Pedido do dono: "Na capa, sempre com referência, a sequência dele é muito
 * idêntica. Ele vai no sentido da base, show de bola, mas diversificar um
 * pouquinho também: ele entender o que já foi feito, para não ficar fazendo
 * sempre a mesma coisa. Pode ter o negócio da referência extremamente
 * idêntica, mais ou menos, ser criativo junto, ter os controles que eu consiga
 * aumentar e diminuir, dentro do Estúdio."
 *
 * Quatro níveis, escolhidos por lâmina (card.fidelidade_referencia) com um
 * padrão por trabalho (direcao.fidelidade_referencia):
 *   - identica: o modo replicar referência como foi aprovado (padrão). Nada
 *     muda: nem o prompt, nem os anexos, nem a edição da referência;
 *   - proxima: mesmo layout e mesma grade; pose, enquadramento, elementos
 *     secundários e detalhes livres;
 *   - inspirada: a referência vira guia de estilo e do sistema gráfico; a
 *     composição é nova;
 *   - criativa: só o clima, a paleta e a energia; composição e ideia novas.
 * O prompt de cada nível é montado em promptDoReplicar (direcao-arte.ts).
 *
 * Variedade com memória (níveis proxima, inspirada e criativa, só na capa):
 * o servidor lê as últimas capas do cliente gravadas nas versões (referencias,
 * molde_lido, modo, fidelidade_referencia e variedade) e escolhe, em código,
 * o que variar nesta versão (pose, câmera, posição do texto, elemento gráfico,
 * cor de destaque da paleta), evitando o que já foi feito, principalmente com
 * a mesma referência. A escolha fica gravada na versão (variedade) para a
 * próxima capa não repetir.
 */

export type FidelidadeDaReferencia = "identica" | "proxima" | "inspirada" | "criativa";
export const FIDELIDADES: FidelidadeDaReferencia[] = ["identica", "proxima", "inspirada", "criativa"];
export const FIDELIDADE_PADRAO: FidelidadeDaReferencia = "identica";

export const ROTULO_DA_FIDELIDADE: Record<FidelidadeDaReferencia, string> = {
  identica: "Idêntica",
  proxima: "Próxima",
  inspirada: "Inspirada",
  criativa: "Criativa",
};

/** Nível lido com cuidado (JSON do banco ou da tela): o que não é conhecido vira null. */
export function fidelidadeDaReferencia(v: unknown): FidelidadeDaReferencia | null {
  return FIDELIDADES.indexOf(v as FidelidadeDaReferencia) >= 0 ? v as FidelidadeDaReferencia : null;
}

/** O nível que vale na lâmina: o dela, senão o padrão do trabalho, senão Idêntica. */
export function fidelidadeDaLamina(card: { fidelidade_referencia?: unknown } | null | undefined, direcao: { fidelidade_referencia?: unknown } | null | undefined): FidelidadeDaReferencia {
  return fidelidadeDaReferencia(card ? card.fidelidade_referencia : null) || fidelidadeDaReferencia(direcao ? direcao.fidelidade_referencia : null) || FIDELIDADE_PADRAO;
}

/** Inspirada e Criativa soltam a composição: a referência não é editada nem dá as posições. */
export const soltaAComposicao = (f: FidelidadeDaReferencia) => f === "inspirada" || f === "criativa";

// ---------------------------------------------------------------- variedade

export type EixoDaVariedade = "pose" | "camera" | "texto" | "elemento" | "destaque";
export type EscolhaDeVariedade = Partial<Record<EixoDaVariedade, string>>;
const EIXOS: EixoDaVariedade[] = ["pose", "camera", "texto", "elemento", "destaque"];

/** Uma capa já gerada do cliente, lida das versões gravadas (estudio_trabalhos.cards). */
export type CapaNoHistorico = {
  referencias: string[];
  fidelidade: FidelidadeDaReferencia;
  variedade: EscolhaDeVariedade | null;
  mesmaReferencia: boolean;
  /** O molde (layout medido) da referência foi lido nesta versão. */
  moldeLido: boolean;
  criado_em: string;
};

const textoCurto = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Escolha de variedade gravada numa versão, lida com cuidado. */
export function variedadeGravada(v: unknown): EscolhaDeVariedade | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const saida: EscolhaDeVariedade = {};
  for (const eixo of EIXOS) {
    const t = textoCurto(o[eixo], 200);
    if (t) saida[eixo] = t;
  }
  return Object.keys(saida).length ? saida : null;
}

/**
 * As capas (lâmina 1) já geradas no modo replicar referência, das mais novas
 * para as mais velhas, até `max`. `refId` marca as que usaram a mesma
 * referência (o id gravado em referencias da versão). Lê só o que a versão já
 * grava: referencias, molde_lido, modo, fidelidade_referencia e variedade.
 */
export function capasNoHistorico(trabalhos: { cards?: unknown }[] | null | undefined, refId: string | null, max = 12): CapaNoHistorico[] {
  const saida: CapaNoHistorico[] = [];
  for (const t of trabalhos ?? []) {
    const cards = t && Array.isArray(t.cards) ? t.cards : [];
    for (const bruto of cards) {
      if (!bruto || typeof bruto !== "object") continue;
      const v = bruto as Record<string, unknown>;
      if (Number(v.ordem) !== 1 || v.modo !== "replicar_referencia") continue;
      const referencias = (Array.isArray(v.referencias) ? v.referencias : []).filter((x) => typeof x === "string") as string[];
      const lidos = Array.isArray(v.molde_lido) ? v.molde_lido as { referencia_id?: unknown; lido?: unknown }[] : [];
      const mesma = !!refId && referencias.indexOf(refId) >= 0;
      saida.push({
        referencias,
        fidelidade: fidelidadeDaReferencia(v.fidelidade_referencia) || FIDELIDADE_PADRAO,
        variedade: variedadeGravada(v.variedade),
        mesmaReferencia: mesma,
        moldeLido: lidos.some((l) => l && l.lido === true && (!refId || l.referencia_id === refId)),
        criado_em: typeof v.criado_em === "string" ? v.criado_em : "",
      });
    }
  }
  return saida.sort((a, b) => (a.criado_em < b.criado_em ? 1 : a.criado_em > b.criado_em ? -1 : 0)).slice(0, max);
}

type Caixa = { x0: number; x1: number; y0: number; y1: number };

/** Onde fica uma caixa (em % do quadro), em palavras: "no topo, à esquerda". */
export function zonaDaCaixa(c: Caixa | null | undefined): { vertical: "topo" | "meio" | "base"; horizontal: "esquerda" | "centro" | "direita"; texto: string } | null {
  if (!c) return null;
  const cy = (c.y0 + c.y1) / 2;
  const cx = (c.x0 + c.x1) / 2;
  const vertical = cy < 38 ? "topo" : cy > 62 ? "base" : "meio";
  const larga = c.x1 - c.x0 >= 70;
  const horizontal = larga ? "centro" : cx < 42 ? "esquerda" : cx > 58 ? "direita" : "centro";
  const v = vertical === "topo" ? "no topo" : vertical === "base" ? "na base" : "no meio";
  const h = horizontal === "centro" ? (larga ? "de lado a lado" : "ao centro") : horizontal === "esquerda" ? "à esquerda" : "à direita";
  return { vertical, horizontal, texto: `${v}, ${h}` };
}

const POSES = [
  "outra pose: corpo de três quartos, ombros virados, olhando para a câmera",
  "outro gesto: a mão em primeiro plano, apontando ou segurando algo ligado ao tema",
  "de perfil ou meio perfil, com o olhar indo na direção do texto",
  "em ação, fazendo o serviço ou usando o produto, sem posar",
  "sentada ou apoiada, postura relaxada, sorriso natural",
  "braços cruzados ou mãos juntas, postura confiante, meio corpo",
];
const CAMERAS_COM_PESSOA = [
  "câmera mais baixa, de baixo para cima",
  "câmera um pouco mais alta, de cima para baixo",
  "plano mais fechado, do peito para cima",
  "plano mais aberto, com mais ambiente em volta",
  "câmera levemente de lado, em diagonal",
];
const RECORTES_DA_FOTO = [
  "recorte mais fechado da foto do cliente, do peito para cima",
  "recorte mais aberto da foto do cliente, com mais respiro em volta",
  "a foto do cliente deslocada para o lado oposto ao da referência",
];
const CAMERAS_SEM_PESSOA = [
  "câmera de cima (vista superior) sobre o objeto ou a cena",
  "plano de detalhe, bem de perto, com textura em primeiro plano",
  "câmera baixa, o objeto grande contra o fundo",
  "plano aberto, o objeto pequeno com muito espaço calmo",
];
const TEXTOS: { zona: "topo" | "base" | "meio" | "lateral"; texto: string }[] = [
  { zona: "topo", texto: "título no topo, alinhado à esquerda, em bloco compacto" },
  { zona: "base", texto: "título na base, alinhado à esquerda, com o assunto acima" },
  { zona: "lateral", texto: "título em coluna estreita na lateral, em várias linhas curtas" },
  { zona: "meio", texto: "título grande atravessando o meio, com o assunto atrás dele" },
  { zona: "topo", texto: "título centralizado no terço de cima, com a palavra-chave bem maior" },
];
const ELEMENTOS = [
  "um fio fino na cor de destaque sublinhando a palavra-chave",
  "um bloco sólido de cor da marca atrás do título",
  "uma forma geométrica grande (círculo ou arco) cortada pela borda, atrás do assunto",
  "uma faixa diagonal de cor atravessando um canto",
  "o assunto recortado sobre um bloco de cor da paleta, com sombra de contato suave",
  "numeração ou marcador grande e leve, no estilo editorial",
];

function saturacao(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}
const hex6 = (v: unknown) => (typeof v === "string" && /^#?[0-9a-f]{6}$/i.test(v.trim()) ? `#${v.trim().replace("#", "").toUpperCase()}` : null);

/** Cores de destaque possíveis dentro da paleta: as coloridas (as neutras só sem nenhuma colorida). */
export function destaquesDaPaleta(paleta: { nome?: string; hex?: string; papel?: string }[]): string[] {
  const cores = paleta.map((p) => ({ nome: p.nome || p.papel || "cor", hex: hex6(p.hex) })).filter((p) => p.hex) as { nome: string; hex: string }[];
  const coloridas = cores.filter((c) => saturacao(c.hex) >= 0.25);
  return (coloridas.length ? coloridas : cores).map((c) => `${c.nome} ${c.hex}`);
}

/** Primeira opção a partir de `inicio` (em roda) que ainda não foi usada; todas usadas, a do início. */
function naRoda(opcoes: string[], usadas: string[], inicio: number): string | undefined {
  if (!opcoes.length) return undefined;
  for (let k = 0; k < opcoes.length; k++) {
    const o = opcoes[(inicio + k) % opcoes.length];
    if (usadas.indexOf(o) < 0) return o;
  }
  return opcoes[inicio % opcoes.length];
}

export type EntradaDaVariedade = {
  fidelidade: FidelidadeDaReferencia;
  historico: CapaNoHistorico[];
  paleta: { nome?: string; hex?: string; papel?: string }[];
  /** O assunto da referência (ou da foto) é uma pessoa. */
  temPessoa: boolean;
  /** A lâmina tem foto real do cliente (a pose não muda: muda o recorte). */
  temFoto: boolean;
  /** A referência não tem assunto fotográfico (só tipografia e elementos). */
  soTipografia: boolean;
  /** Caixa do título da referência (molde), para o texto sair de outro lugar. */
  tituloDaReferencia: Caixa | null;
};

/**
 * O que variar nesta versão, escolhido em código (sem IA): em cada eixo, a
 * primeira opção que nenhuma capa anterior usou, começando por um ponto que
 * gira com o número de capas feitas com a mesma referência. Próxima não mexe
 * na posição do texto (o layout fica); Inspirada e Criativa tiram o texto do
 * lugar em que a referência põe o título.
 */
export function escolherVariedade(e: EntradaDaVariedade): EscolhaDeVariedade {
  if (e.fidelidade === "identica") return {};
  const mesmas = e.historico.filter((h) => h.mesmaReferencia);
  const usadas = (eixo: EixoDaVariedade) =>
    // As da mesma referência primeiro; as outras capas do cliente também contam.
    mesmas.concat(e.historico.filter((h) => !h.mesmaReferencia)).map((h) => (h.variedade ? h.variedade[eixo] : undefined)).filter(Boolean) as string[];
  const n = mesmas.length;
  const escolha: EscolhaDeVariedade = {};
  if (!e.soTipografia) {
    if (e.temPessoa && !e.temFoto) escolha.pose = naRoda(POSES, usadas("pose"), n);
    const cameras = e.temFoto ? RECORTES_DA_FOTO : e.temPessoa ? CAMERAS_COM_PESSOA : CAMERAS_SEM_PESSOA;
    escolha.camera = naRoda(cameras, usadas("camera"), n + 1);
  }
  if (soltaAComposicao(e.fidelidade)) {
    const zona = zonaDaCaixa(e.tituloDaReferencia);
    const lateral = !!e.tituloDaReferencia && e.tituloDaReferencia.x1 - e.tituloDaReferencia.x0 < 45 && e.tituloDaReferencia.y1 - e.tituloDaReferencia.y0 > 25;
    const fora = TEXTOS.filter((t) => !zona || (lateral ? t.zona !== "lateral" : t.zona !== zona.vertical)).map((t) => t.texto);
    escolha.texto = naRoda(fora.length ? fora : TEXTOS.map((t) => t.texto), usadas("texto"), n);
  }
  escolha.elemento = naRoda(ELEMENTOS, usadas("elemento"), n + 2);
  const destaques = destaquesDaPaleta(e.paleta);
  if (destaques.length > 1) escolha.destaque = naRoda(destaques, usadas("destaque"), n);
  for (const eixo of EIXOS) if (!escolha[eixo]) delete escolha[eixo];
  return escolha;
}

const REGRA_QUE_FICA: Record<Exclude<FidelidadeDaReferencia, "identica">, string> = {
  proxima: "a grade e a posição dos blocos de texto da referência",
  inspirada: "o estilo e o sistema gráfico da referência",
  criativa: "o clima e a energia da referência",
};

/**
 * Bloco curto do prompt: o que já foi feito com esta referência (e nas
 * últimas capas do cliente) e o que variar agora. Vazio em Idêntica.
 * `layoutDaReferencia`: o layout que o nível Idêntica repete (do molde), para
 * dizer o que já saiu igual.
 */
export function blocoDaVariedade(e: {
  fidelidade: FidelidadeDaReferencia;
  historico: CapaNoHistorico[];
  escolha: EscolhaDeVariedade;
  layoutDaReferencia?: string | null;
}): string {
  if (e.fidelidade === "identica") return "";
  const mesmas = e.historico.filter((h) => h.mesmaReferencia);
  const outras = e.historico.filter((h) => !h.mesmaReferencia);
  const resumoDe = (v: EscolhaDeVariedade | null) => (v ? [v.pose, v.camera, v.texto, v.elemento, v.destaque ? `destaque ${v.destaque}` : ""].filter(Boolean).join(", ") : "");
  let feito: string;
  if (mesmas.length) {
    const identicas = mesmas.filter((h) => h.fidelidade === "identica" || !h.variedade).length;
    const variadas = mesmas.filter((h) => h.variedade).slice(0, 2).map((h) => resumoDe(h.variedade)).filter(Boolean);
    feito = [
      `${mesmas.length} capa${mesmas.length === 1 ? "" : "s"} deste cliente`,
      identicas ? `${identicas} no layout idêntico da referência${e.layoutDaReferencia ? ` (${e.layoutDaReferencia})` : ""}` : "",
      variadas.length ? `já variadas com: ${variadas.join("; ")}` : "",
    ].filter(Boolean).join("; ");
  } else {
    const ultimas = outras.filter((h) => h.variedade).slice(0, 2).map((h) => resumoDe(h.variedade)).filter(Boolean);
    feito = `nenhuma capa deste cliente ainda${ultimas.length ? `; nas últimas capas com outras referências: ${ultimas.join("; ")}` : ""}`;
  }
  const varie = [e.escolha.pose, e.escolha.camera, e.escolha.texto, e.escolha.elemento, e.escolha.destaque ? `cor de destaque ${e.escolha.destaque} (dentro da paleta da marca, só na palavra-chave, no número ou no CTA)` : ""].filter(Boolean);
  return [
    "VARIEDADE (para não repetir o que já foi feito)",
    `- Já foi feito com esta referência: ${feito}.`,
    varie.length ? `- Varie nesta versão: ${varie.join("; ")}.` : "",
    `- Continuam: o texto exato, a marca (cores, fontes, logo), a pessoa ou o produto da foto do cliente (quando há) e ${REGRA_QUE_FICA[e.fidelidade]}.`,
  ].filter(Boolean).join("\n");
}

// ---------------------------------------------------------------- série e anexos

/**
 * Legenda do anexo da referência nos níveis que não são Idêntica (null em
 * Idêntica: a legenda de sempre). A 2ª referência continua só o acabamento.
 */
export function rotuloDaReferenciaNaFidelidade(f: FidelidadeDaReferencia, indice: number): string | null {
  if (f === "identica" || indice > 0) return null;
  if (f === "proxima") return "REFERÊNCIA 1 escolhida pela equipe: a grade e a posição dos blocos desta lâmina; pose, enquadramento e elementos secundários são novos";
  if (f === "inspirada") return "REFERÊNCIA 1 escolhida pela equipe: guia de estilo e do sistema gráfico; a composição desta lâmina é nova";
  return "REFERÊNCIA 1 escolhida pela equipe: só o clima, a energia e o jeito de usar a cor; a ideia e a composição desta lâmina são novas";
}

/**
 * Da lâmina 2 em diante, em Inspirada e Criativa (a composição é nova), a capa
 * gerada vai anexada para a série continuar parecendo uma só. Vazio nos outros
 * casos (em Idêntica e Próxima o layout da referência já amarra a série).
 */
export function serieNaFidelidade(e: { fidelidade: FidelidadeDaReferencia; ordem: number; total: number; capa: number | null }): string {
  if (!soltaAComposicao(e.fidelidade) || e.ordem < 2 || e.total < 2 || !e.capa) return "";
  return [
    `SÉRIE (lâmina ${e.ordem} de ${e.total}): a capa desta série já foi gerada (imagem ${e.capa}).`,
    "- Mantenha dela a marca aplicada: as mesmas cores, fontes, tratamento, a mesma pessoa e o mesmo cenário, para a série parecer uma só; a composição desta lâmina pode ser outra, e o texto é o desta lâmina.",
  ].join("\n");
}
