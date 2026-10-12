/**
 * Hashtags por tamanho (12/10/2026, skill ig-hashtag-strategist): 3 a 5 hashtags, com 2 a 3 de nicho
 * (menos de 50 mil posts), 1 a 2 médias (50 mil a 500 mil) e no máximo 1 ampla (500 mil ou mais).
 * A API não dá a contagem de posts: o Jev estima o tamanho pela especificidade, e o código monta a
 * mistura com a nota de relevância que o Jev já dava. Sem o Jev, uma estimativa em código.
 * Puro (sem Deno, sem rede), testado no Vitest.
 */

export type TamanhoDaHashtag = "nicho" | "media" | "ampla";

export const CRITERIOS_DO_TAMANHO: Record<TamanhoDaHashtag, string> = {
  nicho: "hashtag de nicho: bem específica (cidade ou bairro com o serviço, combinação de duas ou mais palavras, nome de comunidade), com poucas publicações (menos de cerca de 50 mil)",
  media: "hashtag média: um assunto do setor com recorte (serviço + público, ou estilo), com volume intermediário (cerca de 50 mil a 500 mil publicações)",
  ampla: "hashtag ampla: palavra única comum ou assunto genérico de muito volume (500 mil publicações ou mais), onde perfil pequeno some",
};

/** Estimativa em código, para quando o Jev não responde: palavra única curta = ampla; muitas letras e sem espaço = nicho. */
export function tamanhoEstimado(hashtag: string): TamanhoDaHashtag {
  const h = hashtag.replace(/^#/, "").toLowerCase();
  if (h.length <= 9) return "ampla";
  if (h.length >= 18) return "nicho";
  return "media";
}

export type HashtagAvaliada = { hashtag: string; nota: number; tamanho: TamanhoDaHashtag };

/**
 * A mistura final: as melhores de cada tamanho, até 2 a 3 de nicho, 1 a 2 médias e 0 a 1 ampla,
 * no total de 3 a 5. Faltou de um tamanho, completa com as melhores restantes (sem passar de 1 ampla).
 */
export function misturaDeHashtags(avaliadas: HashtagAvaliada[], max = 5): string[] {
  const vistos = new Set<string>();
  const unicas = avaliadas.filter((a) => (vistos.has(a.hashtag.toLowerCase()) ? false : (vistos.add(a.hashtag.toLowerCase()), true)));
  const porNota = (t: TamanhoDaHashtag) => unicas.filter((a) => a.tamanho === t).sort((a, b) => b.nota - a.nota);
  const escolha: HashtagAvaliada[] = [...porNota("nicho").slice(0, 3), ...porNota("media").slice(0, 2), ...porNota("ampla").slice(0, 1)];
  // Mais de max: tira primeiro o excesso de nicho (fica 2), depois de média (fica 1).
  while (escolha.length > max) {
    const nichos = escolha.filter((a) => a.tamanho === "nicho");
    const medias = escolha.filter((a) => a.tamanho === "media");
    const tirar = nichos.length > 2 ? nichos[nichos.length - 1] : medias.length > 1 ? medias[medias.length - 1] : escolha[escolha.length - 1];
    escolha.splice(escolha.indexOf(tirar), 1);
  }
  // Menos de 3: completa com as melhores que sobraram, sem passar de 1 ampla.
  if (escolha.length < 3) {
    const resto = unicas.filter((a) => escolha.indexOf(a) < 0).sort((a, b) => b.nota - a.nota);
    for (const a of resto) {
      if (escolha.length >= 3) break;
      if (a.tamanho === "ampla" && escolha.some((x) => x.tamanho === "ampla")) continue;
      escolha.push(a);
    }
  }
  const ordem: Record<TamanhoDaHashtag, number> = { nicho: 0, media: 1, ampla: 2 };
  return escolha.sort((a, b) => ordem[a.tamanho] - ordem[b.tamanho] || b.nota - a.nota).map((a) => a.hashtag);
}
