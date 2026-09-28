import { createElement as h, Profiler } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Link direto para uma etapa da Mesa Ads (frente AD4, 28/09):
 * `/mesa-ads?client=X&etapa=plano` (e oferta, referencias, estudio, conta,
 * resultados) tem de montar a etapa e PARAR de renderizar.
 *
 * A causa achada no harness: a contagem de avisos não lidos do sino
 * (useContagemDeNaoLidas) voltava NaN quando o Content-Range vinha sem o
 * total; NaN !== NaN, então o resultado da consulta nunca era igual ao
 * anterior e o painel re-renderizava cerca de 4 mil vezes por segundo. A
 * mesa ficava no esqueleto ou pesada. Aqui o sino roda junto com a mesa e a
 * contagem vem NaN de propósito: o número de commits do React tem de parar.
 *
 * O laço em si só aparece no navegador (harness da AD4: 20.044 commits em
 * 5 s na etapa plano sem a correção, 0 com ela); no jsdom o React não entra
 * no mesmo ciclo. Por isso o contrato que trava a volta do defeito é o da
 * contagem: nunca NaN.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), tabelas: {} as Record<string, unknown> }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    let soContagem = false;
    const b: any = {};
    for (const m of ["eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert", "gte", "lte", "lt", "gt", "filter", "match"]) b[m] = () => b;
    b.select = (_c?: string, o?: { head?: boolean }) => {
      if (o && o.head) soContagem = true;
      return b;
    };
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    // Contagem sem o total no Content-Range: o supabase-js devolve NaN.
    b.then = (ok: any, erro: any) => Promise.resolve(soContagem ? { data: null, error: null, count: NaN } : { data: dados, error: null, count: Array.isArray(dados) ? dados.length : 0 }).then(ok, erro);
    return b;
  };
  const canal: any = { on: () => canal, subscribe: () => canal, unsubscribe: () => Promise.resolve() };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: mock.rpc,
      from: (tabela: string) => consulta(tabela),
      channel: () => canal,
      removeChannel: () => Promise.resolve(),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

const CLIENTE = "11111111-1111-1111-1111-111111111111";
vi.mock("@/hooks/useSupabaseData", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    useClients: () => ({
      data: [{ id: "11111111-1111-1111-1111-111111111111", company_name: "Clínica Sintética" }],
      isLoading: false,
      isSuccess: true,
      isFetching: false,
      dataUpdatedAt: 1,
      refetch: vi.fn(),
    }),
  };
});

import { TooltipProvider } from "@/components/ui/tooltip";
import NotificationsPanel from "@/components/NotificationsPanel";
import MesaAds, { ETAPAS_DA_MESA_ADS } from "@/pages/MesaAds";
import { useContagemDeNaoLidas } from "@/hooks/useAvisos";

beforeAll(() => {
  if (typeof (globalThis as any).ResizeObserver === "undefined") {
    (globalThis as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = {};
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  mock.rpc.mockResolvedValue({ data: null, error: null });
  mock.invoke.mockImplementation(async () => ({ data: { ok: true, custo_usd: 0 }, error: null }));
});

const esperar = (ms: number) => act(() => new Promise((ok) => setTimeout(ok, ms)));

describe("contagem de avisos não lidos (causa do laço)", () => {
  it("Content-Range sem o total (count NaN) vira 0, nunca NaN", async () => {
    const lidos: unknown[] = [];
    function Sino() {
      const q = useContagemDeNaoLidas();
      lidos.push(q.data);
      return null;
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(h(QueryClientProvider, { client: qc }, h(Sino)));
    await waitFor(() => expect(lidos[lidos.length - 1]).toBe(0));
    expect(lidos.some((v) => typeof v === "number" && isNaN(v))).toBe(false);
  });
});

describe("link direto para cada etapa da Mesa Ads", () => {
  for (const { valor, rotulo } of ETAPAS_DA_MESA_ADS) {
    it(`/mesa-ads?client=X&etapa=${valor} monta a etapa e para de renderizar (sino com contagem NaN junto)`, { timeout: 30000 }, async () => {
      let commits = 0;
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        h(
          Profiler,
          { id: "painel", onRender: () => { commits += 1; } },
          h(
            QueryClientProvider,
            { client: qc },
            h(
              MemoryRouter,
              { initialEntries: [`/mesa-ads?client=${CLIENTE}&etapa=${valor}`] },
              h(TooltipProvider, null, h(NotificationsPanel, { open: false, onOpenChange: () => undefined }), h(MesaAds)),
            ),
          ),
        ),
      );
      const nav = await screen.findByRole("navigation", { name: "Etapas da Mesa Ads" });
      const atual = within(nav).getAllByRole("button").find((b) => b.getAttribute("aria-current") === "page");
      expect(atual && atual.textContent).toContain(rotulo);
      // A etapa sai do esqueleto ("Abrindo a etapa").
      await waitFor(() => expect(screen.queryByLabelText("Abrindo a etapa")).toBeNull(), { timeout: 20000 });
      await esperar(600);
      const antes = commits;
      await esperar(800);
      // Tela parada: nenhum commit novo (antes eram milhares por segundo).
      expect(commits - antes).toBeLessThanOrEqual(2);
    });
  }
});
