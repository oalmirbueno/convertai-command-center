import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { andamentoDoUnico, conferirExtra, montarParcelas, resumoDosExtras, somarMeses, type Extra } from "@/lib/extrasDoCliente";

// 14/11/2026 (dono): order bumps e upsells por cliente, com entrada livre e o restante parcelado, mensal
// que começa depois da entrega, comissão em percentual, e tudo no financeiro sem duplicar.
const ler = (c: string) => readFileSync(resolve(process.cwd(), c), "utf8");
const MIG = ler("supabase/migrations/20261114120000_extras_do_cliente.sql");
const TELA = ler("src/components/clientes/ExtrasDoCliente.tsx");
const soma = (l: { valor: number }[]) => Math.round(l.reduce((s, p) => s + p.valor, 0) * 100) / 100;

describe("entrada livre e o restante em parcelas", () => {
  it("R$ 6.500 com R$ 3.000 de entrada paga e o resto em 2 vezes", () => {
    const l = montarParcelas({ total: 6500, entrada: 3000, entradaPaga: true, entradaEm: "2026-11-13", parcelas: 2, primeiraEm: "2026-12-13" });
    expect(l.map((p) => [p.valor, p.vencimento, p.paga, p.rotulo])).toEqual([
      [3000, "2026-11-13", true, "entrada"],
      [1750, "2026-12-13", false, "parcela 1/2"],
      [1750, "2027-01-13", false, "parcela 2/2"],
    ]);
    expect(soma(l)).toBe(6500);
  });
  it("o centavo que sobra da divisão vai para a última parcela", () => {
    const l = montarParcelas({ total: 1000, entrada: 0, entradaPaga: false, entradaEm: "2026-11-14", parcelas: 3, primeiraEm: "2026-12-10" });
    expect(l.map((p) => p.valor)).toEqual([333.33, 333.33, 333.34]);
    expect(soma(l)).toBe(1000);
  });
  it("entrada igual ao total vira pagamento único; sem entrada, tudo é parcela", () => {
    const tudo = montarParcelas({ total: 597, entrada: 597, entradaPaga: true, entradaEm: "2026-11-14", parcelas: 4, primeiraEm: "2026-12-14" });
    expect(tudo).toHaveLength(1);
    expect(tudo[0].rotulo).toBe("pagamento único");
    expect(montarParcelas({ total: 597, entrada: 0, entradaPaga: true, entradaEm: "2026-11-14", parcelas: 1, primeiraEm: "2026-12-14" })[0].rotulo).toBe("parcela 1/1");
  });
  it("parcela no dia 31 cai no último dia dos meses mais curtos", () => {
    expect(somarMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(somarMeses("2026-10-31", 1)).toBe("2026-11-30");
    expect(somarMeses("2026-11-13", 2)).toBe("2027-01-13");
  });
});

describe("o que falta para salvar", () => {
  const base = { nome: "Suporte", cobranca: "mensal" as const, valor: 397, percentual: 0, comecaAgora: true, inicio: "2026-12-01", parcelas: [] };
  it("mensal pode ficar para depois da entrega, sem data", () => {
    expect(conferirExtra(base)).toBeNull();
    expect(conferirExtra({ ...base, comecaAgora: false, inicio: "" })).toBeNull();
    expect(conferirExtra({ ...base, inicio: "" })).toContain("começa a cobrar");
    expect(conferirExtra({ ...base, valor: 0 })).toContain("valor");
    expect(conferirExtra({ ...base, nome: " " })).toContain("comprando");
  });
  it("único exige parcelas que fecham; comissão exige percentual", () => {
    const p = [{ valor: 100, vencimento: "2026-12-01", paga: false }];
    expect(conferirExtra({ ...base, cobranca: "unico", valor: 100, parcelas: p })).toBeNull();
    expect(conferirExtra({ ...base, cobranca: "unico", valor: 150, parcelas: p })).toContain("não somam");
    expect(conferirExtra({ ...base, cobranca: "comissao", valor: 0, percentual: 2.5 })).toBeNull();
    expect(conferirExtra({ ...base, cobranca: "comissao", valor: 0, percentual: 0 })).toContain("percentual");
  });
});

describe("resumo dos extras do cliente", () => {
  const e = (cobranca: Extra["cobranca"], valor: number, status: Extra["status"]): Extra => ({ id: `${cobranca}-${valor}-${status}`, client_id: "c", nome: "x", categoria: "outro", cobranca, valor, percentual: null, base_da_comissao: null, inicio: null, dia_vencimento: null, status, encerrado_em: null, observacao: null, created_at: "" });
  it("só o mensal ativo entra no valor por mês; o que espera a entrega fica à parte", () => {
    const r = resumoDosExtras([e("mensal", 397, "ativo"), e("mensal", 1970, "aguardando"), e("mensal", 99.8, "ativo"), e("mensal", 50, "encerrado"), e("unico", 6500, "ativo")]);
    expect(r).toEqual({ porMes: 496.8, aguardando: 1970, ativos: 4 });
  });
  it("valor único mostra quanto entrou, quanto falta e a próxima data", () => {
    const c = (amount: number, status: string, due: string) => ({ id: due, extra_id: "e", amount, paid_amount: status === "paid" ? amount : null, status, due_date: due, paid_date: null, description: null });
    expect(andamentoDoUnico([c(3000, "paid", "2026-11-13"), c(1750, "pending", "2027-01-13"), c(1750, "pending", "2026-12-13")])).toEqual({ pago: 3000, aberto: 3500, proxima: "2026-12-13" });
  });
});

describe("regras no banco", () => {
  it("a cobrança de extra nunca é 'renewal' (não empurra a renovação do plano)", () => {
    expect(MIG).toContain("VALUES (_extra.client_id, 'extra', _extra.valor,");
    expect(MIG).toContain("VALUES (_e.client_id, 'one_off', (_p->>'valor')::numeric,");
    expect(MIG).not.toMatch(/VALUES \([^)]*'renewal'/);
  });
  it("um extra não gera duas cobranças do mesmo mês", () => {
    expect(MIG).toContain("CREATE UNIQUE INDEX IF NOT EXISTS billing_extra_competencia_uidx");
    expect(MIG.match(/ON CONFLICT \(extra_id, competencia\)/g)?.length).toBe(2);
  });
  it("só o admin cria, inicia, encerra e lança comissão", () => {
    expect(MIG.match(/PERFORM app_private\.extras_so_admin\(\);/g)?.length).toBe(4);
    expect(MIG).toContain("REVOKE ALL ON public.client_extras FROM anon;");
  });
  it("encerrar não apaga o que foi pago", () => {
    expect(MIG).toContain("DELETE FROM public.billing WHERE extra_id = _id AND status = 'pending' AND due_date > _dia;");
  });
  it("a rotina do mês roda todo dia e pula cliente inativo", () => {
    expect(MIG).toContain("cron.schedule('extras-gerar-mensais'");
    expect(MIG).toContain("COALESCE(p.plan_status, 'active') <> 'inactive'");
  });
});

describe("tela", () => {
  it("toda cobrança nasce pelo banco, nunca por insert direto na tela", () => {
    expect(TELA).toContain('rpc("extra_salvar"');
    expect(TELA).toContain('rpc("extra_iniciar"');
    expect(TELA).toContain('rpc("extra_lancar_comissao"');
    expect(TELA).toContain('rpc("extra_encerrar"');
    expect(TELA).not.toMatch(/from\("billing"\)\.(insert|update|delete)/);
  });
  it("fica na ficha do cliente, na aba de plano, e o Financeiro reconhece o tipo", () => {
    expect(ler("src/components/admin/EditClientDrawer.tsx")).toContain("<ExtrasDoCliente clientId={client.id}");
    expect(ler("src/pages/AdminFinanceiro.tsx")).toContain('if (type === "extra") return "EXT";');
  });
});
