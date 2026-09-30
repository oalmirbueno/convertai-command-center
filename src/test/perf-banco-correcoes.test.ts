import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Frente PERF-banco (30/09/2026): o painel ficava lento para a equipe e para
 * o cliente porque as regras de leitura (RLS) rodavam funções por LINHA.
 * useTasks do gerente levava 1,5 s, do design 1,8 s para devolver 0 linhas;
 * social_post_metrics do gerente 1,1 s. As migrations 20260930296100 a
 * 293700 reescrevem as regras em forma de conjunto (uma vez por consulta),
 * sem mudar quem vê o quê (conferido no banco, só leitura, para todos os
 * usuários: 0 divergências). Estes testes guardam o texto das migrations e a
 * lógica da troca, que é feita no banco na hora de aplicar.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");
const mig = (nome: string) => ler(`supabase/migrations/${nome}`);

const tarefas = mig("20260930296100_rls_tarefas_em_conjunto.sql");
const mesas = mig("20260930296200_rls_mesas_em_conjunto.sql");
const arquivos = mig("20260930296300_rls_arquivos_sem_reler.sql");
const promotor = mig("20260930293300_promotor_pula_publicacao_ocupada.sql");
const vista = mig("20260930293400_autopublicacao_vista_so_leitura.sql");
// B08 (cron do leitor só com fila) ficou numa migration só na regressão de 30/09:
// a 20260930292000 da frente de funções, com a condição exata do claimNext.
const worker = mig("20260930292000_mcp_files_worker_so_com_trabalho.sql");
const historico = mig("20260930293600_cron_limpa_historico.sql");
const gatilhos = mig("20260930293700_funcoes_gatilho_fechadas.sql");
const todas = [tarefas, mesas, arquivos, promotor, vista, worker, historico, gatilhos];

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

describe("B02: tarefas, updates e filhas da tarefa em forma de conjunto", () => {
  const sql = codigo(tarefas);

  it("cria os quatro ajudantes definer, com search_path vazio e sem anon", () => {
    for (const f of ["eh_admin_atual()", "clientes_da_equipe_atual()", "projetos_da_equipe()", "projetos_proprios()"]) {
      expect(sql).toContain(`CREATE OR REPLACE FUNCTION app_private.${f}`);
      expect(sql).toContain(`REVOKE ALL ON FUNCTION app_private.${f} FROM PUBLIC, anon;`);
      // Sem este GRANT toda leitura de tasks quebraria para a equipe.
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION app_private.${f} TO authenticated, service_role;`);
    }
    expect(sql.match(/SECURITY DEFINER\nSET search_path = ''/g)?.length).toBe(4);
  });

  it("projetos_da_equipe é is_staff + can_access_client em conjunto, com o ::uuid[]", () => {
    const corpo = sql.slice(sql.indexOf("FUNCTION app_private.projetos_da_equipe()"), sql.indexOf("COMMENT ON FUNCTION app_private.projetos_da_equipe()"));
    expect(corpo).toContain("WHERE public.is_staff(auth.uid())");
    expect(corpo).toContain("(SELECT app_private.eh_admin_atual())");
    expect(corpo).toContain("p.client_id = ANY ((SELECT app_private.clientes_da_equipe_atual())::uuid[])");
    // Igual a can_staff_access_project: sem filtro de deleted_at.
    expect(corpo).not.toContain("deleted_at");
  });

  it("troca só as 7 políticas SELECT, com ALTER POLICY (nome e papéis ficam)", () => {
    const alteradas = [...sql.matchAll(/ALTER POLICY (\w+) ON public\.(\w+)/g)].map((m) => `${m[2]}.${m[1]}`);
    expect(alteradas.sort()).toEqual([
      "milestones.milestones_select",
      "task_attachments.task_attachments_staff_select",
      "task_checklist_items.task_checklist_staff_select",
      "task_comments.task_comments_staff_select",
      "tasks.tasks_client_schedule_read",
      "tasks.tasks_staff_select",
      "updates.updates_secure_select",
    ]);
    expect(sql).not.toMatch(/WITH CHECK/);
  });

  it("o cliente mantém o deleted_at da tarefa e do projeto; updates usa o mesmo dono de user_owns_project", () => {
    const cliente = sql.slice(sql.indexOf("ALTER POLICY tasks_client_schedule_read"), sql.indexOf("ALTER POLICY updates_secure_select"));
    expect(cliente).toContain("deleted_at IS NULL");
    expect(cliente).toContain("project.deleted_at IS NULL");
    expect(cliente).toContain("(SELECT public.has_role((SELECT auth.uid()), 'client'::public.app_role))");
    const upd = sql.slice(sql.indexOf("ALTER POLICY updates_secure_select"), sql.indexOf("ALTER POLICY task_comments_staff_select"));
    expect(upd).toContain("client_visible AND project_id IN (SELECT app_private.projetos_proprios())");
    const marcos = sql.slice(sql.indexOf("ALTER POLICY milestones_select"));
    expect(marcos).toContain("public.user_owns_project((SELECT auth.uid()), project_id)");
  });
});

// ─── B03: a troca de texto feita no banco, espelhada aqui ────────────────

function literais(trecho: string): string[] {
  return [...trecho.matchAll(/'((?:[^']|'')*)'/g)].map((m) => m[1].replace(/''/g, "'"));
}
const bloco = mesas.slice(mesas.indexOf("DO $rls$"), mesas.indexOf("$rls$;"));
const [UID] = literais(bloco.slice(bloco.indexOf("_uid  CONSTANT"), bloco.indexOf("_role CONSTANT")));
const [ROLE] = literais(bloco.slice(bloco.indexOf("_role CONSTANT"), bloco.indexOf("_antigos CONSTANT")));
const ANTIGOS = literais(bloco.slice(bloco.indexOf("_antigos CONSTANT"), bloco.indexOf("_novo CONSTANT")));
const NOVO = literais(bloco.slice(bloco.indexOf("_novo CONSTANT"), bloco.indexOf("_r record;"))).join("");

/** Mesmos passos do bloco DO da 20260930296200. */
function transformar(expr: string): string {
  let e = expr;
  e = e.split(UID).join("\u0001").split("auth.uid()").join(UID).split("\u0001").join(UID);
  e = e.split(ROLE).join("\u0002").split("auth.role()").join(ROLE).split("\u0002").join(ROLE);
  if (!e.includes("(NOT ")) {
    for (const antigo of ANTIGOS) e = e.split(antigo).join(NOVO);
  }
  return e;
}

describe("B03: is_staff AND can_access_client em forma de conjunto", () => {
  it("lê as constantes do bloco DO", () => {
    expect(UID).toBe("( SELECT auth.uid() AS uid)");
    expect(ROLE).toBe("( SELECT auth.role() AS role)");
    expect(ANTIGOS).toEqual([
      "public.is_staff(( SELECT auth.uid() AS uid)) AND public.can_access_client(client_id)",
      "COALESCE(public.is_staff(( SELECT auth.uid() AS uid)), false) AND public.can_access_client(client_id)",
    ]);
  });

  it("a forma nova é can_access_client em conjunto, com o cast ::uuid[] obrigatório", () => {
    expect(NOVO).toContain("(SELECT public.is_staff((SELECT auth.uid())))");
    expect(NOVO).toContain("(SELECT app_private.eh_admin_atual())");
    expect(NOVO).toContain("(client_id = (SELECT auth.uid())) AND (SELECT public.has_role((SELECT auth.uid()), 'client'::public.app_role))");
    // Sem o cast o Postgres lê ANY(subconsulta) e compara uuid com uuid[].
    expect(NOVO).toContain("client_id = ANY ((SELECT app_private.clientes_da_equipe_atual())::uuid[])");
    expect(NOVO).not.toContain("can_access_client");
    expect(NOVO.split("(").length).toBe(NOVO.split(")").length);
  });

  it("troca o padrão com auth.uid() solto ou já embrulhado", () => {
    const solto = "(public.is_staff(auth.uid()) AND public.can_access_client(client_id))";
    const embrulhado = "(public.is_staff(( SELECT auth.uid() AS uid)) AND public.can_access_client(client_id))";
    expect(transformar(solto)).toBe(`(${NOVO})`);
    expect(transformar(embrulhado)).toBe(`(${NOVO})`);
  });

  it("dentro de expressão maior só troca o trecho, com parênteses próprios", () => {
    const pedido = "((client_id = auth.uid()) OR (public.is_staff(auth.uid()) AND public.can_access_client(client_id)))";
    expect(transformar(pedido)).toBe(`((client_id = ${UID}) OR (${NOVO}))`);
    const relatorio = "(public.is_staff(auth.uid()) AND public.can_access_client(client_id) AND (created_by = auth.uid()))";
    expect(transformar(relatorio)).toBe(`(${NOVO} AND (created_by = ${UID}))`);
  });

  it("formato próprio fica como está (só ganha o auth.uid() embrulhado)", () => {
    const proprio = "(public.is_staff(( SELECT auth.uid() AS uid)) AND ((client_id IS NULL) OR public.can_access_client(client_id)))";
    expect(transformar(proprio)).toBe(proprio);
    const comNot = "(NOT (public.is_staff(auth.uid()) AND public.can_access_client(client_id)))";
    expect(transformar(comNot)).toBe(`(NOT (public.is_staff(${UID}) AND public.can_access_client(client_id)))`);
  });

  it("auth.uid() e auth.role() viram InitPlan; o que já estava embrulhado não dobra", () => {
    expect(transformar("(auth.role() = 'service_role'::text)")).toBe(`(${ROLE} = 'service_role'::text)`);
    expect(transformar(`((user_id = auth.uid()) OR (owner_id = ${UID}))`)).toBe(`((user_id = ${UID}) OR (owner_id = ${UID}))`);
    const pronto = `(user_id = ${UID})`;
    expect(transformar(pronto)).toBe(pronto);
  });

  it("o bloco lê pg_policy só do public, compara antes de alterar e volta o search_path", () => {
    const sql = codigo(mesas);
    expect(sql).toContain("WHERE n.nspname = 'public'");
    expect(sql).not.toContain("realtime");
    expect(sql).toContain("PERFORM set_config('search_path', '', true);");
    expect(sql).toContain("PERFORM set_config('search_path', _search_path, true);");
    expect(sql).toContain("CONTINUE WHEN _novas[1] IS NOT DISTINCT FROM _r.q");
    expect(sql).toContain("format('ALTER POLICY %I ON %I.%I', _r.polname, _r.nspname, _r.relname)");
    expect(sql).toContain("IF position('(NOT ' IN _e) = 0 THEN");
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
  });
});

describe("B04: files sem reler a própria linha", () => {
  it("mesma regra de can_read_file lendo as colunas, com o pré-filtro do cliente", () => {
    const sql = codigo(arquivos);
    expect(sql).toContain("ALTER POLICY files_secure_select ON public.files");
    expect(sql).toContain("(SELECT public.is_staff((SELECT auth.uid())))");
    expect(sql).toContain("client_id = ANY ((SELECT app_private.clientes_da_equipe_atual())::uuid[])");
    expect(sql).toContain("OR (client_id = (SELECT auth.uid()) AND public.can_client_read_file(id))");
    expect(sql).not.toContain("can_read_file(id)\n");
    expect(sql).not.toContain("zz_admin_leitura_rapida");
  });
});

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
