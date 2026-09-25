import type { SocialMetricsWeek, SocialPostMetric } from "@/hooks/useSocialMetrics";

/**
 * Leituras da tela de métricas (/metricas), em código e sem IA: o ranking dos
 * posts, os totais do perfil em 30 dias e o conselho curto por cliente.
 *
 * O conselho junta três fontes, nesta ordem de confiança: os números da
 * semana (variação de alcance e seguidores), a leitura de evolução que a Mesa
 * gravou (vencedores, testes e aprendizados) e os anúncios do cliente.
 */

export const ROTULO_DO_FORMATO: Record<string, string> = {
  IMAGE: "Post",
  CAROUSEL_ALBUM: "Carrossel",
  VIDEO: "Reels",
  REELS: "Reels",
};

export const formatoDoPost = (tipo?: string | null) =>
  (tipo && Object.prototype.hasOwnProperty.call(ROTULO_DO_FORMATO, tipo) ? ROTULO_DO_FORMATO[tipo] : tipo) || "Post";

/** Interações do post: o total da Meta quando existe; senão a soma do que veio. */
export function interacoesDoPost(p: Pick<SocialPostMetric, "like_count" | "comments_count" | "saved" | "shares" | "total_interactions">): number {
  if (p.total_interactions != null) return Number(p.total_interactions) || 0;
  return (p.like_count || 0) + (p.comments_count || 0) + (p.saved || 0) + (p.shares || 0);
}

/** Do que mais performou para o que menos: interações e, no empate, alcance. */
export function rankearPosts<T extends SocialPostMetric>(posts: T[] | undefined): T[] {
  return (posts || []).slice().sort((a, b) => {
    const d = interacoesDoPost(b) - interacoesDoPost(a);
    return d !== 0 ? d : (b.reach || 0) - (a.reach || 0);
  });
}

const DIA = 86400000;

export interface TotaisDosPosts {
  posts: number;
  interacoes: number;
  /** null quando a Meta não mandou o campo em nenhum post (sem dado, e não zero). */
  salvos: number | null;
  compartilhamentos: number | null;
  alcanceMedio: number | null;
}

/** Totais dos posts publicados nos últimos `dias`. */
export function totaisDosPosts(posts: SocialPostMetric[] | undefined, dias = 30, agora: Date = new Date()): TotaisDosPosts {
  const limite = agora.getTime() - dias * DIA;
  const doPeriodo = (posts || []).filter((p) => {
    const t = p.posted_at ? new Date(p.posted_at).getTime() : NaN;
    return Number.isFinite(t) && t >= limite;
  });
  let salvos: number | null = null;
  let compartilhamentos: number | null = null;
  let somaAlcance = 0;
  let comAlcance = 0;
  let interacoes = 0;
  for (const p of doPeriodo) {
    interacoes += interacoesDoPost(p);
    if (p.saved != null) salvos = (salvos || 0) + Number(p.saved);
    if (p.shares != null) compartilhamentos = (compartilhamentos || 0) + Number(p.shares);
    if (p.reach != null) {
      somaAlcance += Number(p.reach);
      comAlcance += 1;
    }
  }
  return {
    posts: doPeriodo.length,
    interacoes,
    salvos,
    compartilhamentos,
    alcanceMedio: comAlcance ? Math.round(somaAlcance / comAlcance) : null,
  };
}

const pct = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/** O que a Mesa gravou na última leitura de evolução (normalizado, só o que o conselho usa). */
export interface EvolucaoParaConselho {
  resumo?: string | null;
  vencedores?: { nome: string; canal: string }[];
  proximos_testes?: { titulo: string }[];
  aprendizados?: { tipo: "repetir" | "evitar"; texto: string }[];
}

export interface AnunciosParaConselho {
  investido: number;
  /** "12 conversas iniciadas" */
  resultado: string | null;
  /** "R$ 8,50 cada" */
  custo: string | null;
}

const primeiraFrase = (t: string, max = 200) => {
  const limpo = t.trim();
  const ponto = limpo.indexOf(". ");
  const frase = ponto > 30 ? limpo.slice(0, ponto + 1) : limpo;
  return frase.length > max ? `${frase.slice(0, max).trim()}...` : frase;
};

/**
 * Conselho curto do cliente: no máximo `max` linhas, cada uma com o número
 * que a gerou. Sem dado suficiente, devolve lista vazia (a tela diz isso).
 */
export function conselhoDoCliente(entrada: {
  semanas: SocialMetricsWeek[];
  deltaAlcance: number | null;
  deltaSeguidores: number | null;
  posts: SocialPostMetric[];
  evolucao?: EvolucaoParaConselho | null;
  anuncios?: AnunciosParaConselho | null;
  agora?: Date;
  max?: number;
}): string[] {
  const linhas: string[] = [];
  const { deltaAlcance, deltaSeguidores } = entrada;

  if (deltaAlcance != null) {
    linhas.push(
      deltaAlcance >= 0
        ? `Alcance subiu ${pct(deltaAlcance)}% na última semana fechada: mantenha o ritmo e o formato que está puxando.`
        : `Alcance caiu ${pct(Math.abs(deltaAlcance))}% na última semana fechada: varie formato e horário nos próximos posts.`,
    );
  }
  if (deltaSeguidores != null && deltaSeguidores < 0) {
    linhas.push("Seguidores em queda: reforce conteúdo de valor (dica, bastidor, prova) antes de conteúdo de venda.");
  }

  // Formato que mais engaja (com pelo menos 2 posts de cada lado).
  const porFormato = new Map<string, { total: number; n: number }>();
  for (const p of entrada.posts || []) {
    const f = formatoDoPost(p.media_type);
    const b = porFormato.get(f) || { total: 0, n: 0 };
    b.total += interacoesDoPost(p);
    b.n += 1;
    porFormato.set(f, b);
  }
  const medias: { f: string; m: number }[] = [];
  porFormato.forEach((b, f) => {
    if (b.n >= 2) medias.push({ f, m: b.total / b.n });
  });
  medias.sort((a, b) => b.m - a.m);
  if (medias.length >= 2 && medias[0].m > 0) {
    const ult = medias[medias.length - 1];
    linhas.push(
      `${medias[0].f} engaja em média ${Math.round(medias[0].m)} interações por post, contra ${Math.round(ult.m)} de ${ult.f.toLowerCase()}: priorize ${medias[0].f.toLowerCase()}.`,
    );
  }

  // O que a Mesa concluiu na última leitura de evolução.
  const ev = entrada.evolucao;
  if (ev) {
    const repetir = (ev.aprendizados || []).find((a) => a.tipo === "repetir");
    const teste = (ev.proximos_testes || [])[0];
    if (ev.resumo && ev.resumo.trim()) linhas.push(`Mesa: ${primeiraFrase(ev.resumo)}`);
    else if (repetir) linhas.push(`Mesa: ${primeiraFrase(repetir.texto)}`);
    if (teste && teste.titulo) linhas.push(`Próximo teste sugerido pela Mesa: ${primeiraFrase(teste.titulo, 140)}`);
  }

  // Anúncios: o resultado certo para o objetivo, ou o alerta de dinheiro sem resultado.
  const ads = entrada.anuncios;
  if (ads && ads.investido > 0) {
    const reais = ads.investido.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
    linhas.push(
      ads.resultado
        ? `Anúncios em 30 dias: ${reais} trouxeram ${ads.resultado}${ads.custo ? ` (${ads.custo})` : ""}.`
        : `${reais} em anúncios nos últimos 30 dias sem resultado medido: confira o objetivo e o pixel das campanhas.`,
    );
  }

  // Ritmo de publicação.
  const agora = entrada.agora || new Date();
  const recentes = (entrada.posts || []).filter(
    (p) => p.posted_at && agora.getTime() - new Date(p.posted_at).getTime() < 30 * DIA,
  ).length;
  if ((entrada.posts || []).length > 0) {
    linhas.push(
      recentes === 0
        ? "Nenhuma publicação nos últimos 30 dias: o perfil parou, e o alcance orgânico cai junto."
        : `Ritmo: ${recentes} ${recentes === 1 ? "publicação" : "publicações"} nos últimos 30 dias.`,
    );
  }

  return linhas.slice(0, entrada.max || 5);
}
