import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const raiz = resolve(__dirname, "../..");
const ler = (c: string) => readFileSync(resolve(raiz, c), "utf8");
const modal = ler("src/components/admin/CreateClientModal.tsx");
const cobrancas = ler("src/components/admin/CobrancasDoCliente.tsx");
const drawer = ler("src/components/admin/EditClientDrawer.tsx");

/**
 * Uma cliente entrou sem pagar a mensalidade e ficou registrada como PAGA:
 * o cadastro assumia que todo pagamento inicial já tinha caído ("motivo do
 * cadastro"), sem pergunta. E não havia onde corrigir — o financeiro mentia
 * até alguém caçar a linha no banco.
 */

describe("o cadastro pergunta em vez de presumir", () => {
  it("a mensalidade tem a escolha recebida/vai pagar", () => {
    expect(modal).toContain("mensalidadeRecebida");
    expect(modal).toContain("Vai pagar");
    expect(modal).toContain('mensalidadeRecebida ? "paid" : "pending"');
  });

  it("mensalidade não recebida nasce pendente e sem data de pagamento", () => {
    expect(modal).toContain("paid_date: mensalidadeRecebida ? todayStr : null");
    expect(modal).toContain("paid_amount: mensalidadeRecebida ? planValueNum : null");
  });

  it("recebido continua sendo o padrão — o caso comum não ganha passo extra", () => {
    expect(modal).toContain("const [mensalidadeRecebida, setMensalidadeRecebida] = useState(true)");
    expect(modal).toContain("const [entradaRecebida, setEntradaRecebida] = useState(true)");
  });
});

describe("a entrada pode ter valor próprio", () => {
  it("o campo existe e vazio mantém parcelas iguais", () => {
    expect(modal).toContain("Valor da entrada (R$)");
    expect(modal).toContain("vazio = parcelas iguais");
  });

  it("entrada fora da faixa é ignorada em vez de quebrar a conta", () => {
    // Entrada >= total ou <= 0 cai no rateio igual: registro impossível não
    // entra no financeiro.
    expect(modal).toContain("entradaNum > 0 && entradaNum < projValueNum");
  });

  it("o restante é dividido e a última parcela acerta o arredondamento", () => {
    expect(modal).toContain("(projValueNum - primeira) / (n - 1)");
    expect(modal).toContain("projValueNum - primeira - restantePer * (n - 2)");
  });

  it("a 1ª não recebida vence na data informada, não hoje", () => {
    expect(modal).toContain("due_date: primeiraRecebida ? todayIso : dueStr");
  });
});

describe("qualquer valor é corrigível no cliente", () => {
  it("o drawer monta o editor de cobranças", () => {
    expect(drawer).toContain("<CobrancasDoCliente clientId={client.id} />");
  });

  it("valor e vencimento editam na linha", () => {
    expect(cobrancas).toContain('aria-label="Valor da cobrança"');
    expect(cobrancas).toContain('aria-label="Vencimento da cobrança"');
  });

  it("pago por engano tem caminho de volta", () => {
    // Sem o reverso, o engano virava registro definitivo.
    expect(cobrancas).toContain('{ status: "pending", paid_date: null, paid_amount: null }');
  });

  it("corrigir o valor de uma paga corrige também o recebido", () => {
    // Senão o financeiro somaria o valor antigo para sempre.
    expect(cobrancas).toMatch(/status === "paid" \? \{ paid_amount: \+valor\.toFixed\(2\) \}/);
  });

  it("valor zero ou negativo é recusado", () => {
    expect(cobrancas).toContain("Informe um valor maior que zero.");
  });
});
