import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 2026-09-21: auditoria do banco. Oito correções numa migration só: o
 * cliente lia a memória interna do projeto; o e-mail de aviso aceitava
 * qualquer link e desistia em 5 s; a equipe gravava aviso em nome de
 * qualquer usuário; file_root_state lia a raiz sem checar quem chama;
 * nome de empresa no CRM podia repetir; índice duplicado e chaves
 * estrangeiras sem índice; crons de 5/10/15/30 min disparando no mesmo
 * minuto; e a vista de autopublicação sem barreira de segurança.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");
const migracao = ler("supabase/migrations/20260921140000_auditoria_banco_correcoes.sql");

describe("o cliente só lê a memória marcada como visível para ele", () => {
  it("reescreve só a política de leitura do cliente e deixa a da equipe em paz", () => {
    expect(migracao).toContain('DROP POLICY IF EXISTS "memory client read own" ON public.project_memory;');
    expect(migracao).toContain("AND coalesce((metadata->>'client_visible')::boolean, false)");
    // A politica da equipe so aparece em comentario; nenhum DROP/CREATE a toca.
    expect(migracao).not.toMatch(/POLICY "memory staff full"/);
  });
});

describe("o e-mail de aviso só aponta para o painel e espera a função acordar", () => {
  it("aceita caminho relativo ou o próprio domínio; o resto vira a raiz", () => {
    expect(migracao).toContain("WHEN NEW.link LIKE '/%' THEN 'https://aceleriq.online' || NEW.link");
    expect(migracao).toContain("WHEN NEW.link LIKE 'https://aceleriq.online%' THEN NEW.link");
    expect(migracao).toContain("ELSE 'https://aceleriq.online' END;");
    expect(migracao).not.toContain("NEW.link LIKE 'http%'");
  });

  it("dá 15 s ao net.http_post e mantém o freio de 20 por hora e a idempotência", () => {
    expect(migracao).toContain("timeout_milliseconds := 15000");
    expect(migracao).toContain("IF _na_hora >= 20 THEN RETURN NEW; END IF;");
    expect(migracao).toContain("'idempotencyKey', 'notificacao-' || NEW.id::text,");
  });
});

describe("aviso em nome de outro só por administrador", () => {
  it("notifications_insert exige user_id = auth.uid() ou cargo admin", () => {
    expect(migracao).toContain("DROP POLICY IF EXISTS notifications_insert ON public.notifications;");
    expect(migracao).toContain("OR public.has_role(auth.uid(), 'admin'::public.app_role)");
    const bloco = migracao.slice(migracao.indexOf("CREATE POLICY notifications_insert"));
    expect(bloco.slice(0, bloco.indexOf(";"))).not.toContain("is_staff");
  });
});

describe("a raiz do arquivo só é lida por quem pode ler o arquivo", () => {
  it("file_root_state ganha a mesma guarda de file_guard_state sem mudar a assinatura", () => {
    expect(migracao).toContain("CREATE OR REPLACE FUNCTION public.file_root_state(p_root_id uuid)");
    expect(migracao).toContain("WHERE root.id = p_root_id\n    AND public.can_read_file(root.id)");
  });
});

describe("CRM, índices, cron e vista", () => {
  it("nome de empresa único entre as vivas", () => {
    expect(migracao).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS commercial_organizations_nome_unico\n  ON public.commercial_organizations (lower(btrim(name)))\n  WHERE archived_at IS NULL;",
    );
  });

  it("derruba o índice duplicado e cria os que faltavam, sem CONCURRENTLY", () => {
    expect(migracao).toContain("DROP INDEX IF EXISTS public.tasks_project_ops_node_unique;");
    expect(migracao).not.toContain("tasks_project_ops_node_uniq;");
    for (const idx of [
      "updates_created_at_idx", "updates_project_created_idx", "projects_client_id_idx",
      "tasks_assigned_to_idx", "files_project_id_idx", "files_uploaded_by_idx",
      "file_approval_events_actor_id_idx", "client_requests_project_id_idx",
      "reports_client_created_idx", "briefings_client_id_idx", "task_comments_author_id_idx",
      "task_attachments_task_id_idx", "operator_approvals_client_id_idx",
    ]) {
      expect(migracao).toContain(`CREATE INDEX IF NOT EXISTS ${idx}`);
    }
    expect(migracao).not.toContain("CONCURRENTLY");
    // Já cobertos por índices existentes.
    expect(migracao).not.toContain("ON public.editorial_publications (post_id)");
    expect(migracao).not.toContain("ON public.editorial_posts (project_id)");
  });

  it("espalha os crons periódicos e mantém o comando que já estava gravado", () => {
    expect(migracao).toContain("IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN");
    expect(migracao).toContain("PERFORM cron.schedule(_job.jobname, _novo, _job.command);");
    for (const [job, horario] of [
      ["operator-maintenance-5min", "2-59/5 * * * *"],
      ["ads-metrics", "3-59/10 * * * *"],
      ["social-metrics", "6-59/10 * * * *"],
      ["cleanup-meta-oauth-secrets", "8-59/10 * * * *"],
      ["editorial-agendamento-atrasado", "4-59/15 * * * *"],
      ["materiais-classificar-30min", "11,41 * * * *"],
    ]) {
      expect(migracao).toContain(`WHEN '${job}'`);
      expect(migracao).toContain(`THEN '${horario}'`);
    }
    for (const intocado of [
      "editorial-autopublish", "mcp-files-worker-drain", "dossie-fila-1min",
      "check-renewals-daily", "comercial-lembretes", "dossie-avancos-semanais",
    ]) {
      expect(migracao).not.toContain(`'${intocado}'`);
    }
  });

  it("a vista de autopublicação vira barreira de segurança", () => {
    expect(migracao).toContain("ALTER VIEW public.autopublish_status_secure SET (security_barrier = true);");
  });
});
