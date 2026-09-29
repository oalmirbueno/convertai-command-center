import "@testing-library/jest-dom";
import { afterEach } from "vitest";

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
