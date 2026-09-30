import { createElement as h } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * O sino com o canal em tempo real de pé lê o banco a cada 5 min, não a
 * cada 30 s (EX-07, 30/09). Canal caído ou nunca conectado: 30 s, como
 * antes. Ao cair, relê na hora; ao voltar, traz o que chegou no meio tempo.
 * Apagar aviso (limpeza dos alertas resolvidos) também relê na hora.
 */

const estado = vi.hoisted(() => ({
  leituras: 0,
  contagens: 0,
  aoStatus: null as null | ((s: string) => void),
  escutas: [] as Array<{ filtro: Record<string, unknown>; f: () => void }>,
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" }, profile: { role: "admin" } }) }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (contagem: boolean) => {
    const b: any = {};
    ["eq", "order", "limit"].forEach((m) => (b[m] = () => b));
    b.then = (ok: any, erro: any) => {
      if (contagem) estado.contagens += 1;
      else estado.leituras += 1;
      return Promise.resolve(contagem ? { count: 2, error: null, data: null } : { data: [], error: null }).then(ok, erro);
    };
    return b;
  };
  const canal: any = {
    on: (_tipo: string, filtro: Record<string, unknown>, f: () => void) => {
      estado.escutas.push({ filtro, f });
      return canal;
    },
    subscribe: (cb: (s: string) => void) => {
      estado.aoStatus = cb;
      return canal;
    },
  };
  return {
    supabase: {
      from: () => ({ select: (_c: string, op?: { head?: boolean }) => consulta(!!(op && op.head)) }),
      channel: () => canal,
      removeChannel: vi.fn(),
    },
  };
});

import { useAvisosEmTempoReal, useContagemDeNaoLidas } from "@/hooks/useAvisos";
import { useNotifications } from "@/hooks/useSupabaseData";
import { intervaloDosAvisos } from "@/lib/avisos/canalDosAvisos";

function Sino() {
  useAvisosEmTempoReal();
  useNotifications();
  useContagemDeNaoLidas();
  return null;
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  estado.leituras = 0;
  estado.contagens = 0;
  estado.aoStatus = null;
  estado.escutas = [];
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  render(h(QueryClientProvider, { client: qc }, h(Sino)));
}

describe("sino: intervalo segue o canal", () => {
  it("sem o canal: 30 s, como antes", async () => {
    montar();
    await passar(100);
    expect(estado.leituras).toBe(1);
    expect(estado.contagens).toBe(1);
    await passar(10 * 60_000);
    // eslint-disable-next-line no-console
    console.log(`[EX-07] 10 min sem canal: lista=${estado.leituras} contagem=${estado.contagens}`);
    expect(estado.leituras).toBe(21);
    expect(estado.contagens).toBe(21);
  });

  it("com o canal de pé: 5 min; ao cair, relê na hora e volta a 30 s", async () => {
    montar();
    await passar(100);
    act(() => estado.aoStatus && estado.aoStatus("SUBSCRIBED"));
    expect(intervaloDosAvisos()).toBe(5 * 60_000);
    await passar(10 * 60_000);
    // eslint-disable-next-line no-console
    console.log(`[EX-07] 10 min com canal: lista=${estado.leituras} contagem=${estado.contagens}`);
    // A 1ª leitura, a que já estava marcada para 30 s e depois uma a cada 5 min.
    expect(estado.leituras).toBeLessThanOrEqual(4);
    expect(estado.contagens).toBeLessThanOrEqual(4);
    const antes = estado.leituras;
    act(() => estado.aoStatus && estado.aoStatus("CHANNEL_ERROR"));
    expect(intervaloDosAvisos()).toBe(30_000);
    await passar(600);
    expect(estado.leituras).toBe(antes + 1);
    await passar(60_000);
    expect(estado.leituras).toBe(antes + 3);
  });

  it("ao reconectar, relê o que chegou enquanto o canal estava fora", async () => {
    montar();
    await passar(100);
    act(() => estado.aoStatus && estado.aoStatus("SUBSCRIBED"));
    await passar(1_000);
    const antes = estado.leituras;
    act(() => estado.aoStatus && estado.aoStatus("SUBSCRIBED"));
    await passar(600);
    expect(estado.leituras).toBe(antes + 1);
  });

  it("escuta os avisos da pessoa e também o apagar (sem filtro, que o filtro não recebe)", async () => {
    montar();
    await passar(100);
    const filtros = estado.escutas.map((e) => e.filtro);
    expect(filtros).toContainEqual({ event: "*", schema: "public", table: "notifications", filter: "user_id=eq.u-1" });
    expect(filtros).toContainEqual({ event: "DELETE", schema: "public", table: "notifications" });
    const antes = estado.leituras;
    const apagar = estado.escutas.find((e) => e.filtro.event === "DELETE");
    act(() => apagar && apagar.f());
    await passar(600);
    expect(estado.leituras).toBe(antes + 1);
  });
});
