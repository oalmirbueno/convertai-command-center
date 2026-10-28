import { act, fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  (globalThis as { __APP_BUILD_ID__?: string }).__APP_BUILD_ID__ = "versao-aberta";
});

import { AtualizacaoDosMembros } from "@/pages/AreaDeMembros";
import { startVersionWatch, updateReload, versaoNovaPendente } from "@/lib/appRefresh";

const ATUALIZACOES = "aceleriq-update-reloads";

beforeEach(() => {
  sessionStorage.clear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ buildId: "versao-publicada" }), { status: 200 })));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
  window.history.replaceState(null, "", "/");
});

describe("atualização da área de membros", () => {
  it("avisa sem recarregar ao abrir ou voltar à aba, preserva o rascunho e pede confirmação", async () => {
    window.history.replaceState(null, "", "/membros?secao=estudio");
    let agora = 100_000;
    vi.spyOn(Date, "now").mockImplementation(() => agora);
    let visibilidade: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibilidade);
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<><input aria-label="Rascunho" defaultValue="Texto em andamento" /><AtualizacaoDosMembros /></>);

    let parar: () => void = () => undefined;
    await act(async () => { parar = startVersionWatch(); });
    await waitFor(() => expect(versaoNovaPendente()).toBe(true));
    const botao = await screen.findByRole("button", { name: /nova versão disponível/i });
    expect(sessionStorage.getItem(ATUALIZACOES)).toBeNull();

    visibilidade = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    agora += 31 * 60_000;
    visibilidade = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(sessionStorage.getItem(ATUALIZACOES)).toBeNull();
    expect(screen.getByLabelText("Rascunho")).toHaveValue("Texto em andamento");

    fireEvent.click(botao);
    expect(confirmar).toHaveBeenCalledWith(expect.stringMatching(/salve suas alterações/i));
    expect(sessionStorage.getItem(ATUALIZACOES)).toBeNull();
    expect(screen.getByLabelText("Rascunho")).toHaveValue("Texto em andamento");

    confirmar.mockReturnValue(true);
    fireEvent.click(botao);
    expect(JSON.parse(sessionStorage.getItem(ATUALIZACOES) || "[]")).toHaveLength(1);
    parar();
  });

  it("mantém a recarga automática de abertura em outras rotas", async () => {
    window.history.replaceState(null, "", "/dashboard");
    const parar = startVersionWatch();
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem(ATUALIZACOES) || "[]")).toHaveLength(1));
    parar();
  });

  it("cancela uma recarga automática atrasada se a pessoa abrir a área de membros", async () => {
    window.history.replaceState(null, "", "/dashboard");
    let liberarCache: (() => void) | undefined;
    const unregister = vi.fn(() => new Promise<void>((resolve) => { liberarCache = resolve; }));
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistrations: vi.fn(async () => [{ unregister }]) } });
    expect(updateReload(() => !/^\/membros\/?$/.test(window.location.pathname))).toBe(true);
    await waitFor(() => expect(liberarCache).toBeDefined());
    window.history.replaceState(null, "", "/membros");
    await act(async () => { liberarCache?.(); });
    expect(window.location.pathname).toBe("/membros");
  });
});
