/**
 * Aprendizado contínuo com as entregas (frente AP, 27/09/2026).
 *
 * Pedido do dono: "aprender com cada geração enviada e entregue; cada
 * terminada ele já sabe". Este arquivo é PURO (sem Deno, sem cliente do
 * Supabase, sem IA): o Estúdio, o agente de estilo, o robô semanal e o
 * Vitest usam as mesmas regras.
 *
 * 1. MEMÓRIA DA ENTREGA: quando um trabalho do Estúdio é entregue, o que foi
 *    usado e aprovado vira um registro (fidelidade, referência, template,
 *    estilo, componentes do miolo, jogada do texto, cor de destaque,
 *    tipografia, formato, lâminas, ajustes pedidos até entregar) e um PADRÃO
 *    canônico em texto. O mesmo padrão dito de novo tem o mesmo texto: no
 *    cérebro vira reforço, nunca linha duplicada.
 * 2. NÚMEROS REAIS: a entrega liga ao post publicado (post_id da entrega,
 *    publicação, métrica do post). Taxa de salvamentos mais compartilhamentos
 *    por alcance, comparada com os posts do próprio perfil: os 20% melhores
 *    viram "padrão que funcionou", os 20% piores "rendeu abaixo" (sinal fraco,
 *    nunca apaga nada). Cada entrega é julgada uma vez.
 * 3. NA GERAÇÃO: bloco curto (teto de 700 caracteres) com os 3 padrões mais
 *    fortes (desempenho real > aprovação sem ajuste > recência) e uma linha do
 *    que evitar; na capa, uma linha para não repetir a composição exata das
 *    últimas capas entregues. Cliente sem entrega: tudo vazio, o prompt fica
 *    byte a byte o de antes.
 *
 * Sem travessão, sem lookbehind, sem \p{}: o painel importa este arquivo.
 */

// ------------------------------------------------------------------ utilidades

const umaLinha = (v: unknown, max: number): string => {
  const s = String(v == null ? "" : v).replace(/[—–]/g, ",").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…` : s;
};
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const unicos = <T>(l: T[]): T[] => l.filter((x, i) => l.indexOf(x) === i);

/** Acentos soltos depois do NFD (U+0300 a U+036F), montados por código para o arquivo ficar em ASCII. */
const MARCAS_DE_ACENTO = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g");

/** Texto sem acento, sem pontuação e sem caixa (chave estável). */
export function normalizado(s: string): string {
  return String(s == null ? "" : s)
    .normalize("NFD")
    .replace(MARCAS_DE_ACENTO, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 0,041 -> "4,1%"; casas decimais pelo tamanho. */
export function pctBr(v: number | null | undefined, casas = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "sem dado";
  const f = Math.round(v * 10 ** casas) / 10 ** casas;
  return `${String(f).replace(".", ",")}%`;
}
const inteiroBr = (v: number | null | undefined) => (v == null ? "sem dado" : Math.round(v).toLocaleString("pt-BR"));
const dataCurta = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

// ------------------------------------------------------------------ números reais dos posts

/** Regras do julgamento por números (em código, sem IA). */
export const REGRAS_DOS_NUMEROS = {
  /** Post precisa de 3 dias no ar para os salvamentos e compartilhamentos assentarem. */
  horas_minimas: 72,
  /** Alcance mínimo para a taxa valer. */
  alcance_minimo: 30,
  /** Posts medidos no perfil para existir "topo" e "fundo". */
  posts_para_julgar: 5,
  /** Topo: os 20% melhores; fundo: os 20% piores. */
  fatia: 0.2,
  /** Janela dos posts que entram na comparação (dias). */
  janela_dias: 200,
} as const;

export type PostComNumeros = {
  media_id: string;
  media_type?: string | null;
  caption?: string | null;
  permalink?: string | null;
  posted_at?: string | null;
  reach?: number | null;
  saved?: number | null;
  shares?: number | null;
  comments_count?: number | null;
  like_count?: number | null;
};

export type PosicaoNoPerfil = "topo" | "meio" | "fundo";

export type PostMedido = {
  media_id: string;
  permalink: string | null;
  posted_at: string | null;
  media_type: string | null;
  caption: string | null;
  alcance: number;
  salvos: number;
  compartilhamentos: number;
  comentarios: number;
  curtidas: number;
  /** (salvamentos + compartilhamentos) / alcance, em %. */
  taxa: number;
  /** 0 = o pior do perfil, 1 = o melhor. */
  percentil: number;
  posicao: PosicaoNoPerfil;
};

/**
 * Mede os posts do perfil: só os que já têm alcance, salvamentos ou
 * compartilhamentos lidos e pelo menos 3 dias no ar. Com menos de 5 medidos,
 * não há topo nem fundo (tudo "meio"): não se chama oscilação de padrão.
 */
export function medirPosts(posts: PostComNumeros[], agora: Date = new Date()): PostMedido[] {
  const R = REGRAS_DOS_NUMEROS;
  const medidos = (posts || [])
    .filter((p) => p && p.media_id)
    .filter((p) => (numero(p.reach) ?? 0) >= R.alcance_minimo && (p.saved != null || p.shares != null))
    .filter((p) => !p.posted_at || agora.getTime() - new Date(p.posted_at).getTime() >= R.horas_minimas * 3_600_000)
    .map((p) => {
      const alcance = numero(p.reach) ?? 0;
      const salvos = numero(p.saved) ?? 0;
      const compartilhamentos = numero(p.shares) ?? 0;
      return {
        media_id: String(p.media_id),
        permalink: p.permalink ? String(p.permalink) : null,
        posted_at: p.posted_at ? String(p.posted_at) : null,
        media_type: p.media_type ? String(p.media_type) : null,
        caption: p.caption ? String(p.caption) : null,
        alcance,
        salvos,
        compartilhamentos,
        comentarios: numero(p.comments_count) ?? 0,
        curtidas: numero(p.like_count) ?? 0,
        taxa: alcance > 0 ? ((salvos + compartilhamentos) / alcance) * 100 : 0,
        percentil: 0.5,
        posicao: "meio" as PosicaoNoPerfil,
      };
    });
  if (medidos.length < R.posts_para_julgar) return medidos;
  const ordem = medidos.slice().sort((a, b) => a.taxa - b.taxa);
  const n = ordem.length;
  const corte = Math.max(1, Math.floor(n * R.fatia));
  ordem.forEach((p, i) => {
    p.percentil = n > 1 ? i / (n - 1) : 0.5;
    p.posicao = i >= n - corte ? "topo" : i < corte ? "fundo" : "meio";
  });
  return medidos;
}

// ------------------------------------------------------------------ memória da entrega

export const VERSAO_DA_MEMORIA_DA_ENTREGA = 1;
/** Entregas guardadas por cliente (as mais novas ficam). */
export const MAX_ENTREGAS_NA_MEMORIA = 60;

export type DescricaoVisual = { capa: string; miolo: string | null; cor: string | null; tipografia: string | null };

export type DesempenhoDaEntrega = {
  media_id: string;
  permalink: string | null;
  publicado_em: string | null;
  alcance: number;
  salvos: number;
  compartilhamentos: number;
  comentarios: number;
  taxa: number;
  posicao: PosicaoNoPerfil;
  julgado_em: string;
};

export type ArquivoDaLamina = { bucket: string; caminho: string } | null;

export type MemoriaDaEntrega = {
  versao: number;
  /** trabalho_id:r<rodada> (a rodada nova, depois de uma reprovação, é outra entrega). */
  id: string;
  trabalho_id: string;
  client_id: string;
  task_id: string | null;
  post_id: string | null;
  /** Arquivo principal da entrega (Arquivos), para achar a publicação. */
  arquivo_id: string | null;
  tipo: "social" | "ads";
  titulo: string;
  entregue_em: string;
  rodada: number;
  formato: string;
  laminas: number;
  modo: string;
  fidelidade: string | null;
  referencias: number;
  template: string | null;
  estilo_ligado: boolean;
  componentes: string[];
  jogada: string | null;
  cor_de_destaque: string | null;
  tipografia: string | null;
  ajustes: { quantos: number; pedidos: string[] };
  reprovacoes: number;
  aprovado_sem_ajuste: boolean;
  /** Aprovado pelo cliente (lido depois, no robô): null = ainda não se sabe. */
  aprovado: boolean | null;
  descricao_visual: DescricaoVisual | null;
  capa: ArquivoDaLamina;
  miolo: ArquivoDaLamina;
  padrao: string;
  chave_do_padrao: string;
  desempenho: DesempenhoDaEntrega | null;
  /** A rodada seguinte do mesmo trabalho existe (esta foi reprovada ou reaberta). */
  substituida: boolean;
};

export type IndiceDasEntregas = {
  versao: number;
  entregas: MemoriaDaEntrega[];
  /** Última leitura dos números reais (robô semanal ou entrega nova). */
  numeros_em: string | null;
};

export const indiceVazio = (): IndiceDasEntregas => ({ versao: VERSAO_DA_MEMORIA_DA_ENTREGA, entregas: [], numeros_em: null });

/** Caminho do índice no bucket mesa. */
export const caminhoDoIndiceDasEntregas = (clientId: string) => `${clientId}/aprendizado/entregas.json`;
export const BUCKET_DO_APRENDIZADO = "mesa";

/** Trabalho do Estúdio como a memória lê (tudo opcional: versões antigas não têm os campos novos). */
export type TrabalhoParaMemoria = {
  id: string;
  client_id: string;
  task_id?: string | null;
  post_id?: string | null;
  tipo?: string | null;
  direcao?: unknown;
  cards?: unknown;
  file_ids?: string[] | null;
  entrega_rodada?: number | null;
  entrega_status?: string | null;
};

type Versao = Record<string, unknown> & { ordem: number; versao: number };

function versoesDe(t: TrabalhoParaMemoria): Versao[] {
  const lista = Array.isArray(t.cards) ? t.cards : [];
  return lista
    .map(obj)
    .filter((v) => Number.isFinite(Number(v.ordem)) && Number.isFinite(Number(v.versao)))
    .map((v) => ({ ...v, ordem: Number(v.ordem), versao: Number(v.versao) }));
}

/** A versão atual de cada lâmina (a de maior número), em ordem. */
export function versoesAtuais(t: TrabalhoParaMemoria): Versao[] {
  const porOrdem = new Map<number, Versao>();
  for (const v of versoesDe(t)) {
    const ja = porOrdem.get(v.ordem);
    if (!ja || v.versao > ja.versao) porOrdem.set(v.ordem, v);
  }
  return Array.from(porOrdem.values()).sort((a, b) => a.ordem - b.ordem);
}

/** A lâmina do miolo que vai na leitura: a do meio (nem a capa nem o fechamento, quando dá). */
export function ordemDoMiolo(total: number): number | null {
  if (total <= 1) return null;
  if (total === 2) return 2;
  return Math.max(2, Math.min(total - 1, Math.ceil(total / 2)));
}

/** Ajuste pedido pela equipe (a autocorreção sozinha não conta). */
function ehAjusteDaEquipe(v: Versao): boolean {
  if (v.origem !== "ajuste") return false;
  const a = obj(v.autocorrecao);
  if (Object.keys(a).length && a.pedido_da_equipe !== true) return false;
  return true;
}

const ROTULO_DA_FIDELIDADE: Record<string, string> = {
  identica: "idêntica à referência",
  proxima: "próxima da referência",
  inspirada: "inspirada na referência",
  criativa: "criativa a partir da referência",
};

const ROTULO_DO_MODO: Record<string, string> = {
  replicar_referencia: "replicando referência",
  foto_composta: "com foto real e elementos",
  foto_real: "com foto real do cliente",
  recorte: "com recorte sem fundo",
  panorama: "contínuo (panorama)",
  normal: "composição do diretor",
};

const nomeDoComponente = (c: string) => c.replace(/_/g, " ");

function faixaDeLaminas(n: number): string {
  if (n <= 1) return "1 lâmina";
  if (n <= 3) return "2 a 3 lâminas";
  if (n <= 6) return "4 a 6 lâminas";
  return "7 ou mais lâminas";
}

/** Modo que manda na entrega: o da capa; sem ele, o mais frequente. */
function modoDaEntrega(atuais: Versao[]): string {
  const capa = atuais.find((v) => v.ordem === 1);
  const m = capa && typeof capa.modo === "string" ? capa.modo : "";
  if (m) return m;
  const cont = new Map<string, number>();
  for (const v of atuais) if (typeof v.modo === "string" && v.modo) cont.set(v.modo, (cont.get(v.modo) || 0) + 1);
  let melhor = "normal";
  let n = 0;
  cont.forEach((q, k) => {
    if (q > n) {
      n = q;
      melhor = k;
    }
  });
  return melhor;
}

/**
 * O padrão da entrega em texto CANÔNICO (só traços discretos, na mesma ordem):
 * a mesma receita entregue de novo produz o mesmo texto e vira reforço.
 * A descrição visual e os ajustes ficam fora de propósito (vão no motivo).
 */
export function padraoDaEntrega(m: Pick<MemoriaDaEntrega, "tipo" | "formato" | "laminas" | "modo" | "fidelidade" | "template" | "estilo_ligado" | "componentes" | "tipografia" | "jogada">): string {
  const peca = m.tipo === "ads" ? "criativo de anúncio" : m.laminas > 1 ? "carrossel" : "post único";
  const partes: string[] = [`${peca} ${m.formato}${m.laminas > 1 ? ` de ${faixaDeLaminas(m.laminas)}` : ""}`];
  const modo = ROTULO_DO_MODO[m.modo] || (m.modo ? m.modo.replace(/_/g, " ") : "");
  if (m.modo === "replicar_referencia" && m.fidelidade) partes.push(`${modo} (${ROTULO_DA_FIDELIDADE[m.fidelidade] || m.fidelidade})`);
  else if (modo) partes.push(modo);
  if (m.template) partes.push(`template "${umaLinha(m.template, 40)}"`);
  if (m.estilo_ligado) partes.push("estilo do cliente ligado");
  if (m.componentes.length) partes.push(`miolo em ${m.componentes.slice(0, 3).map(nomeDoComponente).join(", ")}`);
  if (m.tipografia) partes.push(m.tipografia);
  if (m.jogada) partes.push(m.jogada);
  return umaLinha(`Padrão entregue: ${partes.join(", ")}.`, 400);
}

export const chaveDoPadrao = (padrao: string) => normalizado(padrao).slice(0, 200);

/**
 * A memória de uma entrega, lida do trabalho (sem IA). `descricao` (a
 * leitura por visão da capa e de uma lâmina do miolo) entra depois, uma vez.
 */
export function memoriaDaEntrega(
  t: TrabalhoParaMemoria,
  opcoes: { agora?: Date; titulo?: string | null; descricao?: DescricaoVisual | null } = {},
): MemoriaDaEntrega | null {
  const atuais = versoesAtuais(t);
  if (!atuais.length || !t.id || !t.client_id) return null;
  const agora = opcoes.agora ?? new Date();
  const direcao = obj(t.direcao);
  const cardsDaDirecao = Array.isArray(direcao.cards) ? (direcao.cards as unknown[]).map(obj) : [];
  const rodada = Math.max(1, Math.round(numero(t.entrega_rodada) ?? 1));
  const tipo: "social" | "ads" = t.tipo === "ads" ? "ads" : "social";
  const capa = atuais.find((v) => v.ordem === 1) || atuais[0];
  const todas = versoesDe(t);
  const ajustes = todas.filter(ehAjusteDaEquipe);
  const pedidos = unicos(ajustes.map((v) => umaLinha(v.instrucao, 120)).filter(Boolean)).slice(0, 4);
  const modo = modoDaEntrega(atuais);
  const replicou = atuais.some((v) => v.modo === "replicar_referencia");
  const fidelidadeBruta = typeof direcao.fidelidade_referencia === "string" ? direcao.fidelidade_referencia : typeof capa.fidelidade_referencia === "string" ? capa.fidelidade_referencia : null;
  const tpl = obj(direcao.template_de_design);
  const template = typeof tpl.id === "string" && tpl.id ? umaLinha(tpl.nome || tpl.titulo || "escolhido", 60) : null;
  const componentes = unicos(
    atuais
      .map((v) => obj(v.miolo_desenhado).componente)
      .filter((c): c is string => typeof c === "string" && !!c),
  );
  const tip = obj(capa.tipografia);
  const tipografia = typeof tip.titulo === "string" && tip.titulo
    ? `título em ${umaLinha(tip.titulo, 40)}${tip.caixa_titulo === "alta" ? " caixa alta" : ""}${tip.peso_titulo && tip.peso_titulo !== "amostra" ? `, peso ${umaLinha(tip.peso_titulo, 20)}` : ""}`
    : null;
  const termo = atuais.map((v) => v.termo_decorativo).find((x) => typeof x === "string" && x);
  const jogada = termo ? `palavra decorativa de fundo` : direcao.carrossel_infinito === true && tipo === "social" && atuais.length > 1 ? "carrossel contínuo" : null;
  const destaque = obj(capa.variedade).destaque;
  const formatoDoCard = cardsDaDirecao.length && typeof cardsDaDirecao[0].formato === "string" ? String(cardsDaDirecao[0].formato) : "";
  const formato = tipo === "ads"
    ? ({ feed_4x5: "4:5", quadrado_1x1: "1:1", stories_9x16: "9:16" } as Record<string, string>)[formatoDoCard] || "4:5"
    : typeof direcao.formato === "string" && direcao.formato ? direcao.formato : typeof capa.formato_post === "string" && capa.formato_post ? capa.formato_post : "4:5";
  const reprovacoes = rodada - 1;
  const ordemMiolo = ordemDoMiolo(atuais.length);
  const miolo = ordemMiolo ? atuais.find((v) => v.ordem === ordemMiolo) || null : null;
  const caminho = (v: Versao | null): ArquivoDaLamina => (v && typeof v.storage_path === "string" && v.storage_path ? { bucket: "mesa", caminho: v.storage_path } : null);
  const base = {
    tipo,
    formato,
    laminas: atuais.length,
    modo,
    fidelidade: replicou && fidelidadeBruta ? fidelidadeBruta : null,
    template,
    estilo_ligado: direcao.usar_estilo_do_cliente === true,
    componentes,
    tipografia,
    jogada,
  };
  const padrao = padraoDaEntrega(base);
  return {
    versao: VERSAO_DA_MEMORIA_DA_ENTREGA,
    id: `${t.id}:r${rodada}`,
    trabalho_id: t.id,
    client_id: t.client_id,
    task_id: t.task_id || null,
    post_id: t.post_id || null,
    arquivo_id: Array.isArray(t.file_ids) && t.file_ids.length ? String(t.file_ids[0]) : null,
    titulo: umaLinha(opcoes.titulo || umaLinha(direcao.conceito, 120) || "Arte do Estúdio", 120),
    entregue_em: agora.toISOString(),
    rodada,
    ...base,
    referencias: Array.isArray(capa.referencias) ? capa.referencias.length : 0,
    cor_de_destaque: typeof destaque === "string" && destaque ? umaLinha(destaque, 60) : null,
    ajustes: { quantos: ajustes.length, pedidos },
    reprovacoes,
    aprovado_sem_ajuste: ajustes.length === 0 && reprovacoes === 0,
    aprovado: null,
    descricao_visual: opcoes.descricao ?? null,
    capa: caminho(capa),
    miolo: caminho(miolo),
    padrao,
    chave_do_padrao: chaveDoPadrao(padrao),
    desempenho: null,
    substituida: false,
  };
}

/** Normaliza o que veio do JSON guardado (versões antigas, campos faltando). */
export function normalizarIndice(bruto: unknown): IndiceDasEntregas {
  const o = obj(bruto);
  const entregas = (Array.isArray(o.entregas) ? o.entregas : [])
    .map(obj)
    .filter((e) => typeof e.id === "string" && typeof e.trabalho_id === "string" && typeof e.padrao === "string")
    .map((e) => e as unknown as MemoriaDaEntrega)
    .map((e) => ({
      ...e,
      componentes: Array.isArray(e.componentes) ? e.componentes : [],
      ajustes: e.ajustes && typeof e.ajustes === "object" ? { quantos: Number(e.ajustes.quantos) || 0, pedidos: Array.isArray(e.ajustes.pedidos) ? e.ajustes.pedidos : [] } : { quantos: 0, pedidos: [] },
      chave_do_padrao: e.chave_do_padrao || chaveDoPadrao(e.padrao),
      desempenho: e.desempenho && typeof e.desempenho === "object" ? e.desempenho : null,
      substituida: e.substituida === true,
      aprovado: e.aprovado === true ? true : e.aprovado === false ? false : null,
    }));
  return { versao: VERSAO_DA_MEMORIA_DA_ENTREGA, entregas, numeros_em: typeof o.numeros_em === "string" ? o.numeros_em : null };
}

/**
 * Acrescenta a entrega (a mais nova primeiro). A mesma entrega (mesmo id)
 * não entra duas vezes. A rodada nova de um trabalho marca as anteriores como
 * substituídas (foram reprovadas ou reabertas).
 */
export function comEntrega(indice: IndiceDasEntregas, m: MemoriaDaEntrega): IndiceDasEntregas {
  if (indice.entregas.some((e) => e.id === m.id)) return indice;
  const antes = indice.entregas.map((e) => (e.trabalho_id === m.trabalho_id && e.rodada < m.rodada ? { ...e, substituida: true } : e));
  return { ...indice, entregas: [m, ...antes].slice(0, MAX_ENTREGAS_NA_MEMORIA) };
}

export const jaRegistrada = (indice: IndiceDasEntregas, id: string) => indice.entregas.some((e) => e.id === id);

/** Motivo curto que vai com o padrão no cérebro: ajustes até entregar. */
export function motivoDaEntrega(m: Pick<MemoriaDaEntrega, "ajustes" | "reprovacoes">): string {
  if (!m.ajustes.quantos && !m.reprovacoes) return "Entregue sem ajuste.";
  const partes: string[] = [];
  if (m.ajustes.quantos) partes.push(`${m.ajustes.quantos} ajuste(s) até entregar${m.ajustes.pedidos.length ? `: ${m.ajustes.pedidos.join("; ")}` : ""}`);
  if (m.reprovacoes) partes.push(`${m.reprovacoes} reprovação(ões) antes`);
  return umaLinha(`${partes.join(". ")}.`, 400);
}

/** A descrição visual em uma linha (evidência no cérebro e linha da variedade). */
export function descricaoEmTexto(d: DescricaoVisual | null | undefined): string {
  if (!d) return "";
  return umaLinha([d.capa ? `Capa: ${d.capa}` : "", d.miolo ? `Miolo: ${d.miolo}` : "", d.cor ? `Cor: ${d.cor}` : "", d.tipografia ? `Letra: ${d.tipografia}` : ""].filter(Boolean).join(" "), 400);
}

/** Leitura por visão normalizada (o JSON do modelo). */
export function normalizarDescricao(bruto: unknown): DescricaoVisual | null {
  const o = obj(bruto);
  const capa = umaLinha(o.capa, 220);
  if (!capa) return null;
  return { capa, miolo: umaLinha(o.miolo, 220) || null, cor: umaLinha(o.cor, 160) || null, tipografia: umaLinha(o.tipografia, 160) || null };
}

// ------------------------------------------------------------------ ligar entregas aos posts

export type PublicacaoDaEntrega = {
  post_id?: string | null;
  file_id?: string | null;
  external_post_id?: string | null;
  permalink?: string | null;
  published_at?: string | null;
  status?: string | null;
};

/**
 * Qual post medido é de qual entrega: pela publicação do post da entrega
 * (post_id) ou do arquivo principal (file_id), e daí pelo id da mídia ou pelo
 * link. Sem par seguro, fica sem número (nunca chuta).
 */
export function ligarEntregasAosPosts(
  entregas: MemoriaDaEntrega[],
  publicacoes: PublicacaoDaEntrega[],
  medidos: PostMedido[],
): Map<string, PostMedido> {
  const porMidia = new Map(medidos.map((p) => [p.media_id, p]));
  const porLink = new Map(medidos.filter((p) => p.permalink).map((p) => [String(p.permalink).replace(/\/+$/, ""), p]));
  const saida = new Map<string, PostMedido>();
  for (const e of entregas) {
    const pubs = publicacoes.filter((p) => (p.status == null || p.status === "published") && ((e.post_id && p.post_id === e.post_id) || (e.arquivo_id && p.file_id === e.arquivo_id)));
    for (const p of pubs) {
      const m = (p.external_post_id && porMidia.get(String(p.external_post_id))) || (p.permalink && porLink.get(String(p.permalink).replace(/\/+$/, ""))) || null;
      if (m) {
        saida.set(e.id, m);
        break;
      }
    }
  }
  return saida;
}

export type JulgamentoDaEntrega = { id: string; posicao: PosicaoNoPerfil; desempenho: DesempenhoDaEntrega };

/**
 * Julga as entregas ainda sem número que agora têm post medido. Cada entrega
 * é julgada UMA vez (quem já tem desempenho fica como está): o reforço no
 * cérebro não se repete a cada semana.
 */
export function julgarEntregas(indice: IndiceDasEntregas, ligados: Map<string, PostMedido>, agora: Date = new Date()): { indice: IndiceDasEntregas; novos: JulgamentoDaEntrega[] } {
  const novos: JulgamentoDaEntrega[] = [];
  const entregas = indice.entregas.map((e) => {
    if (e.desempenho) return e;
    const p = ligados.get(e.id);
    if (!p) return e;
    const desempenho: DesempenhoDaEntrega = {
      media_id: p.media_id,
      permalink: p.permalink,
      publicado_em: p.posted_at,
      alcance: p.alcance,
      salvos: p.salvos,
      compartilhamentos: p.compartilhamentos,
      comentarios: p.comentarios,
      taxa: Math.round(p.taxa * 1000) / 1000,
      posicao: p.posicao,
      julgado_em: agora.toISOString(),
    };
    novos.push({ id: e.id, posicao: p.posicao, desempenho });
    return { ...e, desempenho };
  });
  return { indice: { ...indice, entregas, numeros_em: agora.toISOString() }, novos };
}

/** Texto do cérebro para a entrega julgada (topo: funcionou; fundo: sinal fraco). Meio: nada. */
export function aprendizadoDoDesempenho(m: MemoriaDaEntrega): { categoria: "performou" | "aprendizado"; texto: string; motivo: string; evidencia: string | null } | null {
  const d = m.desempenho;
  if (!d || d.posicao === "meio") return null;
  const corpo = m.padrao.replace(/^Padrão entregue:\s*/, "").replace(/\.$/, "");
  const quando = dataCurta(d.publicado_em);
  const numeros = `${pctBr(d.taxa, 2)} de salvamentos e compartilhamentos por alcance (${inteiroBr(d.alcance)} de alcance${quando ? `, post de ${quando}` : ""})`;
  if (d.posicao === "topo") {
    return {
      categoria: "performou",
      texto: umaLinha(`Padrão que funcionou (número real): ${corpo}.`, 400),
      motivo: umaLinha(`${numeros}, entre os 20% melhores do perfil.`, 400),
      evidencia: d.permalink,
    };
  }
  return {
    categoria: "aprendizado",
    texto: umaLinha(`Rendeu abaixo (sinal fraco, não é regra): ${corpo}.`, 400),
    motivo: umaLinha(`${numeros}, entre os 20% de menor resultado do perfil.`, 400),
    evidencia: d.permalink,
  };
}

/** Aprovação do cliente lida do trabalho (robô): aprovado sem ajuste só se a rodada não mudou. */
export function comAprovacoes(indice: IndiceDasEntregas, trabalhos: Array<{ id: string; entrega_status?: string | null; entrega_rodada?: number | null }>): IndiceDasEntregas {
  const porId = new Map(trabalhos.map((t) => [t.id, t]));
  const entregas = indice.entregas.map((e) => {
    const t = porId.get(e.trabalho_id);
    if (!t) return e;
    const rodadaAtual = Math.max(1, Math.round(numero(t.entrega_rodada) ?? 1));
    if (rodadaAtual !== e.rodada) return e.substituida ? e : { ...e, substituida: rodadaAtual > e.rodada };
    const aprovado = t.entrega_status === "aprovado" || t.entrega_status === "agendado" ? true : t.entrega_status === "reprovado" ? false : e.aprovado;
    return aprovado === e.aprovado ? e : { ...e, aprovado };
  });
  return { ...indice, entregas };
}

// ------------------------------------------------------------------ o que funcionou (na geração)

/** Teto do bloco das entregas (caracteres). */
export const TETO_DO_BLOCO_DAS_ENTREGAS = 700;
export const TETO_DA_LINHA_DA_VARIEDADE = 260;

export const TITULO_DO_QUE_FUNCIONOU = "O QUE FUNCIONOU NAS ENTREGAS DESTE CLIENTE (padrões aprovados e números reais; o texto exato, a paleta, a logo e o pedido desta lâmina valem sobre eles):";

export type GrupoDoPadrao = {
  chave: string;
  padrao: string;
  entregas: number;
  topo: DesempenhoDaEntrega | null;
  fundo: DesempenhoDaEntrega | null;
  semAjuste: boolean;
  ultima: string;
};

/** As entregas que contam (fora as substituídas e as reprovadas pelo cliente). */
const entregasQueContam = (l: MemoriaDaEntrega[]) => l.filter((e) => !e.substituida && e.aprovado !== false);

/**
 * Padrões agrupados e na ordem de força: desempenho real (topo) > aprovado sem
 * ajuste > recência. O grupo que só rendeu abaixo não entra na lista forte.
 */
export function rankingDosPadroes(entregas: MemoriaDaEntrega[], tipo?: "social" | "ads"): GrupoDoPadrao[] {
  const grupos = new Map<string, GrupoDoPadrao>();
  for (const e of entregasQueContam(entregas)) {
    if (tipo && e.tipo !== tipo) continue;
    const g = grupos.get(e.chave_do_padrao) || { chave: e.chave_do_padrao, padrao: e.padrao, entregas: 0, topo: null, fundo: null, semAjuste: false, ultima: "" };
    g.entregas += 1;
    if (e.desempenho && e.desempenho.posicao === "topo" && (!g.topo || e.desempenho.taxa > g.topo.taxa)) g.topo = e.desempenho;
    if (e.desempenho && e.desempenho.posicao === "fundo" && (!g.fundo || e.desempenho.taxa < g.fundo.taxa)) g.fundo = e.desempenho;
    if (e.aprovado_sem_ajuste) g.semAjuste = true;
    if (e.entregue_em > g.ultima) g.ultima = e.entregue_em;
    grupos.set(e.chave_do_padrao, g);
  }
  return Array.from(grupos.values()).sort((a, b) =>
    (b.topo ? 1 : 0) - (a.topo ? 1 : 0) ||
    (b.topo && a.topo ? b.topo.taxa - a.topo.taxa : 0) ||
    (b.semAjuste ? 1 : 0) - (a.semAjuste ? 1 : 0) ||
    b.entregas - a.entregas ||
    b.ultima.localeCompare(a.ultima)
  );
}

function linhaDoGrupo(g: GrupoDoPadrao): string {
  const corpo = umaLinha(g.padrao.replace(/^Padrão entregue:\s*/, "").replace(/\.$/, ""), 150);
  const provas: string[] = [];
  if (g.topo) provas.push(`topo do perfil: ${pctBr(g.topo.taxa, 1)} salvos e compart.`);
  else if (g.semAjuste) provas.push("aprovado sem ajuste");
  if (g.entregas > 1) provas.push(`${g.entregas} entregas`);
  else if (!g.topo && !g.semAjuste && g.ultima) provas.push(`entregue em ${dataCurta(g.ultima)}`);
  return `- ${corpo}${provas.length ? ` (${provas.join("; ")})` : ""}`;
}

/** O que evitar: o padrão que rendeu abaixo; sem ele, os ajustes que mais se repetiram. */
export function linhaDoQueEvitar(entregas: MemoriaDaEntrega[], tipo?: "social" | "ads"): string {
  const lista = entregas.filter((e) => !tipo || e.tipo === tipo);
  const fundos = rankingDosPadroes(lista, tipo).filter((g) => g.fundo && !g.topo);
  if (fundos.length) {
    const g = fundos.sort((a, b) => (a.fundo!.taxa - b.fundo!.taxa))[0];
    return `- Evitar repetir: ${umaLinha(g.padrao.replace(/^Padrão entregue:\s*/, "").replace(/\.$/, ""), 120)} (rendeu abaixo: ${pctBr(g.fundo!.taxa, 1)})`;
  }
  const cont = new Map<string, { texto: string; n: number }>();
  for (const e of lista) {
    for (const p of e.ajustes.pedidos) {
      const k = normalizado(p).slice(0, 60);
      if (!k) continue;
      const x = cont.get(k) || { texto: p, n: 0 };
      x.n += 1;
      cont.set(k, x);
    }
  }
  const mais = Array.from(cont.values()).sort((a, b) => b.n - a.n).slice(0, 2);
  if (!mais.length) return "";
  return `- Evitar de saída o que mais pediu ajuste: ${mais.map((m) => umaLinha(m.texto, 70)).join("; ")}`;
}

/**
 * O bloco "O QUE FUNCIONOU NAS ENTREGAS DESTE CLIENTE": até 3 padrões e 1
 * linha do que evitar, nunca acima do teto (corta sempre em linha inteira).
 * Sem entrega que conte: "" (o prompt fica como antes).
 */
export function blocoDoQueFuncionou(entregas: MemoriaDaEntrega[], opcoes: { teto?: number; tipo?: "social" | "ads" } = {}): string {
  const teto = Math.max(200, opcoes.teto ?? TETO_DO_BLOCO_DAS_ENTREGAS);
  const grupos = rankingDosPadroes(entregas, opcoes.tipo).filter((g) => !(g.fundo && !g.topo)).slice(0, 3);
  if (!grupos.length) return "";
  const linhas = grupos.map(linhaDoGrupo);
  const evitar = linhaDoQueEvitar(entregas, opcoes.tipo);
  const montar = (l: string[], e: string) => [TITULO_DO_QUE_FUNCIONOU, ...l, ...(e ? [e] : [])].join("\n");
  let usadas = linhas.slice();
  let ev = evitar;
  while (montar(usadas, ev).length > teto && usadas.length > 1) usadas = usadas.slice(0, -1);
  if (montar(usadas, ev).length > teto) ev = "";
  const saida = montar(usadas, ev);
  return saida.length > teto ? saida.slice(0, teto) : saida;
}

/**
 * Capa nova: não repetir a composição EXATA das últimas capas entregues (as
 * duas mais novas com descrição). Vazio sem descrição guardada.
 */
export function linhaDaVariedadeDasEntregas(entregas: MemoriaDaEntrega[], tipo?: "social" | "ads"): string {
  const com = entregasQueContam(entregas)
    .filter((e) => (!tipo || e.tipo === tipo) && e.descricao_visual && e.descricao_visual.capa)
    .sort((a, b) => b.entregue_em.localeCompare(a.entregue_em))
    .slice(0, 2);
  if (!com.length) return "";
  const capas = com.map((e) => umaLinha(e.descricao_visual!.capa, 80)).join("; ");
  const s = `CAPA NOVA: não repita a composição exata das últimas capas entregues (${capas}); mude a posição do título, o enquadramento ou o elemento principal, mantendo a marca.`;
  return s.length > TETO_DA_LINHA_DA_VARIEDADE ? `${s.slice(0, TETO_DA_LINHA_DA_VARIEDADE - 1)}.` : s;
}

// ------------------------------------------------------------------ sugestões para o estilo

export type SugestaoDaEntrega = {
  entrega_id: string;
  trabalho_id: string;
  titulo: string;
  bucket: string;
  caminho: string;
  motivo: string;
  entregue_em: string;
};

/**
 * As melhores artes entregues como candidatas a referência do estilo (só
 * sugestão: entram com a confirmação da equipe). Topo primeiro, depois as
 * aprovadas sem ajuste; nunca a que já está no estilo.
 */
export function sugestoesParaOEstilo(entregas: MemoriaDaEntrega[], jaNoEstilo: string[] = [], max = 4): SugestaoDaEntrega[] {
  const fora = new Set(jaNoEstilo);
  return entregasQueContam(entregas)
    .filter((e) => e.capa && !fora.has(e.trabalho_id) && ((e.desempenho && e.desempenho.posicao === "topo") || e.aprovado_sem_ajuste))
    .sort((a, b) =>
      (b.desempenho && b.desempenho.posicao === "topo" ? 1 : 0) - (a.desempenho && a.desempenho.posicao === "topo" ? 1 : 0) ||
      (b.desempenho ? b.desempenho.taxa : 0) - (a.desempenho ? a.desempenho.taxa : 0) ||
      b.entregue_em.localeCompare(a.entregue_em)
    )
    .filter((e, i, l) => l.findIndex((x) => x.trabalho_id === e.trabalho_id) === i)
    .slice(0, max)
    .map((e) => ({
      entrega_id: e.id,
      trabalho_id: e.trabalho_id,
      titulo: e.titulo,
      bucket: e.capa!.bucket,
      caminho: e.capa!.caminho,
      motivo: e.desempenho && e.desempenho.posicao === "topo" ? `Rendeu no topo: ${pctBr(e.desempenho.taxa, 1)} salvos e compart.` : "Aprovada sem ajuste",
      entregue_em: e.entregue_em,
    }));
}
