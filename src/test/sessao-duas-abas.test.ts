import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { criarTravaDoLogin } from "@/integrations/supabase/travaDoLogin";
import { criarFetchComPrazo } from "@/integrations/supabase/fetchComPrazo";
import { esquecerTokensMortos, protegerSessaoGuardada } from "@/integrations/supabase/renovacaoSegura";

/**
 * 14/11/2026, com o supabase-js de verdade: várias abas do mesmo navegador
 * abrindo juntas com o token vencido. O servidor falso faz rotação ESTRITA
 * (sem janela de reuso): token já trocado volta refresh_token_not_found.
 * Com a trava, o fetch e o storage do painel, só sai UMA renovação e todas as
 * abas ficam com a sessão.
 */

const URL_FALSA = "https://ci-sessao.supabase.co";
const CHAVE = "sb-ci-sessao-auth-token";
const usuario = { id: "u1", aud: "authenticated", role: "authenticated", email: "aceleriq@gmail.com", app_metadata: {}, user_metadata: {}, created_at: "2026-11-13T00:00:00Z" };

function servidorComRotacao(demoraMs = 15) {
  let n = 0;
  const vivos = new Set(["t0"]);
  const log: string[] = [];
  const fetchFalso = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/auth/v1/token?grant_type=refresh_token")) {
      const { refresh_token } = JSON.parse(String(init?.body || "{}"));
      if (!vivos.has(refresh_token)) {
        await new Promise((r) => setTimeout(r, demoraMs));
        log.push(`morto:${refresh_token}`);
        return new Response(JSON.stringify({ code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      // Como o servidor real: troca o token na hora e só depois responde. Se o
      // cliente cancelar no meio, o token velho já morreu ("context canceled").
      vivos.delete(refresh_token);
      const novo = `t${++n}`;
      vivos.add(novo);
      log.push(`ok:${refresh_token}->${novo}`);
      await new Promise<void>((ok, falha) => {
        const relogio = setTimeout(ok, demoraMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(relogio);
          falha(new DOMException("abortado", "AbortError"));
        });
      });
      return new Response(
        JSON.stringify({ access_token: `a${n}`, refresh_token: novo, token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: usuario }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { fetchFalso, log };
}

/** LockManager mínimo e fiel: exclusivo por nome, fila, ifAvailable e signal. */
function lockManagerFalso() {
  const filas = new Map<string, Promise<unknown>>();
  const ocupadas = new Set<string>();
  return {
    request(nome: string, opcoes: { ifAvailable?: boolean; signal?: AbortSignal }, fn: (lock: unknown) => Promise<unknown>) {
      if (opcoes.ifAvailable && ocupadas.has(nome)) return fn(null);
      const antes = filas.get(nome) || Promise.resolve();
      let desistiu = false;
      const desistencia = new Promise<never>((_ok, falha) => {
        opcoes.signal?.addEventListener("abort", () => {
          desistiu = true;
          falha(Object.assign(new Error("aborted"), { name: "AbortError" }));
        });
      });
      const vez = antes.then(async () => {
        if (desistiu) return undefined;
        ocupadas.add(nome);
        try {
          return await fn({ name: nome });
        } finally {
          ocupadas.delete(nome);
        }
      });
      filas.set(nome, vez.catch(() => undefined));
      return opcoes.signal ? Promise.race([vez, desistencia]) : vez;
    },
  };
}

const original = Object.getOwnPropertyDescriptor(globalThis.navigator, "locks");
afterEach(() => {
  if (original) Object.defineProperty(globalThis.navigator, "locks", original);
  else delete (globalThis.navigator as unknown as { locks?: unknown }).locks;
  esquecerTokensMortos();
  localStorage.removeItem(CHAVE);
});

function sessaoVencida() {
  localStorage.setItem(
    CHAVE,
    JSON.stringify({ access_token: "a0", refresh_token: "t0", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) - 10, user: usuario }),
  );
}

function abaDoPainel(fetchFalso: typeof fetch, esperaDaTravaMs = 8_000, prazoDoLoginMs?: number) {
  const armazenamento = protegerSessaoGuardada(localStorage)!;
  return createClient(URL_FALSA, "ci-public-placeholder", {
    auth: {
      storageKey: CHAVE,
      storage: armazenamento,
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      lock: criarTravaDoLogin(esperaDaTravaMs, armazenamento),
    },
    global: { fetch: criarFetchComPrazo(fetchFalso, prazoDoLoginMs) },
  });
}

describe("duas abas, mesmo token vencido, rotação estrita", () => {
  it("só uma renovação sai e todas as abas continuam logadas", async () => {
    Object.defineProperty(globalThis.navigator, "locks", { value: lockManagerFalso(), configurable: true });
    localStorage.setItem(
      CHAVE,
      JSON.stringify({ access_token: "a0", refresh_token: "t0", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) - 10, user: usuario }),
    );
    const { fetchFalso, log } = servidorComRotacao();
    const armazenamento = protegerSessaoGuardada(localStorage)!;
    const aba = () =>
      createClient(URL_FALSA, "ci-public-placeholder", {
        auth: {
          storageKey: CHAVE,
          storage: armazenamento,
          persistSession: true,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          lock: criarTravaDoLogin(8_000, armazenamento),
        },
        global: { fetch: criarFetchComPrazo(fetchFalso) },
      });
    const abas = [aba(), aba(), aba()];
    const resultados = await Promise.all(abas.flatMap((c) => [c.auth.getSession(), c.auth.getSession()]));

    expect(log.filter((l) => l.startsWith("morto"))).toEqual([]);
    expect(log.filter((l) => l.startsWith("ok"))).toHaveLength(1);
    for (const r of resultados) {
      expect(r.error).toBeNull();
      expect(r.data.session?.refresh_token).toBe("t1");
    }
    expect(JSON.parse(localStorage.getItem(CHAVE) || "{}").refresh_token).toBe("t1");
  });

  it("trava presa por outra aba além do prazo: ninguém renova sem a trava; quando solta, sai UMA renovação e as abas seguem", async () => {
    const lm = lockManagerFalso();
    Object.defineProperty(globalThis.navigator, "locks", { value: lm, configurable: true });
    sessaoVencida();
    const { fetchFalso, log } = servidorComRotacao();
    let soltar: () => void = () => undefined;
    const presa = lm.request(`lock:${CHAVE}`, {}, () => new Promise<void>((ok) => (soltar = ok)));
    const abas = [abaDoPainel(fetchFalso, 40), abaDoPainel(fetchFalso, 40)];
    const pedidos = abas.map((c) => c.auth.getSession());
    await new Promise((r) => setTimeout(r, 120));
    // Espera esgotou nas duas abas, mas nenhuma renovação saiu sem a trava.
    // Antes (26/09) as duas renovavam t0 juntas: uma morria e apagava a sessão de todas.
    expect(log).toEqual([]);
    expect(JSON.parse(localStorage.getItem(CHAVE) || "{}").refresh_token).toBe("t0");
    soltar();
    await presa;
    const resultados = await Promise.all(pedidos);
    expect(log).toEqual(["ok:t0->t1"]);
    for (const r of resultados) {
      expect(r.error).toBeNull();
      expect(r.data.session?.refresh_token).toBe("t1");
    }
    // A aba continua usável depois (o initialize() não ficou quebrado).
    for (const c of abas) expect((await c.auth.getSession()).data.session?.refresh_token).toBe("t1");
  });

  it("servidor lento (resposta depois do prazo do login): a renovação não é cancelada e o token novo é guardado", async () => {
    Object.defineProperty(globalThis.navigator, "locks", { value: lockManagerFalso(), configurable: true });
    sessaoVencida();
    // Servidor responde em 80 ms; prazo do login de 30 ms. Antes, o pedido era abortado
    // depois do servidor já ter trocado o token ("context canceled"), e a aba ficava com t0 morto.
    const { fetchFalso, log } = servidorComRotacao(80);
    const aba = abaDoPainel(fetchFalso, 8_000, 30);
    const r = await aba.auth.getSession();
    expect(r.error).toBeNull();
    expect(r.data.session?.refresh_token).toBe("t1");
    expect(log).toEqual(["ok:t0->t1"]);
    expect(JSON.parse(localStorage.getItem(CHAVE) || "{}").refresh_token).toBe("t1");
  });
});
