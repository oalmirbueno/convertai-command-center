/**
 * Escolha com motivo (19/10/2026). Dono: "melhore a inteligência da área de
 * identidade". Nas rodadas de nomes, slogans, paletas e pares de fonte, o Jev
 * já dá a nota de cada proposta; aqui ele aponta as 1 ou 2 melhores e diz
 * POR QUÊ, numa linha curta.
 *
 * O porquê é julgamento, então é Choice do Jev (nunca prompt-e-parse): para
 * cada destacada, "qual é o ponto mais forte desta proposta?" entre motivos
 * fixos de cada peça. A segunda só entra quando está perto da primeira.
 * É aviso: quem escolhe é a equipe.
 *
 * Puro: sem Deno, sem banco. O Jev chega por parâmetro (o teste usa um falso).
 * Regex só na sintaxe antiga (Safari 11). Sem travessão.
 */

export type PecaDaEscolha = "nome" | "slogan" | "paleta" | "fonte";

type PerguntaChoice = { type: "choice"; instructions: string; criteria: Record<string, string> };
type RespostaChoice = { choice?: string; confidence?: number; probabilities?: Record<string, number> };
export type PerguntarAoJevMotivo = (e: { state: unknown; questions: Record<string, PerguntaChoice> }) => Promise<{ answers: Record<string, RespostaChoice> }>;

/** Motivos possíveis por peça: id -> [critério para o Jev, frase curta da tela]. */
export const MOTIVOS_DA_ESCOLHA: Record<PecaDaEscolha, Record<string, [string, string]>> = {
  nome: {
    personalidade: ["O ponto forte é soar como a personalidade e o arquétipo da marca", "soa como a personalidade da marca"],
    memoria: ["O ponto forte é ser curto, fácil de falar, escrever e lembrar", "fácil de falar, escrever e lembrar"],
    diferenca: ["O ponto forte é se diferenciar dos concorrentes e dos clichês do segmento", "foge dos clichês e dos concorrentes"],
    promessa: ["O ponto forte é sugerir a promessa ou o benefício da marca para o público", "sugere a promessa da marca"],
    criterios: ["O ponto forte é atender aos critérios pedidos no briefing", "atende aos critérios do briefing"],
  },
  slogan: {
    posicionamento: ["O ponto forte é dizer o posicionamento da marca com clareza", "diz o posicionamento com clareza"],
    tom: ["O ponto forte é soar no tom de voz da marca", "soa no tom de voz da marca"],
    memoria: ["O ponto forte é ser curto e fácil de lembrar", "curto e fácil de lembrar"],
    diferenca: ["O ponto forte é não soar como o que os concorrentes dizem", "não soa como os concorrentes"],
    publico: ["O ponto forte é falar direto com o público da marca", "fala direto com o público"],
  },
  paleta: {
    arquetipo: ["O ponto forte é expressar o arquétipo e a personalidade da marca", "expressa o arquétipo da marca"],
    publico: ["O ponto forte é combinar com o público e o segmento sem cair no clichê", "conversa com o público sem clichê"],
    leitura: ["O ponto forte é o contraste: texto e logo leem bem sobre as cores", "contraste bom para texto e logo"],
    coerencia: ["O ponto forte é combinar com o que já foi decidido (nome, conceito, logo)", "combina com o que já foi decidido"],
    diferenca: ["O ponto forte é se destacar das cores dos concorrentes", "se destaca dos concorrentes"],
  },
  fonte: {
    personalidade: ["O ponto forte é dar à marca a voz da personalidade e do arquétipo", "dá a voz da personalidade da marca"],
    leitura: ["O ponto forte é a leitura: o texto corrido lê bem em tela e impresso", "lê bem em tela e impresso"],
    contraste: ["O ponto forte é o par: título e texto contrastam sem brigar", "título e texto contrastam sem brigar"],
    coerencia: ["O ponto forte é combinar com o que já foi decidido (nome, paleta, logo)", "combina com o que já foi decidido"],
    diferenca: ["O ponto forte é fugir das letras genéricas do segmento", "foge da letra genérica do segmento"],
  },
};

const ROTULO_DA_PECA: Record<PecaDaEscolha, string> = { nome: "o nome", slogan: "a frase", paleta: "a paleta", fonte: "o par de fontes" };

/** Nota mínima para destacar e a distância máxima da segunda para a primeira. */
export const NOTA_MINIMA_DO_DESTAQUE = 0.5;
export const DISTANCIA_DA_SEGUNDA = 0.12;

/**
 * As 1 ou 2 melhores pela nota (a lista pode vir em qualquer ordem). Sem nota
 * (Jev fora do ar) ou abaixo do mínimo: nenhuma. A segunda só quando está a
 * até DISTANCIA_DA_SEGUNDA da primeira.
 */
export function melhoresPelaNota<T>(itens: T[], nota: (x: T) => number | null | undefined, maximo = 2): T[] {
  const comNota = itens
    .map((x, i) => ({ x, i, n: nota(x) }))
    .filter((o): o is { x: T; i: number; n: number } => typeof o.n === "number" && isFinite(o.n))
    .sort((a, b) => b.n - a.n || a.i - b.i);
  if (!comNota.length || comNota[0].n < NOTA_MINIMA_DO_DESTAQUE) return [];
  const saida = [comNota[0]];
  if (maximo > 1 && comNota[1] && comNota[1].n >= NOTA_MINIMA_DO_DESTAQUE && comNota[0].n - comNota[1].n <= DISTANCIA_DA_SEGUNDA) saida.push(comNota[1]);
  return saida.map((o) => o.x);
}

/** Uma pergunta Choice por destacada (id m0, m1...). */
export function perguntasDoMotivo(descricoes: string[], peca: PecaDaEscolha): Record<string, PerguntaChoice> {
  const motivos = MOTIVOS_DA_ESCOLHA[peca];
  const criteria: Record<string, string> = {};
  Object.keys(motivos).forEach((k) => {
    criteria[k] = motivos[k][0];
  });
  const q: Record<string, PerguntaChoice> = {};
  descricoes.forEach((d, i) => {
    q[`m${i}`] = {
      type: "choice",
      instructions: `Entre as propostas da rodada, ${ROTULO_DA_PECA[peca]} abaixo ficou entre as melhores para a marca descrita em \`marca\`. Qual é o ponto mais forte dela? ${d}`,
      criteria,
    };
  });
  return q;
}

/** A frase curta do motivo escolhido pelo Jev (null quando não veio motivo conhecido). */
export function fraseDoMotivo(r: RespostaChoice | undefined, peca: PecaDaEscolha): string | null {
  const id = r && typeof r.choice === "string" ? r.choice : "";
  const m = MOTIVOS_DA_ESCOLHA[peca][id];
  return m ? m[1] : null;
}

/** Linha da tela: "Escolha do Jev: ..." para a primeira, "2ª do Jev: ..." para a segunda. */
export function linhaDoDestaque(posicao: number, motivo: string): string {
  return `${posicao === 0 ? "Escolha do Jev" : "2ª do Jev"}: ${motivo}`;
}

/**
 * Aponta as melhores e o porquê. Devolve id -> linha da tela. Falha do Jev
 * devolve vazio (as propostas ficam só com a nota); nunca lança.
 */
export async function apontarComJev<T>(
  itens: T[],
  e: { id: (x: T) => string; nota: (x: T) => number | null | undefined; descrever: (x: T) => string; peca: PecaDaEscolha; marca: Record<string, unknown> },
  perguntar: PerguntarAoJevMotivo,
): Promise<{ destaques: Record<string, string>; falhou: boolean }> {
  const melhores = melhoresPelaNota(itens, e.nota);
  if (!melhores.length) return { destaques: {}, falhou: false };
  try {
    const r = await perguntar({ state: { marca: e.marca }, questions: perguntasDoMotivo(melhores.map(e.descrever), e.peca) });
    const destaques: Record<string, string> = {};
    melhores.forEach((x, i) => {
      const motivo = fraseDoMotivo(r.answers ? r.answers[`m${i}`] : undefined, e.peca);
      if (motivo) destaques[e.id(x)] = linhaDoDestaque(i, motivo);
    });
    return { destaques, falhou: false };
  } catch {
    return { destaques: {}, falhou: true };
  }
}

/** Grava o destaque em cada item (`destaque_jev`; quem não é destaque fica sem o campo). */
export function marcarDestaques<T extends object>(itens: T[], id: (x: T) => string, destaques: Record<string, string>): Array<T & { destaque_jev?: string }> {
  return itens.map((x) => {
    const linha = destaques[id(x)];
    const sem = { ...x } as T & { destaque_jev?: string };
    delete sem.destaque_jev;
    return linha ? { ...sem, destaque_jev: linha } : sem;
  });
}
