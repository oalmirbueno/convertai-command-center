/**
 * Módulos do painel que não fazem nada só por serem importados (19/11/2026,
 * dono: "o painel está bem lento").
 *
 * O Rollup só joga fora um módulo importado e não usado quando sabe que ele
 * não tem efeito colateral. Ele não sabe isso de quase nenhum arquivo nosso:
 * qualquer chamada no topo do arquivo (forwardRef, createContext, cva, new Map,
 * `X.displayName = ...`) conta como efeito. Resultado, medido no build de
 * 19/11: o índice `@/components/sistema` arrastava para o PRIMEIRO arquivo do
 * painel, em toda abertura e até no /login, o quadro kanban com o @dnd-kit
 * (cerca de 40 KB), o seletor da Mesa com o Radix Select e, por um hook que só
 * usa uma data, a Central inteira (esteira, ritual, revisão).
 *
 * O que está aqui diz ao Rollup: o arquivo só vale pelo que exporta. Usado, ele
 * entra inteiro como antes (inclusive o que roda no topo dele); não usado, sai.
 * Fora da regra, de propósito:
 *  - o que roda só por ser importado: `src/main.tsx`, `src/polyfills.ts`, CSS;
 *  - workers (`*.worker.ts`), que são a entrada do próprio pedaço;
 *  - pedidos com `?` (`?url`, `?worker`, `?raw`), que o Vite trata à parte;
 *  - node_modules, exceto o @dnd-kit, que não declara `sideEffects` no
 *    package.json mas não faz nada ao ser importado.
 *
 * Nenhum arquivo do src depende de import só pelo efeito (o teste
 * src/test/build-sem-efeito-colateral.test.ts confere): só `./polyfills`.
 */

const NOSSO = /[\\/](src|supabase[\\/]functions)[\\/].+\.(ts|tsx)$/;
const COM_EFEITO = /[\\/]src[\\/](main\.tsx|polyfills\.ts)$|\.worker\.ts$|\.d\.ts$/;
const BIBLIOTECAS_SEM_EFEITO = /[\\/]node_modules[\\/]@dnd-kit[\\/]/;

/** O módulo pode sair do build quando nada do que ele exporta é usado? */
export function semEfeitoColateral(id: string): boolean {
  if (!id || id.indexOf("?") >= 0 || id.charCodeAt(0) === 0) return false;
  if (BIBLIOTECAS_SEM_EFEITO.test(id)) return true;
  if (/[\\/]node_modules[\\/]/.test(id)) return false;
  return NOSSO.test(id) && !COM_EFEITO.test(id);
}

/** Plugin do build: marca os módulos acima como sem efeito colateral. */
export function pluginSemEfeitoColateral() {
  return {
    name: "aceleriq-sem-efeito-colateral",
    apply: "build" as const,
    enforce: "post" as const,
    transform(_codigo: string, id: string) {
      return semEfeitoColateral(id) ? { moduleSideEffects: false } : null;
    },
  };
}
