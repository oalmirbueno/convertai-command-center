import { describe, expect, it } from "vitest";
import { isChunkError, isStrictChunkError } from "./appRefresh";

/**
 * Contrato da recuperação anti tela branca: os detectores globais só podem
 * reagir a erro de pedaço de versão antiga; o "Load failed" genérico do Safari
 * (qualquer fetch que falhou) só conta dentro do ErrorBoundary.
 */
describe("appRefresh: classificação de erros de versão antiga", () => {
  it("reconhece as mensagens de chunk morto de cada navegador (estrito)", () => {
    expect(isStrictChunkError(new Error("Failed to fetch dynamically imported module: https://x/a.js"))).toBe(true);
    expect(isStrictChunkError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isStrictChunkError(new Error("Importing a module script failed."))).toBe(true);
    expect(isStrictChunkError(new Error("Loading chunk 42 failed"))).toBe(true);
    expect(isStrictChunkError("ChunkLoadError: Loading chunk vendor failed")).toBe(true);
  });

  it("não trata falha de rede comum como chunk morto no detector global", () => {
    expect(isStrictChunkError(new Error("Load failed"))).toBe(false);
    expect(isStrictChunkError(new Error("NetworkError when attempting to fetch resource."))).toBe(false);
    expect(isStrictChunkError(new Error("Cannot read properties of undefined"))).toBe(false);
    expect(isStrictChunkError(null)).toBe(false);
    expect(isStrictChunkError(undefined)).toBe(false);
  });

  it("no ErrorBoundary (tela já quebrada) o Load failed do Safari conta", () => {
    expect(isChunkError(new Error("Load failed"))).toBe(true);
    expect(isChunkError(new Error("Importing a module script failed."))).toBe(true);
    expect(isChunkError(new Error("Cannot read properties of undefined"))).toBe(false);
  });
});
