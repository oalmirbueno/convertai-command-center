import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { criarFetchComPrazo } from "@/integrations/supabase/fetchComPrazo";
import {
  ehPedidoDeRenovacao,
  esquecerTokensMortos,
  protegerSessaoGuardada,
  registrarTokenMorto,
  tokenEstaMorto,
} from "@/integrations/supabase/renovacaoSegura";

afterEach(() => {
  esquecerTokensMortos();
  vi.useRealTimers();
});

const RENOVAR = "https://x.supabase.co/auth/v1/token?grant_type=refresh_token";
const corpo = (t: string) => ({ method: "POST", body: JSON.stringify({ refresh_token: t }) });

function presoAteAbortar() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("abortado", "AbortError")));
    }),
  ) as unknown as typeof fetch;
}

describe("login com prazo (26/09: painel parado na logo)", () => {
  it("pedido de login por senha preso é cancelado no prazo", async () => {
    const f = criarFetchComPrazo(presoAteAbortar(), 30);
    await expect(f("https://x.supabase.co/auth/v1/token?grant_type=password", { method: "POST" })).rejects.toThrow();
  });

  it("banco, storage e funções não ganham prazo", async () => {
    const base = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(init?.signal ? "com" : "sem")) as unknown as typeof fetch;
    const f = criarFetchComPrazo(base, 30);
    expect(await (await f("https://x.supabase.co/rest/v1/tasks")).text()).toBe("sem");
    expect(await (await f("https://x.supabase.co/functions/v1/estudio-arte", { method: "POST" })).text()).toBe("sem");
    expect(await (await f("https://x.supabase.co/auth/v1/user")).text()).toBe("com");
  });

  it("login que responde a tempo passa normal", async () => {
    const base = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;
    const f = criarFetchComPrazo(base, 1000);
    expect(await (await f("https://x.supabase.co/auth/v1/token")).text()).toBe("ok");
  });
});

describe("renovação do token não é cancelada (14/11: 'context canceled' derrubou a sessão)", () => {
  it("renovação nunca ganha prazo nem sinal de cancelamento", async () => {
    vi.useFakeTimers();
    let sinal: AbortSignal | null | undefined = undefined;
    let responder: (r: Response) => void = () => undefined;
    const base = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      sinal = init?.signal;
      return new Promise<Response>((ok) => (responder = ok));
    }) as unknown as typeof fetch;
    const f = criarFetchComPrazo(base, 30);
    const p = f(RENOVAR, corpo("r1"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sinal).toBeUndefined();
    responder(new Response(JSON.stringify({ access_token: "novo" }), { status: 200 }));
    expect(await (await p).json()).toEqual({ access_token: "novo" });
  });

  it("o mesmo vale para /oauth/token com grant_type=refresh_token", () => {
    expect(ehPedidoDeRenovacao("https://x.supabase.co/auth/v1/oauth/token", { method: "POST", body: "grant_type=refresh_token&refresh_token=r" })).toBe(true);
    expect(ehPedidoDeRenovacao(RENOVAR)).toBe(true);
    expect(ehPedidoDeRenovacao("https://x.supabase.co/auth/v1/token?grant_type=password")).toBe(false);
    expect(ehPedidoDeRenovacao("https://x.supabase.co/rest/v1/token?grant_type=refresh_token")).toBe(false);
  });

  it("token recusado pelo servidor não é reenviado (para a rajada de refresh_token_not_found)", async () => {
    const base = vi.fn(async () =>
      new Response(JSON.stringify({ code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" }), { status: 400 }),
    ) as unknown as typeof fetch;
    const f = criarFetchComPrazo(base);
    expect((await f(RENOVAR, corpo("morto"))).status).toBe(400);
    expect(tokenEstaMorto("morto")).toBe(true);
    const segunda = await f(RENOVAR, corpo("morto"));
    expect(segunda.status).toBe(400);
    expect((await segunda.json()).error_code).toBe("refresh_token_not_found");
    expect(base).toHaveBeenCalledTimes(1);
    // Outro token segue normal.
    await f(RENOVAR, corpo("vivo"));
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("erro de rede/500 na renovação não marca o token como morto", async () => {
    const base = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    await criarFetchComPrazo(base)(RENOVAR, corpo("r1"));
    expect(tokenEstaMorto("r1")).toBe(false);
  });
});

describe("storage da sessão: token velho não apaga a sessão nova de outra aba", () => {
  function memoria(inicial: Record<string, string>) {
    const dados = { ...inicial };
    return {
      dados,
      getItem: (k: string) => dados[k] ?? null,
      setItem: (k: string, v: string) => void (dados[k] = v),
      removeItem: (k: string) => void delete dados[k],
    };
  }
  const CHAVE = "sb-x-auth-token";

  it("depois de refresh_token_not_found, se o storage já tem outro token vivo, não apaga", async () => {
    const m = memoria({ [CHAVE]: JSON.stringify({ refresh_token: "novo-da-outra-aba", user: { id: "u1" } }) });
    const s = protegerSessaoGuardada(m)!;
    registrarTokenMorto("velho");
    await s.removeItem(CHAVE);
    expect(m.dados[CHAVE]).toBeDefined();
  });

  it("se o storage tem o mesmo token que morreu, apaga (sessão morta de verdade)", async () => {
    const m = memoria({ [CHAVE]: JSON.stringify({ refresh_token: "velho", user: { id: "u1" } }) });
    const s = protegerSessaoGuardada(m)!;
    registrarTokenMorto("velho");
    await s.removeItem(CHAVE);
    expect(m.dados[CHAVE]).toBeUndefined();
  });

  it("saída normal (sem token recusado) apaga como sempre", async () => {
    const m = memoria({ [CHAVE]: JSON.stringify({ refresh_token: "r", user: { id: "u1" } }) });
    await protegerSessaoGuardada(m)!.removeItem(CHAVE);
    expect(m.dados[CHAVE]).toBeUndefined();
  });

  it("sem storage (fora do navegador) continua sem storage", () => {
    expect(protegerSessaoGuardada(undefined)).toBeUndefined();
  });
});

describe("cliente e abertura", () => {
  it("o cliente usa o fetch do login, e a abertura não força renovação", () => {
    const cliente = readFileSync(resolve(__dirname, "../integrations/supabase/client.ts"), "utf8");
    expect(cliente).toContain("global: { fetch: criarFetchComPrazo() }");
    const auth = readFileSync(resolve(__dirname, "../contexts/AuthContext.tsx"), "utf8");
    // Só comentário pode citar refreshSession: nenhuma chamada.
    expect(auth).not.toMatch(/\.refreshSession\(/);
    // Nenhum signOut sem scope.
    expect(auth).not.toMatch(/signOut\(\s*\)/);
  });
});
