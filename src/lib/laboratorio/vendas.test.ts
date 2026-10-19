import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Vendas do Laboratório (vendas.ts): o gateway do nó vira slug, o valor sai
 * em reais, o que falta para receber, e a ponte com a função vendas-webhook
 * (ação certa no corpo, erro do corpo vira ErroDeVendas com a frase).
 */

const m = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: m.invoke } } }));

import { criarIntegracao, ErroDeVendas, falta, gatewayDoNo, INFO_DO_GATEWAY, listarEventos, listarIntegracoes, rotuloDoEvento, salvarSegredo, valorNaTela, type IntegracaoDeVenda } from "./vendas";

const integ = (o: Partial<IntegracaoDeVenda> = {}): IntegracaoDeVenda => ({
  id: "i1",
  client_id: null,
  gateway: "stripe",
  ativo: true,
  endereco: "https://x.supabase.co/functions/v1/vendas-webhook/stripe/0123456789abcdef0123456789abcdef",
  criado_em: "2026-10-19T10:00:00Z",
  tem_segredo: false,
  segredo_final: null,
  segredo_gerado_pelo_painel: false,
  token_api: "nao",
  tem_token_api: false,
  ultimo_evento_em: null,
  ...o,
});

describe("vendas.ts", () => {
  beforeEach(() => m.invoke.mockReset());

  it("gateway do nó vira slug; 'outro link' não manda eventos", () => {
    expect(gatewayDoNo("Hotmart")).toBe("hotmart");
    expect(gatewayDoNo("Mercado Pago")).toBe("mercado_pago");
    expect(gatewayDoNo("mercadopago")).toBe("mercado_pago");
    expect(gatewayDoNo("outro link")).toBeNull();
    expect(gatewayDoNo("")).toBeNull();
    expect(gatewayDoNo(null)).toBeNull();
  });

  it("valor em reais com milhar e centavos; outra moeda com o código", () => {
    expect(valorNaTela(197, "BRL")).toBe("R$ 197,00");
    expect(valorNaTela(12345.5, null)).toBe("R$ 12.345,50");
    expect(valorNaTela(10, "USD")).toBe("USD 10.00");
    expect(valorNaTela(null, "BRL")).toBe("");
  });

  it("o que falta para receber: segredo, depois a chave de API do Mercado Pago", () => {
    expect(falta(integ())).toBe("segredo");
    expect(falta(integ({ tem_segredo: true }))).toBeNull();
    expect(falta(integ({ gateway: "mercado_pago", token_api: "obrigatorio", tem_segredo: true }))).toBe("token_api");
    expect(falta(integ({ gateway: "asaas", token_api: "opcional", tem_segredo: true }))).toBeNull();
  });

  it("todo gateway tem instrução de onde colar e rótulo de evento conhecido", () => {
    for (const g of Object.keys(INFO_DO_GATEWAY) as Array<keyof typeof INFO_DO_GATEWAY>) expect(INFO_DO_GATEWAY[g].ondeColar.length).toBeGreaterThan(0);
    expect(INFO_DO_GATEWAY.asaas.segredoDoPainel).toBe(true);
    expect(rotuloDoEvento("pix_gerado")).toBe("Pix gerado");
    expect(rotuloDoEvento("desconhecido")).toBe("desconhecido");
  });

  it("chama a função com a ação certa", async () => {
    m.invoke.mockResolvedValueOnce({ data: { integracoes: [integ()] }, error: null });
    expect(await listarIntegracoes("c1", "stripe")).toHaveLength(1);
    expect(m.invoke).toHaveBeenLastCalledWith("vendas-webhook", { body: { acao: "integracao_listar", client_id: "c1", gateway: "stripe" } });

    m.invoke.mockResolvedValueOnce({ data: { integracao: integ({ gateway: "asaas" }), segredo: "abc" }, error: null });
    expect((await criarIntegracao(null, "asaas")).segredo).toBe("abc");
    expect(m.invoke).toHaveBeenLastCalledWith("vendas-webhook", { body: { acao: "integracao_criar", client_id: null, gateway: "asaas" } });

    m.invoke.mockResolvedValueOnce({ data: { integracao: integ({ tem_segredo: true }) }, error: null });
    await salvarSegredo("i1", { segredo: "whsec_123456" });
    expect(m.invoke).toHaveBeenLastCalledWith("vendas-webhook", { body: { acao: "integracao_segredo", id: "i1", segredo: "whsec_123456", token_api: null } });

    m.invoke.mockResolvedValueOnce({ data: { eventos: [] }, error: null });
    await listarEventos(null, { gateway: "stripe" });
    expect(m.invoke).toHaveBeenLastCalledWith("vendas-webhook", { body: { acao: "eventos_listar", client_id: null, gateway: "stripe", integracao_id: null, limite: 5 } });
  });

  it("erro da função vira ErroDeVendas com a frase do servidor", async () => {
    const resposta = new Response(JSON.stringify({ error: "somente_admin_ou_gestor", mensagem: "Só admin ou gestor liga o checkout." }), { status: 403 });
    m.invoke.mockResolvedValueOnce({ data: null, error: { name: "FunctionsHttpError", context: resposta } });
    await expect(listarIntegracoes(null)).rejects.toMatchObject({ codigo: "somente_admin_ou_gestor", message: "Só admin ou gestor liga o checkout." });
    m.invoke.mockResolvedValueOnce({ data: null, error: { name: "FunctionsFetchError" } });
    const e = await listarIntegracoes(null).catch((x) => x);
    expect(e).toBeInstanceOf(ErroDeVendas);
    expect(e.codigo).toBe("servico_indisponivel");
  });
});
