import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/**
 * Depois de uma publicação, o primeiro clique de quem está com o painel aberto
 * pede um pedaço que a hospedagem já apagou (PERF-B14, 30/09/2026). A recarga
 * continua a mesma; a tela enquanto ela sai passa a ser o aviso neutro, e com
 * a versão nova já conhecida a recarga é a de atualização (não gasta as
 * tentativas de emergência).
 */
describe("appRefresh: pedaço que sumiu depois de publicar", () => {
  const TENTATIVAS = "aceleriq-refresh-attempts";
  const ATUALIZACOES = "aceleriq-update-reloads";
  const lista = (chave: string): number[] => JSON.parse(sessionStorage.getItem(chave) || "[]");
  let desligar: (() => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    // O jsdom não navega de verdade e reclama no console quando a recarga sai.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    desligar?.();
    desligar = undefined;
    vi.unstubAllGlobals();
    delete (globalThis as { __APP_BUILD_ID__?: string }).__APP_BUILD_ID__;
  });

  const falharPreCarga = () => {
    const evento = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(evento);
    return evento;
  };

  it("marca que está atualizando e faz a recarga de emergência de sempre", async () => {
    const mod = await import("./appRefresh");
    desligar = mod.installChunkErrorRecovery();
    expect(mod.atualizandoPorVersao()).toBe(false);

    const evento = falharPreCarga();

    expect(evento.defaultPrevented).toBe(true);
    expect(mod.atualizandoPorVersao()).toBe(true);
    expect(lista(TENTATIVAS)).toHaveLength(1);
    expect(lista(ATUALIZACOES)).toHaveLength(0);
  });

  it("com a versão nova já conhecida pelo vigia, usa a recarga de atualização", async () => {
    (globalThis as { __APP_BUILD_ID__?: string }).__APP_BUILD_ID__ = "versao-aberta";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ buildId: "versao-nova" }), { status: 200 })),
    );
    const mod = await import("./appRefresh");
    desligar = mod.installChunkErrorRecovery();
    mod.startVersionWatch();
    // O vigia confere ao abrir e já pede a recarga de atualização uma vez.
    await vi.waitFor(() => expect(lista(ATUALIZACOES)).toHaveLength(1));

    falharPreCarga();

    expect(mod.atualizandoPorVersao()).toBe(true);
    expect(lista(ATUALIZACOES)).toHaveLength(2);
    expect(lista(TENTATIVAS)).toHaveLength(0);
  });

  it("sem tentativas sobrando a recarga não sai e a tela de erro manual volta", async () => {
    const agora = Date.now();
    sessionStorage.setItem(TENTATIVAS, JSON.stringify([agora - 1_000, agora - 500]));
    const mod = await import("./appRefresh");
    desligar = mod.installChunkErrorRecovery();

    falharPreCarga();

    expect(mod.atualizandoPorVersao()).toBe(false);
    expect(lista(TENTATIVAS)).toHaveLength(2);
  });
});
