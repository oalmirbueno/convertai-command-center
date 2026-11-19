import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { modoDaConta, mudancaDoModo } from "@/lib/produto/produtosDoCliente";

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

describe("E-mail e CRM no plano do cliente (19/11/2026)", () => {
  it("como é cobrado decide onde a mensalidade soma", () => {
    expect(modoDaConta({ estado: "ativa", cobranca_por: "plano" })).toBe("plano");
    expect(modoDaConta({ estado: "ativa", cobranca_por: "assinatura" })).toBe("site");
    expect(modoDaConta({ estado: "cortesia", cobranca_por: "plano" })).toBe("cortesia");
    expect(mudancaDoModo("plano", { estado: "ativa", cobranca_por: "assinatura" })).toEqual({ cobranca_por: "plano" });
    expect(mudancaDoModo("cortesia", { estado: "ativa", cobranca_por: "plano" })).toEqual({ estado: "cortesia" });
    expect(mudancaDoModo("site", { estado: "cortesia", cobranca_por: "plano" })).toEqual({ estado: "ativa", cobranca_por: "assinatura" });
  });

  it("o plano do cliente mostra os produtos e cadastra quem usa o CRM com o envio do acesso", () => {
    expect(ler("src/components/clientes/ExtrasDoCliente.tsx")).toContain("<ProdutosNoPlano clientId={clientId} crm={crm} />");
    const bloco = ler("src/components/clientes/ProdutosNoPlano.tsx");
    expect(bloco).toContain("casa.convidar(");
    expect(bloco).toContain("data-modo-de-cobranca");
  });
});
