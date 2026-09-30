import "@testing-library/jest-dom";
import { configure } from "@testing-library/dom";
import { afterEach } from "vitest";

// Prazo das esperas (findBy*, waitFor): 1 s era pouco para as telas grandes com
// abas lazy sob carga (4 falhas intermitentes na semana, todas em espera). O
// teste que passa não fica mais lento; só o que falharia ganha fôlego. Fica no
// nível de cima: o setup roda antes de cada arquivo de teste, e os arquivos que
// chamam configure({ asyncUtilTimeout: 8000 }) continuam com 8000.
// Importado de @testing-library/dom (o mesmo que o RTL usa por baixo) para não
// mudar a ordem dos afterEach (o cleanup do RTL segue antes da limpeza abaixo).
configure({ asyncUtilTimeout: 5000 });

// AG2 (29/09): o CartaoDeAcao lembra o último estado de cada proposta nesta aba (não volta a "Confirmar"
// depois de feito). Entre um teste e outro, a lembrança some (ids repetidos nos testes).
afterEach(() => {
  (globalThis as { __estadosDosCartoesDeAcao?: Map<string, unknown> }).__estadosDosCartoesDeAcao?.clear();
});

if (typeof window !== "undefined") {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => {},
    }),
  });
}
