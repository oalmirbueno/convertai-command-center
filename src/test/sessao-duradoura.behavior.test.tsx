import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * 14/11/2026: a sessão do painel caía durante o uso. Estes testes travam as
 * regras da correção no AuthContext:
 *  - abertura com token válido não força renovação;
 *  - erro de rede, abort ou trava ocupada nunca desloga;
 *  - refresh_token_not_found relê o storage antes de sair;
 *  - toda saída é scope "local" (a conta é compartilhada).
 */

type Ouvinte = (evento: string, sessao: unknown) => void | Promise<void>;
const { CHAVE, armazenado, auth, estado, consulta } = vi.hoisted(() => {
  const CHAVE = "sb-x-auth-token";
  const armazenado: Record<string, string> = {};
  const estado: { ouvinte: ((evento: string, sessao: unknown) => void | Promise<void>) | null } = { ouvinte: null };
  const auth = {
    storageKey: CHAVE,
    storage: { getItem: (k: string) => armazenado[k] ?? null },
    getSession: vi.fn(),
    refreshSession: vi.fn(),
    signOut: vi.fn(async (_o?: unknown) => ({ error: null })),
    signInWithPassword: vi.fn(),
    signUp: vi.fn(),
    onAuthStateChange: vi.fn((cb: (evento: string, sessao: unknown) => void | Promise<void>) => {
      estado.ouvinte = cb;
      return { data: { subscription: { unsubscribe: () => undefined } } };
    }),
  };
  function consulta(data: unknown) {
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data, error: null }),
      upsert: async () => ({ error: null }),
    });
    return q;
  }
  return { CHAVE, armazenado, auth, estado, consulta };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth,
    from: (tabela: string) =>
      tabela === "user_roles"
        ? consulta({ role: "admin" })
        : consulta({ id: "u1", full_name: "Orion", email: "aceleriq@gmail.com" }),
  },
}));
vi.mock("@/lib/notifyHelpers", () => ({ notifyAdmin: vi.fn() }));
vi.mock("@/lib/miniaturas", () => ({ definirAutoMiniaturas: vi.fn(), definirDonoDasUrls: vi.fn() }));

import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { esquecerTokensMortos, registrarTokenMorto } from "@/integrations/supabase/renovacaoSegura";

const usuario = { id: "u1", email: "aceleriq@gmail.com", updated_at: "x", user_metadata: {} };
const agoraEm = (s: number) => Math.floor(Date.now() / 1000) + s;
const sessao = (refresh: string, expiraEm = 3600) => ({ access_token: "a", refresh_token: refresh, expires_at: agoraEm(expiraEm), user: usuario });

let sair: () => Promise<void> = async () => undefined;
function Sonda() {
  const { user, loading, logout } = useAuth();
  sair = logout;
  return <div data-testid="estado">{loading ? "carregando" : user ? `dentro:${user.id}` : "fora"}</div>;
}
const montar = () => render(<AuthProvider><Sonda /></AuthProvider>);

beforeEach(() => {
  for (const k of Object.keys(armazenado)) delete armazenado[k];
  estado.ouvinte = null;
  vi.clearAllMocks();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  esquecerTokensMortos();
  vi.restoreAllMocks();
});

describe("abertura do painel", () => {
  it("token válido: abre sem forçar refreshSession", async () => {
    auth.getSession.mockResolvedValue({ data: { session: sessao("r1") }, error: null });
    montar();
    expect(await screen.findByText("dentro:u1")).toBeInTheDocument();
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("erro de rede na renovação: mantém a sessão guardada, não desloga", async () => {
    armazenado[CHAVE] = JSON.stringify(sessao("r1", 60));
    auth.getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError("Failed to fetch", 0) });
    montar();
    expect(await screen.findByText("dentro:u1")).toBeInTheDocument();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("trava do login ocupada (isAcquireTimeout): não desloga", async () => {
    armazenado[CHAVE] = JSON.stringify(sessao("r1", 60));
    auth.getSession.mockRejectedValue(Object.assign(new Error("Trava ocupada."), { isAcquireTimeout: true }));
    montar();
    expect(await screen.findByText("dentro:u1")).toBeInTheDocument();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("refresh_token_not_found com token novo de outra aba no storage: segue com ele, sem signOut", async () => {
    registrarTokenMorto("velho");
    armazenado[CHAVE] = JSON.stringify(sessao("novo-da-outra-aba"));
    auth.getSession.mockResolvedValue({ data: { session: null }, error: new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found") });
    montar();
    expect(await screen.findByText("dentro:u1")).toBeInTheDocument();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("refresh_token_not_found e storage morto: sai só deste navegador (scope local)", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: new AuthApiError("Invalid Refresh Token", 400, "refresh_token_not_found") });
    montar();
    expect(await screen.findByText("fora")).toBeInTheDocument();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
});

describe("durante o uso", () => {
  it("SIGNED_OUT com sessão viva no storage (token velho largado): a pessoa continua no painel", async () => {
    auth.getSession.mockResolvedValue({ data: { session: sessao("r1") }, error: null });
    montar();
    expect(await screen.findByText("dentro:u1")).toBeInTheDocument();
    armazenado[CHAVE] = JSON.stringify(sessao("r2"));
    await act(async () => {
      await (estado.ouvinte as Ouvinte)("SIGNED_OUT", null);
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(screen.getByText("dentro:u1")).toBeInTheDocument();
  });

  it("SIGNED_OUT com storage vazio: vai para fora", async () => {
    auth.getSession.mockResolvedValue({ data: { session: sessao("r1") }, error: null });
    montar();
    expect(await screen.findByText("dentro:u1")).toBeInTheDocument();
    await act(async () => {
      await (estado.ouvinte as Ouvinte)("SIGNED_OUT", null);
    });
    await waitFor(() => expect(screen.getByText("fora")).toBeInTheDocument());
  });

  it("botão sair usa scope local (não derruba iPhone, Windows e agentes da mesma conta)", async () => {
    auth.getSession.mockResolvedValue({ data: { session: sessao("r1") }, error: null });
    montar();
    expect(await screen.findByText("dentro:u1")).toBeInTheDocument();
    await act(async () => {
      await sair();
    });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(screen.getByText("fora")).toBeInTheDocument();
  });
});
