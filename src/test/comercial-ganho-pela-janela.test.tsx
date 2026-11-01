import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Lead } from "@/lib/comercial";

/**
 * CRM: "Ganho" pela janela do lead (Mover para). O quadro pergunta o cliente do painel ao fechar; a janela não
 * perguntava e gravava won_client_id nulo, então a ponte com o Financeiro e o "Gerar proposta" ficavam sem
 * cliente. Agora a janela tem o mesmo seletor e manda o cliente escolhido para o moverLead.
 */

const estado = vi.hoisted(() => ({ mover: vi.fn(), sucesso: vi.fn(), erro: vi.fn() }));

vi.mock("sonner", () => ({ toast: { success: estado.sucesso, error: estado.erro, info: vi.fn(), warning: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  const vazio = () => q;
  Object.assign(q, {
    select: vazio, eq: vazio, is: vazio, not: vazio, in: vazio, order: vazio, limit: vazio, gte: vazio, lt: vazio,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
  });
  return { supabase: { from: () => q, auth: { getUser: () => Promise.resolve({ data: { user: { id: "u1" } } }) } } };
});
vi.mock("@/lib/comercial", async (original) => ({
  ...(await original<typeof import("@/lib/comercial")>()),
  moverLead: estado.mover,
}));
vi.mock("@/components/comercial/AtividadesDoLead", () => ({ default: () => null }));

import { EditorDeLead } from "@/pages/AdminComercial";

const lead: Lead = {
  id: "l1",
  name: "Padaria do Zé",
  company: null,
  email: null,
  whatsapp: null,
  origin: "manual",
  campaign_id: null,
  quiz_submission_id: null,
  stage: "proposta",
  monthly_value: 1500,
  one_off_value: 0,
  owner_id: null,
  next_action: null,
  next_action_at: null,
  notes: null,
  lost_reason: null,
  won_client_id: null,
  classe: null,
  qualificacao: {},
  closed_at: null,
  created_at: "2026-10-01T12:00:00Z",
  updated_at: "2026-10-01T12:00:00Z",
} as unknown as Lead;

function abrir() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EditorDeLead
          lead={lead}
          campanhas={[]}
          equipe={[]}
          empresas={[]}
          atividades={[]}
          eventos={[]}
          clientes={[{ id: "c-padaria", nome: "Padaria do Zé Ltda" }, { id: "c-outro", nome: "Outro cliente" }]}
          onFechar={() => {}}
          onSalvo={() => Promise.resolve()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// O "Mover para" fica na aba "Proposta, etapa e atividades" (abas de ícone).
function irParaEtapa() {
  fireEvent.click(screen.getByRole("button", { name: /proposta, etapa e atividades/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  estado.mover.mockResolvedValue(true);
});
afterEach(cleanup);

describe("Ganho pela janela do lead", () => {
  it("marca como ganho ligado ao cliente escolhido no painel", async () => {
    abrir();
    irParaEtapa();
    const seletor = await screen.findByRole("combobox", { name: /cliente no painel/i });
    fireEvent.change(seletor, { target: { value: "c-padaria" } });
    fireEvent.click(screen.getByRole("button", { name: /^ganho$/i }));
    await waitFor(() => expect(estado.mover).toHaveBeenCalledOnce());
    expect(estado.mover.mock.calls[0][0]).toMatchObject({ paraEstagio: "ganho", clienteGanho: "c-padaria" });
  });

  it("sem cliente escolhido, o ganho segue sem cliente (como 'Ainda não cadastrei' no quadro)", async () => {
    abrir();
    irParaEtapa();
    await screen.findByRole("combobox", { name: /cliente no painel/i });
    fireEvent.click(screen.getByRole("button", { name: /^ganho$/i }));
    await waitFor(() => expect(estado.mover).toHaveBeenCalledOnce());
    expect(estado.mover.mock.calls[0][0]).toMatchObject({ paraEstagio: "ganho", clienteGanho: null });
  });

  it("mover para outra etapa não manda cliente", async () => {
    abrir();
    irParaEtapa();
    const seletor = await screen.findByRole("combobox", { name: /cliente no painel/i });
    fireEvent.change(seletor, { target: { value: "c-padaria" } });
    fireEvent.click(screen.getByRole("button", { name: /^negociação$/i }));
    await waitFor(() => expect(estado.mover).toHaveBeenCalledOnce());
    expect(estado.mover.mock.calls[0][0].clienteGanho).toBeNull();
  });
});
