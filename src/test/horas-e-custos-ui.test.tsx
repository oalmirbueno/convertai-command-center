import { createElement as h } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { normalizarResumo } from "@/lib/horas/dados";

/**
 * Central "Horas e custos" (frente CR). A tela abre sem histórico de horas
 * (primeira semana) sem inventar número, e com dados mostra a decisão, a
 * lista por cliente com a comparação, o gráfico mês a mês e o histórico.
 */

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";

const mock = vi.hoisted(() => ({ resumo: null as unknown, custos: [] as unknown[] }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "admin-1" }, profile: { id: "admin-1", role: "admin" } }),
}));
vi.mock("@/lib/horas/dados", async (original) => {
  const real = await original<typeof import("@/lib/horas/dados")>();
  return {
    ...real,
    useResumoDeHoras: () => ({ data: mock.resumo, isLoading: false, isError: false, refetch: vi.fn() }),
    useCustosDoHistorico: () => ({ data: { linhas: mock.custos }, isLoading: false }),
  };
});

import AdminHoras from "@/pages/AdminHoras";

const custo = (client_id: string, nome: string, mes: string, gasto: number) => ({ client_id, nome, mes, gasto_total_usd: gasto });

beforeEach(() => {
  localStorage.clear();
  vi.setSystemTime(new Date("2026-09-28T15:00:00Z"));
});

const montar = () => render(h(MemoryRouter, { initialEntries: ["/horas"] }, h(AdminHoras)));

describe("Horas e custos", () => {
  it("primeira semana: sem horas, decisão sem base; entregas e custos que já existem aparecem", () => {
    mock.resumo = normalizarResumo({
      mes: "2026-09-01",
      escopo: "meu",
      meses: [],
      detalhe: [],
      entregas: [{ client_id: A, nome: "Mirante", mes: "2026-09-01", pecas_aprovadas: 4, tarefas: 2, pautas: 10, pautas_feitas: 5, atrasadas: 1, publicados: 3 }],
      pessoas: [],
    });
    mock.custos = [custo(A, "Mirante", "2026-09-01", 1.5)];
    montar();
    expect(screen.getByRole("heading", { name: "Horas e custos" })).toBeTruthy();
    expect(document.querySelector('[data-decisao="sem-base"]')).toBeTruthy();
    expect(screen.getByText("Ainda não há horas registradas neste mês.")).toBeTruthy();
    const lista = screen.getByRole("list", { name: "Clientes do mês" });
    expect(within(lista).getByText("Mirante")).toBeTruthy();
    expect(lista.textContent).toContain("6 entregas");
    expect(lista.textContent).toContain("5 de 10 do plano");
  });

  it("com horas: decisão, recorte por período, comparação por cliente e histórico", () => {
    const H = 3600;
    mock.resumo = normalizarResumo({
      mes: "2026-09-01",
      escopo: "meu",
      meses: [
        { client_id: A, nome: "Mirante", mes: "2026-08-01", segundos: 20 * H, dias: 10 },
        { client_id: A, nome: "Mirante", mes: "2026-09-01", segundos: 18 * H, dias: 9 },
        { client_id: B, nome: "Softy", mes: "2026-09-01", segundos: 6 * H, dias: 3 },
      ],
      detalhe: [
        { client_id: A, dia: "2026-09-01", hora: 9, segundos: 10 * H },
        { client_id: A, dia: "2026-09-02", hora: 14, segundos: 8 * H },
        { client_id: B, dia: "2026-09-03", hora: 20, segundos: 6 * H },
      ],
      pecas_hora: [{ client_id: A, hora: 14, pecas: 6 }],
      entregas: [
        { client_id: A, nome: "Mirante", mes: "2026-08-01", pecas_aprovadas: 10 },
        { client_id: A, nome: "Mirante", mes: "2026-09-01", pecas_aprovadas: 12, pautas: 12, pautas_feitas: 9 },
      ],
      pessoas: [],
    });
    mock.custos = [custo(A, "Mirante", "2026-08-01", 2), custo(A, "Mirante", "2026-09-01", 3), custo(B, "Softy", "2026-09-01", 0.4)];
    montar();
    expect(document.querySelector('[data-decisao="escalar"]')).toBeTruthy();
    const lista = screen.getByRole("list", { name: "Clientes do mês" });
    const linhas = within(lista).getAllByRole("button");
    expect(linhas[0].textContent).toContain("Mirante");
    expect(linhas[0].textContent).toContain("rende mais à tarde");
    // Recorte: só a noite.
    fireEvent.click(screen.getByRole("tab", { name: "Noite" }));
    const depois = within(screen.getByRole("list", { name: "Clientes do mês" })).getAllByRole("button");
    expect(depois[0].textContent).toContain("Softy");
    // Comparação do cliente.
    fireEvent.click(depois[1]);
    expect(document.querySelector("[data-detalhe-do-cliente]")!.textContent).toContain("Peças aprovadas");
    expect(screen.getAllByText("Média de 3 meses").length).toBeGreaterThan(0);
    // Histórico com o mês escolhido.
    expect(screen.getAllByText("Setembro de 2026").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("group", { name: /Mapa de horas/ })).toBeTruthy();
  });
});
