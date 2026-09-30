/**
 * Limite de texto das lâminas 2 em diante no Estúdio (frente R3, 26/09/2026).
 *
 * Dono: "o card 2 fica muito genérico, um textão; quando chegar no Estúdio já
 * chega refinado". A preparação enxuga (uma chamada ao redator) as lâminas que
 * passam deste limite; a tela usa a mesma regra para mostrar o custo antes de
 * "Montar do roteiro" (grátis quando nenhuma passa). Os números são os do
 * agente do Mês (menos-texto-nas-laminas.ts, frente M): só importados aqui.
 *
 * Puro, sem Deno nem npm: a tela, a função e os testes leem o mesmo arquivo.
 */

import { contarPalavras, LIMITE_DA_LAMINA, LIMITE_DO_CTA, PALAVRAS_DO_APOIO, PALAVRAS_DO_TITULO } from "../../_shared/menos-texto-nas-laminas.ts";

type Bloco = { papel: string; texto: string };
export type LaminaDoLimite = { ordem: number; funcao?: string | null; texto_exato?: string | null; blocos?: Bloco[] | null };

/** Sem blocos (roteiro cru): a 1ª linha é a headline e o resto é o apoio. */
function blocosDe(c: LaminaDoLimite): Bloco[] {
  if (c.blocos && c.blocos.length) return c.blocos;
  const linhas = String(c.texto_exato || "").split("\n").map((l) => l.trim()).filter(Boolean);
  return linhas.map((texto, i) => ({ papel: i === 0 ? "headline" : "apoio", texto }));
}

/**
 * A lâmina 2 em diante passa do limite? Total acima do limite do papel
 * (conteúdo: título + apoio com folga; fechamento: o do CTA), headline acima de
 * PALAVRAS_DO_TITULO + 2 ou um apoio acima de PALAVRAS_DO_APOIO. A capa nunca.
 */
export function passaDoLimite(c: LaminaDoLimite, total: number): boolean {
  if (c.ordem <= 1 || c.funcao === "capa") return false;
  const blocos = blocosDe(c);
  const totalDePalavras = contarPalavras(c.texto_exato || blocos.map((b) => b.texto).join(" "));
  const fechamento = c.funcao === "cta" || (total > 1 && c.ordem === total);
  if (totalDePalavras > (fechamento ? LIMITE_DO_CTA : LIMITE_DA_LAMINA)) return true;
  const titulo = blocos.filter((b) => b.papel === "headline" || b.papel === "numero").reduce((s, b) => s + contarPalavras(b.texto), 0);
  if (titulo > PALAVRAS_DO_TITULO + 2) return true;
  return blocos.some((b) => (b.papel === "apoio" || b.papel === "subtitulo") && contarPalavras(b.texto) > PALAVRAS_DO_APOIO);
}

/**
 * Lâminas longas de um roteiro do estrategista (cards com `texto`), na mesma
 * ordem e com a mesma função que a direção do roteiro dá (direcaoDoRoteiro):
 * a 1ª é a capa, a última de uma série é o fechamento.
 */
export function laminasLongasDoRoteiro(cards: unknown): number[] {
  const lista = (Array.isArray(cards) ? cards : [])
    .filter((c): c is Record<string, unknown> => !!c && typeof c === "object" && typeof (c as Record<string, unknown>).texto === "string" && !!String((c as Record<string, unknown>).texto).trim())
    .slice()
    .sort((a, b) => Number(a.ordem ?? 0) - Number(b.ordem ?? 0));
  const total = lista.length;
  const longas: number[] = [];
  lista.forEach((c, i) => {
    const ordem = i + 1;
    const pedida = typeof c.funcao === "string" ? c.funcao : "";
    const funcao = ordem === 1 ? "capa" : ordem === total && total > 1 ? "cta" : /cta|chamada/i.test(pedida) ? "cta" : "conteudo";
    if (passaDoLimite({ ordem, funcao, texto_exato: String(c.texto).trim() }, total)) longas.push(ordem);
  });
  return longas;
}

/**
 * Aviso curto da tela depois de preparar (miolo_enxuto e miolo_longo da
 * resposta): quais lâminas longas chegaram enxutas e quais ainda passam do
 * limite. Nenhuma longa: null (nada a dizer).
 */
export function textoDoMioloEnxuto(r: { miolo_enxuto?: unknown; miolo_longo?: unknown } | null | undefined): string | null {
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter((n) => typeof n === "number") as number[] : []);
  const longo = lista(r && r.miolo_longo);
  if (!longo.length) return null;
  const enxuto = lista(r && r.miolo_enxuto).filter((n) => longo.indexOf(n) >= 0);
  const resto = longo.filter((n) => enxuto.indexOf(n) < 0);
  const nomes = (ns: number[]) => (ns.length === 1 ? `Lâmina ${ns[0]}` : `Lâminas ${ns.slice(0, -1).join(", ")} e ${ns[ns.length - 1]}`);
  return [
    enxuto.length ? `${nomes(enxuto)} ${enxuto.length === 1 ? "chegou enxuta" : "chegaram enxutas"}.` : "",
    resto.length ? `${nomes(resto)} ainda ${resto.length === 1 ? "passa" : "passam"} do limite: use Refinar texto.` : "",
  ].filter(Boolean).join(" ");
}
