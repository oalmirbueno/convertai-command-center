-- Frente PERF-banco (30/09/2026), achado B02: leitura de tarefas em forma de
-- conjunto. Também cria os ajudantes em conjunto que o B03 (20260930296200) e
-- o B04 (20260930296300) usam.
--
-- O problema: as regras de leitura de tasks, updates e das três tabelas
-- filhas da tarefa chamavam can_staff_access_project(project_id) uma vez por
-- LINHA. Cada chamada faz 4 has_role e can_access_client (mais 5 has_role e
-- um EXISTS). Medido em 30/09 com EXPLAIN ANALYZE, como authenticated, da
-- leitura do useTasks (1.511 tarefas): gerente 1.556 ms, design 1.779 ms para
-- devolver 0 linhas, cliente 724 ms. O feed de updates (10.564 linhas) passava
-- dos 8 s do statement_timeout para design e cliente quando lido sem janela.
--
-- A correção: a mesma regra, calculada UMA vez por consulta.
--   * app_private.eh_admin_atual() e app_private.clientes_da_equipe_atual():
--     can_access_client escrito em conjunto. can_access_client(c) é
--       auth.uid() não nulo E (admin
--         OU (cliente E c = auth.uid())
--         OU ((manager OU design OU traffic) E atribuição em team_client_assignments))
--     e vira (SELECT eh_admin) OR (c = uid AND (SELECT has_role client))
--     OR c = ANY((SELECT clientes_da_equipe)::uuid[]), sempre ao lado de um
--     is_staff (que já exige uid não nulo).
--   * app_private.projetos_da_equipe(): is_staff (admin, manager, design,
--     traffic: o mesmo conjunto de papéis de can_staff_access_project) E o
--     cliente do projeto liberado pela forma de conjunto acima. É a regra de
--     can_staff_access_project, sem filtro de deleted_at (igual à original).
--   * app_private.projetos_proprios(): projetos cujo client_id é a própria
--     pessoa. É a regra de user_owns_project(auth.uid(), x), que é definer e
--     não passa pela RLS de projects.
--   * As 6 políticas SELECT passam a usar project_id IN (SELECT ...), que o
--     Postgres avalia uma vez (hashed SubPlan) e não por linha.
--
-- Medido em 30/09 (predicado novo embutido, mesmas linhas, md5 igual):
-- useTasks do gerente 1.556 -> 3,4 ms; design 1.779 -> ~20 ms; cliente
-- 724 -> 3 ms; anexos do Kanban 45 -> 2 ms; comentários 161 -> 7 ms.
--
-- O que NÃO muda: can_access_client, can_staff_access_project,
-- user_owns_project e todas as políticas de INSERT, UPDATE e DELETE. Nomes,
-- comandos e papéis das políticas ficam iguais (ALTER POLICY só troca a
-- expressão). milestones_select só ganha o is_staff em InitPlan.
-- Se can_access_client mudar um dia, os dois ajudantes mudam junto (o roteiro
-- scripts/conferir-rls-por-linha.sql acusa a diferença).
--
-- Equivalência conferida em 30/09, só leitura (transação read only, sem
-- aplicar nada), para os 25 usuários de user_roles (3 admins, gerente, design,
-- 20 clientes), um uid inexistente e anon: 0 divergências entre a regra antiga
-- e a nova em tasks, updates, task_comments, task_checklist_items,
-- task_attachments e milestones, e entre can_access_client e a forma de
-- conjunto para todo client_id existente e nulo.
--
-- Idempotente: CREATE OR REPLACE e ALTER POLICY podem rodar de novo.
-- Não aplicar direto: o dono aplica na integração (SQL Editor).

SET LOCAL lock_timeout = '5s';

-- ─── 1) Funções de conjunto ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_private.eh_admin_atual()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.has_role(auth.uid(), 'admin'::public.app_role)
$$;

COMMENT ON FUNCTION app_private.eh_admin_atual() IS
  'A pessoa atual é admin (ramo admin de can_access_client). Usar em (SELECT ...) nas políticas: uma vez por consulta.';

CREATE OR REPLACE FUNCTION app_private.clientes_da_equipe_atual()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(ARRAY(
    SELECT tca.client_id
      FROM public.team_client_assignments AS tca
     WHERE tca.user_id = auth.uid()
       AND (public.has_role(auth.uid(), 'manager'::public.app_role)
         OR public.has_role(auth.uid(), 'design'::public.app_role)
         OR public.has_role(auth.uid(), 'traffic'::public.app_role))
  ), '{}'::uuid[])
$$;

COMMENT ON FUNCTION app_private.clientes_da_equipe_atual() IS
  'Clientes atribuídos à pessoa atual quando ela é manager, design ou traffic (ramo de equipe de can_access_client), em conjunto. Usar em (SELECT ...)::uuid[].';

CREATE OR REPLACE FUNCTION app_private.projetos_da_equipe()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id
    FROM public.projects AS p
   WHERE public.is_staff(auth.uid())
     AND ((SELECT app_private.eh_admin_atual())
       OR (p.client_id = (SELECT auth.uid())
           AND (SELECT public.has_role(auth.uid(), 'client'::public.app_role)))
       OR p.client_id = ANY ((SELECT app_private.clientes_da_equipe_atual())::uuid[]))
$$;

COMMENT ON FUNCTION app_private.projetos_da_equipe() IS
  'Projetos que a pessoa enxerga como equipe: a regra de can_staff_access_project, em conjunto (uma vez por consulta). Usada nas políticas SELECT de tasks, updates e filhas da tarefa.';

CREATE OR REPLACE FUNCTION app_private.projetos_proprios()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p.id
    FROM public.projects AS p
   WHERE p.client_id = auth.uid()
$$;

COMMENT ON FUNCTION app_private.projetos_proprios() IS
  'Projetos cujo client_id é a própria pessoa: a regra de user_owns_project(auth.uid(), x), em conjunto.';

-- As políticas rodam como authenticated: sem este GRANT toda leitura de tasks
-- quebraria. O esquema app_private não precisa de USAGE (a política guarda a
-- função pelo OID; a vista staff_files_secure, security_invoker, já chama
-- app_private.staff_files_secure_rows como authenticated assim em produção).
-- anon fica sem EXECUTE, como em is_staff e can_access_client.
REVOKE ALL ON FUNCTION app_private.eh_admin_atual() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.clientes_da_equipe_atual() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.projetos_da_equipe() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION app_private.projetos_proprios() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_private.eh_admin_atual() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.clientes_da_equipe_atual() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.projetos_da_equipe() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION app_private.projetos_proprios() TO authenticated, service_role;

-- ─── 2) Políticas SELECT em forma de conjunto ─────────────────────────

-- Antes: can_staff_access_project(project_id)
ALTER POLICY tasks_staff_select ON public.tasks
  USING (project_id IN (SELECT app_private.projetos_da_equipe()));

-- Antes: deleted_at IS NULL AND has_role(auth.uid(),'client') AND EXISTS
-- (projects do próprio cliente, não apagados). O projects da subconsulta
-- continua passando pela RLS de projects, como no EXISTS original.
ALTER POLICY tasks_client_schedule_read ON public.tasks
  USING (
    deleted_at IS NULL
    AND (SELECT public.has_role((SELECT auth.uid()), 'client'::public.app_role))
    AND project_id IN (
      SELECT project.id
        FROM public.projects AS project
       WHERE project.client_id = (SELECT auth.uid())
         AND project.deleted_at IS NULL
    )
  );

-- Antes: can_staff_access_project(project_id)
--        OR (client_visible AND user_owns_project(auth.uid(), project_id))
ALTER POLICY updates_secure_select ON public.updates
  USING (
    project_id IN (SELECT app_private.projetos_da_equipe())
    OR (client_visible AND project_id IN (SELECT app_private.projetos_proprios()))
  );

-- Antes: EXISTS (tasks da linha AND can_staff_access_project(task.project_id))
ALTER POLICY task_comments_staff_select ON public.task_comments
  USING (EXISTS (
    SELECT 1
      FROM public.tasks AS task
     WHERE task.id = task_comments.task_id
       AND task.project_id IN (SELECT app_private.projetos_da_equipe())
  ));

ALTER POLICY task_checklist_staff_select ON public.task_checklist_items
  USING (EXISTS (
    SELECT 1
      FROM public.tasks AS task
     WHERE task.id = task_checklist_items.task_id
       AND task.project_id IN (SELECT app_private.projetos_da_equipe())
  ));

ALTER POLICY task_attachments_staff_select ON public.task_attachments
  USING (EXISTS (
    SELECT 1
      FROM public.tasks AS task
     WHERE task.id = task_attachments.task_id
       AND task.project_id IN (SELECT app_private.projetos_da_equipe())
  ));

-- Antes: is_staff(auth.uid()) OR user_owns_project(auth.uid(), project_id).
-- Só o is_staff vira InitPlan; o ramo do cliente fica como estava.
ALTER POLICY milestones_select ON public.milestones
  USING (
    (SELECT public.is_staff((SELECT auth.uid())))
    OR public.user_owns_project((SELECT auth.uid()), project_id)
  );

RESET lock_timeout;

-- Conferência depois de aplicar (só leitura):
-- select policyname, qual from pg_policies
--  where schemaname = 'public'
--    and policyname in ('tasks_staff_select','tasks_client_schedule_read','updates_secure_select',
--      'task_comments_staff_select','task_checklist_staff_select','task_attachments_staff_select','milestones_select');
-- Voltar atrás: ALTER POLICY <nome> ON <tabela> USING (<expressão antiga do comentário acima>).
