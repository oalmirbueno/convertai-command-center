import { describe, expect, it } from "vitest";
import {
  baseDoAsaas,
  criarCobrancaPix,
  documentoValido,
  pagamentoConfirmado,
  planoPorId,
  valorDoFechamento,
} from "../../supabase/functions/_shared/comercial-asaas";
import { textoFalado } from "../../supabase/functions/mcp-server/modulos/comercial-voz";

const resp = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status });

describe("Fala do executivo", () => {
  it("na voz o nome é Acelériq", () => {
    expect(textoFalado("Aqui é o Rafael, da Aceleriq.")).toBe("Aqui é o Rafael, da Acelériq.");
    expect(textoFalado("ACELERIQ")).toBe("Acelériq");
  });
});

describe("Fechamento pelo Asaas", () => {
  it("o valor vem da tabela: entrada mais a primeira mensalidade", () => {
    expect(valorDoFechamento(planoPorId("start_assistido")!)).toBe(1244);
    expect(valorDoFechamento(planoPorId("crescimento")!)).toBe(3994);
    expect(valorDoFechamento(planoPorId("crescimento")!, true)).toBe(4291);
    expect(valorDoFechamento(planoPorId("start_assistido")!, false, true)).toBe(1116.95);
    expect(valorDoFechamento(planoPorId("google_avulso")!, false, true)).toBe(297);
    expect(planoPorId("inventado")).toBeNull();
  });

  it("confere CPF e CNPJ pelo dígito", () => {
    expect(documentoValido("529.982.247-25")).toBe("52998224725");
    expect(documentoValido("11.222.333/0001-81")).toBe("11222333000181");
    expect(documentoValido("111.111.111-11")).toBeNull();
    expect(documentoValido("123")).toBeNull();
    expect(documentoValido("529.982.247-26")).toBeNull();
  });

  it("chave de teste vai para o sandbox e a de produção para a conta real", () => {
    expect(baseDoAsaas("$aact_hmlg_abc")).toContain("sandbox");
    expect(baseDoAsaas("$aact_prod_abc")).toBe("https://api.asaas.com");
  });

  it("cria cliente e cobrança e devolve o copia e cola; reaproveita cliente pelo documento", async () => {
    const chamadas: string[] = [];
    const buscar = async (url: string, init?: RequestInit) => {
      chamadas.push(`${init?.method} ${new URL(url).pathname}`);
      if (url.includes("/customers?")) return resp({ data: [] });
      if (url.endsWith("/customers")) return resp({ id: "cus_1" });
      if (url.endsWith("/pixQrCode")) return resp({ payload: "000201copia" });
      return resp({ id: "pay_1", invoiceUrl: "https://asaas/i/1" });
    };
    const c = await criarCobrancaPix("$aact_hmlg_x", buscar, { nome: "A", documento: "52998224725", valor: 1394, descricao: "d", referencia: "r", vencimento: "2026-11-08" });
    expect(c).toEqual({ cliente_id: "cus_1", pagamento_id: "pay_1", link: "https://asaas/i/1", pix_copia_e_cola: "000201copia" });
    expect(chamadas).toEqual(["GET /v3/customers", "POST /v3/customers", "POST /v3/payments", "GET /v3/payments/pay_1/pixQrCode"]);
  });

  it("só confirma com dinheiro recebido e o valor certo", async () => {
    const com = (status: string, value: number, extra = {}) => async () => resp({ status, value, ...extra });
    expect((await pagamentoConfirmado("t", com("RECEIVED", 1394, { clientPaymentDate: "2026-11-05" }), "pay_1", 1394)).pago).toBe(true);
    expect(await pagamentoConfirmado("t", com("PENDING", 1394), "pay_1", 1394)).toMatchObject({ pago: false, motivo: "status_PENDING" });
    expect(await pagamentoConfirmado("t", com("RECEIVED", 10), "pay_1", 1394)).toMatchObject({ pago: false, motivo: "valor_diferente" });
    expect(await pagamentoConfirmado("t", com("RECEIVED", 1394, { deleted: true }), "pay_1", 1394)).toMatchObject({ pago: false });
    expect((await pagamentoConfirmado("t", com("RECEIVED", 1394), "invalido", 1394)).motivo).toBe("pagamento_invalido");
  });
});
