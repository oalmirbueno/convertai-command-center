import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * Financeiro do cliente (portal): confirmar ou recusar a recarga de Ads que a equipe pediu.
 *
 * O update não conferia erro nem linha gravada: com RLS ou rede falhando, o cliente via "Recarga confirmada",
 * a agência recebia o aviso e o pedido continuava "pending". E as leituras (cobranças, wallets, recargas)
 * engoliam o erro e mostravam a tela vazia, como se não houvesse nada.
 */

type Registro = { op: string; valor: unknown; filtros: Array<[string, unknown]> };
type Resposta = { data?: unknown; error?: unknown };

const estado = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  notifyAdmin: vi.fn(),
  escritas: [] as Registro[],
  respostas: {} as Record<string, Resposta>,
}));

vi.mock("sonner", () => ({ toast: { success: estado.success, error: estado.error, warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "cliente" }, profile: { role: "client" }, loading: false }) }));
vi.mock("@/hooks/useClientIdentity", () => ({
  useClientIdentity: () => ({ clientId: "client", profile: { company_name: "Cliente sintético", services_config: { traffic: true } }, isImpersonating: false }),
}));
vi.mock("@/lib/notifyHelpers", () => ({ notifyAdmin: estado.notifyAdmin, notifyUser: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const filtros: Array<[string, unknown]> = [];
    let op = "select";
    let valor: unknown = null;
    const responder = () => {
      const chave = `${tabela}.${op}`;
      if (op !== "select") estado.escritas.push({ op: chave, valor, filtros: [...filtros] });
      const r = estado.respostas[chave] || {};
      return Promise.resolve({ data: r.data ?? [], error: r.error ?? null });
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (c: string, v: unknown) => { filtros.push([c, v]); return q; },
      order: () => q,
      update: (v: unknown) => { op = "update"; valor = v; return q; },
      then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => responder().then(ok, erro),
    };
    return q;
  };
  return { supabase: { from: (t: string) => consulta(t) } };
});

import ClientFinanceiro from "@/pages/ClientFinanceiro";

const recargaPendente = { id: "r1", client_id: "client", platform: "meta", amount: 500, status: "pending", reason: "Investimento semanal", created_at: "2026-10-30T12:00:00Z" };

beforeEach(() => {
  vi.clearAllMocks();
  estado.escritas = [];
  estado.respostas = { "recharge_requests.select": { data: [recargaPendente] } };
  estado.notifyAdmin.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function abrir() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><MemoryRouter><ClientFinanceiro /></MemoryRouter></QueryClientProvider>);
}

describe("Portal: confirmar e recusar recarga", () => {
  it("confirmação não gravou: mostra erro, não avisa a agência e não diz confirmada", async () => {
    estado.respostas["recharge_requests.update"] = { error: { message: "violação de RLS" } };
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /confirmar pagamento/i }));
    await waitFor(() => expect(estado.error).toHaveBeenCalled());
    expect(estado.notifyAdmin).not.toHaveBeenCalled();
    expect(estado.success).not.toHaveBeenCalled();
  });

  it("pedido já não estava pendente (0 linhas): não avisa a agência nem diz confirmada", async () => {
    estado.respostas["recharge_requests.update"] = { data: [] };
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /confirmar pagamento/i }));
    await waitFor(() => expect(estado.error).toHaveBeenCalled());
    expect(estado.notifyAdmin).not.toHaveBeenCalled();
    expect(estado.success).not.toHaveBeenCalled();
  });

  it("confirmação gravada: só vale para o pedido pendente, avisa a agência e confirma", async () => {
    estado.respostas["recharge_requests.update"] = { data: [{ id: "r1" }] };
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /confirmar pagamento/i }));
    await waitFor(() => expect(estado.success).toHaveBeenCalledWith("Recarga confirmada. O saldo atualiza em seguida."));
    const update = estado.escritas.find((e) => e.op === "recharge_requests.update");
    expect(update?.valor).toEqual({ status: "approved" });
    expect(update?.filtros).toEqual([["id", "r1"], ["status", "pending"]]);
    expect(estado.notifyAdmin).toHaveBeenCalledOnce();
  });

  it("recusa não gravou: mostra erro, não avisa a agência e não diz recusada", async () => {
    estado.respostas["recharge_requests.update"] = { error: { message: "rede" } };
    abrir();
    fireEvent.click(await screen.findByRole("button", { name: /^recusar$/i }));
    await waitFor(() => expect(estado.error).toHaveBeenCalled());
    expect(estado.notifyAdmin).not.toHaveBeenCalled();
    expect(estado.success).not.toHaveBeenCalled();
    expect(estado.escritas.find((e) => e.op === "recharge_requests.update")?.filtros).toEqual([["id", "r1"], ["status", "pending"]]);
  });
});

describe("Portal: leitura com erro", () => {
  it("cobranças não carregaram: avisa em vez de mostrar a tela vazia como se não houvesse nada", async () => {
    estado.respostas["billing.select"] = { error: { message: "rede" } };
    abrir();
    expect(await screen.findByText("Não consegui carregar parte do seu financeiro.")).toBeInTheDocument();
  });

  it("tudo carregou: sem aviso de erro", async () => {
    abrir();
    await screen.findByRole("button", { name: /confirmar pagamento/i });
    expect(screen.queryByText("Não consegui carregar parte do seu financeiro.")).not.toBeInTheDocument();
  });
});
