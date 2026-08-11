import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8");

const legacyFinance = read("src/pages/AdminFinanceiro.tsx");
const financeV2 = read("src/components/finance/FinanceV2.tsx");
const financeHook = read("src/hooks/useFinanceV2.ts");
const migration = read(
  "supabase/migrations/20260810150000_financial_v2_foundation.sql",
);

const stripSqlComments = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "");

const sqlStatements = stripSqlComments(migration)
  .split(";")
  .map((statement) => statement.trim())
  .filter(Boolean);

function tabItems(source: string) {
  const block = source.match(
    /const\s+TAB_ITEMS(?:\s*:[^=]+)?\s*=\s*\[([\s\S]*?)\]\s*(?:as\s+const)?\s*;/,
  )?.[1];
  if (!block) return [];

  return [...block.matchAll(/\{([\s\S]*?)\}/g)].map((match) => {
    const value = match[1].match(/\bvalue\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    const label = match[1].match(/\blabel\s*:\s*["'`]([^"'`]+)["'`]/)?.[1];
    return { value, label };
  });
}

describe("Financeiro V2 frontend contract", () => {
  it("keeps the legacy finance screen free from automatic billing writes on mount", () => {
    expect(legacyFinance).not.toMatch(/\bauto[-_ ]?sync\b/i);
    expect(legacyFinance).not.toContain("autoSyncDone");
    expect(legacyFinance).not.toContain("handleSyncBilling");
    expect(legacyFinance).not.toMatch(
      /useEffect\s*\([\s\S]{0,1800}?(?:\.insert\s*\(|\.upsert\s*\(|\.update\s*\(|\.delete\s*\(|\.rpc\s*\(|\.mutate(?:Async)?\s*\()/,
    );
  });

  it("exposes exactly the five approved top-level finance tabs", () => {
    expect(tabItems(financeV2)).toEqual([
      { value: "overview", label: "Visão geral" },
      { value: "cash-flow", label: "Fluxo de caixa" },
      { value: "subscriptions", label: "Mensalidades" },
      { value: "fixed-costs", label: "Custos fixos" },
      { value: "plans", label: "Planos e preços" },
    ]);
  });

  it("requires an explicit confirmation before generating a competence", () => {
    expect(financeV2).toContain("<AlertDialog");
    expect(financeV2).toContain("<AlertDialogAction");
    expect(financeV2).toMatch(
      /const\s+generate\s*=\s*async\s*\(\s*\)\s*=>\s*\{[\s\S]*?generateCompetence\.mutateAsync\s*\(\s*\{\s*competence\s*\}\s*\)/,
    );
    expect(financeV2).toMatch(
      /<AlertDialogAction[\s\S]*?onClick=\{(?:generate|\(\s*\)\s*=>\s*(?:void\s+)?generate\(\s*\))\}[\s\S]*?<\/AlertDialogAction>/,
    );
    expect(financeV2).not.toMatch(
      /<(?:button|Button)[^>]*onClick=\{[^}]*generateCompetence\.mutate(?:Async)?/,
    );
  });

  it("routes every Financeiro V2 mutation through a versioned RPC", () => {
    const mutationSource = financeHook.slice(
      financeHook.indexOf("export function useFinanceMutations"),
    );
    const rpcArguments = [...mutationSource.matchAll(/\.rpc\s*\(\s*([^,\n)]+)/g)]
      .map((match) => match[1].trim());

    expect(mutationSource).not.toBe("");
    expect(rpcArguments.length).toBeGreaterThanOrEqual(4);
    expect(rpcArguments.every((argument) =>
      /^FINANCE_V2_CONTRACT\.rpc\./.test(argument)
      || /^["'`]financial_[a-z0-9_]+["'`]$/i.test(argument)
    )).toBe(true);
    expect(mutationSource).not.toMatch(
      /\.from\s*\([^)]*\)\s*\.\s*(?:insert|upsert|update|delete)\s*\(/,
    );

    for (const rpcName of [
      "financial_generate_competence",
      "financial_record_settlement",
      "financial_reverse_settlement",
      "financial_assign_client_plan",
      "financial_create_plan_version",
      "financial_update_settings",
    ]) {
      expect(financeHook).toContain(rpcName);
    }
  });

  it("reads cash flow through the canonical RPC and keeps MRR monthly and reviewed", () => {
    expect(financeHook).toContain("financial_cash_flow_v2");
    expect(financeHook).toMatch(
      /FINANCE_V2_CONTRACT\.rpc\.cashFlow[\s\S]{0,300}p_mode:\s*mode[\s\S]{0,180}p_competence:\s*normalizedCompetence/,
    );
    expect(financeHook).toMatch(
      /const\s+planAmount\s*=[\s\S]{0,260}operationalAmount\s*\/\s*billingMonths\[billingPeriod\]/,
    );
    expect(financeHook).toMatch(
      /status:\s*stringOf\(row\.status,\s*row\.term_status,\s*row\.plan_status\)/,
    );
    expect(financeV2).toMatch(
      /activeSummaries\s*=\s*summaries\.filter\(\(client\)\s*=>\s*client\.status\s*===\s*"active"\s*&&\s*!client\.reviewRequired\)/,
    );
    expect(financeV2).toContain("nextCompetenceStart");
    expect(financeV2).toMatch(/\^\\d\{4\}-\\d\{2\}-01\$/);
    expect(financeHook).toContain("upcomingStartsOn");
    expect(financeV2).toContain("Programado:");
  });
});

describe("Financeiro V2 database contract", () => {
  it("enables RLS and declares grants and PUBLIC revocations for every V2 table", () => {
    const v2Tables = [...migration.matchAll(
      /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+public\.([a-z][a-z0-9_]*)/gi,
    )].map((match) => match[1]);

    expect(v2Tables.length).toBeGreaterThanOrEqual(8);
    expect(new Set(v2Tables).size).toBe(v2Tables.length);

    for (const table of v2Tables) {
      expect(migration).toMatch(new RegExp(
        `ALTER\\s+TABLE\\s+public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`,
        "i",
      ));
      expect(sqlStatements.some((statement) =>
        /^REVOKE\b/i.test(statement)
        && statement.includes(`public.${table}`)
        && /\bFROM\s+PUBLIC\b/i.test(statement)
      )).toBe(true);
      expect(sqlStatements.some((statement) =>
        /^GRANT\b/i.test(statement)
        && statement.includes(`public.${table}`)
        && /\bTO\s+(?:authenticated|service_role)\b/i.test(statement)
      )).toBe(true);
    }
  });

  it("keeps views and caller-facing functions on invoker security", () => {
    expect(migration).toMatch(
      /WITH\s*\(\s*security_invoker\s*=\s*true\s*\)/i,
    );
    expect(migration).toMatch(/\bSECURITY\s+INVOKER\b/i);
  });

  it("keeps internal finance rows and payloads restricted to staff readers", () => {
    const termsPolicy = migration.match(
      /CREATE\s+POLICY\s+financial_client_terms_read[\s\S]*?\);/i,
    )?.[0] ?? "";
    const entriesPolicy = migration.match(
      /CREATE\s+POLICY\s+financial_entries_read[\s\S]*?\);/i,
    )?.[0] ?? "";
    const summariesFunction = migration.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.financial_client_summaries_v2\(\)[\s\S]*?\$\$;/i,
    )?.[0] ?? "";
    const cashFlowFunction = migration.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.financial_cash_flow_v2\([\s\S]*?\$\$;/i,
    )?.[0] ?? "";

    for (const policy of [termsPolicy, entriesPolicy]) {
      expect(policy).toContain("'admin'::public.app_role");
      expect(policy).toContain("'manager'::public.app_role");
      expect(policy).not.toMatch(/\bclient_id\s*=\s*auth\.uid\(\)/i);
    }
    for (const fn of [summariesFunction, cashFlowFunction]) {
      expect(fn).toContain("'admin'::public.app_role");
      expect(fn).toContain("'manager'::public.app_role");
    }
    expect(migration).not.toMatch(/CREATE\s+POLICY\s+financial_(?:plans|plan_versions)_client_read/i);
  });

  it("revokes PUBLIC execution from every V2 function before explicit grants", () => {
    const v2Functions = [...migration.matchAll(
      /CREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+public\.(financial_[a-z0-9_]+)\s*\(/gi,
    )].map((match) => match[1]);

    expect(v2Functions.length).toBeGreaterThanOrEqual(6);
    for (const functionName of new Set(v2Functions)) {
      expect(sqlStatements.some((statement) =>
        /^REVOKE\b/i.test(statement)
        && new RegExp(`\\bFUNCTION\\s+public\\.${functionName}\\s*\\(`, "i").test(statement)
        && /\bFROM\s+PUBLIC\b/i.test(statement)
      )).toBe(true);
    }

    for (const rpcName of [
      "financial_generate_competence",
      "financial_record_settlement",
      "financial_reverse_settlement",
      "financial_assign_client_plan",
      "financial_cash_flow_v2",
      "financial_create_plan_version",
      "financial_update_settings",
    ]) {
      expect(sqlStatements.some((statement) =>
        /^GRANT\s+EXECUTE\b/i.test(statement)
        && statement.includes(`public.${rpcName}(`)
        && /\bTO\s+authenticated\b/i.test(statement)
      )).toBe(true);
    }
  });

  it("makes competence generation and settlements idempotent", () => {
    const uniqueStatements = sqlStatements.filter((statement) =>
      /\bUNIQUE\b/i.test(statement),
    );

    expect(migration).toMatch(/\bidempotency_key\b/i);
    expect(uniqueStatements.some((statement) =>
      /\bidempotency_key\b/i.test(statement)
    )).toBe(true);
    expect(uniqueStatements.some((statement) =>
      /\bcompetenc(?:e|y|ia)[a-z_]*\b/i.test(statement)
    )).toBe(true);
    expect(migration).toMatch(/\bON\s+CONFLICT\b/i);
    expect(migration).toContain("'term-setup:' || term_row.id::text");
    expect(migration).toContain("'setup_entries', setup_count");
  });

  it("projects unmaterialized terms and rules without duplicating generated entries", () => {
    expect(migration).toMatch(/forecast_term_items\s+AS\s*\(/i);
    expect(migration).toMatch(/forecast_rule_items\s+AS\s*\(/i);
    expect(migration).toMatch(/forecast_setup_items\s+AS\s*\(/i);
    expect(migration).toMatch(/entry_row\.idempotency_key\s*=\s*'term:'/i);
    expect(migration).toMatch(/entry_row\.idempotency_key\s*=\s*'rule:'/i);
  });

  it("blocks financial mutations after monthly closing", () => {
    expect(migration).toMatch(/\bfinancial_[a-z0-9_]*(?:close|closing|period)[a-z0-9_]*\b/i);
    expect(migration).toMatch(/\b(?:closed_at|is_closed|period_status)\b/i);
    expect(migration).toMatch(
      /RAISE\s+EXCEPTION[\s\S]{0,240}(?:closed|fechad)/i,
    );
    expect(migration).toMatch(/\bFOR\s+UPDATE\b/i);
    expect(migration).toMatch(
      /target_competence\s*:=\s*date_trunc\([\s\S]{0,160}(?:NEW|OLD)\.settled_on/i,
    );
    const lockFunction = migration.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+app_private\.financial_lock_open_period\(p_competence\s+date\)[\s\S]*?\$\$;/i,
    )?.[0] ?? "";
    expect(lockFunction).toMatch(/INSERT\s+INTO\s+public\.financial_period_closures/i);
    expect(lockFunction).toMatch(/ON\s+CONFLICT\s*\(competence\)\s+DO\s+NOTHING/i);
    expect(lockFunction).toMatch(/WHERE\s+closure_row\.competence\s*=\s*normalized_competence[\s\S]*?FOR\s+UPDATE/i);
    expect(lockFunction).not.toMatch(/WHERE[\s\S]*?period_status\s*=\s*'closed'[\s\S]*?FOR\s+UPDATE/i);
  });

  it("keeps plan changes on competence boundaries and includes every client in summaries", () => {
    expect(migration).toMatch(
      /p_effective_from\s*<>\s*date_trunc\('month',\s*p_effective_from\)::date/i,
    );
    expect(migration).toMatch(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.financial_client_summaries_v2\(\)[\s\S]*?FROM\s+public\.profiles\s+profile_row[\s\S]*?LEFT\s+JOIN\s+LATERAL/i,
    );
    expect(migration).toMatch(/'forecast_30_days'[\s\S]*?'forecast_60_days'[\s\S]*?'forecast_90_days'/i);
    expect(migration).toMatch(/upcoming_starts_on\s+date/i);
    expect(migration).toMatch(
      /financial_assign_client_plan[\s\S]*?financial_lock_open_period\(p_effective_from\)[\s\S]*?client competence is already materialized/i,
    );
  });

  it("never updates or deletes historical legacy finance rows", () => {
    const sql = stripSqlComments(migration);
    const legacyTables = [
      "billing",
      "project_payments",
      "payment_installments",
      "expenses",
      "profiles",
      "contracts",
    ];

    for (const table of legacyTables) {
      expect(sql).not.toMatch(new RegExp(
        `\\bUPDATE\\s+(?:public\\.)?${table}\\b`,
        "i",
      ));
      expect(sql).not.toMatch(new RegExp(
        `\\bDELETE\\s+FROM\\s+(?:public\\.)?${table}\\b`,
        "i",
      ));
    }
  });
});
