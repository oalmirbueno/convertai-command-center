/**
 * O Voltar do topo só usa o cliente em foco do cronômetro; antes assinava o
 * instantâneo inteiro, que muda a cada segundo, e redesenhava junto com o
 * menu dele 3.600 vezes por hora (EX-11, 30/09).
 */
import { createElement as h, Profiler, useEffect } from "react";
import { act, render } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CLIENTE = "11111111-2222-4333-8444-555555555555";

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mock.rpc,
    auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "pessoa-1" }, profile: { id: "pessoa-1", role: "admin" } }),
}));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({ data: [{ id: CLIENTE, company_name: "Mirante" }] }),
}));

import { CronometroProvider } from "@/components/cronometro/CronometroProvider";
import CronometroDoTopo from "@/components/cronometro/CronometroDoTopo";
import VoltarParaOndeEstava from "@/components/navegacao/VoltarParaOndeEstava";

let navegar: (para: string) => void = () => undefined;
function Navegador() {
  const n = useNavigate();
  useEffect(() => {
    navegar = (para) => n(para);
  }, [n]);
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
  localStorage.clear();
  sessionStorage.clear();
  mock.rpc.mockReset();
  mock.rpc.mockImplementation(async (nome: string) => {
    if (nome === "tempo_de_trabalho_total") return { data: 3600, error: null };
    return { data: { ok: true, gravado: true }, error: null };
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Voltar do topo: não redesenha a cada segundo do cronômetro (EX-11)", () => {
  it("em 60 s contando, o Voltar não redesenha e continua com o nome do cliente", async () => {
    let rendersVoltar = 0;
    let rendersTopo = 0;
    render(
      h(
        MemoryRouter,
        { initialEntries: [`/mesa?client=${CLIENTE}`] },
        h(
          CronometroProvider,
          null,
          h(Navegador),
          h(Profiler, { id: "voltar", onRender: () => rendersVoltar++ }, h(VoltarParaOndeEstava)),
          h(Profiler, { id: "topo", onRender: () => rendersTopo++ }, h(CronometroDoTopo, { podeAbrirCentral: true })),
        ),
      ),
    );
    await act(async () => {
      navegar(`/mesa-foto?client=${CLIENTE}`);
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      navegar(`/arquivos?client=${CLIENTE}`);
      vi.advanceTimersByTime(3000);
    });
    const temVoltar = !!document.querySelector("[data-voltar-para-onde-estava]");
    const spy = vi.spyOn(Storage.prototype, "getItem");
    const v0 = rendersVoltar;
    const t0 = rendersTopo;
    for (let i = 0; i < 60; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    const lider = spy.mock.calls.filter((c) => String(c[0]).indexOf(":lider") >= 0).length;
    // eslint-disable-next-line no-console
    console.log(
      `EX11 temVoltar=${temVoltar} rendersVoltar/60s=${rendersVoltar - v0} rendersTopo/60s=${rendersTopo - t0} getItem(lider)/60s=${lider} topo=${(document.querySelector("[data-cronometro-do-topo]") as HTMLElement).textContent}`,
    );
    const botao = document.querySelector("[data-voltar-para-onde-estava] button") as HTMLElement;
    // eslint-disable-next-line no-console
    console.log(`EX11 rotulo=${botao.getAttribute("aria-label")}`);
    expect(temVoltar).toBe(true);
    expect(botao.getAttribute("aria-label")).toContain("Mirante");
    // Antes (30/09): 90 desenhos do Voltar em 60 s, um por batida do relógio.
    expect(rendersVoltar - v0).toBeLessThanOrEqual(2);
    // O relógio do topo continua andando a cada segundo.
    expect(rendersTopo - t0).toBeGreaterThanOrEqual(30);
  });
});
