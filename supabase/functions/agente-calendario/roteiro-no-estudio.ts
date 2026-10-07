import { blocosDoTexto, direcaoDoRoteiro, promptDaLamina, type MarcaParaDirecao } from "../_shared/direcao-arte.ts";

/** Atualiza o texto da direção, preservando escolhas visuais e referências da lâmina. */
export function direcaoComRoteiro(direcao: Record<string, any>, item: Record<string, any>, marca: MarcaParaDirecao) {
  const base = direcaoDoRoteiro(item.cards || [], marca, {
    postUnico: item.formato === "estatico", carrosselInfinito: !!direcao.carrossel_infinito,
    conceito: String(item.tema || direcao.conceito || ""), levaLogo: (ordem, total) => ordem === 1 || ordem === total,
  });
  const cards = base.cards.map(novo => {
    const anterior = Array.isArray(direcao.cards) ? direcao.cards.find((c: any) => c.ordem === novo.ordem) : null;
    const card = { ...novo, ...anterior, ordem: novo.ordem, texto_exato: novo.texto_exato,
      blocos: blocosDoTexto(novo.texto_exato, anterior?.funcao || novo.funcao) };
    card.prompt_imagem = promptDaLamina(card, marca, { total: base.cards.length,
      carrosselInfinito: base.carrossel_infinito, levaLogo: novo.ordem === 1 || novo.ordem === base.cards.length, conceito: base.conceito });
    return card;
  });
  return { ...direcao, conceito: base.conceito, cards };
}
