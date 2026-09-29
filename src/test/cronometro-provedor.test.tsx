import { createElement as h, useEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cronômetro por cliente (frente CR): o provedor descobre o cliente pelo
 * endereço ou pelo aviso da tela (useClienteEmFoco), o topo mostra o cliente e
 * o tempo do mês, e rota sem trabalho de cliente não conta.
 */

const CLIENTE = "11111111-2222-4333-8444-555555555555";
const OUTRO = "66666666-7777-4888-8999-000000000000";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(),
  papel: "admin",
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mock.rpc,
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "pessoa-1" }, profile: { id: "pessoa-1", role: mock.papel } }),
}));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({ data: [{ id: CLIENTE, company_name: "Mirante" }, { id: OUTRO, company_name: "Softy" }] }),
}));

import { CronometroProvider, useClienteEmFoco, useCronometro } from "@/components/cronometro/CronometroProvider";
import CronometroDoTopo from "@/components/cronometro/CronometroDoTopo";

function Estado() {
  const e = useCronometro();
  return h("output", { "data-testid": "estado" }, `${e.cliente || "-"}|${e.area || "-"}|${e.contando ? "contando" : e.motivo}`);
}

function TelaQueAvisa({ cliente }: { cliente: string | null }) {
  useClienteEmFoco(cliente);
  return null;
}

let navegar: (para: string) => void = () => undefined;
function Navegador() {
  const n = useNavigate();
  useEffect(() => {
    navegar = (para) => n(para);
  }, [n]);
  return null;
}

function montar(rota: string, filhos: unknown[] = []) {
  return render(
    h(
      MemoryRouter,
      { initialEntries: [rota] },
      h(CronometroProvider, null, h(Navegador), h(Estado), h(CronometroDoTopo, { podeAbrirCentral: true }), ...(filhos as never[])),
    ),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  localStorage.clear();
  mock.papel = "admin";
  mock.rpc.mockReset();
  mock.rpc.mockImplementation(async (nome: string) => {
    if (nome === "tempo_de_trabalho_total") return { data: 3600, error: null };
    return { data: { ok: true, gravado: true }, error: null };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const estado = () => screen.getByTestId("estado").textContent;

describe("provedor do cronômetro", () => {
  it("conta pelo ?client= da mesa e mostra no topo o cliente e o total do mês", async () => {
    montar(`/mesa?client=${CLIENTE}`);
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(estado()).toBe(`${CLIENTE}|mesa|contando`);
    const topo = document.querySelector("[data-cronometro-do-topo]") as HTMLElement;
    expect(topo.textContent).toContain("Mirante");
    // Base do banco (1 h) + os segundos desta aba.
    expect(topo.textContent).toMatch(/1:00:0\d/);
    expect(topo.getAttribute("href")).toBe("/horas");
    expect(mock.rpc).toHaveBeenCalledWith("tempo_de_trabalho_total", expect.objectContaining({ _client_id: CLIENTE }));
  });

  it("a tela que escolhe o cliente sem endereço avisa, e o aviso vence o endereço", async () => {
    montar("/central", [h(TelaQueAvisa, { key: "t", cliente: OUTRO })]);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(estado()).toBe(`${OUTRO}|central|contando`);
  });

  it("Dashboard, Financeiro e a própria central de horas não contam, mesmo com cliente no endereço", async () => {
    montar(`/dashboard?client=${CLIENTE}`);
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(estado()).toBe(`${CLIENTE}|-|fora-de-area`);
    // Sem cliente em foco, o topo vira só o atalho da central.
    expect(document.querySelector('[data-cronometro-do-topo="sem-cliente"]')).toBeTruthy();
    await act(async () => {
      navegar(`/financeiro?client=${CLIENTE}`);
      vi.advanceTimersByTime(2000);
    });
    expect(estado()).toContain("fora-de-area");
  });

  it("trocar de rota para outro cliente passa a contar o outro", async () => {
    montar(`/mesa?client=${CLIENTE}`);
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    await act(async () => {
      navegar(`/mesa-foto?client=${OUTRO}`);
      vi.advanceTimersByTime(3000);
    });
    expect(estado()).toBe(`${OUTRO}|mesa-foto|contando`);
  });

  it("cliente (papel) não tem cronômetro", async () => {
    mock.papel = "client";
    montar(`/mesa?client=${CLIENTE}`);
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(estado()).toBe("-|-|desligado");
    expect(document.querySelector("[data-cronometro-do-topo]")).toBeNull();
  });
});
