import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Anti-bug 26/09: o "ainda não respondeu, pode estar sendo publicado" aparecia
 * para qualquer falha sem corpo e escondeu o "CPU Time exceeded" da Mesa Foto.
 * Resposta com fôlego cortada no meio (o 200 já saiu e a leitura do corpo
 * falha) ou limite do servidor (546/504) agora dizem que a função parou no
 * meio; 404, relé e rede antes de responder continuam como antes.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mock.invoke } } }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { chamarFuncao, ErroDaMesa } from "@/lib/mesa/api";

const resposta = (status: number, corpo: unknown) =>
  new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

async function erroDe(error: unknown): Promise<ErroDaMesa> {
  mock.invoke.mockResolvedValueOnce({ data: null, error });
  try {
    await chamarFuncao("mesa-foto", { acao: "variar" });
  } catch (e) {
    return e as ErroDaMesa;
  }
  throw new Error("não lançou");
}

describe("erro de rede da Mesa não fica mascarado", () => {
  beforeEach(() => {
    mock.invoke.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("resposta com fôlego cortada (JSON vazio) vira funcao_interrompida com a frase certa", async () => {
    const e = await erroDe(new SyntaxError("Unexpected end of JSON input"));
    expect(e).toBeInstanceOf(ErroDaMesa);
    expect(e.codigo).toBe("funcao_interrompida");
    expect(e.message).toBe("A função parou no meio (limite do servidor). Nada foi cobrado se não houve resultado; tente de novo ou avise.");
    expect(e.detalhes).toMatchObject({ funcao: "mesa-foto", causa: "SyntaxError" });
    expect(console.warn).toHaveBeenCalledWith("[mesa] funcao_interrompida", expect.objectContaining({ funcao: "mesa-foto" }));
  });

  it("leitura do corpo que cai no meio (TypeError de rede) também", async () => {
    const e = await erroDe(new TypeError("network error"));
    expect(e.codigo).toBe("funcao_interrompida");
    expect(e.detalhes).toMatchObject({ causa: "TypeError" });
  });

  it("546 WORKER_LIMIT (CPU ou memória antes de responder) vira funcao_interrompida", async () => {
    const e = await erroDe({ name: "FunctionsHttpError", context: resposta(546, { code: "WORKER_LIMIT", message: "Function failed" }) });
    expect(e.codigo).toBe("funcao_interrompida");
    expect(e.detalhes).toMatchObject({ status_http: 546, codigo_do_servidor: "WORKER_LIMIT" });
  });

  it("504 (tempo esgotado) vira funcao_interrompida", async () => {
    const e = await erroDe({ name: "FunctionsHttpError", context: resposta(504, "gateway timeout") });
    expect(e.codigo).toBe("funcao_interrompida");
  });

  it("404, relé e falha antes de responder continuam como serviço indisponível", async () => {
    expect((await erroDe({ name: "FunctionsHttpError", context: resposta(404, "not found") })).codigo).toBe("servico_indisponivel");
    expect((await erroDe({ name: "FunctionsRelayError", context: resposta(502, "relay") })).codigo).toBe("servico_indisponivel");
    expect((await erroDe({ name: "FunctionsFetchError" })).codigo).toBe("servico_indisponivel");
    expect((await erroDe({ name: "FunctionsFetchError" })).message).toContain("ainda não respondeu");
  });

  it("corpo de erro com código continua valendo o código do servidor", async () => {
    const e = await erroDe({ name: "FunctionsHttpError", context: resposta(402, { error: "saldo_insuficiente", falta_usd: 1 }) });
    expect(e.codigo).toBe("saldo_insuficiente");
  });

  it("500 sem corpo JSON continua falha_interna", async () => {
    const e = await erroDe({ name: "FunctionsHttpError", context: resposta(500, "<html>") });
    expect(e.codigo).toBe("falha_interna");
  });

  it("erro no corpo 200 (resposta com fôlego que terminou com erro) continua valendo", async () => {
    mock.invoke.mockResolvedValueOnce({ data: { error: "falha_interna", status_http: 500 }, error: null });
    await expect(chamarFuncao("mesa-foto", { acao: "variar" })).rejects.toMatchObject({ codigo: "falha_interna" });
  });
});
