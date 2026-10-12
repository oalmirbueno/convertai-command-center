/**
 * Múltiplo de outlier do post (12/10/2026, yt-viral e ig-audience-insights): quanto o post rendeu contra
 * o normal do próprio perfil. Mede pela melhor métrica que existe no post, nesta ordem:
 *   views ÷ mediana das views do perfil; senão alcance ÷ mediana do alcance; senão interações ÷ mediana.
 * Mediana (não média): um post que estourou não puxa a régua. Exige pelo menos 4 posts com a métrica
 * na janela (como o yt-viral); com menos, não há múltiplo (sem dado, e não 1x).
 * Destaque a partir de 1,5x (padrão do yt-viral). Puro: a tela (/metricas) e o Agente do Mês leem este arquivo.
 */

export type MedidaDoMultiplo = "views" | "alcance" | "interacoes";
export const DESTAQUE_A_PARTIR_DE = 1.5;
const MINIMO_DE_POSTS = 4;

export type PostParaMultiplo = {
  posted_at: string | null;
  views?: number | null;
  reach?: number | null;
  total_interactions?: number | null;
  like_count?: number | null;
  comments_count?: number | null;
  saved?: number | null;
  shares?: number | null;
};

export type BasesDoPerfil = Record<MedidaDoMultiplo, number | null>;
export type MultiploDoPost = { multiplo: number | null; medida: MedidaDoMultiplo | null; destaque: boolean };

const interacoes = (p: PostParaMultiplo): number | null => {
  if (typeof p.total_interactions === "number") return p.total_interactions;
  const partes = [p.like_count, p.comments_count, p.saved, p.shares].filter((x): x is number => typeof x === "number");
  return partes.length ? partes.reduce((a, b) => a + b, 0) : null;
};
const valor = (p: PostParaMultiplo, m: MedidaDoMultiplo): number | null =>
  m === "views" ? (typeof p.views === "number" ? p.views : null) : m === "alcance" ? (typeof p.reach === "number" ? p.reach : null) : interacoes(p);

function mediana(v: number[]): number | null {
  if (v.length < MINIMO_DE_POSTS) return null;
  const s = v.slice().sort((a, b) => a - b);
  const meio = Math.floor(s.length / 2);
  const m = s.length % 2 ? s[meio] : (s[meio - 1] + s[meio]) / 2;
  return m > 0 ? m : null;
}

/** As medianas do perfil na janela (90 dias por padrão), uma por métrica. */
export function basesDoPerfil(posts: PostParaMultiplo[], dias = 90, agora: Date = new Date()): BasesDoPerfil {
  const limite = agora.getTime() - dias * 86400000;
  const naJanela = posts.filter((p) => p.posted_at && new Date(p.posted_at).getTime() >= limite);
  const de = (m: MedidaDoMultiplo) => mediana(naJanela.map((p) => valor(p, m)).filter((x): x is number => x !== null));
  return { views: de("views"), alcance: de("alcance"), interacoes: de("interacoes") };
}

export function multiploDoPost(p: PostParaMultiplo, bases: BasesDoPerfil): MultiploDoPost {
  for (const m of ["views", "alcance", "interacoes"] as MedidaDoMultiplo[]) {
    const v = valor(p, m);
    const b = bases[m];
    if (v !== null && b !== null) {
      const x = Math.round((v / b) * 10) / 10;
      return { multiplo: x, medida: m, destaque: x >= DESTAQUE_A_PARTIR_DE };
    }
  }
  return { multiplo: null, medida: null, destaque: false };
}

/** "2,4x o normal do perfil (views)". */
export function textoDoMultiplo(m: MultiploDoPost): string {
  if (m.multiplo === null) return "";
  const rotulo = m.medida === "views" ? "views" : m.medida === "alcance" ? "alcance" : "interações";
  return `${String(m.multiplo).replace(".", ",")}x o normal do perfil (${rotulo})`;
}
