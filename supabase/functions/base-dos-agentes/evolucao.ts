/**
 * Painel de evolução (17/10/2026, pedido do dono): por cliente e por mês, se o trabalho está melhorando.
 *   a) aprovadas de primeira / peças decididas;
 *   b) rodadas por peça aprovada (entrega_rodada começa em 1 e sobe a cada reprovação);
 *   c) múltiplo médio dos posts publicados contra o normal do perfil (_shared/multiplo-do-post.ts);
 *   d) custo por resultado dos anúncios no mês (somarMetricas da Mesa Ads).
 * Só conta e regra fixa, sem IA. A parte pura (mesesDaEvolucao) é testada sem banco.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { basesDoPerfil, multiploDoPost, type PostParaMultiplo } from "../_shared/multiplo-do-post.ts";
import { type Diaria, type Metricas, somarMetricas } from "../mesa-ads/calculos.ts";

export type TrabalhoDaEvolucao = {
  entrega_status: string | null;
  entrega_rodada: number | null;
  aprovado_em: string | null;
  criado_em: string | null;
};
export type PostDaEvolucao = { mes: string; multiplo: number | null };
export type AdsDoMes = Pick<Metricas, "custo_por_resultado" | "resultados">;

export type EntradaDaEvolucao = {
  trabalhos: TrabalhoDaEvolucao[];
  posts: PostDaEvolucao[];
  /** Métricas somadas dos anúncios por mês ("AAAA-MM"). */
  anunciosPorMes: Record<string, AdsDoMes>;
  hoje: Date;
  meses?: number;
};

export type MesDaEvolucao = {
  mes: string;
  decididas: number;
  aprovadasDePrimeira: number;
  /** Fração de 0 a 1 (a tela mostra em %); null sem peça decidida no mês. */
  taxaDePrimeira: number | null;
  rodadasMedia: number | null;
  posts: number;
  multiploMedio: number | null;
  custoPorResultado: number | null;
  resultadosAds: number;
};

const APROVADAS = ["aprovado", "agendado"];
/** Brasília sem horário de verão desde 2019: o mês vira na meia-noite daqui, não na de Greenwich. */
const FUSO_MS = 3 * 3_600_000;
const SO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** "AAAA-MM" de uma data (dia puro como "2026-10-01" fica no próprio mês) ou de um instante, no horário de Brasília. */
export function mesDe(valor: string | Date | null | undefined): string | null {
  if (!valor) return null;
  if (typeof valor === "string" && SO_DATA.test(valor)) return valor.slice(0, 7);
  const t = typeof valor === "string" ? Date.parse(valor) : valor.getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t - FUSO_MS).toISOString().slice(0, 7);
}

/** Os últimos `meses` meses até o de hoje, do mais antigo ao mais novo. */
export function listaDeMeses(hoje: Date, meses = 6): string[] {
  const atual = mesDe(hoje) as string;
  const ano = Number(atual.slice(0, 4));
  const mes = Number(atual.slice(5, 7)) - 1;
  const out: string[] = [];
  for (let i = meses - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ano, mes - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

const arred = (v: number, casas: number) => Math.round(v * 10 ** casas) / 10 ** casas;

export function mesesDaEvolucao(e: EntradaDaEvolucao): MesDaEvolucao[] {
  const lista = listaDeMeses(e.hoje, e.meses ?? 6);
  const linhas = new Map<string, { decididas: number; primeira: number; aprovadas: number; somaRodadas: number; posts: number; multiplos: number[] }>();
  for (const m of lista) linhas.set(m, { decididas: 0, primeira: 0, aprovadas: 0, somaRodadas: 0, posts: 0, multiplos: [] });

  for (const t of e.trabalhos) {
    const aprovada = APROVADAS.includes(String(t.entrega_status));
    if (!aprovada && t.entrega_status !== "reprovado") continue;
    // Aprovada conta no mês da aprovação; reprovada (sem data de decisão própria) no mês em que nasceu.
    const l = linhas.get(mesDe(aprovada ? t.aprovado_em || t.criado_em : t.criado_em) || "");
    if (!l) continue;
    l.decididas += 1;
    if (!aprovada) continue;
    const rodada = typeof t.entrega_rodada === "number" && t.entrega_rodada > 0 ? t.entrega_rodada : 1;
    l.aprovadas += 1;
    l.somaRodadas += rodada;
    if (rodada === 1) l.primeira += 1;
  }

  for (const p of e.posts) {
    const l = linhas.get(p.mes);
    if (!l) continue;
    l.posts += 1;
    if (typeof p.multiplo === "number") l.multiplos.push(p.multiplo);
  }

  return lista.map((mes) => {
    const l = linhas.get(mes)!;
    const ads = e.anunciosPorMes[mes];
    return {
      mes,
      decididas: l.decididas,
      aprovadasDePrimeira: l.primeira,
      taxaDePrimeira: l.decididas > 0 ? arred(l.primeira / l.decididas, 4) : null,
      // Só as aprovadas: a reprovada ainda está no meio do ciclo e puxaria a média para baixo.
      rodadasMedia: l.aprovadas > 0 ? arred(l.somaRodadas / l.aprovadas, 2) : null,
      posts: l.posts,
      multiploMedio: l.multiplos.length ? arred(l.multiplos.reduce((s, x) => s + x, 0) / l.multiplos.length, 2) : null,
      custoPorResultado: ads && typeof ads.custo_por_resultado === "number" ? ads.custo_por_resultado : null,
      resultadosAds: ads ? ads.resultados || 0 : 0,
    };
  });
}

// ------------------------------------------------------------------ leitura do banco

/** Janela da régua do perfil (a mesma do resultado das fichas). */
const DIAS_DA_BASE = 180;
/** Peça aprovada até 60 dias antes da janela ainda pode ter sido publicada dentro dela. */
const FOLGA_DOS_TRABALHOS_DIAS = 60;
const PAGINA = 1000;

const emPedacos = <T>(lista: T[], n = 100): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < lista.length; i += n) out.push(lista.slice(i, i + n));
  return out;
};
const semBarraNoFim = (u: string | null | undefined) => String(u || "").replace(/\/+$/, "");

/** Lê em páginas de 1000 (o PostgREST corta acima disso) até o teto. */
async function lerEmPaginas<T>(pagina: (de: number, ate: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>, teto: number): Promise<T[]> {
  const out: T[] = [];
  for (let de = 0; de < teto; de += PAGINA) {
    const { data, error } = await pagina(de, Math.min(de + PAGINA, teto) - 1);
    if (error) throw new Error(error.message);
    const linhas = (data || []) as T[];
    out.push(...linhas);
    if (linhas.length < PAGINA) break;
  }
  return out;
}

type TrabalhoLido = TrabalhoDaEvolucao & { id: string; post_id: string | null };
type PostLido = PostParaMultiplo & { media_id: string; permalink: string | null };

export async function evolucaoDoCliente(db: SupabaseClient, clientId: string, hoje: Date = new Date(), meses = 6): Promise<MesDaEvolucao[]> {
  const lista = listaDeMeses(hoje, meses);
  // Meia-noite de Brasília do primeiro dia da janela.
  const inicio = new Date(Date.parse(`${lista[0]}-01T00:00:00Z`) + FUSO_MS);
  const inicioTrabalhos = new Date(inicio.getTime() - FOLGA_DOS_TRABALHOS_DIAS * 86_400_000).toISOString();

  const trabalhos = await lerEmPaginas<TrabalhoLido>(
    (de, ate) =>
      db.from("estudio_trabalhos")
        .select("id, entrega_status, entrega_rodada, aprovado_em, criado_em, post_id")
        .eq("client_id", clientId)
        // Aspas: o instante tem ":" e ".", que o PostgREST lê como separador no or().
        .or(`aprovado_em.gte."${inicioTrabalhos}",criado_em.gte."${inicioTrabalhos}"`)
        .order("id", { ascending: true })
        .range(de, ate),
    5000,
  );

  // Posts: publicação do post da entrega, depois a métrica pela mídia ou pelo link.
  const posts: PostDaEvolucao[] = [];
  const idsDosPosts = [...new Set(trabalhos.map((t) => t.post_id).filter((x): x is string => !!x))];
  if (idsDosPosts.length) {
    const pubs: Array<{ post_id: string; external_post_id: string | null; permalink: string | null }> = [];
    for (const ids of emPedacos(idsDosPosts)) {
      const { data, error } = await db.from("editorial_publications").select("post_id, external_post_id, permalink").in("post_id", ids).eq("status", "published").limit(1000);
      if (error) throw new Error(error.message);
      pubs.push(...((data || []) as typeof pubs));
    }
    if (pubs.length) {
      const desde = new Date(Math.min(inicio.getTime(), hoje.getTime() - DIAS_DA_BASE * 86_400_000)).toISOString();
      const { data, error } = await db.from("social_post_metrics")
        .select("media_id, permalink, posted_at, views, reach, total_interactions, like_count, comments_count, saved, shares")
        .eq("client_id", clientId).gte("posted_at", desde).order("posted_at", { ascending: false }).limit(1000);
      if (error) throw new Error(error.message);
      const doPerfil = (data || []) as PostLido[];
      const bases = basesDoPerfil(doPerfil, DIAS_DA_BASE, hoje);
      const porMidia = new Map(doPerfil.map((p) => [String(p.media_id), p]));
      const porLink = new Map(doPerfil.filter((p) => p.permalink).map((p) => [semBarraNoFim(p.permalink), p]));
      // Um post publicado conta uma vez, mesmo com mais de uma entrega ou publicação apontando para ele.
      const vistos = new Set<string>();
      for (const pub of pubs) {
        const m = (pub.external_post_id && porMidia.get(String(pub.external_post_id))) || (pub.permalink && porLink.get(semBarraNoFim(pub.permalink))) || null;
        if (!m || vistos.has(String(m.media_id))) continue;
        vistos.add(String(m.media_id));
        const mes = mesDe(m.posted_at);
        if (mes) posts.push({ mes, multiplo: multiploDoPost(m, bases).multiplo });
      }
    }
  }

  const diarias = await lerEmPaginas<Diaria>(
    (de, ate) =>
      db.from("ads_creative_daily")
        .select("ad_id, day, spend, impressions, reach, clicks, link_clicks, frequency, actions")
        .eq("client_id", clientId)
        .gte("day", `${lista[0]}-01`)
        .order("day", { ascending: true })
        .order("ad_id", { ascending: true })
        .range(de, ate),
    30000,
  );
  const porMes = new Map<string, Diaria[]>();
  for (const l of diarias) {
    const mes = mesDe(String(l.day).slice(0, 10));
    if (mes) porMes.set(mes, [...(porMes.get(mes) || []), l]);
  }
  const anunciosPorMes: Record<string, Metricas> = {};
  for (const [mes, linhas] of porMes) anunciosPorMes[mes] = somarMetricas(linhas);

  return mesesDaEvolucao({ trabalhos, posts, anunciosPorMes, hoje, meses });
}
