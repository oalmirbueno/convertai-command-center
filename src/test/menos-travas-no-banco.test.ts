import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 19/10/2026 (dono: "tem muitas tarefas travadas, isso não pode acontecer"). Dos 11 vínculos
 * travados, 6 eram de tarefa já excluída e 3 de rodada que parou sem sinal: nenhum dependia dele.
 */

const raiz = resolve(__dirname, "../..");
const nome = readdirSync(resolve(raiz, "supabase/migrations")).find((n) => /_menos_travas\.sql$/.test(n));
const sql = nome ? readFileSync(resolve(raiz, "supabase/migrations", nome), "utf8") : "";

describe("o banco não trava o que o time resolve", () => {
  it("a migration existe", () => {
    expect(nome).toBeTruthy();
  });

  it("rodada que parou sem sinal volta para a fila; só trava na terceira seguida", () => {
    const expira = sql.slice(sql.indexOf("create or replace function public.operator_expire_stale_runs"));
    expect(expira).toContain("then 'blocked' else 'queued' end");
    expect(expira).toContain("r2.status = 'timeout'");
    expect(expira).toContain(">= 2");
    expect(expira).toContain("Retomar do ponto em que parou");
  });

  it("vínculo de tarefa excluída é encerrado, não bloqueado", () => {
    const orfaos = sql.slice(sql.indexOf("create or replace function public.operator_fechar_orfaos"));
    expect(orfaos).toContain("SET status = 'done'");
    expect(orfaos).not.toContain("SET status = 'blocked'");
  });

  it("limpa os que já estavam presos assim", () => {
    expect(sql).toMatch(/update public\.operator_task_links[\s\S]{0,200}status = 'done'[\s\S]{0,300}block_reason ilike 'Tarefa exclu%'/);
    expect(sql).toMatch(/update public\.operator_task_links[\s\S]{0,200}status = 'queued'[\s\S]{0,300}execucao expirou sem heartbeat/);
  });
});
