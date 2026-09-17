/**
 * O ritual escrito pela IA vem em blocos de WhatsApp (*Onde estamos*,
 * *O que vem agora*, *Precisamos de você*). O "próximo passo" que a revisão
 * e o portal exigem está DENTRO desse texto; antes ficava vazio e travava a
 * aprovação com "Próximo passo ausente". Aqui ele é extraído do próprio
 * texto, sem inventar nada.
 */
const BLOCOS_DE_PROXIMO_PASSO = [/o que vem agora/i, /precisamos de voc/i, /pr[oó]ximos? passos?/i, /o que vem/i];

export interface BlocoDoRitual { titulo: string; linhas: string[] }

/**
 * O ritual inteiro, separado: a linha de abertura (cumprimento com o nome),
 * os blocos titulados e a despedida. E o que o portal do cliente usa para
 * mostrar a mensagem organizada, sem os asteriscos do WhatsApp.
 */
export interface RitualEstruturado {
  abertura: string;
  blocos: BlocoDoRitual[];
  fechamento: string;
  /** Texto que nao coube em bloco nenhum (mensagem antiga, sem formato). */
  solto: string[];
}

export function blocosDoTexto(body: string): BlocoDoRitual[] {
  return estruturaDoRitual(body).blocos;
}

export function estruturaDoRitual(body: string | null | undefined): RitualEstruturado {
  const blocos: BlocoDoRitual[] = [];
  const solto: string[] = [];
  let abertura = "";
  let fechamento = "";
  let atual: BlocoDoRitual | null = null;
  for (const bruta of (body ?? "").split(/\r?\n/)) {
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
    if (atual) { atual.linhas.push(linha.replace(/^[•\-–]\s*/, "")); continue; }
    // Fora de bloco: antes do primeiro e a abertura; depois do ultimo e o
    // fechamento; qualquer outra coisa fica solta (texto sem formato).
    const semAsterisco = linha.replace(/\*/g, "");
    if (blocos.length === 0 && !abertura) abertura = semAsterisco;
    else if (blocos.length > 0) fechamento = fechamento ? `${fechamento} ${semAsterisco}` : semAsterisco;
    else solto.push(semAsterisco);
  }
  // A despedida com "Tudo detalhado no painel" nao faz sentido dentro do painel.
  fechamento = fechamento.replace(/\s*Tudo detalhado no painel:?\s*aceleriq\.online\.?/i, "").trim();
  return { abertura, blocos, fechamento, solto };
}

/** Uma frase de resumo para cartoes e linha do tempo: abertura + primeiro bloco. */
export function resumoDoRitual(body: string | null | undefined, max = 220): string {
  const e = estruturaDoRitual(body);
  const primeiro = e.blocos[0] ? `${e.blocos[0].titulo}: ${e.blocos[0].linhas.join(" ")}` : e.solto.join(" ");
  const texto = [e.abertura, primeiro].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return texto.length > max ? `${texto.slice(0, max).replace(/\s+\S*$/, "")}…` : texto;
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
