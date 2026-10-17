/**
 * Hype no conteúdo (17/10/2026, dono: "o conteúdo tem que puxar tematizado já
 * com o hype, e além do hype ter um para puxar assuntos em alta do nicho, tudo
 * o que estão falando no momento e que é viral").
 *
 * A busca da semana (mesa_hypes, uma linha por cliente e semana) guarda duas
 * listas no mesmo `itens`: `tipo: "hype"` (datas, notícias, eventos, memes do
 * momento) e `tipo: "nicho"` (o que viraliza no nicho do cliente agora: temas,
 * formatos e ganchos, lidos na web, nas hashtags do Instagram e nos posts fora
 * da curva dos perfis de referência). Linha antiga sem `tipo` conta como hype.
 *
 * Este módulo decide o que ainda vale para o período pedido (hype vencido não
 * entra no conteúdo) e monta o bloco que vai em TODA geração do agente do Mês
 * (temas, detalhar, pedido livre, conteúdo rápido, campanha e planejamento).
 *
 * Sem import de Deno nem de npm: o Vitest lê este arquivo. Sem travessão.
 */

export type TipoDoHype = "hype" | "nicho";

export type ItemDoHype = {
  tipo: TipoDoHype;
  titulo: string;
  o_que_e: string;
  por_que_agora: string;
  janela: string;
  como_usar: string;
  formato: string;
  cuidado: string;
  sinal: string;
  nota: number | null;
};

export type HypeQueVale = { semana: string; resumo: string | null; hypes: ItemDoHype[]; nicho: ItemDoHype[] };

const DIA_MS = 86_400_000;
/** Abaixo disso o Jev disse que serve pouco ou não serve para este cliente. */
export const NOTA_MINIMA_DO_HYPE = 5;
/** Até quantos itens de cada lista vão para o pedido. */
export const HYPES_NO_PEDIDO = 5;

const dia = (iso: string) => Date.parse(`${String(iso).slice(0, 10)}T12:00:00Z`);
const diasEntre = (de: string, ate: string) => Math.round((dia(ate) - dia(de)) / DIA_MS);
const texto = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Até quando cada item vale, contado da segunda-feira da busca:
 * "hoje" e "esta_semana" valem a semana da busca; "proximas_semanas", três
 * semanas; o que está em alta no nicho, duas semanas (viral envelhece rápido).
 */
export function validadeEmDias(item: { tipo?: unknown; janela?: unknown }): number {
  if (item.tipo === "nicho") return 14;
  if (item.janela === "proximas_semanas") return 21;
  return 7;
}

export function itemDoHype(bruto: unknown): ItemDoHype | null {
  const o = (bruto ?? {}) as Record<string, unknown>;
  const titulo = texto(o.titulo, 160);
  if (!titulo) return null;
  const nota = typeof o.nota === "number" && Number.isFinite(o.nota) ? o.nota : null;
  return {
    tipo: o.tipo === "nicho" ? "nicho" : "hype",
    titulo,
    o_que_e: texto(o.o_que_e, 300),
    por_que_agora: texto(o.por_que_agora, 300),
    janela: texto(o.janela, 40),
    como_usar: texto(o.como_usar, 400),
    formato: texto(o.formato, 20),
    cuidado: texto(o.cuidado, 200),
    sinal: texto(o.sinal, 200),
    nota,
  };
}

/**
 * O que da busca ainda vale para o período [inicio, fim]: o item precisa estar
 * dentro da validade em algum dia do período e ter nota boa (sem nota, vale).
 * Busca de outra semana muito antiga ou período longe demais: null.
 */
export function hypesQueValem(
  linha: { semana?: string | null; resumo?: string | null; itens?: unknown } | null | undefined,
  periodo: { inicio: string; fim: string },
): HypeQueVale | null {
  if (!linha?.semana) return null;
  const semana = String(linha.semana).slice(0, 10);
  const itens = (Array.isArray(linha.itens) ? linha.itens : []).map(itemDoHype).filter((x): x is ItemDoHype => !!x);
  const valem = itens.filter((h) => {
    if (h.nota !== null && h.nota < NOTA_MINIMA_DO_HYPE) return false;
    const ultimoDia = validadeEmDias(h);
    // Algum dia do período cai entre a segunda da busca e o último dia da validade.
    return diasEntre(semana, periodo.fim) >= 0 && diasEntre(semana, periodo.inicio) < ultimoDia;
  });
  const porNota = (a: ItemDoHype, b: ItemDoHype) => (b.nota ?? 5) - (a.nota ?? 5);
  const hypes = valem.filter((h) => h.tipo === "hype").sort(porNota).slice(0, HYPES_NO_PEDIDO);
  const nicho = valem.filter((h) => h.tipo === "nicho").sort(porNota).slice(0, HYPES_NO_PEDIDO);
  if (!hypes.length && !nicho.length) return null;
  return { semana, resumo: texto(linha.resumo, 300) || null, hypes, nicho };
}

const curto = (h: ItemDoHype) => ({
  titulo: h.titulo,
  ...(h.o_que_e ? { o_que_e: h.o_que_e } : {}),
  ...(h.por_que_agora ? { por_que_agora: h.por_que_agora } : {}),
  ...(h.tipo === "hype" && h.janela ? { janela: h.janela } : {}),
  ...(h.sinal ? { onde_esta_viralizando: h.sinal } : {}),
  ...(h.como_usar ? { como_usar: h.como_usar } : {}),
  ...(h.cuidado ? { cuidado: h.cuidado } : {}),
  ...(h.nota !== null ? { nota_para_este_cliente: h.nota } : {}),
});

/** O bloco que vai no pedido (vazio quando não há nada que valha). */
export function blocoDoHype(h: HypeQueVale | null | undefined): string {
  if (!h || (!h.hypes.length && !h.nicho.length)) return "";
  const dados = {
    pesquisado_na_semana_de: h.semana,
    ...(h.resumo ? { clima_da_semana: h.resumo } : {}),
    ...(h.hypes.length ? { hypes_do_momento: h.hypes.map(curto) } : {}),
    ...(h.nicho.length ? { em_alta_no_nicho: h.nicho.map(curto) } : {}),
  };
  return `HYPE E ASSUNTOS EM ALTA AGORA (pesquisados na web e no Instagram nesta semana; nota do Jev de 0 a 10 para este cliente):
${JSON.stringify(dados)}
COMO USAR (tematizar, não só citar):
- Toda pauta do período que cair na janela de um item desta lista e tiver ligação natural com a oferta nasce dele: o gancho, o ângulo, os exemplos, o visual e a legenda vêm tematizados (data comemorativa ou evento: o clima, as cores, os objetos e a linguagem da data; assunto viral: a referência que o público já reconhece; formato em alta no nicho: a estrutura desse formato).
- Com itens de nota 7 ou mais, pelo menos 1 em cada 3 pautas do período pega carona em um deles. O resto segue a estratégia de sempre.
- Diga no por_que_agora (ou no motivo) qual item a pauta usa, com o que está acontecendo.
- Respeite o "cuidado" de cada item. Não force ligação que o público não faria, não use tragédia nem polêmica, e não repita o mesmo item em pautas seguidas.`;
}

// ------------------------------------------------------------- em alta no nicho

type PostLido = { legenda?: string | null; link?: string | null; data?: string | null; curtidas?: number | null; comentarios?: number | null; tipo?: string | null; destaque?: string | null };

/** O que foi lido do Instagram agora (hashtags do nicho, perfis de referência e posts do próprio cliente). */
export type SinaisDoNicho = {
  instagram: { hashtags: Array<{ tag: string; posts: PostLido[] }>; motivo: string | null };
  referencias: { perfis: Array<{ handle: string; papel: string; posts: PostLido[] }>; motivo: string | null };
  publicados: { posts: PostLido[]; motivo: string | null };
};

const post = (p: PostLido) => ({
  legenda: texto(p.legenda, 220),
  ...(p.link ? { link: p.link } : {}),
  ...(p.data ? { data: String(p.data).slice(0, 10) } : {}),
  ...(p.tipo ? { tipo: p.tipo } : {}),
  ...(p.curtidas != null ? { curtidas: p.curtidas } : {}),
  ...(p.comentarios != null ? { comentarios: p.comentarios } : {}),
  ...(p.destaque ? { destaque: p.destaque } : {}),
});

/** Quantos sinais reais do Instagram vieram (para a tela e o log). */
export function contarSinais(s: SinaisDoNicho | null | undefined): { hashtags: number; referencias: number; publicados: number } {
  if (!s) return { hashtags: 0, referencias: 0, publicados: 0 };
  return {
    hashtags: s.instagram.hashtags.reduce((t, h) => t + h.posts.length, 0),
    referencias: s.referencias.perfis.reduce((t, p) => t + p.posts.length, 0),
    publicados: s.publicados.posts.length,
  };
}

/** O bloco do que está viralizando no nicho, lido agora no Instagram (vazio sem nenhum sinal). */
export function blocoDoNichoAgora(s: SinaisDoNicho | null | undefined): string {
  const n = contarSinais(s);
  if (!s || !n.hashtags && !n.referencias && !n.publicados) {
    const fora = s ? [s.instagram.motivo, s.referencias.motivo].filter(Boolean).join(" ") : "";
    return `SINAIS DO INSTAGRAM: nenhum lido agora${fora ? ` (${fora})` : ""}. O que está em alta no nicho vem só da busca na web.`;
  }
  const dados = {
    posts_em_alta_nas_hashtags_do_nicho: s.instagram.hashtags.map((h) => ({ hashtag: `#${h.tag}`, posts: h.posts.slice(0, 5).map(post) })),
    posts_fora_da_curva_dos_perfis_de_referencia: s.referencias.perfis.slice(0, 6).map((p) => ({ perfil: `@${p.handle}`, papel: p.papel, posts: p.posts.slice(0, 4).map(post) })),
    posts_do_proprio_cliente_que_mais_funcionaram: s.publicados.posts.slice(0, 5).map(post),
  };
  return `SINAIS DO INSTAGRAM LIDOS AGORA (posts reais; "destaque" diz quanto o post passou do normal do perfil):\n${JSON.stringify(dados)}`;
}
