/**
 * O trecho de criativos do relatório de anúncios.
 *
 * Construído sobre o dado REAL da carteira, e não sobre o que eu
 * imaginaria. Quando fui olhar, o retrato era este:
 *
 *   Verzelo      34 peças, 15 gastaram, 9 tiveram clique, maior peça R$ 17
 *   Mirante Luz  17 peças,  6 gastaram, 4 tiveram clique, maior peça R$ 104
 *   Preserva Eco  4 peças,  3 gastaram, 2 tiveram clique
 *
 * Duas coisas saltam daí, e as duas mudam o que o relatório deve dizer:
 *
 * 1. METADE DAS PEÇAS NUNCA RODOU. Dezenove das trinta e quatro da Verzelo
 *    não gastaram um centavo. Isso não é ruído para esconder: é a
 *    informação mais acionável do mês, porque arte parada é trabalho da
 *    equipe que não virou resultado. O relatório diz o número.
 *
 * 2. OS VOLUMES SÃO PEQUENOS. Uma peça com dois cliques e R$ 5 gastos
 *    produz um "R$ 2,50 por clique" que parece análise e é sorte. Por isso
 *    o custo só é comparado entre peças com pelo menos DEZ cliques no
 *    link. O corte não é arbitrário: na carteira dele os cliques por peça
 *    caem 106, 37, 36, 26, 13, 11, 10, 10 e então despencam para 6, 4, 3 —
 *    dez é onde o sinal acaba.
 *
 * Quando nenhuma peça passa do corte, o relatório DIZ que não passou, em
 * vez de rankear três cliques e deixar alguém decidir verba com isso.
 */

export interface PecaParaRelatorio {
  ad_name: string | null;
  campanha?: string | null;
  gasto: number;
  impressoes: number;
  cliques_no_link: number;
  ctr: number | null;
  custo_no_link: number | null;
}

/** Abaixo disto, custo por clique é sorte, não desempenho. */
export const MINIMO_DE_CLIQUES_PARA_COMPARAR = 10;

const dinheiro = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const inteiro = (v: number) => v.toLocaleString("pt-BR");
const nomeDe = (p: PecaParaRelatorio) => p.ad_name?.trim() || "peça sem nome";

export interface ResumoDeCriativos {
  /** Parágrafos prontos para o corpo do relatório. */
  texto: string;
  /** A frase de destaque, ou vazio quando não há o que destacar. */
  destaque: string;
  total: number;
  rodaram: number;
  paradas: number;
  comparaveis: number;
}

export function resumirCriativos(pecas: PecaParaRelatorio[]): ResumoDeCriativos {
  const total = pecas.length;
  if (total === 0) {
    return {
      texto: "",
      destaque: "",
      total: 0,
      rodaram: 0,
      paradas: 0,
      comparaveis: 0,
    };
  }

  const rodaram = pecas.filter((p) => p.gasto > 0);
  const paradas = total - rodaram.length;
  const gastoTotal = rodaram.reduce((t, p) => t + p.gasto, 0);
  const cliquesTotal = rodaram.reduce((t, p) => t + p.cliques_no_link, 0);

  const linhas: string[] = [];

  linhas.push(
    `${total} ${total === 1 ? "peça criada" : "peças criadas"} no período, ` +
    `${rodaram.length} ${rodaram.length === 1 ? "recebeu" : "receberam"} verba, ` +
    `somando ${dinheiro(gastoTotal)} e ${inteiro(cliquesTotal)} ` +
    `${cliquesTotal === 1 ? "clique no link" : "cliques no link"}.`,
  );

  // Arte parada é trabalho que não virou resultado. Merece uma linha
  // própria, e não uma nota de rodapé.
  if (paradas > 0) {
    linhas.push(
      `${paradas} ${paradas === 1 ? "peça não chegou a rodar" : "peças não chegaram a rodar"} ` +
      `e ${paradas === 1 ? "não teve" : "não tiveram"} nenhum gasto no período.`,
    );
  }

  const maiores = [...rodaram].sort((a, b) => b.gasto - a.gasto).slice(0, 3);
  if (maiores.length > 0) {
    linhas.push(
      "Onde a verba foi: " +
      maiores
        .map((p) => `${nomeDe(p)} (${dinheiro(p.gasto)})`)
        .join(", ") + ".",
    );
  }

  // O ranking de custo só existe com amostra que sustente comparação.
  const comparaveis = rodaram
    .filter(
      (p) =>
        p.cliques_no_link >= MINIMO_DE_CLIQUES_PARA_COMPARAR &&
        p.custo_no_link !== null,
    )
    .sort((a, b) => a.custo_no_link! - b.custo_no_link!);

  let destaque = "";

  if (comparaveis.length >= 2) {
    const melhor = comparaveis[0];
    const pior = comparaveis[comparaveis.length - 1];
    linhas.push(
      `Entre as ${comparaveis.length} peças com pelo menos ` +
      `${MINIMO_DE_CLIQUES_PARA_COMPARAR} cliques no link, a mais eficiente foi ` +
      `${nomeDe(melhor)}, a ${dinheiro(melhor.custo_no_link!)} por clique, ` +
      `contra ${dinheiro(pior.custo_no_link!)} de ${nomeDe(pior)}.`,
    );
    destaque =
      `${nomeDe(melhor)} entregou o clique mais barato do período: ` +
      `${dinheiro(melhor.custo_no_link!)}.`;
  } else if (comparaveis.length === 1) {
    const unica = comparaveis[0];
    linhas.push(
      `Só ${nomeDe(unica)} acumulou cliques suficientes para uma leitura de ` +
      `custo (${dinheiro(unica.custo_no_link!)} por clique). As demais ainda ` +
      `não têm volume para comparar.`,
    );
    destaque = `${nomeDe(unica)} foi a peça com volume no período.`;
  } else if (rodaram.length > 0) {
    // Dizer que não dá para comparar é mais útil do que comparar mal.
    linhas.push(
      `Nenhuma peça acumulou ${MINIMO_DE_CLIQUES_PARA_COMPARAR} cliques no link ` +
      `no período, então ainda não dá para dizer qual entrega mais barato: ` +
      `com poucos cliques, a diferença entre uma e outra é sorte, não desempenho.`,
    );
  }

  return {
    texto: linhas.join("\n"),
    destaque,
    total,
    rodaram: rodaram.length,
    paradas,
    comparaveis: comparaveis.length,
  };
}
