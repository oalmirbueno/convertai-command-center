import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  baseDoAsaas,
  desdeDias,
  ehLicencaDk,
  lancamentoDoPagamento,
  sincronizarLicencas,
  totaisPorMes,
  type Lancamento,
  type PagamentoDoAsaas,
} from "../../supabase/functions/_shared/licencas-dk";

const raiz = resolve(__dirname, "../..");
const ler = (arquivo: string) => readFileSync(resolve(raiz, arquivo), "utf8");
const DK = "eae16e8d-174a-4f4c-9613-4944571f7235";
const DESCRICAO = "Infraestrutura, servidor e suporte da plataforma DK Sorteios - Gerente";

const pagamento = (over: Partial<PagamentoDoAsaas> = {}): PagamentoDoAsaas => ({
  id: "pay_lic0001",
  status: "RECEIVED",
  value: 597,
  netValue: 595.01,
  billingType: "PIX",
  externalReference: "LICC19F9CA5",
  description: DESCRICAO,
  dateCreated: "2026-11-03",
  clientPaymentDate: "2026-11-05",
  paymentDate: "2026-11-05",
  ...over,
});

/** Um Asaas falso: guarda o que foi pedido e devolve as páginas por situação. */
function asaasFalso(porSituacao: Record<string, PagamentoDoAsaas[]>, porPagina = 100) {
  const pedidos: string[] = [];
  const buscar = async (url: string, init?: RequestInit) => {
    pedidos.push(url);
    expect((init?.headers as Record<string, string>).access_token).toBe("$aact_hmlg_teste");
    const u = new URL(url);
    const lista = porSituacao[u.searchParams.get("status") || ""] || [];
    const offset = Number(u.searchParams.get("offset"));
    const limite = Math.min(Number(u.searchParams.get("limit")), porPagina);
    const data = lista.slice(offset, offset + limite);
    return new Response(JSON.stringify({ data, hasMore: offset + limite < lista.length }), { status: 200 });
  };
  return { buscar, pedidos };
}

describe("licenças DK: o que é licença", () => {
  it("reconhece pela referência LIC e pela descrição da plataforma, as duas juntas", () => {
    expect(ehLicencaDk(pagamento())).toBe(true);
    expect(ehLicencaDk(pagamento({ externalReference: "lic-abc" }))).toBe(true);
    expect(ehLicencaDk(pagamento({ externalReference: "PLANO-ESSENCIAL" }))).toBe(false);
    expect(ehLicencaDk(pagamento({ description: "Plano Essencial Aceleriq" }))).toBe(false);
    expect(ehLicencaDk(pagamento({ externalReference: null }))).toBe(false);
    expect(ehLicencaDk(pagamento({ deleted: true }))).toBe(false);
    expect(ehLicencaDk(pagamento({ id: "xyz" }))).toBe(false);
  });

  it("vira lançamento com bruto, líquido, forma, cliente DK e a data do recebimento", () => {
    expect(lancamentoDoPagamento(pagamento(), DK)).toEqual<Lancamento>({
      asaas_pagamento_id: "pay_lic0001",
      cliente_id: DK,
      referencia: "LICC19F9CA5",
      descricao: DESCRICAO,
      forma: "PIX",
      situacao: "recebido",
      bruto: 597,
      liquido: 595.01,
      pago_em: "2026-11-05",
      recebido_em: "2026-11-05",
      criado_no_asaas: "2026-11-03",
    });
  });

  it("cartão confirmado: fica 'confirmado' e, sem crédito ainda, usa o dia em que o cliente pagou", () => {
    const l = lancamentoDoPagamento(pagamento({ status: "CONFIRMED", billingType: "CREDIT_CARD", value: 397, netValue: 378.66, paymentDate: null, clientPaymentDate: null, confirmedDate: "2026-11-10" }), DK);
    expect(l).toMatchObject({ situacao: "confirmado", forma: "CREDIT_CARD", bruto: 397, liquido: 378.66, pago_em: "2026-11-10", recebido_em: "2026-11-10" });
  });

  it("não grava o que não foi pago ou não fecha", () => {
    expect(lancamentoDoPagamento(pagamento({ status: "PENDING" }), DK)).toBeNull();
    expect(lancamentoDoPagamento(pagamento({ status: "OVERDUE" }), DK)).toBeNull();
    expect(lancamentoDoPagamento(pagamento({ netValue: 700 }), DK)).toBeNull();
    expect(lancamentoDoPagamento(pagamento({ value: 0 }), DK)).toBeNull();
    expect(lancamentoDoPagamento(pagamento({ value: "abc" }), DK)).toBeNull();
  });

  it("estorno fica marcado como estornado", () => {
    expect(lancamentoDoPagamento(pagamento({ status: "REFUNDED" }), DK)?.situacao).toBe("estornado");
  });

  it("sandbox pela chave _hmlg_ e produção pelas outras", () => {
    expect(baseDoAsaas("$aact_hmlg_x")).toBe("https://api-sandbox.asaas.com");
    expect(baseDoAsaas("$aact_prod_x")).toBe("https://api.asaas.com");
  });
});

describe("licenças DK: sincronização contra um Asaas simulado", () => {
  const outroDoComercial: PagamentoDoAsaas = { ...pagamento({ id: "pay_comercial1", externalReference: "lead-123", description: "Plano Essencial" }) };
  const pix = pagamento();
  const cartao = pagamento({ id: "pay_lic0002", status: "CONFIRMED", billingType: "CREDIT_CARD", value: 397, netValue: 378.66, paymentDate: "2026-12-07", clientPaymentDate: "2026-11-06" });
  const estornado = pagamento({ id: "pay_lic0003", status: "REFUNDED", value: 397, netValue: 395.01, paymentDate: "2026-11-08" });

  it("lê todas as situações, página por página, e grava só as licenças, pelo id do pagamento", async () => {
    const muitos = Array.from({ length: 130 }, (_, i) => pagamento({ id: `pay_lote${i}`, paymentDate: "2026-10-15" }));
    const { buscar, pedidos } = asaasFalso({ RECEIVED: [pix, outroDoComercial, ...muitos], CONFIRMED: [cartao], REFUNDED: [estornado] });
    const gravados: Lancamento[][] = [];
    const r = await sincronizarLicencas({ token: "$aact_hmlg_teste", buscar, clienteId: DK, desde: "2026-07-22", gravar: async (l) => void gravados.push(l) });
    expect(r).toEqual({ lidos: 134, licencas: 133, gravados: 133, ignorados: 0 });
    expect(gravados).toHaveLength(1);
    expect(new Set(gravados[0].map((l) => l.asaas_pagamento_id)).size).toBe(133);
    expect(gravados[0].every((l) => l.cliente_id === DK)).toBe(true);
    expect(pedidos.every((u) => u.startsWith("https://api-sandbox.asaas.com/v3/payments?") && new URL(u).searchParams.get("dateCreated[ge]") === "2026-07-22")).toBe(true);
    expect(pedidos.filter((u) => new URL(u).searchParams.get("status") === "RECEIVED")).toHaveLength(2);
  });

  it("rodar duas vezes grava as mesmas linhas (idempotente pelo id)", async () => {
    const banco = new Map<string, Lancamento>();
    const gravar = async (linhas: Lancamento[]) => linhas.forEach((l) => banco.set(l.asaas_pagamento_id, l));
    const { buscar } = asaasFalso({ RECEIVED: [pix], CONFIRMED: [cartao] });
    await sincronizarLicencas({ token: "$aact_hmlg_teste", buscar, clienteId: DK, desde: null, gravar });
    const primeira = JSON.stringify([...banco.entries()]);
    await sincronizarLicencas({ token: "$aact_hmlg_teste", buscar, clienteId: DK, desde: null, gravar });
    expect(JSON.stringify([...banco.entries()])).toBe(primeira);
    expect(banco.size).toBe(2);
  });

  it("o cartão que cai depois troca de confirmado para recebido na mesma linha", async () => {
    const banco = new Map<string, Lancamento>();
    const gravar = async (linhas: Lancamento[]) => linhas.forEach((l) => banco.set(l.asaas_pagamento_id, l));
    await sincronizarLicencas({ token: "$aact_hmlg_teste", buscar: asaasFalso({ CONFIRMED: [cartao] }).buscar, clienteId: DK, desde: null, gravar });
    expect(banco.get("pay_lic0002")?.situacao).toBe("confirmado");
    await sincronizarLicencas({ token: "$aact_hmlg_teste", buscar: asaasFalso({ RECEIVED: [{ ...cartao, status: "RECEIVED" }] }).buscar, clienteId: DK, desde: null, gravar });
    expect(banco.size).toBe(1);
    expect(banco.get("pay_lic0002")?.situacao).toBe("recebido");
  });

  it("erro do Asaas interrompe sem gravar nada", async () => {
    let gravou = false;
    const buscar = async () => new Response(JSON.stringify({ errors: [{ description: "Chave inválida" }] }), { status: 401 });
    await expect(sincronizarLicencas({ token: "$aact_hmlg_teste", buscar, clienteId: DK, desde: null, gravar: async () => void (gravou = true) })).rejects.toThrow("Chave inválida");
    expect(gravou).toBe(false);
  });

  it("a janela da rotina é contada em dias", () => {
    expect(desdeDias(120, Date.UTC(2026, 10, 19, 12))).toBe("2026-07-22");
  });
});

describe("licenças DK: totais da tela", () => {
  it("soma bruto, taxas e líquido por mês do recebimento, sem os estornos", () => {
    const linhas = [
      { asaas_pagamento_id: "pay_1", forma: "PIX", situacao: "recebido" as const, bruto: 597, liquido: 595.01, recebido_em: "2026-11-05" },
      { asaas_pagamento_id: "pay_2", forma: "CREDIT_CARD", situacao: "confirmado" as const, bruto: "397.00", liquido: "378.66", recebido_em: "2026-11-20" },
      { asaas_pagamento_id: "pay_3", forma: "PIX", situacao: "estornado" as const, bruto: 397, liquido: 395.01, recebido_em: "2026-11-08" },
      { asaas_pagamento_id: "pay_4", forma: "PIX", situacao: "recebido" as const, bruto: 397, liquido: 395.01, recebido_em: "2026-10-30" },
    ];
    expect(totaisPorMes(linhas)).toEqual([
      { mes: "2026-11", pagamentos: 2, bruto: 994, taxas: 20.33, liquido: 973.67, estornados: 1 },
      { mes: "2026-10", pagamentos: 1, bruto: 397, taxas: 1.99, liquido: 395.01, estornados: 0 },
    ]);
  });
});

describe("licenças DK: guardas", () => {
  const migracao = ler("supabase/migrations/20261120090000_licencas_dk_financeiro.sql");
  const funcao = ler("supabase/functions/licencas-dk-sync/index.ts");

  it("a tabela é só do admin e fica fora de public.billing (que o cliente lê)", () => {
    expect(migracao).toMatch(/enable row level security/);
    expect(migracao).toMatch(/licencas_dk_pagamentos_admin_le[\s\S]*has_role\(\(select auth\.uid\(\)\), 'admin'/);
    expect(migracao).not.toMatch(/insert into public\.billing/i);
    expect(migracao).toMatch(/revoke all on public\.licencas_dk_pagamentos from anon, authenticated/);
    expect(migracao).toMatch(/asaas_pagamento_id text primary key/);
    expect(migracao).toMatch(/taxa numeric\(12, 2\) generated always as \(bruto - liquido\)/);
  });

  it("a função só roda para a rotina ou para admin, grava por upsert no id e lê a chave do cofre", () => {
    expect(funcao).toMatch(/if \(!rotina && !\(await ehAdmin\(req\)\)\) return json\(\{ error: "sem_permissao" \}, 403\)/);
    expect(funcao).toMatch(/onConflict: "asaas_pagamento_id"/);
    expect(funcao).toMatch(/chave\("ASAAS_API_KEY"\)/);
    expect(funcao).not.toMatch(/billing/);
  });

  it("a aba mora no Financeiro só para admin, ao lado do v1", () => {
    const tela = ler("src/pages/AdminFinanceiro.tsx");
    expect(tela).toMatch(/\{ valor: "licencas-dk", rotulo: "Licenças DK", papeis: "admin"/);
    expect(tela).toMatch(/isAdmin && aba === "licencas-dk"/);
    expect(ler("src/pages/ClientFinanceiro.tsx")).not.toMatch(/licencas/i);
  });
});
