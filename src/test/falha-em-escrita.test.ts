import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registrarSeFalhar } from "../../supabase/functions/_shared/falha-registrada";
import { reverterItemDoLancador } from "../../supabase/functions/voice-assistant-agent/acoes-do-lancador";

/**
 * CT-11 (30/09): escritas que não bloqueiam a resposta usavam
 * `.then(() => undefined, () => undefined)` direto no builder do supabase. O
 * supabase-js não rejeita em erro de banco (devolve `{ error }`), então a
 * falha sumia sem rastro. Agora `registrarSeFalhar` lê o `{ error }` e a
 * rejeição e manda para o log, sem lançar nem bloquear a resposta.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registrarSeFalhar", () => {
  it("resposta com { error } vai para o log com o motivo e o extra; nada é lançado", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await Promise.resolve({ data: null, error: { code: "23502", message: "null value in column anexos" } }).then(...registrarSeFalhar("teste: escrita", { client_id: "c-1" }));
    expect(r).toBeUndefined();
    expect(log).toHaveBeenCalledWith("teste: escrita", { client_id: "c-1", motivo: "null value in column anexos" });
  });

  it("rejeição (rede) também vai para o log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await Promise.reject(new Error("fetch failed")).then(...registrarSeFalhar("teste: rede"));
    expect(log).toHaveBeenCalledWith("teste: rede", { motivo: "fetch failed" });
  });

  it("sucesso, ou banco falso que resolve sem error, passa calado", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await Promise.resolve({ data: [], error: null }).then(...registrarSeFalhar("teste: ok"));
    await Promise.resolve(undefined).then(...registrarSeFalhar("teste: vazio"));
    await Promise.resolve(null).then(...registrarSeFalhar("teste: nulo"));
    expect(log).not.toHaveBeenCalled();
  });
});

describe("lançador: desfazer a nota que substituiu outras", () => {
  it("a reativação das notas antigas que falha no banco vai para o log e o Desfazer segue", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const escritas: Array<{ valores: Record<string, unknown>; resposta: { error: unknown } }> = [];
    const db = {
      from: () => ({
        update: (valores: Record<string, unknown>) => {
          const resposta = { error: valores.ativa === true ? { message: "permission denied for table agente_memoria" } : null };
          escritas.push({ valores, resposta });
          const b: Record<string, unknown> = {};
          b.eq = () => b;
          b.in = () => b;
          b.then = (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => Promise.resolve(resposta).then(ok, erro);
          return b;
        },
      }),
    };
    const antiga = "11111111-1111-4111-8111-111111111111";
    await expect(
      reverterItemDoLancador(db as never, "c-1", { operacao: "registrar_nota", desfazer: { memoria_id: "22222222-2222-4222-8222-222222222222", substituidos: [antiga] } }, {}),
    ).resolves.toBeUndefined();
    expect(escritas.map((e) => e.valores)).toEqual([{ ativa: false }, { ativa: true, substituida_por: null }]);
    expect(log).toHaveBeenCalledWith("voice-assistant-agent: notas substituidas nao reativadas", { client_id: "c-1", ids: 1, motivo: "permission denied for table agente_memoria" });
  });
});

describe("nenhuma escrita engolida nas funções do CT-11", () => {
  it("sem `.then(() => undefined, () => undefined)` nos arquivos corrigidos", () => {
    const arquivos = [
      "supabase/functions/agente-contexto/index.ts",
      "supabase/functions/agente-contexto/executor-do-plano.ts",
      "supabase/functions/mesa-ads/index.ts",
      "supabase/functions/voice-assistant-agent/index.ts",
      "supabase/functions/voice-assistant-agent/acoes-do-lancador.ts",
    ];
    for (const a of arquivos) {
      const fonte = readFileSync(resolve(__dirname, "../..", a), "utf8");
      expect({ a, engolidas: fonte.split("\n").filter((l) => l.indexOf(".then(() => undefined, () => undefined)") >= 0).length }).toEqual({ a, engolidas: 0 });
    }
  });
});
