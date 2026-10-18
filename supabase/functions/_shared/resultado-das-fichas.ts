/**
 * O resultado de cada ficha da base dos agentes (17/10/2026). Dono: "a base aprender com o que você aprova e
 * reprova" e "os números do Instagram voltando para o gancho e a técnica".
 *
 * Cada uso de uma ficha aponta a peça que ela ajudou a fazer (agente_base_usos.referencia). Aqui, puro:
 * - o desfecho da peça: aprovada de primeira, aprovada depois de ajuste, reprovada ou ainda sem decisão;
 * - quanto o post publicado rendeu contra o normal do perfil (o múltiplo de _shared/multiplo-do-post.ts);
 * - o peso da ficha na próxima geração e quando ela deve sair (reprova muito ou os posts com ela rendem pouco).
 * A rotina semanal (base-dos-agentes) grava o resumo na ficha; a geração e a tela só leem.
 */

export type DesfechoDaPeca = "aprovada" | "ajustada" | "reprovada" | "pendente";

/** Estúdio: aprovado/agendado na 1ª rodada é de primeira; depois de reprovação, ajustada. */
export function desfechoDoEstudio(t: { entrega_status: string | null; entrega_rodada: number | null }): DesfechoDaPeca {
  const rodada = Number(t.entrega_rodada) || 1;
  if (t.entrega_status === "aprovado" || t.entrega_status === "agendado") return rodada > 1 ? "ajustada" : "aprovada";
  if (t.entrega_status === "reprovado" || rodada > 1) return "reprovada";
  return "pendente";
}

/** Mesa Ads: o criativo que a equipe deixou pronto ou levou à conta conta como aprovado; o resto não decide. */
export function desfechoDoAds(status: string | null): DesfechoDaPeca {
  return status === "pronto" || status === "no_ar" || status === "pausado" ? "aprovada" : "pendente";
}

export interface ResultadoDaFicha {
  aprovadas: number;
  ajustadas: number;
  reprovadas: number;
  /** Posts publicados e medidos feitos com a ficha. */
  posts: number;
  /** Média do múltiplo desses posts (1 = o normal do perfil). */
  multiplo: number | null;
}

export const RESULTADO_VAZIO: ResultadoDaFicha = { aprovadas: 0, ajustadas: 0, reprovadas: 0, posts: 0, multiplo: null };

export type UsoParaResultado = { ficha_id: string; referencia_tipo: string | null; referencia_id: string | null };

/** Soma por ficha, contando cada peça uma vez só (a mesma ficha entra na direção e no ajuste da mesma peça). */
export function resultadosDasFichas(
  usos: UsoParaResultado[],
  desfechos: Map<string, DesfechoDaPeca>,
  multiplos: Map<string, number>,
): Map<string, ResultadoDaFicha> {
  const vistos = new Set<string>();
  const soma = new Map<string, { r: ResultadoDaFicha; somaMultiplo: number }>();
  for (const u of usos) {
    if (!u.referencia_tipo || !u.referencia_id) continue;
    const peca = `${u.referencia_tipo}:${u.referencia_id}`;
    const chave = `${u.ficha_id}|${peca}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const atual = soma.get(u.ficha_id) || { r: { ...RESULTADO_VAZIO }, somaMultiplo: 0 };
    const d = desfechos.get(peca);
    if (d === "aprovada") atual.r.aprovadas += 1;
    else if (d === "ajustada") atual.r.ajustadas += 1;
    else if (d === "reprovada") atual.r.reprovadas += 1;
    const m = multiplos.get(peca);
    if (typeof m === "number" && Number.isFinite(m)) {
      atual.r.posts += 1;
      atual.somaMultiplo += m;
    }
    soma.set(u.ficha_id, atual);
  }
  const saida = new Map<string, ResultadoDaFicha>();
  soma.forEach((v, id) => {
    saida.set(id, { ...v.r, multiplo: v.r.posts ? Math.round((v.somaMultiplo / v.r.posts) * 100) / 100 : null });
  });
  return saida;
}

/** Peças decididas com a ficha. */
export const julgadas = (r: ResultadoDaFicha) => r.aprovadas + r.ajustadas + r.reprovadas;

/** De 0 a 1: aprovada vale 1, ajustada meio. null sem peça decidida. */
export function taxaDeAprovacao(r: ResultadoDaFicha): number | null {
  const n = julgadas(r);
  return n ? (r.aprovadas + 0.5 * r.ajustadas) / n : null;
}

/** A ficha que mais atrapalha do que ajuda: reprova quase sempre, ou os posts com ela rendem bem abaixo do normal. */
export function deveSair(r: ResultadoDaFicha | null | undefined): boolean {
  if (!r) return false;
  const taxa = taxaDeAprovacao(r);
  if (julgadas(r) >= 3 && taxa !== null && taxa <= 0.25) return true;
  return r.posts >= 3 && r.multiplo !== null && r.multiplo <= 0.6;
}

/** O empurrão na escolha da próxima geração (somado à nota do Jev, que vai de 0 a 3). */
export function pesoDaFicha(r: ResultadoDaFicha | null | undefined): number {
  if (!r) return 0;
  let p = 0;
  const taxa = taxaDeAprovacao(r);
  if (julgadas(r) >= 2 && taxa !== null) p += taxa >= 0.75 ? 0.5 : taxa <= 0.4 ? -0.5 : 0;
  if (r.posts >= 2 && r.multiplo !== null) p += r.multiplo >= 1.2 ? 0.5 : r.multiplo <= 0.8 ? -0.5 : 0;
  return p;
}

/** A linha curta da tela: "aprovou 4 de 5 · posts 1,8x o normal". */
export function resumoDoResultado(r: ResultadoDaFicha | null | undefined): string {
  if (!r) return "";
  const partes: string[] = [];
  const n = julgadas(r);
  if (n) partes.push(`aprovou ${r.aprovadas + r.ajustadas} de ${n}${r.ajustadas ? ` (${r.ajustadas} com ajuste)` : ""}`);
  if (r.posts && r.multiplo !== null) partes.push(`${r.posts} ${r.posts === 1 ? "post" : "posts"} com ${String(r.multiplo).replace(".", ",")}x o normal`);
  return partes.join(" · ");
}
