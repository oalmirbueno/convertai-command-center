import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

/**
 * Dia Prioritário na Central (redesenho de 16/10/2026: semana em 5 colunas + zoom do dia em
 * cartões). Confere que as funções de antes continuam: abre no dia de hoje, troca de dia, clique no
 * cliente abre o perfil, provisório marcado, atrasadas, captação fora do dia e o último registro.
 */

// 13/10/2026 é terça-feira (meio-dia em São Paulo).
const TERCA = new Date("2026-10-13T15:00:00Z");

const DIAS = [
  { client_id: "a", dia: 1, situacao: "confirmado" },
  { client_id: "b", dia: 2, situacao: "provisorio" },
  { client_id: "c", dia: 2, situacao: "confirmado" },
];

const TAREFAS = [
  { id: "t1", title: "Relatório atrasado", status: "todo", due_date: "2026-10-10", client_id: "b", delivery_type: null },
  { id: "t2", title: "Gravação na loja", status: "todo", due_date: "2026-10-15", client_id: "b", delivery_type: null },
];

const REGISTROS = [
  {
    id: "r1",
    client_id: "c",
    title: null,
    created_at: "2026-10-12T13:00:00Z",
    metadata: { dia_prioritario: { tipo: "ligacao", data: "2026-10-12", proximos_passos: "Mandar a proposta" } },
  },
];

vi.mock("@/lib/diaPrioritarioApi", async (original) => {
  const real = (await original()) as Record<string, unknown>;
  return {
    ...real,
    useDiasPrioritarios: () => ({ data: DIAS, isLoading: false }),
    tarefasAbertasDosClientes: async () => TAREFAS,
  };
});

vi.mock("@/integrations/supabase/client", () => {
  const q: Record<string, unknown> = {};
  ["select", "eq", "gte", "order"].forEach((m) => {
    q[m] = () => q;
  });
  q.limit = async () => ({ data: REGISTROS, error: null });
  return { supabase: { from: () => q } };
});

import DiaPrioritarioNaCentral from "@/components/dia-prioritario/DiaPrioritarioNaCentral";

function montar(onAbrirPerfil = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tela = render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <DiaPrioritarioNaCentral
          agora={TERCA}
          onAbrirPerfil={onAbrirPerfil}
          clientes={[
            { id: "a", nome: "Alfa Comércio de Peças" },
            { id: "b", nome: "Beta Loja" },
            { id: "c", nome: "Cia Gama" },
          ]}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...tela, onAbrirPerfil };
}

const zoom = () => document.querySelector("[data-zoom-do-dia]") as HTMLElement;

describe("Dia Prioritário na Central", () => {
  it("a semana em 5 colunas, abre em hoje e mostra os clientes do dia em cartões", async () => {
    montar();
    const semana = screen.getByRole("group", { name: "Dias da semana" });
    const dias = within(semana).getAllByRole("button", { pressed: false }).concat(within(semana).getAllByRole("button", { pressed: true }));
    expect(dias).toHaveLength(5);
    expect(within(semana).getByRole("button", { pressed: true }).getAttribute("aria-label")).toBe("Terça-feira (hoje): 2 clientes");
    expect(within(zoom()).getByText("Hoje, terça-feira")).toBeTruthy();
    expect(zoom().querySelector('[data-cliente-do-dia="b"]')).toBeTruthy();
    expect(zoom().querySelector('[data-cliente-do-dia="c"]')).toBeTruthy();
    expect(zoom().querySelector('[data-cliente-do-dia="a"]')).toBeNull();
  });

  it("provisório, atrasada, captação fora do dia e último registro continuam visíveis", async () => {
    montar();
    const beta = zoom().querySelector('[data-cliente-do-dia="b"]') as HTMLElement;
    expect(within(beta).getByText("Provisório")).toBeTruthy();
    expect(await within(beta).findByText("1 atrasada")).toBeTruthy();
    expect(within(beta).getByText("Captação 15/10, fora do Dia Prioritário")).toBeTruthy();
    expect(within(beta).getByText("2 tarefas abertas")).toBeTruthy();
    const gama = zoom().querySelector('[data-cliente-do-dia="c"]') as HTMLElement;
    expect(await within(gama).findByText("Ligação · 12/10")).toBeTruthy();
    expect(within(gama).getByText("Mandar a proposta")).toBeTruthy();
    expect(within(beta).getByText("Sem registro em 14 dias")).toBeTruthy();
  });

  it("trocar de dia muda o zoom; clicar no cliente (coluna ou cartão) abre o perfil", async () => {
    const { onAbrirPerfil } = montar();
    fireEvent.click(screen.getByRole("button", { name: "Segunda-feira: 1 cliente" }));
    expect(within(zoom()).getByText("Segunda-feira, 19/10")).toBeTruthy();
    expect(zoom().querySelector('[data-cliente-do-dia="a"]')).toBeTruthy();

    const colunaDaSegunda = screen.getByRole("list", { name: "Clientes de segunda-feira" });
    fireEvent.click(within(colunaDaSegunda).getByTitle("Alfa Comércio de Peças"));
    expect(onAbrirPerfil).toHaveBeenLastCalledWith("a");

    fireEvent.click(within(zoom()).getByTitle("Abrir o perfil de Alfa Comércio de Peças"));
    expect(onAbrirPerfil).toHaveBeenCalledTimes(2);
  });

  it("Registrar abre a janela do registro do cliente", async () => {
    montar();
    const gama = zoom().querySelector('[data-cliente-do-dia="c"]') as HTMLElement;
    fireEvent.click(within(gama).getByRole("button", { name: "Registrar" }));
    expect(await screen.findByText("Dia Prioritário: Cia Gama")).toBeTruthy();
  });
});
