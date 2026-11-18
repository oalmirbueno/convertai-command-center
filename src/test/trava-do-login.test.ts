import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { criarTravaDoLogin, TravaOcupada } from "@/integrations/supabase/travaDoLogin";
import { criarFetchComPrazo } from "@/integrations/supabase/fetchComPrazo";
import { ESPERA_DA_RENOVACAO_MS } from "@/integrations/supabase/renovacaoSegura";

/**
 * 26/09: "1 print não entrou: Acquiring an exclusive Navigator LockManager lock
 * lock:sb-...-auth-token timed out waiting 10000ms".
 * 14/11: rodar sem trava liberava DUAS renovações do mesmo refresh token e a
 * sessão caía (rotação ligada). Agora, espera esgotada: a leitura segue (o
 * envio não falha); a renovação nunca roda sem a trava.
 */

const CHAVE = "sb-x-auth-token";
function storageCom(expiraEmSegundos: number) {
  const valor = JSON.stringify({ access_token: "a", refresh_token: "r1", expires_at: Math.floor(Date.now() / 1000) + expiraEmSegundos, user: { id: "u1" } });
  return { getItem: (k: string) => (k === CHAVE ? valor : null), setItem: () => undefined, removeItem: () => undefined };
}

type Pedido = { nome: string; opcoes: Record<string, any>; fn: (lock: unknown) => Promise<unknown> };

function locksFalsos(ocupada: boolean) {
  const pedidos: Pedido[] = [];
  return {
    pedidos,
    request(nome: string, opcoes: Record<string, any>, fn: (lock: unknown) => Promise<unknown>) {
      pedidos.push({ nome, opcoes, fn });
      if (opcoes.ifAvailable) return fn(ocupada ? null : {});
      if (!ocupada) return fn({});
      // Ocupada: só termina quando o sinal abortar (como o LockManager de verdade).
      return new Promise((_ok, falha) => {
        const s = opcoes.signal as AbortSignal | undefined;
        if (s) s.addEventListener("abort", () => falha(Object.assign(new Error("aborted"), { name: "AbortError" })));
      });
    },
  };
}

const original = Object.getOwnPropertyDescriptor(globalThis.navigator, "locks");
function usarLocks(l: unknown) {
  Object.defineProperty(globalThis.navigator, "locks", { value: l, configurable: true });
}
afterEach(() => {
  if (original) Object.defineProperty(globalThis.navigator, "locks", original);
  else delete (globalThis.navigator as any).locks;
  vi.useRealTimers();
});

describe("trava do login", () => {
  it("livre: roda dentro da trava", async () => {
    const l = locksFalsos(false);
    usarLocks(l);
    const r = await criarTravaDoLogin()("lock:sb-x-auth-token", 10_000, async () => "ok");
    expect(r).toBe("ok");
    expect(l.pedidos[0].opcoes.mode).toBe("exclusive");
  });

  it("ocupada além do prazo: a leitura segue (envio não falha, defeito de 26/09 não volta)", async () => {
    vi.useFakeTimers();
    usarLocks(locksFalsos(true));
    const p = criarTravaDoLogin(8_000, storageCom(3600))("lock:" + CHAVE, 10_000, async () => "enviado");
    await vi.advanceTimersByTimeAsync(8_001);
    await expect(p).resolves.toBe("enviado");
  });

  it("ocupada além do prazo: a RENOVAÇÃO não roda sem a trava (espera a trava e, se não soltar, falha como rede)", async () => {
    vi.useFakeTimers();
    usarLocks(locksFalsos(true));
    const rede = vi.fn(async () => new Response("{}"));
    const f = criarFetchComPrazo(rede as unknown as typeof fetch);
    const p = criarTravaDoLogin(8_000, storageCom(60))("lock:" + CHAVE, 10_000, async () =>
      f("https://x.supabase.co/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: "r1" }) }),
    ).catch((e) => e);
    await vi.advanceTimersByTimeAsync(8_001);
    expect(rede).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(ESPERA_DA_RENOVACAO_MS + 1);
    const erro = await p;
    // TypeError vira AuthRetryableFetchError no supabase-js: mantém a sessão e tenta de novo.
    expect(erro).toBeInstanceOf(TypeError);
    expect(rede).not.toHaveBeenCalled();
  });

  it("renovação pedida sem a trava: quando a trava solta, relê o storage e usa o token que outra aba já gravou", async () => {
    let soltar: () => void = () => undefined;
    const presa = new Promise<void>((ok) => (soltar = ok));
    let livre = false;
    usarLocks({
      request(_nome: string, opcoes: { signal?: AbortSignal }, fn: (lock: unknown) => Promise<unknown>) {
        if (livre) return fn({});
        return new Promise((ok, falha) => {
          opcoes.signal?.addEventListener("abort", () => falha(Object.assign(new Error("aborted"), { name: "AbortError" })));
          void presa.then(() => fn({}).then(ok, falha));
        });
      },
    });
    const dados: Record<string, string> = {
      [CHAVE]: JSON.stringify({ access_token: "a", refresh_token: "r1", expires_at: Math.floor(Date.now() / 1000) + 30, user: { id: "u1" } }),
    };
    const storage = { getItem: (k: string) => dados[k] ?? null, setItem: (k: string, v: string) => void (dados[k] = v), removeItem: (k: string) => void delete dados[k] };
    const rede = vi.fn(async () => new Response("{}"));
    const f = criarFetchComPrazo(rede as unknown as typeof fetch);
    const p = criarTravaDoLogin(20, storage)("lock:" + CHAVE, 10_000, async () =>
      f("https://x.supabase.co/auth/v1/token?grant_type=refresh_token", { method: "POST", body: JSON.stringify({ refresh_token: "r1" }) }),
    );
    await new Promise((r) => setTimeout(r, 40));
    // Outra aba renovou r1 -> r2 enquanto segurava a trava.
    dados[CHAVE] = JSON.stringify({ access_token: "a2", refresh_token: "r2", expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: "u1" } });
    livre = true;
    soltar();
    const resposta = (await p) as Response;
    expect(rede).not.toHaveBeenCalled();
    expect((await resposta.json()).refresh_token).toBe("r2");
  });

  it("duas renovações no mesmo navegador nunca rodam juntas: a segunda espera a primeira soltar", async () => {
    // LockManager de verdade em miniatura: fila exclusiva por nome.
    const filas = new Map<string, Promise<unknown>>();
    usarLocks({
      request(nome: string, _o: Record<string, unknown>, fn: (lock: unknown) => Promise<unknown>) {
        const antes = filas.get(nome) || Promise.resolve();
        const agora = antes.then(() => fn({}));
        filas.set(nome, agora.catch(() => undefined));
        return agora;
      },
    });
    let simultaneas = 0;
    let pico = 0;
    const renovar = async () => {
      simultaneas++;
      pico = Math.max(pico, simultaneas);
      await new Promise((r) => setTimeout(r, 20));
      simultaneas--;
    };
    const trava = criarTravaDoLogin(8_000, storageCom(60));
    await Promise.all([trava("lock:" + CHAVE, 10_000, renovar), trava("lock:" + CHAVE, -1, renovar), trava("lock:" + CHAVE, 10_000, renovar)]);
    expect(pico).toBe(1);
  });

  it("prazo 0 (renovação automática pula a vez) continua avisando com isAcquireTimeout", async () => {
    usarLocks(locksFalsos(true));
    const erro = await criarTravaDoLogin()("lock:sb-x-auth-token", 0, async () => "nao").catch((e) => e);
    expect(erro).toBeInstanceOf(TravaOcupada);
    expect(erro.isAcquireTimeout).toBe(true);
  });

  it("sem LockManager (Safari antigo): roda direto", async () => {
    usarLocks(undefined);
    await expect(criarTravaDoLogin()("x", 10_000, async () => 7)).resolves.toBe(7);
  });

  it("o cliente do Supabase usa esta trava", () => {
    const fonte = readFileSync(resolve(__dirname, "../integrations/supabase/client.ts"), "utf8");
    expect(fonte).toContain("lock: criarTravaDoLogin(ESPERA_MAXIMA_MS, armazenamentoDoLogin)");
    // Um único createClient, sessão persistida e renovação automática ligadas.
    expect(fonte.match(/createClient</g)?.length).toBe(1);
    expect(fonte).toContain("persistSession: true");
    expect(fonte).toContain("autoRefreshToken: true");
    expect(fonte).toContain("protegerSessaoGuardada(brokeredPreviewStorage())");
  });
});
