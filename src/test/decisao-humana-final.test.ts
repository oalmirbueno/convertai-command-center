import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 16/10/2026 (dono: "está tendo muitos bloqueios no painel e não parece direito para aprovar").
 * Na trilha da ACE-87 ele clicou "Aprovar e concluir" sete vezes e cada clique voltou para
 * "em revisão": a regra "concluir sem evidência vira revisão" valia também para a mão humana.
 * Depois, o agente reabria o que a equipe tinha decidido. Agora a decisão humana é final.
 */

const raiz = resolve(__dirname, "../..");
const sql = readFileSync(resolve(raiz, "supabase/migrations/20261016233955_decisao_humana_final.sql"), "utf8");
const acao = sql.slice(sql.indexOf("create or replace function public.operator_human_action"), sql.indexOf("$function$;", sql.indexOf("create or replace function public.operator_human_action")));

describe("a decisão da equipe fecha de verdade", () => {
  it("concluir sem prova anexada não vira mais revisão: a decisão vira o registro", () => {
    expect(acao).not.toContain("_new_status := 'review'");
    expect(acao).toContain("'Decisão de '");
    expect(acao).toContain("last_evidence = case when _new_status = 'done'");
  });

  it("fecha o cartão do Kanban e os vínculos irmãos da mesma tarefa", () => {
    expect(acao).toContain("update public.tasks set status = 'done'");
    expect(acao).toContain("and id <> _link.id");
    // O Kanban recusar (guarda editorial) não derruba a decisão: vira nota na trilha.
    expect(acao).toContain("'cartao NAO fechou: '");
  });

  it("continua só para a equipe, pela mesma trilha", () => {
    expect(acao).toContain("app_private.require_rpc_link_staff(_link_id)");
    expect(acao).toContain("not_allowed: somente a equipe move o quadro");
    expect(acao).toContain("insert into public.operator_audit_log");
    expect(acao).toContain("(humano)");
  });

  it("agente não reabre o que a equipe concluiu; só a mão humana reabre", () => {
    expect(acao).toContain("set_config('app.decisao_humana', '1', true)");
    expect(sql).toContain("create or replace function app_private.decisao_humana_e_final()");
    expect(sql).toMatch(/old\.status = 'done'[\s\S]{0,120}current_setting\('app\.decisao_humana', true\)/);
    expect(sql).toContain("before update of status on public.operator_task_links");
  });
});
