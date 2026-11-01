import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pulso Aceleriq (avaliação do cliente no Início). Antes de gravar, a tela relê o `services_config` e acrescenta
 * a nota no `pulse_history`. O erro dessa leitura não era olhado: numa falha de rede `fresh` vinha null, o
 * `current` virava {} e o update gravava SÓ o pulso, apagando frentes, empresa interna, avulso concluído e o
 * vínculo com o lead. E ainda aparecia "Obrigado pela avaliação".
 */

const estado = vi.hoisted(() => ({
  leitura: { data: null as unknown, error: null as unknown },
  updates: [] as unknown[],
  sucesso: vi.fn(),
  erro: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: estado.sucesso, error: estado.erro, info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/notifyHelpers", () => ({ notifyAdmin: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta: Record<string, unknown> = {
    select: () => consulta,
    eq: () => consulta,
    maybeSingle: () => Promise.resolve(estado.leitura),
    update: (valor: unknown) => {
      estado.updates.push(valor);
      return { eq: () => Promise.resolve({ error: null }) };
    },
  };
  return { supabase: { from: () => consulta, functions: { invoke: () => Promise.resolve({ data: null, error: null }) } } };
});
vi.mock("@/components/client/dashboardHelpers", async () => {
  const real = await vi.importActual<Record<string, unknown>>("@/components/client/dashboardHelpers");
  return {
    ...real,
    useClientDashboardData: () => ({
      loadingProjects: false,
      errorProjects: false,
      refetchProjects: vi.fn(),
      data: {
        activeProjects: [],
        doneProjects: [],
        milestones: [],
        completedMilestonesCount: 0,
        totalMilestones: 0,
        pendingFiles: [],
        deliveredFiles: [],
        approvedFiles: 0,
        totalFiles: 0,
        contentPublications: [],
        latestReport: null,
        clientProfile: { plan_status: "active", services_config: { social: true } },
        clientPendingBilling: [],
        projects: [],
      },
    }),
  };
});
vi.mock("@/components/dia-prioritario/CartaoDoDiaPrioritario", () => ({ default: () => null }));
vi.mock("@/components/shared/ProjectJournal", () => ({ default: () => null }));

import ClientJourneyDashboard from "@/components/client/ClientJourneyDashboard";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ClientJourneyDashboard clientId="c1" clientName="Marina Souza" onSelectProject={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function avaliar() {
  fireEvent.click(screen.getByRole("radio", { name: "Nota 4" }));
  fireEvent.click(screen.getByRole("button", { name: "Enviar avaliação" }));
}

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: 1280 });
  estado.updates = [];
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("Pulso não apaga o cadastro do cliente", () => {
  it("leitura do cadastro falhou: não grava nada e avisa o erro", async () => {
    estado.leitura = { data: null, error: { message: "rede caiu" } };
    montar();
    avaliar();
    await waitFor(() => expect(estado.erro).toHaveBeenCalled());
    expect(estado.updates).toHaveLength(0);
    expect(estado.sucesso).not.toHaveBeenCalled();
  });

  it("leitura deu certo: acrescenta o pulso e mantém o resto do services_config", async () => {
    estado.leitura = { data: { services_config: { social: true, internal_company: true, pulse_history: [] } }, error: null };
    montar();
    avaliar();
    await waitFor(() => expect(estado.sucesso).toHaveBeenCalled());
    expect(estado.updates).toHaveLength(1);
    const gravado = (estado.updates[0] as { services_config: { social: boolean; internal_company: boolean; pulse_history: Array<{ score: number }> } }).services_config;
    expect(gravado.social).toBe(true);
    expect(gravado.internal_company).toBe(true);
    expect(gravado.pulse_history).toHaveLength(1);
    expect(gravado.pulse_history[0].score).toBe(4);
  });
});
