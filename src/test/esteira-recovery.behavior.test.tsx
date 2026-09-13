import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { lerFatosDaEsteira } from "@/lib/esteira/esteiraFatos";
import { useEsteira } from "@/hooks/useEsteira";
import { useClients } from "@/hooks/useSupabaseData";
import AdminEsteira from "@/pages/AdminEsteira";

type Row = Record<string, unknown>;
type DbResult = { data: Row[] | null; error: { message: string } | null };
const dbState = vi.hoisted(() => ({ from: vi.fn(), fail: "", role: "manager", userId: "staff" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: dbState.from } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: dbState.userId }, profile: { role: dbState.role } }) }));
vi.mock("@/hooks/useNow", () => ({ useNow: () => new Date("2026-09-12T12:00:00Z") }));
vi.mock("@/hooks/usePwaProfile", () => ({ usePwaProfile: () => undefined }));
vi.mock("@/hooks/useFotosDosClientes", () => ({ useFotosDosClientes: () => ({ fotoDe: () => null }) }));
vi.mock("@/components/esteira/EsteiraClientSheet", () => ({ default: () => null }));

function response(data: Row[] = []): DbResult { return { data, error: null }; }

function query(result: DbResult) {
  const promise = Promise.resolve(result);
  return Object.assign(promise, {
    select: () => promise, in: () => promise, eq: () => promise,
    is: () => promise, gte: () => promise, order: () => promise,
  });
}

function fakeFrom(table: string) {
  const rows: Record<string, Row[]> = {
    user_roles: [{ user_id: "client" }],
    profiles: [{ id: "client", plan_status: "active", company_name: "Cliente sintético", created_at: "2026-01-01", services_config: { social: true } }],
    team_client_assignments: [{ client_id: "client" }],
    editorial_posts: [{ id: "post", client_id: "client", title: "Pauta sintética", primary_file_id: "art" }],
    staff_files_secure: [{ id: "art", approval_status: "approved", agency_approval_status: "approved" }],
  };
  const result = dbState.fail === "all" || dbState.fail === table
    ? { data: null, error: { message: "Falha sintética" } }
    : response(rows[table] ?? []);
  return query(result);
}

function harness() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  );
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbState.fail = "";
  dbState.role = "manager";
  dbState.userId = "staff";
  dbState.from.mockImplementation(fakeFrom);
});
afterEach(cleanup);

describe("Esteira: falha de leitura e recuperacao", () => {
  it("rejeita consultas recusadas, sem fabricar fatos vazios", async () => {
    dbState.fail = "all";
    await expect(lerFatosDaEsteira([{ id: "client" }], "2026-09-07")).rejects.toThrow("Não foi possível ler todos os dados");
    expect(dbState.from).toHaveBeenCalledTimes(16);
  });

  it("rejeita falha ao conferir a aprovacao de um arquivo", async () => {
    dbState.fail = "staff_files_secure";
    await expect(lerFatosDaEsteira([{ id: "client" }], "2026-09-07")).rejects.toThrow("aprovações");
  });

  it("falha nos vinculos da equipe nao vira carteira vazia", async () => {
    dbState.fail = "team_client_assignments";
    const { wrapper } = harness();
    const { result } = renderHook(() => useClients(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });

  it("mantem o ultimo retrato, propaga falha ao atualizar e recupera numa nova tentativa", async () => {
    const { wrapper } = harness();
    const { result } = renderHook(() => useEsteira("2026-09-07", new Date("2026-09-12T12:00:00Z")), { wrapper });
    await waitFor(() => expect(result.current.clientes).toHaveLength(1));
    const previous = result.current.clientes[0].fatos;
    dbState.fail = "editorial_posts";
    await act(async () => {
      await expect(result.current.recarregar()).rejects.toThrow("Não foi possível ler todos os dados");
    });
    await waitFor(() => expect(result.current.erro).toBeTruthy());
    expect(result.current.clientes[0].fatos).toBe(previous);
    dbState.fail = "";
    await act(async () => { await result.current.recarregar(); });
    await waitFor(() => expect(result.current.erro).toBeFalsy());
    expect(result.current.clientes).toHaveLength(1);
  });

  it("apresenta falha recuperavel em vez de nenhum cliente", async () => {
    dbState.fail = "editorial_posts";
    const { wrapper } = harness();
    render(<AdminEsteira />, { wrapper });
    expect(await screen.findByRole("alert")).toHaveTextContent("A leitura está indisponível");
    expect(screen.queryByText(/Nenhum cliente nesta frente/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Por onde começar" })).toBeDisabled();
  });

  it.each(["usuario", "papel"])("nao reutiliza fatos em cache apos mudar %s", async (change) => {
    const { wrapper } = harness();
    const { result, rerender } = renderHook(() => useEsteira("2026-09-07", new Date("2026-09-12T12:00:00Z")), { wrapper });
    await waitFor(() => expect(result.current.clientes).toHaveLength(1));
    const reads = dbState.from.mock.calls.filter(([table]) => table === "editorial_posts").length;
    dbState.fail = "editorial_posts";
    if (change === "usuario") dbState.userId = "outro-staff";
    else dbState.role = "traffic";
    rerender();
    await waitFor(() => expect(result.current.erro).toBeTruthy());
    expect(result.current.clientes).toEqual([]);
    expect(dbState.from.mock.calls.filter(([table]) => table === "editorial_posts")).toHaveLength(reads + 1);
  });
});
