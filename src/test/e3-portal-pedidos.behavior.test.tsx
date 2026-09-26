import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Portal do cliente, Pedidos (frente E3, sistema de design): o filtro de
 * status troca a lista e fica lembrado ao sair e voltar; o rascunho do pedido
 * não se perde ao fechar a janela; no modo "ver como cliente" não há como
 * criar pedido.
 */

const pedidos = [
  { id: "p1", client_id: "c1", title: "Ajuste na bio", description: "Trocar horário", priority: "normal", status: "new", created_at: "2026-09-24T10:00:00Z" },
  { id: "p2", client_id: "c1", title: "Post sobre laser", description: "Explicar", priority: "high", status: "in_progress", created_at: "2026-09-20T10:00:00Z" },
  { id: "p3", client_id: "c1", title: "Foto de capa", description: "Fachada", priority: "low", status: "completed", created_at: "2026-09-10T10:00:00Z" },
];

let impersonando = false;

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "c1" }, profile: { id: "c1", role: "client", full_name: "Marina", company_name: "Aurora" } }),
}));
vi.mock("@/hooks/useClientIdentity", () => ({
  useClientIdentity: () => ({ clientId: "c1", isImpersonating: impersonando }),
}));
vi.mock("@/lib/webhooks", () => ({ fireWebhook: vi.fn(), webhooks: { clientRequest: "x" } }));
vi.mock("@/lib/notifyHelpers", () => ({ notifyAdmin: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta: any = {
    select: () => consulta,
    eq: () => consulta,
    order: () => Promise.resolve({ data: pedidos, error: null }),
    insert: () => Promise.resolve({ error: null }),
  };
  return { supabase: { from: () => consulta } };
});

import ClientRequests from "@/pages/ClientRequests";

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ClientRequests />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  impersonando = false;
  window.localStorage.clear();
});
afterEach(cleanup);

describe("Portal: Pedidos no sistema de design", () => {
  it("mostra título curto, a lista e filtra por status; o filtro fica lembrado", async () => {
    const primeira = montar();
    expect(screen.getByRole("heading", { name: "Pedidos" })).toBeInTheDocument();
    await screen.findByText("Ajuste na bio");
    expect(screen.getByText("Post sobre laser")).toBeInTheDocument();
    expect(screen.getByText("Foto de capa")).toBeInTheDocument();

    const filtro = screen.getByRole("tablist", { name: "Filtrar pedidos" });
    fireEvent.click(within(filtro).getByRole("tab", { name: /Concluídos/ }));
    expect(screen.queryByText("Ajuste na bio")).not.toBeInTheDocument();
    expect(screen.getByText("Foto de capa")).toBeInTheDocument();

    primeira.unmount();
    montar();
    await screen.findByText("Foto de capa");
    expect(screen.queryByText("Ajuste na bio")).not.toBeInTheDocument();
    expect(within(screen.getByRole("tablist", { name: "Filtrar pedidos" })).getByRole("tab", { name: /Concluídos/ })).toHaveAttribute("aria-selected", "true");
  });

  it("o rascunho do novo pedido continua lá depois de fechar e reabrir a janela", async () => {
    montar();
    await screen.findByText("Ajuste na bio");
    fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    const titulo = screen.getByPlaceholderText(/Ajuste na bio do Instagram/);
    fireEvent.change(titulo, { target: { value: "Trocar logo do perfil" } });
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    fireEvent.click(screen.getByRole("button", { name: "Novo pedido" }));
    await waitFor(() => expect(screen.getByPlaceholderText(/Ajuste na bio do Instagram/)).toHaveValue("Trocar logo do perfil"));
  });

  it("ver como cliente é só leitura: sem botão de novo pedido", async () => {
    impersonando = true;
    montar();
    await screen.findByText("Ajuste na bio");
    expect(screen.queryByRole("button", { name: "Novo pedido" })).not.toBeInTheDocument();
  });
});
