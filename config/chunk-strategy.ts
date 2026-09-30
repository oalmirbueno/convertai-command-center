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
 *
 * 3. Piso alto demais cola o que não tem relação (medido em 30/09/2026). Com
 *    20 KB o Rollup juntava páginas de rotas diferentes no mesmo arquivo: o
 *    /login baixava junto o primeiro acesso, o contrato e a votação de nomes,
 *    e quase toda tela baixava as páginas de relatórios e de perfil. Das
 *    páginas baixadas, 44% não eram usadas pela tela aberta. Com 10 KB o
 *    desperdício caiu para 22%, todas as 66 rotas ficaram menores (3 a 92 KB
 *    comprimidos a menos), a abertura subiu só 7 KB e o total de arquivos foi
 *    de 225 para 285, sem voltar aos 116 arquivinhos da lição 1.
 */

/**
 * Menor que isto e o Rollup gruda o pedaço no vizinho em vez de criar arquivo.
 * O teste em src/test/build-chunks.test.ts prende o valor entre 10 e 12 KB:
 * abaixo disso voltam os arquivinhos; acima, as páginas coladas.
 */
export const PISO_DE_TAMANHO = 10_000;

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
  // O ajudante de CommonJS do Rollup (o módulo virtual \0commonjsHelpers.js) é
  // usado pelo React. Sem esta linha, o cmdk (via use-sync-external-store) o
  // arrasta para o pedaço "base", o React passa a importar do "base" e o
  // "base" do React: um ciclo entre dois pedaços da abertura, e o painel não
  // abre (variável usada antes de existir). Vem antes do teste de
  // node_modules porque o id do módulo virtual não tem esse caminho.
  if (id.includes("commonjsHelpers")) return "react";
  for (const [casa, nome] of BASE_DE_DESIGN_NA_TELA) if (casa.test(id)) return nome;
  if (!id.includes("node_modules")) return undefined;

  // O React precisa ficar inteiro em um único pedaço: dividido, duas cópias do
  // mesmo módulo passam a existir e os hooks quebram.
  //
  // A barra no fim de cada nome não é enfeite. Sem ela, "react" também casava
  // react-hook-form e react-day-picker, que são de telas específicas e vinham
  // parar na abertura — 64 KB comprimidos carregados por engano.
  //
  // O renderizador de servidor (renderToStaticMarkup) só é usado pela Mesa
  // Identidade ao exportar, via import() dinâmico. Sem esta linha, a regra
  // abaixo o arrasta para a abertura: cerca de 20 KB comprimidos a mais para
  // todo mundo, em toda abertura.
  if (/[\\/]node_modules[\\/]react-dom[\\/](server|cjs[\\/]react-dom-server)/.test(id)) return undefined;
  if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) {
    return "react";
  }
  if (/[\\/]node_modules[\\/](@tanstack|@supabase)[\\/]/.test(id)) return "dados";
  // A causa dos 116 arquivinhos: um chunk por ícone usado.
  if (/[\\/]node_modules[\\/]lucide-react[\\/]/.test(id)) return "icones";
  // A casca do painel: janelas, menus, dicas, avisos, busca de comandos e a
  // junção de classes. Soltas, elas iam no pedaço principal, que troca de nome
  // a cada publicação porque carrega o mapa das rotas, e todo mundo baixava de
  // novo cerca de 54 KB comprimidos de biblioteca que não mudou. Num pedaço
  // próprio, o nome só muda quando a biblioteca muda.
  //
  // SÓ o que a casca já usa. Radix de uso só em tela (select, tabs,
  // accordion) fica fora, senão vira dependência fixa da abertura (lição 2).
  if (
    /[\\/]node_modules[\\/]@radix-ui[\\/]react-(dialog|popover|tooltip|dropdown-menu|menu|popper|presence|dismissable-layer|focus-scope|portal|slot|avatar|alert-dialog)[\\/]/.test(id) ||
    /[\\/]node_modules[\\/](@floating-ui[\\/][^\\/]+|sonner|tailwind-merge|cmdk|class-variance-authority|clsx|react-remove-scroll|aria-hidden)[\\/]/.test(id)
  ) {
    return "base";
  }
  // O React Flow do Canvas da Mesa Foto NÃO é agrupado à mão, de propósito:
  // um pedaço nomeado puxa junto as partes do d3 que os gráficos também usam
  // (cor, interpolação, tempo), e as telas com gráfico passaram a baixar o
  // quadro inteiro (medido no build de 2026-09-24). Solto, ele fica no
  // pedaço da aba Canvas, que só baixa quando a aba abre.

  return undefined;
}
