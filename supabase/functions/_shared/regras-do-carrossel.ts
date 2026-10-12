/**
 * Regras de carrossel do Instagram (12/10/2026, skill ig-carousel-planner), usadas pela agenda do Mês
 * e pelo Estúdio. Puro (sem Deno, sem rede); aviso, nunca reescrita (regra "sem laço de correção").
 *
 * - de 2 a 10 lâminas pela API (o painel publica pela API: mais de 10 trava na entrega);
 * - menos de 4 pontos reais vira imagem única (nunca encher para chegar a 10);
 * - lâmina 1: promessa com loop aberto, de 6 a 12 palavras (nunca título seco);
 * - última lâmina: o resumo que se salva e um pedido só (salvar, seguir ou mandar para alguém).
 * Safari 11: sem lookbehind, classe Unicode ou grupo nomeado.
 */

export const MAX_LAMINAS_PELA_API = 10;
const semAcento = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const palavras = (t: string) => String(t || "").split(/\s+/).filter(Boolean).length;

const PEDIDO_DO_FIM = /\b(salve|salva|salvar|guarde|guarda|siga|segue|seguir|compartilhe|compartilha|mande|manda|envie|envia|marque|marca alguem|comente|comenta)\b/;

/** Avisos do carrossel (lista vazia = segue as regras). `cards` na ordem das lâminas. */
export function avisosDoCarrossel(cards: { texto?: string | null }[]): string[] {
  const avisos: string[] = [];
  const n = cards.length;
  if (n > MAX_LAMINAS_PELA_API) avisos.push(`Carrossel com ${n} lâminas: o Instagram publica até ${MAX_LAMINAS_PELA_API} pela API. Ficam as ${MAX_LAMINAS_PELA_API} primeiras.`);
  if (n > 0 && n < 3) avisos.push(`Só ${n} ${n === 1 ? "lâmina" : "lâminas"}: com menos de 4 pontos, uma imagem única costuma render mais que carrossel.`);
  if (n >= 3) {
    const primeira = String(cards[0]?.texto || "").trim();
    const p1 = palavras(primeira);
    if (primeira && p1 > 12) avisos.push(`Lâmina 1 com ${p1} palavras: a promessa funciona melhor com 6 a 12.`);
    if (primeira && p1 > 0 && p1 < 4) avisos.push("Lâmina 1 parece título seco: diga o que a pessoa ganha ou abra uma curiosidade (\"o 4º quase ninguém faz\").");
    const ultima = semAcento(String(cards[n - 1]?.texto || ""));
    if (ultima && !PEDIDO_DO_FIM.test(ultima)) avisos.push("A última lâmina não pede nada: feche com o resumo e um pedido só (salvar, seguir ou mandar para alguém).");
    const pedidos = (ultima.match(new RegExp(PEDIDO_DO_FIM.source, "g")) || []).length;
    if (pedidos >= 3) avisos.push("A última lâmina pede coisas demais: escolha um pedido só.");
  }
  return avisos;
}
