import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Início do cliente (portal), com o hook de dados real e o banco simulado por tabela.
 *
 * 1. "Pagamento em atraso": a comparação era `due_date` às 12h < agora, então a cobrança que vence HOJE virava
 *    atraso ao meio-dia. Atraso só depois do dia do vencimento.
 * 2. Etapas e entregas: o erro da consulta virava lista vazia ("Nenhuma pendência") numa falha de rede. Agora a
 *    tela avisa que não conseguiu conferir, com "Tentar de novo", sem derrubar o resto do painel.
 */

type Resposta = { data: unknown; error: unknown };

const estado = vi.hoisted(() => ({
  tabelas: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/notifyHelpers", () => ({ notifyAdmin: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "c1" } }) }));
vi.mock("@/hooks/useArquivosAoVivo", () => ({ useArquivosAoVivo: () => undefined }));
vi.mock("@/components/dia-prioritario/CartaoDoDiaPrioritario", () => ({ default: () => null }));
vi.mock("@/components/shared/ProjectJournal", () => ({ default: () => null }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const resposta = (): Resposta => estado.tabelas[tabela] ?? { data: [], error: null };
    const cadeia: Record<string, unknown> = {};
    for (const metodo of ["select", "eq", "is", "in", "order", "limit"]) cadeia[metodo] = () => cadeia;
    cadeia.maybeSingle = () => Promise.resolve(resposta());
    cadeia.then = (ok: (r: Resposta) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve(resposta()).then(ok, falha);
    return cadeia;
  };
  return { supabase: { from: consulta, functions: { invoke: () => Promise.resolve({ data: null, error: null }) } } };
});

import ClientJourneyDashboard from "@/components/client/ClientJourneyDashboard";

const PROJETO = { id: "p1", client_id: "c1", name: "Social", project_type: "social_media", status: "active", progress: 40, created_at: "2026-10-01T12:00:00Z" };

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ClientJourneyDashboard clientId="c1" clientName="Marina Souza" onSelectProject={() => {}} isImpersonation />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const fusoOriginal = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/Sao_Paulo";
});
afterAll(() => {
  process.env.TZ = fusoOriginal;
});

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 });
  // 10/11/2026 às 15h em Brasília (18h UTC): já passou do meio-dia do dia do vencimento.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T18:00:00Z"));
  estado.tabelas = {
    projects: { data: [PROJETO], error: null },
    profiles: { data: { id: "c1", plan_status: "active", services_config: { social: true } }, error: null },
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Início do cliente: atraso no dia certo", () => {
  it("cobrança que vence hoje fica fora do atraso à tarde; a de ontem entra", async () => {
    estado.tabelas.billing = {
      data: [
        { id: "b0", amount: 200, due_date: "2026-11-09", status: "pending" },
        { id: "b1", amount: 500, due_date: "2026-11-10", status: "pending" },
        { id: "b2", amount: 900, due_date: "2026-11-20", status: "pending" },
      ],
      error: null,
    };
    montar();
    const aviso = await screen.findByText(/Pagamento em atraso/);
    // Só os R$ 200 vencidos ontem (antes: R$ 700, somando a que vence hoje).
    expect(aviso.textContent?.replace(/\s/g, " ")).toBe("Pagamento em atraso: R$ 200,00");
  });

  it("só a cobrança de hoje: nenhum aviso de atraso", async () => {
    estado.tabelas.billing = { data: [{ id: "b1", amount: 500, due_date: "2026-11-10", status: "pending" }], error: null };
    montar();
    await screen.findByText(/Bem-vindo de volta/);
    await waitFor(() => expect(screen.getAllByText(/Aprovações pendentes/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Pagamento em atraso/)).toBeNull();
  });
});

describe("Início do cliente: erro em etapas e entregas não vira 'nada para aprovar'", () => {
  it("falha na consulta de arquivos: avisa com Tentar de novo e o painel continua de pé", async () => {
    estado.tabelas.files = { data: null, error: { message: "rede caiu" } };
    montar();
    expect(await screen.findByText("Não foi possível conferir as suas entregas e aprovações.")).toBeTruthy();
    expect(screen.getByText(/Bem-vindo de volta/)).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Tentar de novo" }).length).toBeGreaterThan(0);
  });

  it("falha na consulta de etapas também avisa", async () => {
    estado.tabelas.milestones = { data: null, error: { message: "rede caiu" } };
    montar();
    expect(await screen.findByText("Não foi possível conferir as suas entregas e aprovações.")).toBeTruthy();
  });

  it("consultas certas: sem aviso de erro", async () => {
    montar();
    await screen.findByText(/Bem-vindo de volta/);
    await waitFor(() => expect(screen.getAllByText(/Aprovações pendentes/).length).toBeGreaterThan(0));
    expect(screen.queryByText("Não foi possível conferir as suas entregas e aprovações.")).toBeNull();
  });
});
