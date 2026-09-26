import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { criarTravaDoLogin, TravaOcupada } from "@/integrations/supabase/travaDoLogin";

/**
 * 26/09: "1 print não entrou: Acquiring an exclusive Navigator LockManager lock
 * lock:sb-...-auth-token timed out waiting 10000ms". A trava do login agora
 * segue sem trava quando a espera passa do prazo, em vez de derrubar o envio.
 */

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

  it("ocupada além do prazo: segue sem a trava em vez de falhar", async () => {
    vi.useFakeTimers();
    usarLocks(locksFalsos(true));
    const p = criarTravaDoLogin(8_000)("lock:sb-x-auth-token", 10_000, async () => "enviado");
    await vi.advanceTimersByTimeAsync(8_001);
    await expect(p).resolves.toBe("enviado");
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
    expect(fonte).toContain("lock: criarTravaDoLogin()");
  });
});
