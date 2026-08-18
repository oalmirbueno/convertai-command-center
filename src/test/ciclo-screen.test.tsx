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

// As marcações que o banco devolveria nesta renderização.
const banco = vi.hoisted(() => ({ rows: [] as any[] }));

vi.mock("@/integrations/supabase/client", () => {
  const chain: any = {};
  for (const method of ["select", "eq", "gte", "in", "is", "delete", "update", "insert"]) {
    chain[method] = () => chain;
  }
  chain.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve({ data: banco.rows, error: null }).then(onFulfilled, onRejected);
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

// A primeira renderização desta tela monta carteira, ciclo e histórico de
// seis semanas — leva alguns segundos em máquina de esteira. O limite padrão
// de 5s cortava o teste ANTES da espera de 15s que ele mesmo declara.
describe("tela do Ciclo da Semana", () => {
  beforeEach(() => {
    localStorage.clear();
    banco.rows = [];
    vi.clearAllMocks();
  });

  // O nome do cliente aparece no card e também no atalho "Continuar de onde
  // parou": o que importa é estar na tela, não quantas vezes.
  const naTela = (texto: string) => screen.queryAllByText(texto).length > 0;

  it("mostra em Social quem contratou social, incluindo a empresa do grupo", async () => {
    await renderCiclo();
    await screen.findAllByText("Acerbi", {}, { timeout: 15000 });

    expect(naTela("Mirante Luz")).toBe(true);
    // Sem social contratado, continua fora: a régua da frente não mudou.
    expect(naTela("Vifut")).toBe(false);
    // A empresa do grupo TRABALHA, então aparece na operação. A flag interna
    // existe para tirar de COBRANÇA — MRR, atraso, pendência de plano — e
    // estava escondendo o trabalho: Jalimpo, Stop Informática e AcelerIQ
    // tinham social e tráfego marcados e não apareciam em frente nenhuma.
    expect(naTela("Empresa do Grupo")).toBe(true);
  }, 20000);

  it("troca para Tráfego pela barra de baixo e recorta a lista", async () => {
    await renderCiclo();
    await screen.findAllByText("Acerbi", {}, { timeout: 15000 });
    expect(naTela("Mirante Luz")).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /Tráfego/i }));

    await waitFor(() => {
      // Mirante não tem tráfego contratado: sai da lista.
      expect(naTela("Mirante Luz")).toBe(false);
    });
    expect(naTela("Acerbi")).toBe(true);
  }, 20000);

  it("dá o trilho de onboarding só a quem ainda não concluiu", async () => {
    await renderCiclo();
    await screen.findAllByText("Acerbi", {}, { timeout: 15000 });

    // Mirante está em onboarding: 6 do ciclo + 4 do trilho de entrada.
    expect(screen.getByText("0/10")).toBeInTheDocument();
    expect(screen.getByText(/Novo/i)).toBeInTheDocument();
    // Acerbi já roda em rotina: fica só com as 6 etapas do ciclo.
    expect(naTela("0/6")).toBe(true);
  }, 20000);

  it("tira da frente quem já fechou a semana e guarda o dia da marcação", async () => {
    const hoje = new Date();
    const segunda = new Date(hoje);
    segunda.setHours(0, 0, 0, 0);
    segunda.setDate(segunda.getDate() - ((segunda.getDay() + 6) % 7));
    const semana = `${segunda.getFullYear()}-${String(segunda.getMonth() + 1).padStart(2, "0")}-${String(segunda.getDate()).padStart(2, "0")}`;

    // Acerbi fechou as 6 etapas do ciclo nesta semana.
    banco.rows = Array.from({ length: 6 }, (_, index) => ({
      id: `acerbi-${index + 1}`,
      client_id: "acerbi",
      area: "social",
      week_start: semana,
      step: index + 1,
      done_at: new Date().toISOString(),
      done_by: "dono",
    }));

    await renderCiclo();
    await screen.findByText(/cliente fechado/i, {}, { timeout: 15000 });

    // Sai da lista de trabalho e vira uma linha recolhida.
    expect(screen.getByText("1 cliente fechado")).toBeInTheDocument();
    // Mirante, que não fechou nada, continua na frente.
    expect(naTela("Mirante Luz")).toBe(true);
  }, 20000);

  it("mantém o menu do painel e a semana no topo", async () => {
    await renderCiclo();

    expect(screen.getByRole("button", { name: /Abrir menu/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Semana anterior/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Próxima semana/i })).toBeInTheDocument();
  }, 20000);

  it("abre o menu com os atalhos do painel e o convite de instalação", async () => {
    await renderCiclo();

    fireEvent.click(screen.getByRole("button", { name: /Abrir menu/i }));

    await waitFor(() => {
      expect(screen.getByText(/Como funciona o ciclo/i)).toBeInTheDocument();
    });
    // A instalação acontece pela própria rota /ciclo (o index troca o
    // manifesto por caminho); o menu explica o gesto em vez de linkar para
    // uma página que a hospedagem pode não servir.
    expect(screen.getByText(/Instalar o Ciclo no celular/i)).toBeInTheDocument();
    expect(screen.getByText(/Adicionar à tela inicial/i)).toBeInTheDocument();
    expect(screen.getByText("Kanban")).toBeInTheDocument();
  }, 20000);
});
