import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";

const estado = vi.hoisted(() => ({ papel: null as null | "client", from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: estado.from,
    auth: {
      getSession: async () => ({ data: { session: { expires_at: 9999999999, user: { id: "identidade-teste", email: "pessoa@example.invalid" } } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({}),
    },
  },
}));
vi.mock("@/lib/miniaturas", () => ({ definirAutoMiniaturas: vi.fn(), definirDonoDasUrls: vi.fn() }));
vi.mock("@/lib/notifyHelpers", () => ({ notifyAdmin: vi.fn() }));

function Identidade() { const { profile, loading } = useAuth(); return <p>{loading ? "Carregando" : profile?.role || "Sem identidade"}</p>; }
beforeEach(() => {
  estado.papel = null;
  estado.from.mockImplementation((tabela: string) => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: tabela === "profiles" ? { id: "identidade-teste", full_name: "Pessoa de teste", email: "pessoa@example.invalid" } : estado.papel ? { role: estado.papel } : null, error: null }) }) }) }));
});
afterEach(cleanup);
describe("identidade real do AuthProvider", () => {
  it("não transforma ausência de papel em cliente operacional", async () => {
    render(<AuthProvider><Identidade /></AuthProvider>);
    expect(await screen.findByText("member")).toBeInTheDocument();
    expect(screen.queryByText("client")).not.toBeInTheDocument();
  });
  it("preserva o papel explícito de cliente existente", async () => {
    estado.papel = "client";
    render(<AuthProvider><Identidade /></AuthProvider>);
    expect(await screen.findByText("client")).toBeInTheDocument();
  });
});
