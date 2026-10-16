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
    const recuperacao = mod.installChunkErrorRecovery();
    const pararVigia = mod.startVersionWatch();
    desligar = () => {
      recuperacao();
      pararVigia();
    };
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

describe("appRefresh: versão nova sem recarregar no meio do uso (16/10)", () => {
  const TENTATIVAS = "aceleriq-refresh-attempts";
  const ATUALIZACOES = "aceleriq-update-reloads";
  const lista = (chave: string): number[] => JSON.parse(sessionStorage.getItem(chave) || "[]");
  let desligar: (() => void) | undefined;
  let pararVigia: (() => void) | undefined;
  let visibilidade: DocumentVisibilityState = "visible";

  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
    visibilidade = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibilidade });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    (globalThis as { __APP_BUILD_ID__?: string }).__APP_BUILD_ID__ = "versao-aberta";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    desligar?.();
    desligar = undefined;
    pararVigia?.();
    pararVigia = undefined;
    vi.unstubAllGlobals();
    delete (globalThis as { __APP_BUILD_ID__?: string }).__APP_BUILD_ID__;
    delete (document as { visibilityState?: unknown }).visibilityState;
  });

  /** O servidor responde a versão aberta na primeira conferência e a nova daí em diante. */
  function publicarDepoisDaAbertura() {
    let vezes = 0;
    const buscar = vi.fn(async () => {
      vezes += 1;
      const buildId = vezes === 1 ? "versao-aberta" : "versao-nova";
      return new Response(JSON.stringify({ buildId }), { status: 200 });
    });
    vi.stubGlobal("fetch", buscar);
    return buscar;
  }

  const trocarVisibilidade = (estado: DocumentVisibilityState) => {
    visibilidade = estado;
    document.dispatchEvent(new Event("visibilitychange"));
  };

  it("versão nova no meio do uso só acende o aviso; a recarga sai no clique", async () => {
    const buscar = publicarDepoisDaAbertura();
    const mod = await import("./appRefresh");
    const avisado = vi.fn();
    mod.assinarVersaoNova(avisado);
    pararVigia = mod.startVersionWatch();
    await vi.waitFor(() => expect(buscar).toHaveBeenCalledTimes(1));

    // Volta rápida para a aba: confere, descobre a versão nova e NÃO recarrega.
    trocarVisibilidade("hidden");
    trocarVisibilidade("visible");
    await vi.waitFor(() => expect(mod.versaoNovaPendente()).toBe(true));
    expect(avisado).toHaveBeenCalledTimes(1);
    expect(lista(ATUALIZACOES)).toHaveLength(0);
    expect(lista(TENTATIVAS)).toHaveLength(0);

    expect(mod.atualizarAgora()).toBe(true);
    expect(lista(ATUALIZACOES)).toHaveLength(1);
  });

  it("aba escondida por mais de 30 minutos com versão nova recarrega na volta", async () => {
    const buscar = publicarDepoisDaAbertura();
    const mod = await import("./appRefresh");
    pararVigia = mod.startVersionWatch();
    await vi.waitFor(() => expect(buscar).toHaveBeenCalledTimes(1));

    const inicio = Date.now();
    const agora = vi.spyOn(Date, "now").mockReturnValue(inicio);
    trocarVisibilidade("hidden");
    agora.mockReturnValue(inicio + 31 * 60_000);
    trocarVisibilidade("visible");

    await vi.waitFor(() => expect(buscar).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(lista(ATUALIZACOES)).toHaveLength(1));
    expect(mod.versaoNovaPendente()).toBe(true);
  });

  it("a pré-carga chama todas as funções de import e ignora as que falham, sem recarregar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ buildId: "versao-nova" }), { status: 200 })));
    const mod = await import("./appRefresh");
    desligar = mod.installChunkErrorRecovery();

    let evento: Event | null = null;
    const carregadores = [
      vi.fn(async () => ({ default: "a" })),
      vi.fn(async () => {
        // O que o Vite faz quando o pedaço sumiu: avisa e rejeita.
        evento = new Event("vite:preloadError", { cancelable: true });
        window.dispatchEvent(evento);
        throw new TypeError("Failed to fetch dynamically imported module: /assets/x.js");
      }),
      vi.fn(async () => ({ default: "c" })),
      vi.fn(() => {
        throw new Error("falha síncrona");
      }),
      vi.fn(async () => ({ default: "e" })),
    ];

    const falhas = await mod.preCarregarEmSegundoPlano(carregadores, 2);

    expect(falhas).toBe(2);
    for (const carregar of carregadores) expect(carregar).toHaveBeenCalledTimes(1);
    expect(evento!.defaultPrevented).toBe(false);
    expect(mod.atualizandoPorVersao()).toBe(false);
    expect(lista(TENTATIVAS)).toHaveLength(0);
    expect(lista(ATUALIZACOES)).toHaveLength(0);
    // A falha vira pista de versão nova: o ícone do topo acende.
    await vi.waitFor(() => expect(mod.versaoNovaPendente()).toBe(true));
  });

  it("fora da pré-carga, pedaço sumido continua com a recuperação de sempre", async () => {
    const mod = await import("./appRefresh");
    desligar = mod.installChunkErrorRecovery();
    await mod.preCarregarEmSegundoPlano([async () => undefined]);

    const evento = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(evento);

    expect(evento.defaultPrevented).toBe(true);
    expect(mod.atualizandoPorVersao()).toBe(true);
    expect(lista(TENTATIVAS)).toHaveLength(1);
  });

  it("agenda a pré-carga para o ócio (setTimeout sem requestIdleCallback) e pode ser cancelada", async () => {
    vi.useFakeTimers();
    const mod = await import("./appRefresh");
    expect((window as { requestIdleCallback?: unknown }).requestIdleCallback).toBeUndefined();

    const carregar = vi.fn(async () => undefined);
    mod.agendarPreCargaEmSegundoPlano(() => [carregar, carregar], 4_000);
    vi.advanceTimersByTime(3_999);
    expect(carregar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_300);
    expect(carregar).toHaveBeenCalledTimes(2);

    const outro = vi.fn(async () => undefined);
    const cancelar = mod.agendarPreCargaEmSegundoPlano(() => [outro], 4_000);
    vi.advanceTimersByTime(4_500);
    cancelar();
    vi.advanceTimersByTime(10_000);
    expect(outro).not.toHaveBeenCalled();
  });
});
