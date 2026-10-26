import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agruparAvisos } from "@/lib/avisos/rotulos";

/**
 * 26/10/2026: o sino tinha ~1.200 não lidos de ruído. Agora agrupa por tipo,
 * cada grupo tem "Marcar todos como lidos" e só o que pede decisão tem destaque.
 */

const agora = Date.now();
const aviso = (id: string, tipo: string, lido = false, min = 1) => ({ id, notification_type: tipo, read: lido, message: `Aviso ${id}`, link: null, created_at: new Date(agora - min * 60_000).toISOString() });
const AVISOS = [
  aviso("1", "report", false, 1),
  aviso("2", "report", false, 2),
  aviso("3", "report", false, 3),
  aviso("4", "report", false, 4),
  aviso("5", "approval", false, 10),
  aviso("6", "central_review_pendente", false, 20),
  aviso("7", "task", true, 30),
];

const marcar = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/hooks/useAvisosPorArea", () => ({
  useAvisosPorArea: () => ({ data: { lista: AVISOS, naoLidas: 6 }, isError: false, refetch: vi.fn() }),
  marcarAreaComoLida: vi.fn(),
  marcarTiposComoLidos: marcar,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u-1" }, profile: { role: "manager" } }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }) } }));
vi.mock("@/components/avisos/TesteDeAvisos", () => ({ default: () => null }));

import NotificationsPanel from "@/components/NotificationsPanel";

afterEach(() => cleanup());

describe("sino agrupado", () => {
  it("agrupa por tipo e põe o que pede decisão primeiro", () => {
    const grupos = agruparAvisos(AVISOS);
    expect(grupos.map((g) => g.categoria)).toEqual(["decisao", "relatorio", "tarefa"]);
    expect(grupos[0]).toMatchObject({ naoLidos: 2, pedeDecisao: true });
    expect(grupos[1]).toMatchObject({ naoLidos: 4, pedeDecisao: false, tipos: ["report"] });
  });

  it("mostra os grupos, destaca só a decisão e marca um grupo inteiro como lido", async () => {
    const qc = new QueryClient();
    render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(NotificationsPanel, { open: true, onOpenChange: () => undefined }))));
    const grupos = Array.from(document.querySelectorAll("[data-grupo-do-sino]")).map((g) => g.getAttribute("data-grupo-do-sino"));
    expect(grupos).toEqual(["decisao", "relatorio", "tarefa"]);
    // Só os dois avisos de decisão não lidos ficam em destaque.
    expect(document.querySelectorAll("[data-pede-decisao]").length).toBe(2);
    // Grupo de ruído com mais de 3 itens começa recolhido.
    expect(screen.queryByText("Aviso 1")).toBeNull();
    expect(screen.getByText("Aviso 5")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Marcar todos de Relatórios como lidos" })); });
    expect(marcar).toHaveBeenCalledWith("u-1", "painel", ["report"]);
  });
});
