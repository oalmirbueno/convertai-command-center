/**
 * Como o código do painel é fatiado em arquivos.
 *
 * Isto mora fora do vite.config para poder ser testado de verdade: a regra
 * errada aqui não quebra o build, ela deixa o painel lento de um jeito que só
 * aparece na máquina do cliente.
 *
 * Duas lições que custaram caro, medidas em produção:
 *
 * 1. Fatiar demais é pior que não fatiar. O build chegou a 194 arquivos, 116
 *    com menos de 5 KB — um por ícone. Cada um custava uma ida e volta inteira
 *    até o servidor, e um ícone de 288 bytes levou 3,3 SEGUNDOS para chegar.
 *    O custo é a fila de requisições, não o peso.
 *
 * 2. Agrupar à força uma biblioteca de uso pontual (ler PDF, planilha) a
 *    transforma em dependência fixa da primeira tela, mesmo que só o Studio
 *    use. Ao tentar isso, a abertura saltou de 419 KB para 709 KB.
 *
 * Por isso só as bibliotecas que TODA tela usa são agrupadas à mão. Para o
 * resto, o Rollup decide sozinho (mantendo cada rota com o seu) e o piso de
 * tamanho no vite.config gruda os fragmentos que sobrariam soltos.
 */

/** Menor que isto e o Rollup gruda o pedaço no vizinho em vez de criar arquivo. */
export const PISO_DE_TAMANHO = 20_000;

/**
 * A base UI UX Pro Max na tela (frente UXM) só chega por import dinâmico
 * (src/lib/uiux/carregar.ts), quando a pessoa abre um painel da base. Solta,
 * o piso de tamanho a usava como destino e grudava nela módulos que muitas
 * telas usam (contexto do cliente, kit da marca): 67 pedaços passaram a
 * importar o índice de forma fixa e a pré-carga ociosa baixava a base
 * (medido no build de 2026-09-30). Com nome próprio, o pedaço fica só com a
 * base e ninguém gruda nele. Os três arquivos não importam nada de valor, então
 * nenhum vizinho vem junto.
 *
 * O código leve da base (mapeamentos, consultas, checklist, sem dado) continua
 * solto de propósito: com nome próprio (medido no mesmo dia) o piso mandou um
 * fragmento vizinho para a abertura e ela cresceu mais do que solto.
 */
const BASE_DE_DESIGN_NA_TELA: Array<[RegExp, string]> = [
  [/[\\/]src[\\/]lib[\\/]uiux[\\/]dados[\\/]indice-leve\.ts$/, "base-uiux"],
  [/[\\/]_shared[\\/]uiux[\\/]pt\.ts$/, "base-uiux-pt"],
  [/[\\/]_shared[\\/]uiux[\\/]dados[\\/]ux\.ts$/, "base-uiux-regras"],
];

export function chunkPara(id: string): string | undefined {
  for (const [casa, nome] of BASE_DE_DESIGN_NA_TELA) if (casa.test(id)) return nome;
  if (!id.includes("node_modules")) return undefined;

  // O React precisa ficar inteiro em um único pedaço: dividido, duas cópias do
  // mesmo módulo passam a existir e os hooks quebram.
  //
  // A barra no fim de cada nome não é enfeite. Sem ela, "react" também casava
  // react-hook-form e react-day-picker, que são de telas específicas e vinham
  // parar na abertura — 64 KB comprimidos carregados por engano.
  if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) {
    return "react";
  }
  if (/[\\/]node_modules[\\/](@tanstack|@supabase)[\\/]/.test(id)) return "dados";
  // A causa dos 116 arquivinhos: um chunk por ícone usado.
  if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return "icones";
  // O React Flow do Canvas da Mesa Foto NÃO é agrupado à mão, de propósito:
  // um pedaço nomeado puxa junto as partes do d3 que os gráficos também usam
  // (cor, interpolação, tempo), e as telas com gráfico passaram a baixar o
  // quadro inteiro (medido no build de 2026-09-24). Solto, ele fica no
  // pedaço da aba Canvas, que só baixa quando a aba abre.

  return undefined;
}
