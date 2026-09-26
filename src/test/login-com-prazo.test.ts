import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { criarFetchComPrazo } from "@/integrations/supabase/fetchComPrazo";

describe("login com prazo (26/09: painel parado na logo)", () => {
  it("pedido de login preso é cancelado no prazo", async () => {
    const base = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("abortado", "AbortError")));
      }),
    ) as unknown as typeof fetch;
    const f = criarFetchComPrazo(base, 30);
    await expect(f("https://x.supabase.co/auth/v1/token?grant_type=refresh_token", { method: "POST" })).rejects.toThrow();
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

  it("o cliente do Supabase usa o fetch com prazo, e a abertura não espera a renovação com token válido", () => {
    const cliente = readFileSync(resolve(__dirname, "../integrations/supabase/client.ts"), "utf8");
    expect(cliente).toContain("global: { fetch: criarFetchComPrazo() }");
    const auth = readFileSync(resolve(__dirname, "../contexts/AuthContext.tsx"), "utf8");
    expect(auth).toContain("tokenAindaVale");
  });
});
