import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 30/10/2026 (dono: "sim, corrija no painel a renovação que não é gerada"). A próxima cobrança só nascia no clique
 * do AdminFinanceiro; pago por MCP, Hermes, saldo de parcial ou "Recebi" da ficha não avançava a renovação.
 * O comportamento do gatilho é testado em PGlite: supabase/testes/renovacao_runner.mjs.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const sql = ler("supabase/migrations/20261030190000_renovacao_nasce_no_banco.sql");
const financeiro = ler("src/pages/AdminFinanceiro.tsx");

describe("renovação nasce no banco quando a cobrança vira paga", () => {
  it("gatilho só em renovação que acabou de virar paga", () => {
    expect(sql).toContain("AFTER UPDATE OF status ON public.billing");
    expect(sql).toContain("WHEN (NEW.type = 'renewal' AND NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid')");
  });

  it("função fechada: SECURITY DEFINER, search_path fixo, sem grant para anon/authenticated", () => {
    expect(sql).toContain("CREATE OR REPLACE FUNCTION app_private.renovacao_ao_pagar()");
    expect(sql).toContain("SECURITY DEFINER\n SET search_path TO ''");
    expect(sql).toContain("REVOKE ALL ON FUNCTION app_private.renovacao_ao_pagar() FROM anon, authenticated;");
    expect(sql).not.toMatch(/GRANT\s+EXECUTE/i);
  });

  it("não avança cobrança velha, cliente parado nem empresa do grupo; não duplica a próxima", () => {
    expect(sql).toContain("IF NEW.due_date < _perfil.plan_renewal_date THEN");
    expect(sql).toContain("COALESCE(_perfil.plan_status, '') IN ('inactive', 'standby')");
    expect(sql).toContain("services_config ->> 'internal_company'");
    expect(sql).toContain("b.status IS DISTINCT FROM 'cancelled'");
  });

  it("a tela não avança a data nem cria a próxima cobrança por conta própria", () => {
    expect(financeiro).not.toContain("plan_renewal_date: newDate");
    expect(financeiro).not.toContain('update({ status: "in_progress" })');
    expect(financeiro).toContain("billing_renovacao_ao_pagar");
  });
});
