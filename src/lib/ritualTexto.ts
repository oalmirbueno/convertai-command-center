/**
 * O ritual escrito pela IA vem em blocos de WhatsApp (*Onde estamos*,
 * *O que vem agora*, *Precisamos de você*). O "próximo passo" que a revisão
 * e o portal exigem está DENTRO desse texto; antes ficava vazio e travava a
 * aprovação com "Próximo passo ausente". Aqui ele é extraído do próprio
 * texto, sem inventar nada.
 */
const BLOCOS_DE_PROXIMO_PASSO = [/o que vem agora/i, /precisamos de voc/i, /pr[oó]ximos? passos?/i, /o que vem/i];

function blocosDoTexto(body: string): Array<{ titulo: string; linhas: string[] }> {
  const blocos: Array<{ titulo: string; linhas: string[] }> = [];
  let atual: { titulo: string; linhas: string[] } | null = null;
  for (const bruta of body.split(/\r?\n/)) {
    const linha = bruta.trim();
    const titulo = linha.match(/^\*([^*]{2,60})\*:?\s*(.*)$/);
    if (titulo) {
      atual = { titulo: titulo[1].trim(), linhas: titulo[2] ? [titulo[2].trim()] : [] };
      blocos.push(atual);
      continue;
    }
    // Linha em branco fecha o bloco: no WhatsApp cada bloco termina assim, e a
    // frase de despedida no fim nao pertence ao ultimo bloco.
    if (!linha) { atual = null; continue; }
    if (atual) atual.linhas.push(linha.replace(/^[•\-–]\s*/, ""));
  }
  return blocos;
}

/** Devolve o próximo passo contido no texto, ou "" quando o texto não tem. */
export function proximoPassoDoTexto(body: string | null | undefined): string {
  if (!body) return "";
  const escolhidos = blocosDoTexto(body).filter((b) => BLOCOS_DE_PROXIMO_PASSO.some((re) => re.test(b.titulo)));
  const texto = escolhidos.map((b) => b.linhas.join(" ")).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return texto.slice(0, 600);
}

/** Garante o campo: usa o que já existe; senão, extrai do texto. */
export function completarProximoPasso(nextSteps: string | null | undefined, body: string | null | undefined): string {
  const atual = (nextSteps ?? "").trim();
  return atual || proximoPassoDoTexto(body);
}
