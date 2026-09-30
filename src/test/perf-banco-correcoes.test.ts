import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Frente PERF-banco (30/09/2026): o painel ficava lento para a equipe e para
 * o cliente porque as regras de leitura (RLS) rodavam funções por LINHA.
 * useTasks do gerente levava 1,5 s, do design 1,8 s para devolver 0 linhas;
 * social_post_metrics do gerente 1,1 s. As migrations 20260930293000 a
 * 293700 reescrevem as regras em forma de conjunto (uma vez por consulta),
 * sem mudar quem vê o quê (conferido no banco, só leitura, para todos os
 * usuários: 0 divergências). Estes testes guardam o texto das migrations e a
 * lógica da troca, que é feita no banco na hora de aplicar.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");
const mig = (nome: string) => ler(`supabase/migrations/${nome}`);

const promotor = mig("20260930293300_promotor_pula_publicacao_ocupada.sql");
const vista = mig("20260930293400_autopublicacao_vista_so_leitura.sql");
// B08 (cron do leitor só com fila) ficou numa migration só na regressão de 30/09:
// a 20260930292000 da frente de funções, com a condição exata do claimNext.
const worker = mig("20260930292000_mcp_files_worker_so_com_trabalho.sql");
const historico = mig("20260930293600_cron_limpa_historico.sql");
const gatilhos = mig("20260930293700_funcoes_gatilho_fechadas.sql");
// 30/09: 291000, 293000, 293100 e 293200 (RLS em conjunto) seguradas para decisão do dono: patch build/perf-rls-segurado.patch
const todas = [promotor, vista, worker, historico, gatilhos];

/** Tira os comentários de linha: o que sobra é o que o banco executa. */
const codigo = (sql: string) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("regras de segurança das migrations novas", () => {
  it("nenhuma mexe em can_access_client, can_staff_access_project, user_owns_project ou can_read_file", () => {
    for (const sql of todas.map(codigo)) {
      expect(sql).not.toMatch(/FUNCTION\s+public\.(can_access_client|can_staff_access_project|user_owns_project|can_read_file|can_client_read_file)\b/i);
      expect(sql).not.toMatch(/DROP\s+POLICY/i);
      expect(sql).not.toMatch(/DISABLE\s+ROW\s+LEVEL\s+SECURITY/i);
      expect(sql).not.toContain("CONCURRENTLY");
    }
  });

  it("nenhuma carrega chave: as credenciais do cron vêm do cofre pelo nome", () => {
    for (const sql of todas) {
      expect(sql).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
      expect(sql).not.toMatch(/sb_secret_/);
    }
    expect(worker).toContain("from vault.decrypted_secrets where name = 'email_queue_service_role_key'");
    expect(worker).toContain("from vault.decrypted_secrets where name = 'cron_secret'");
  });
});

function literais(trecho: string): string[] {
  return [...trecho.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}

describe("B06: o promotor pula a publicação ocupada em vez de travar", () => {
  // Reconstrói o corpo do promotor pelas migrations do repositório (criação
  // em 20260831020000 + remendo da Mesa em 20260927020000) e aplica o
  // remendo novo, como o bloco DO faz no banco.
  const original = mig("20260831020000_agendado_aprovado_vai_ao_ar.sql");
  const ini = original.indexOf("create or replace function public.editorial_promover_planejados(");
  let corpo = original.slice(ini, original.indexOf("$$;", ini));
  const alvoMesa = "       and p.scheduled_at >= now() - _janela_de_atraso";
  corpo = corpo.replace(alvoMesa, `${alvoMesa}\n       and not public.mesa_publicacao_segurada(p.post_id, p.scheduled_at, coalesce(p.file_id, po.primary_file_id))`);

  const [laco, lacoNovo, falha, falhaNova] = ["_laco text", "_laco_novo text", "_falha text", "_falha_nova text"].map((nome) => {
    const i = promotor.indexOf(`  ${nome} := '`);
    return literais(promotor.slice(i, promotor.indexOf("';\n", i) + 2))[0];
  });

  it("os dois alvos existem uma vez no corpo atual", () => {
    expect(corpo.split(laco).length - 1).toBe(1);
    expect(corpo.split(falha).length - 1).toBe(1);
  });

  it("trava global antes do bloco, publicação com SKIP LOCKED e falha no log", () => {
    const novo = corpo.replace(laco, lacoNovo).replace(falha, falhaNova);
    const trava = novo.indexOf("perform public.editorial_lock_task_sync();");
    const bloco = novo.indexOf("    begin\n", trava);
    const pula = novo.indexOf("for update skip locked;");
    const insert = novo.indexOf("insert into social_private.editorial_publication_delivery_requests");
    expect(trava).toBeGreaterThan(0);
    expect(trava).toBeLessThan(bloco);
    expect(bloco).toBeLessThan(pula);
    expect(pula).toBeLessThan(insert);
    expect(novo).toContain("         and status = 'planned'\n         for update skip locked;\n      if not found then\n        continue;\n      end if;");
    expect(novo).toContain("raise warning 'editorial_promover_planejados: publicacao % nao promovida: %', _pub.id, sqlerrm;");
    // O cursor do FOR não ganha FOR UPDATE; o retorno e a transição ficam.
    const cursor = novo.indexOf("for _pub in");
    expect(cursor).toBeGreaterThan(0);
    expect(novo.slice(cursor, novo.indexOf("  loop\n", cursor))).not.toMatch(/for update/i);
    for (const chave of ["'promovidos'", "'nao_promovidos'", "'falhas'", "'em'"]) expect(novo).toContain(chave);
    expect(novo).toContain("perform public.transition_editorial_publication_unlocked(\n        _pub.id, 'schedule', _pub.version, _quando, _pub.tz\n      );");
  });

  it("é idempotente, falha alto sem o alvo e não mexe no agendador da Mesa", () => {
    expect(promotor).toContain("IF position('for update skip locked' IN _fonte) > 0 THEN\n    RETURN; -- já aplicado");
    expect(promotor).toContain("RAISE EXCEPTION 'patch editorial_promover_planejados (B06): alvo nao encontrado';");
    expect(codigo(promotor)).not.toContain("mesa_agendar_aprovados");
  });
});

describe("B07, B08, B11 e B13: permissões e crons", () => {
  it("B07: a vista do motor fica só com SELECT para authenticated", () => {
    expect(vista).toContain("REVOKE ALL ON public.autopublish_status_secure FROM PUBLIC, anon, authenticated;");
    expect(vista).toContain("GRANT SELECT ON public.autopublish_status_secure TO authenticated;");
    expect(codigo(vista)).not.toContain("security_invoker");
    expect(codigo(vista)).not.toContain("service_role");
  });

  it("B08: o cron do leitor só chama a função com trabalho na fila, sem mudar o horário", () => {
    expect(worker).toContain("PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mcp-files-worker-drain';");
    expect(worker).toContain("PERFORM cron.schedule('mcp-files-worker-drain', '* * * * *', $job$");
    expect(worker).toContain("where exists (\n        select 1 from public.file_processing_jobs\n        where status in ('pending', 'failed') and attempts < 3\n      );");
  });

  it("B11: limpeza diária do histórico do pg_cron com 14 dias", () => {
    expect(historico).toContain("PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'cron-limpar-historico';");
    expect(historico).toContain("'41 4 * * *'");
    expect(historico).toContain("delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '14 days'");
    expect(codigo(historico)).not.toMatch(/VACUUM/i);
  });

  it("B13: search_path fixo nas 3 funções e as 12 de gatilho fora de PUBLIC, anon e authenticated", () => {
    for (const f of ["notificacao_merece_email(text)", "operator_audit_imutavel()", "operator_approval_payload_imutavel()"]) {
      expect(gatilhos).toContain(`ALTER FUNCTION public.${f} SET search_path = '';`);
    }
    const revoke = gatilhos.slice(gatilhos.indexOf("REVOKE EXECUTE ON FUNCTION"), gatilhos.indexOf("FROM PUBLIC, anon, authenticated;"));
    expect(revoke.match(/public\.\w+\(\)/g)?.length).toBe(12);
    expect(codigo(gatilhos)).not.toMatch(/briefing_public_|idv_/);
  });
});

describe("B05 e B09: menos idas ao banco", () => {
  it("B05: o MCP usa o dono e o owner_is_admin que a RPC já devolve", () => {
    const auth = ler("supabase/functions/_shared/mcp-auth.ts");
    expect(auth).toContain("dataScope = await dataScopeForApiKeyRow(row);");
    expect(auth).toContain("if (ownerId && row.owner_is_admin === true) {");
    // A releitura de api_keys só sobra para a RPC antiga, sem a coluna.
    const releitura = auth.indexOf(".from('api_keys')\n      .select('created_by')");
    expect(releitura).toBeGreaterThan(auth.indexOf("if (row.created_by === undefined) {"));
  });

  it("B09: o Kanban não repete a releitura de 30 s; o tempo real e os 15 s do useTasks ficam", () => {
    const kanban = ler("src/pages/Kanban.tsx");
    expect(kanban).not.toMatch(/setInterval\(\(\) => \{\s*queryClient\.invalidateQueries\(\{ queryKey: \["tasks"\] \}\)/);
    expect(kanban).toContain('.channel("kanban-tasks-realtime")');
    expect(kanban).toContain("supabase.removeChannel(channel);");
    expect(ler("src/hooks/useSupabaseData.ts")).toContain("refetchInterval: options.refetchInterval ?? 15000,");
  });
});
