import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * A tela do Ciclo é usada no celular, no meio da operação. O que não pode
 * quebrar: cada frente mostra só quem contratou aquele serviço, e a troca
 * entre as duas frentes vive na barra de baixo, a um toque.
 */

const CARTEIRA = [
  { id: "acerbi", company_name: "Acerbi", onboarding_done: true, plan_status: "active", client_type: "recurring", services_config: { social: true, trafego: true } },
  { id: "vifut", company_name: "Vifut", onboarding_done: true, plan_status: "active", client_type: "recurring", services_config: { social: false, videos_ia: true } },
  { id: "mirante", company_name: "Mirante Luz", onboarding_done: false, plan_status: "active", client_type: "recurring", services_config: { social: true } },
  { id: "interna", company_name: "Empresa do Grupo", onboarding_done: true, plan_status: "active", client_type: "recurring", services_config: { internal_company: true, social: true, trafego: true } },
];

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "dono" }, profile: { role: "admin" } }),
}));

vi.mock("@/hooks/useSupabaseData", () => ({
  useClients: () => ({ data: CARTEIRA }),
}));

vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {};
  const resolved = Promise.resolve({ data: [], error: null });
  for (const method of ["select", "eq", "gte", "in", "is", "delete", "update", "insert"]) {
    chain[method] = () => chain;
  }
  chain.then = resolved.then.bind(resolved);
  return {
    supabase: {
      from: () => chain,
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    },
  };
});

const renderCiclo = async () => {
  const { default: AdminCiclo } = await import("@/pages/AdminCiclo");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminCiclo />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("tela do Ciclo da Semana", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  // O nome do cliente aparece no card e também no atalho "Continuar de onde
  // parou": o que importa é estar na tela, não quantas vezes.
  const naTela = (texto: string) => screen.queryAllByText(texto).length > 0;

  it("mostra em Social apenas quem contratou social, sem a empresa do grupo", async () => {
    await renderCiclo();
    await screen.findAllByText("Acerbi");

    expect(naTela("Mirante Luz")).toBe(true);
    expect(naTela("Vifut")).toBe(false);
    expect(naTela("Empresa do Grupo")).toBe(false);
  });

  it("troca para Tráfego pela barra de baixo e recorta a lista", async () => {
    await renderCiclo();
    await screen.findAllByText("Acerbi");
    expect(naTela("Mirante Luz")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Tráfego/i }));

    await waitFor(() => {
      // Mirante não tem tráfego contratado: sai da lista.
      expect(naTela("Mirante Luz")).toBe(false);
    });
    expect(naTela("Acerbi")).toBe(true);
  });

  it("dá o trilho de onboarding só a quem ainda não concluiu", async () => {
    await renderCiclo();
    await screen.findAllByText("Acerbi");

    // Mirante está em onboarding: 6 do ciclo + 4 do trilho de entrada.
    expect(screen.getByText("0/10")).toBeInTheDocument();
    expect(screen.getByText(/Onboarding/i)).toBeInTheDocument();
    // Acerbi já roda em rotina: fica só com as 6 etapas do ciclo.
    expect(naTela("0/6")).toBe(true);
  });

  it("mantém o menu do painel e a semana no topo", async () => {
    await renderCiclo();

    expect(screen.getByRole("button", { name: /Abrir menu/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Semana anterior/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Próxima semana/i })).toBeInTheDocument();
  });
});
