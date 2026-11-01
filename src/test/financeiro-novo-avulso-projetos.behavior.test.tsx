import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Nova entrada avulsa (NewIncomeModal): a lista "Vincular existente" carrega os projetos avulsos do cliente
 * escolhido. O efeito não tinha cancelamento: trocar rápido de A para B e a resposta de A chegar depois da
 * de B deixava os projetos de A na lista com B selecionado (a entrada podia ir para o projeto de outro
 * cliente). O erro da leitura também era engolido e virava "nenhum projeto".
 */

type Resposta = { data: unknown; error: unknown };

const estado = vi.hoisted(() => ({
  error: vi.fn(),
  pendentes: {} as Record<string, (r: Resposta) => void>,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: estado.error, warning: vi.fn(), info: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "admin" }, profile: { role: "admin" }, loading: false }) }));
vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({ data: [{ id: "a", company_name: "Cliente A" }, { id: "b", company_name: "Cliente B" }] }),
  useTeamMembers: () => ({ data: [] }),
}));
vi.mock("@/integrations/supabase/client", () => {
  // A leitura dos projetos fica pendente até o teste decidir quando (e em que ordem) cada cliente responde.
  const consulta = () => {
    let cliente = "";
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => { if (c === "client_id") cliente = String(v); return q; },
      is: () => q,
      order: () => new Promise<Resposta>((ok) => { estado.pendentes[cliente] = ok; }),
    };
    return q;
  };
  return { supabase: { from: () => consulta() } };
});

import NewIncomeModal from "@/components/finance/NewIncomeModal";

beforeEach(() => {
  vi.clearAllMocks();
  estado.pendentes = {};
});
afterEach(cleanup);

function escolherCliente(id: string) {
  fireEvent.change(screen.getByRole("combobox", { name: /cliente/i }), { target: { value: id } });
}

describe("Nova entrada avulsa: projetos do cliente escolhido", () => {
  it("resposta atrasada do cliente anterior não substitui a lista do cliente atual", async () => {
    render(<NewIncomeModal open onClose={() => {}} existingProjects={[]} />);
    escolherCliente("a");
    escolherCliente("b");
    await waitFor(() => expect(estado.pendentes.b).toBeDefined());
    await act(async () => { estado.pendentes.b({ data: [{ id: "pb", name: "Projeto do B" }], error: null }); });
    await act(async () => { estado.pendentes.a({ data: [{ id: "pa1", name: "Projeto do A" }, { id: "pa2", name: "Outro do A" }], error: null }); });
    expect(screen.getByText("Vincular existente (1)")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Vincular existente (1)"));
    expect(screen.getByRole("option", { name: "Projeto do B" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Projeto do A" })).not.toBeInTheDocument();
  });

  it("leitura com erro avisa em vez de fingir que o cliente não tem projeto", async () => {
    render(<NewIncomeModal open onClose={() => {}} existingProjects={[]} />);
    escolherCliente("a");
    await waitFor(() => expect(estado.pendentes.a).toBeDefined());
    await act(async () => { estado.pendentes.a({ data: null, error: { message: "rede" } }); });
    expect(estado.error).toHaveBeenCalledWith("Não consegui carregar os projetos deste cliente.");
  });
});
