-- ISOLATED DATABASE ONLY. Synthetic schema/rows; never load in production.
-- Set aceleriq.isolated_tests=on in the disposable test connection first.
-- Bootstrap provides postgres-owned schemas, API roles, auth.uid and pgTAP.
DO $$ BEGIN
  IF current_setting('aceleriq.isolated_tests', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'ISOLATED_SECURITY_FIXTURE_REQUIRED';
  END IF;
END $$;
SET search_path = public, extensions;

CREATE TYPE public.app_role AS ENUM ('admin','manager','design','traffic','client');
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY, full_name text, company_name text, email text, phone text,
  avatar_url text, services_config jsonb DEFAULT '{}', plan_status text DEFAULT 'active',
  plan_renewal_date date, plan_name text, plan_value numeric, onboarding_done boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(), deleted_at timestamptz,
  overdue_since date, client_type text DEFAULT 'recurring', brand jsonb DEFAULT '{}',
  portal_password text, first_access_token text, first_access_expires_at timestamptz,
  first_access_used_at timestamptz, sync_status text, sync_error text
);
CREATE TABLE public.user_roles (user_id uuid, role public.app_role, PRIMARY KEY(user_id,role));
CREATE TABLE public.team_client_assignments (user_id uuid, client_id uuid, PRIMARY KEY(user_id,client_id));
CREATE TABLE public.projects (id uuid PRIMARY KEY, client_id uuid, name text, deleted_at timestamptz);
CREATE TABLE public.tasks (
  id uuid PRIMARY KEY, project_id uuid, title text, description text,
  assigned_to uuid, status text DEFAULT 'backlog', deleted_at timestamptz,
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.client_dossiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid NOT NULL,
  project_id uuid, dossier_type text DEFAULT 'contexto', version integer DEFAULT 1,
  content text, summary text, change_reason text, prior_version_id uuid,
  actor text, source text, tags text[] DEFAULT '{}', metadata jsonb DEFAULT '{}',
  correlation_id text, idempotency_key text, is_current boolean DEFAULT true,
  effective_at timestamptz, superseded_at timestamptz, superseded_by uuid,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX dossiers_current ON public.client_dossiers
  (client_id, dossier_type, COALESCE(project_id,'00000000-0000-0000-0000-000000000000'::uuid)) WHERE is_current;
CREATE TABLE public.project_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id uuid, kind text,
  source text, title text, content text, tags text[], metadata jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
CREATE TABLE public.feature_flags (flag_key text PRIMARY KEY, enabled boolean);
CREATE TABLE public.internal_operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text UNIQUE, display_name text,
  role text, area text, parent_slug text, display_order integer DEFAULT 0,
  scope text, status text DEFAULT 'active', is_coordinator boolean DEFAULT false,
  last_run_at timestamptz
);
CREATE TABLE public.operator_task_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operator_id uuid,
  agent_run_id text, kanban_task_id uuid, painel_task_id uuid, execution_source text,
  status text DEFAULT 'queued', next_step text, last_action text, last_evidence text,
  block_reason text, approval_required boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.operator_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operator_id uuid, run_key text,
  task_link_id uuid, status text DEFAULT 'started', attempt integer DEFAULT 1,
  timeout_seconds integer DEFAULT 900, error text, detail jsonb DEFAULT '{}',
  started_at timestamptz DEFAULT now(), heartbeat_at timestamptz DEFAULT now(),
  finished_at timestamptz, UNIQUE(operator_id,run_key)
);
CREATE TABLE public.operator_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), operator_id uuid, task_link_id uuid,
  kanban_task_id uuid, action_kind text, o_que text, por_que text, destino text,
  prazo date, reversivel boolean DEFAULT true, custo_previsto numeric, payload jsonb,
  status text DEFAULT 'pendente', valid_until timestamptz, decided_at timestamptz,
  decision_note text, executed_at timestamptz, execution_evidence text, execution_run_key text
);
CREATE TABLE public.assignment_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kanban_task_id uuid,
  status text DEFAULT 'pendente', decided_at timestamptz, decision_note text
);
CREATE TABLE public.operator_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor text NOT NULL, operator_id uuid,
  task_link_id uuid, kanban_task_id uuid, action text, old_status text, new_status text,
  evidence text, from_cron boolean DEFAULT false, approval_required boolean DEFAULT false,
  run_key text, occurred_at timestamptz DEFAULT now()
);
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, message text,
  notification_type text, link text, created_at timestamptz DEFAULT now()
);
CREATE TABLE public.external_accounts (id uuid PRIMARY KEY, client_id uuid, external_id text, display_name text, platform text);
CREATE TABLE public.ads_campaigns (id uuid PRIMARY KEY, external_account_id uuid);
CREATE TABLE public.editorial_posts (id uuid PRIMARY KEY, title text);
CREATE TABLE public.editorial_publications (
  id uuid PRIMARY KEY, client_id uuid, post_id uuid, published_at timestamptz,
  platform text, status text, scheduled_at timestamptz
);
CREATE TABLE public.files (id uuid PRIMARY KEY, file_name text);
CREATE TABLE public.file_approval_events (id uuid PRIMARY KEY, file_id uuid, client_id uuid, to_status text, created_at timestamptz);
CREATE TABLE public.milestones (id uuid PRIMARY KEY, project_id uuid, title text, status text, deleted_at timestamptz, updated_at timestamptz);

-- No real secret or external endpoint: inert Vault/dispatch boundaries.
CREATE TABLE vault.decrypted_secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), decrypted_secret text);
CREATE FUNCTION vault.create_secret(_secret text, _name text, _description text, _key_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE _id uuid;
BEGIN
  INSERT INTO vault.decrypted_secrets(decrypted_secret) VALUES (_secret) RETURNING id INTO _id;
  RETURN _id;
END $$;
CREATE TABLE social_private.ads_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), external_account_id uuid,
  access_token_secret_id uuid, label text, saved_by uuid, revoked_at timestamptz
);
CREATE TABLE public.security_test_dispatch (routine text, occurred_at timestamptz DEFAULT now());

-- Records schedules without starting a worker or connecting to any service.
CREATE SCHEMA cron;
CREATE TABLE cron.job (
  jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jobname text, schedule text, command text, username text,
  UNIQUE (jobname, username)
);
CREATE FUNCTION cron.schedule(_jobname text, _schedule text, _command text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE _jobid bigint;
BEGIN
  INSERT INTO cron.job(jobname,schedule,command,username)
  VALUES (_jobname,_schedule,_command,session_user)
  ON CONFLICT(jobname,username) DO UPDATE
    SET schedule=EXCLUDED.schedule, command=EXCLUDED.command
  RETURNING jobid INTO _jobid;
  RETURN _jobid;
END $$;

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role)
$$;
CREATE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role IN ('admin','manager','design','traffic'))
$$;
CREATE FUNCTION public.can_access_client(_client_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.has_role(auth.uid(),'admin')
    OR (public.has_role(auth.uid(),'client') AND auth.uid()=_client_id)
    OR (public.is_staff(auth.uid()) AND EXISTS (
      SELECT 1 FROM public.team_client_assignments WHERE user_id=auth.uid() AND client_id=_client_id)))
$$;
CREATE FUNCTION public.operator_status_do_run(_event text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE _event
  WHEN 'heartbeat' THEN 'progress' WHEN 'review' THEN 'review'
  WHEN 'awaiting_input' THEN 'awaiting_input' ELSE _event END $$;
CREATE FUNCTION public.operator_status_do_card(_event text,_current text,_has_evidence boolean)
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE _event
  WHEN 'started' THEN 'in_progress' WHEN 'progress' THEN 'in_progress'
  WHEN 'done' THEN 'review' ELSE NULL END $$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid()=id OR public.is_staff(auth.uid()));
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid()=id OR public.has_role(auth.uid(),'admin'));
GRANT USAGE ON SCHEMA public,auth TO anon,authenticated,service_role;
GRANT SELECT,UPDATE ON public.profiles TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
REVOKE ALL ON SCHEMA app_private,social_private,vault FROM PUBLIC,anon,authenticated;

-- Below: selected real pre-migration function definitions, captured read-only
-- from jjjtkowvxemvituvywvf on 2026-09-12 after confirming no secret literals.
-- Unchanged unexercised routines use explicit inert stubs solely for ACL tests.

-- INERT ACL/dispatch stub; not a business behavior test: admin_delete_readiness
CREATE FUNCTION public.admin_delete_readiness() RETURNS TABLE(tabela text, coluna text, obrigatoria boolean, tratamento text) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN; END $stub$;

CREATE OR REPLACE FUNCTION public.ads_contas_conhecidas()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'tem_token_da_carteira', exists (
      select 1 from social_private.ads_tokens
       where revoked_at is null and external_account_id is null
    ),
    'contas', coalesce(jsonb_agg(jsonb_build_object(
      'external_account_id', c.id,
      'numero', c.external_id,
      'nome', c.display_name,
      'cliente', c.cliente,
      'tem_token_proprio', c.proprio,
      'campanhas_colhidas', c.campanhas
    ) order by c.cliente nulls last, c.nome), '[]'::jsonb)
  )
  from (
    select account.id, account.external_id, account.display_name,
           coalesce(nullif(btrim(pr.company_name), ''), pr.full_name) as cliente,
           exists (
             select 1 from social_private.ads_tokens t
              where t.revoked_at is null and t.external_account_id = account.id
           ) as proprio,
           (select count(*) from public.ads_campaigns k
             where k.external_account_id = account.id) as campanhas,
           account.display_name as nome
      from public.external_accounts as account
      left join public.profiles as pr on pr.id = account.client_id
     where account.platform = 'meta_ads'
  ) as c
$function$;

-- INERT ACL/dispatch stub; not a business behavior test: ads_creatives_tick
CREATE FUNCTION public.ads_creatives_tick() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN INSERT INTO public.security_test_dispatch(routine) VALUES ('ads_creatives_tick'); RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: ads_metrics_tick
CREATE FUNCTION public.ads_metrics_tick() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN INSERT INTO public.security_test_dispatch(routine) VALUES ('ads_metrics_tick'); RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: ads_oauth_consume_session
CREATE FUNCTION public.ads_oauth_consume_session(_state text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: ads_oauth_create_session
CREATE FUNCTION public.ads_oauth_create_session() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: assignment_proposal_decidir
CREATE FUNCTION public.assignment_proposal_decidir(_proposal_id uuid, _decisao text, _nota text DEFAULT NULL::text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: assignment_proposal_decidir_lote
CREATE FUNCTION public.assignment_proposal_decidir_lote(_proposal_ids uuid[], _decisao text, _nota text DEFAULT NULL::text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: audit_dossies_duplicados
CREATE FUNCTION public.audit_dossies_duplicados() RETURNS TABLE(id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: audit_referencias_orfas
CREATE FUNCTION public.audit_referencias_orfas() RETURNS TABLE(tabela text, id uuid, client_id_orfao uuid, criado_em timestamp with time zone) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: can_delete_file
CREATE FUNCTION public.can_delete_file(_file_id uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN false; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: collect_ads_metrics_now
CREATE FUNCTION public.collect_ads_metrics_now() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

CREATE OR REPLACE FUNCTION public.collect_ads_now()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _c1 jsonb; _p1 jsonb; _c2 jsonb; _p2 jsonb;
begin
  if not public.is_staff(auth.uid()) then
    raise exception 'somente a equipe pode atualizar os anuncios';
  end if;

  _c1 := public.ads_metrics_tick();
  _p1 := public.ads_creatives_tick();
  perform pg_sleep(2);
  _c2 := public.ads_metrics_tick();
  _p2 := public.ads_creatives_tick();

  return jsonb_build_object(
    'campanhas', jsonb_build_object(
      'dispatched', coalesce((_c1 ->> 'dispatched')::int, 0) + coalesce((_c2 ->> 'dispatched')::int, 0),
      'parsed', coalesce((_c1 ->> 'parsed')::int, 0) + coalesce((_c2 ->> 'parsed')::int, 0)
    ),
    'criativos', jsonb_build_object(
      'dispatched', coalesce((_p1 ->> 'dispatched')::int, 0) + coalesce((_p2 ->> 'dispatched')::int, 0),
      'parsed', coalesce((_p1 ->> 'parsed')::int, 0) + coalesce((_p2 ->> 'parsed')::int, 0)
    )
  );
end;
$function$;

-- INERT ACL/dispatch stub; not a business behavior test: collect_social_metrics_now
CREATE FUNCTION public.collect_social_metrics_now() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

CREATE OR REPLACE FUNCTION public.dossie_avancos_texto(_client_id uuid, _dias integer DEFAULT 7)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with proj as (select id, name from public.projects where client_id = _client_id and deleted_at is null),
  tarefas as (select t.title from public.tasks t join proj on proj.id = t.project_id where t.status = 'done' and t.deleted_at is null and t.updated_at >= now() - make_interval(days => _dias) order by t.updated_at desc limit 12),
  pubs as (select coalesce(p.title, 'publicação') as title, e.published_at, e.platform from public.editorial_publications e left join public.editorial_posts p on p.id = e.post_id where e.client_id = _client_id and e.status = 'published' and e.published_at >= now() - make_interval(days => _dias) order by e.published_at desc limit 12),
  aprovadas as (select distinct f.file_name from public.file_approval_events ev join public.files f on f.id = ev.file_id where ev.client_id = _client_id and ev.to_status = 'approved' and ev.created_at >= now() - make_interval(days => _dias) limit 12),
  marcos as (select m.title, m.updated_at from public.milestones m join proj on proj.id = m.project_id where m.status = 'completed' and m.deleted_at is null and m.updated_at >= now() - make_interval(days => _dias) order by m.updated_at desc limit 8),
  agenda as (select count(*) as n from public.editorial_publications e where e.client_id = _client_id and e.status = 'scheduled' and e.scheduled_at > now())
  select concat_ws(E'\n',
    '## Avanços recentes (automático, ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || ')',
    'Registro gerado pelo painel a partir do que aconteceu nos últimos ' || _dias || ' dias. Não edite esta seção: ela é reescrita.',
    case when exists (select 1 from tarefas) then E'\n**Tarefas concluídas:** ' || (select string_agg(title, '; ') from tarefas) end,
    case when exists (select 1 from pubs) then E'\n**Publicações no ar:** ' || (select string_agg(title || ' (' || to_char(published_at at time zone 'America/Sao_Paulo', 'DD/MM') || ')', '; ') from pubs) end,
    case when exists (select 1 from aprovadas) then E'\n**Materiais aprovados pelo cliente:** ' || (select string_agg(file_name, '; ') from aprovadas) end,
    case when exists (select 1 from marcos) then E'\n**Marcos concluídos:** ' || (select string_agg(title, '; ') from marcos) end,
    E'\n**Agenda à frente:** ' || (select n from agenda) || ' publicação(ões) agendada(s).'
  );
$function$;

CREATE OR REPLACE FUNCTION public.dossie_registrar_avancos(_client_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _atual public.client_dossiers%rowtype;
  _marcador constant text := '## Avanços recentes (automático';
  _humano text; _secao text; _novo text; _pos integer;
begin
  select * into _atual from public.client_dossiers d
    where d.client_id = _client_id and d.dossier_type = 'contexto' and d.project_id is null and d.is_current limit 1;
  if not found then return false; end if;
  _secao := public.dossie_avancos_texto(_client_id, 7);
  _pos := position(_marcador in _atual.content);
  _humano := case when _pos > 0 then rtrim(left(_atual.content, _pos - 1)) else rtrim(_atual.content) end;
  if _pos > 0 and trim(substr(_atual.content, _pos)) = trim(_secao) then return false; end if;
  _novo := _humano || E'\n\n' || _secao;
  perform public.upsert_current_dossier(
    _client_id := _client_id, _content := _novo, _dossier_type := 'contexto', _project_id := null,
    _summary := _atual.summary, _change_reason := 'Avanços automáticos do painel (7 dias)',
    _source := 'painel', _actor := 'ciclo', _tags := array['avancos-automaticos'],
    _metadata := coalesce(_atual.metadata, '{}'::jsonb) || jsonb_build_object('auto_avancos', true, 'auto_avancos_em', now()),
    _expected_version := _atual.version);
  return true;
end; $function$;

CREATE OR REPLACE FUNCTION public.dossie_registrar_avancos_todos()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _c record; _n integer := 0;
begin
  for _c in select distinct d.client_id from public.client_dossiers d join public.profiles p on p.id = d.client_id and p.deleted_at is null
            where d.is_current and d.dossier_type = 'contexto' and d.project_id is null loop
    begin
      if public.dossie_registrar_avancos(_c.client_id) then _n := _n + 1; end if;
    exception when others then raise warning 'dossie_registrar_avancos(%): %', _c.client_id, sqlerrm; end;
  end loop;
  return _n;
end; $function$;

-- INERT ACL/dispatch stub; not a business behavior test: editorial_alerta_agendamento_atrasado
CREATE FUNCTION public.editorial_alerta_agendamento_atrasado() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: editorial_autopublish_tick
CREATE FUNCTION public.editorial_autopublish_tick() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN INSERT INTO public.security_test_dispatch(routine) VALUES ('editorial_autopublish_tick'); RETURN '{}'::jsonb; END $stub$;

CREATE OR REPLACE FUNCTION public.editorial_ciclo_publicacao()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _promocao jsonb;
  _tick jsonb;
begin
  _promocao := public.editorial_promover_planejados();
  _tick := public.editorial_autopublish_tick();
  return jsonb_build_object('promocao', _promocao, 'publicacao', _tick);
end;
$function$;

-- INERT ACL/dispatch stub; not a business behavior test: editorial_conferir_agendamentos
CREATE FUNCTION public.editorial_conferir_agendamentos() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: editorial_limpar_alertas_resolvidos
CREATE FUNCTION public.editorial_limpar_alertas_resolvidos() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN 0; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: editorial_promover_planejados
CREATE FUNCTION public.editorial_promover_planejados(_janela_de_atraso interval DEFAULT '06:00:00'::interval) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN INSERT INTO public.security_test_dispatch(routine) VALUES ('editorial_promover_planejados'); RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: editorial_reconciliar_publicados
CREATE FUNCTION public.editorial_reconciliar_publicados() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: expense_estornar
CREATE FUNCTION public.expense_estornar(_pagamento_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: expense_pagar
CREATE FUNCTION public.expense_pagar(_expense_id uuid, _pago_em date DEFAULT NULL::date, _valor numeric DEFAULT NULL::numeric, _proximo_vencimento date DEFAULT NULL::date) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: operator_approval_decidir
CREATE FUNCTION public.operator_approval_decidir(_approval_id uuid, _decisao text, _nota text DEFAULT NULL::text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

CREATE OR REPLACE FUNCTION public.operator_assign_task(_operator_slug text, _kanban_task_id uuid, _actor text, _note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _flag boolean;
  _op public.internal_operators%rowtype;
  _link public.operator_task_links%rowtype;
  _dono public.internal_operators%rowtype;
  _titulo text;
  _humano uuid;
begin
  select enabled into _flag from public.feature_flags where flag_key = 'operators_layer';
  if not coalesce(_flag, false) then
    raise exception 'flag_off: a camada de operadores esta desligada (operators_layer)';
  end if;

  select * into _op from public.internal_operators
    where slug = lower(trim(_operator_slug));
  if not found then
    raise exception 'operator_not_found: % nao existe na hierarquia', _operator_slug;
  end if;
  if _op.status <> 'active' then
    raise exception
      'operator_paused: % esta com status % e nao recebe nem registra trabalho ate ser reativado',
      _op.slug, _op.status;
  end if;

  -- A tarefa tem que existir. Sem esta checagem, um id errado viraria uma
  -- fila fantasma que o agente nunca conseguiria cumprir.
  select t.title, t.assigned_to into _titulo, _humano
    from public.tasks t where t.id = _kanban_task_id;
  if not found then
    raise exception 'task_not_found: tarefa % nao existe no Kanban', _kanban_task_id;
  end if;

  -- Ja ofereci esta tarefa a este operador? Devolve o que existe.
  select * into _link from public.operator_task_links
    where operator_id = _op.id and kanban_task_id = _kanban_task_id
    order by created_at desc limit 1;
  if found and _link.status not in ('done') then
    return jsonb_build_object(
      'ok', true, 'ja_existia', true, 'link_id', _link.id,
      'status', _link.status, 'operator', _op.slug, 'titulo', _titulo
    );
  end if;

  -- Outro operador ja esta nela?
  select o.* into _dono from public.operator_task_links l
    join public.internal_operators o on o.id = l.operator_id
   where l.kanban_task_id = _kanban_task_id
     and l.operator_id <> _op.id
     and l.status in ('queued', 'in_progress', 'awaiting_input', 'review')
   limit 1;
  if found then
    raise exception
      'ja_atribuida: esta tarefa ja esta com %. Conclua, libere ou escolha outra tarefa.',
      _dono.display_name;
  end if;

  insert into public.operator_task_links
    (operator_id, kanban_task_id, execution_source, status, next_step)
  values (_op.id, _kanban_task_id, 'painel', 'queued', nullif(trim(_note), ''))
  returning * into _link;

  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action, old_status, new_status)
  values
    (_actor, _op.id, _link.id, _kanban_task_id,
     'tarefa oferecida a ' || _op.display_name, null, 'queued');

  return jsonb_build_object(
    'ok', true,
    'ja_existia', false,
    'link_id', _link.id,
    'status', 'queued',
    'operator', _op.slug,
    'titulo', _titulo,
    -- O responsavel humano continua exatamente onde estava. Devolver isso
    -- na resposta e a prova, para quem chamou, de que nada foi tomado.
    'responsavel_humano_intocado', _humano
  );
end;
$function$;

-- INERT ACL/dispatch stub; not a business behavior test: operator_cancelar_tarefa
CREATE FUNCTION public.operator_cancelar_tarefa(_operator_slug text, _approval_id uuid, _task_id uuid, _motivo text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

CREATE OR REPLACE FUNCTION public.operator_expire_stale_runs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _n integer;
begin
  with expiradas as (
    update public.operator_runs r set
      status = 'timeout',
      finished_at = now(),
      error = coalesce(r.error, 'timeout: sem heartbeat dentro do prazo')
    where r.status in ('started', 'progress')
      and r.heartbeat_at < now() - make_interval(secs => r.timeout_seconds)
    returning r.id, r.task_link_id
  ),
  liberadas as (
    update public.operator_task_links l set
      status = 'blocked',
      block_reason = coalesce(l.block_reason, 'execucao expirou sem heartbeat'),
      updated_at = now()
    from expiradas e
    where l.id = e.task_link_id and l.status = 'in_progress'
    returning l.id
  )
  select count(*) into _n from expiradas;
  return _n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.operator_fechar_orfaos()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _propostas integer := 0;
  _runs integer := 0;
  _vinculos integer := 0;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'somente_equipe';
  END IF;

  -- 1) Proposta de responsavel para tarefa que nao existe mais, foi
  --    excluida ou ja foi concluida: perdeu o objeto.
  WITH fechadas AS (
    UPDATE public.assignment_proposals p
       SET status = 'rejeitada',
           decided_at = now(),
           decision_note = COALESCE(p.decision_note, 'Fechada pelo painel: a tarefa foi excluída ou concluída antes da decisão.')
      FROM (
        SELECT p2.id
          FROM public.assignment_proposals p2
          LEFT JOIN public.tasks t ON t.id = p2.kanban_task_id
         WHERE p2.status = 'pendente'
           AND (t.id IS NULL OR t.deleted_at IS NOT NULL OR lower(COALESCE(t.status, '')) IN ('done', 'completed', 'concluida', 'cancelado', 'cancelled'))
      ) alvo
     WHERE p.id = alvo.id
     RETURNING p.id
  )
  SELECT count(*) INTO _propostas FROM fechadas;

  -- 2) Run que espera gente (ou revisao) para tarefa excluida: expira com motivo.
  WITH expiradas AS (
    UPDATE public.operator_runs r
       SET status = 'timeout',
           finished_at = COALESCE(r.finished_at, now()),
           error = COALESCE(r.error, 'encerrada: a tarefa foi excluída')
      FROM public.operator_task_links l
      LEFT JOIN public.tasks t ON t.id = l.kanban_task_id
     WHERE r.task_link_id = l.id
       AND r.status IN ('awaiting_input', 'review', 'started', 'progress')
       AND l.kanban_task_id IS NOT NULL
       AND (t.id IS NULL OR t.deleted_at IS NOT NULL)
     RETURNING r.id
  )
  SELECT count(*) INTO _runs FROM expiradas;

  -- 3) Vinculo de tarefa excluida vira bloqueado com o motivo, se ainda nao era.
  WITH encerrados AS (
    UPDATE public.operator_task_links l
       SET status = 'blocked',
           block_reason = COALESCE(l.block_reason, 'Tarefa excluída: vínculo encerrado pelo painel.'),
           updated_at = now()
      FROM (
        SELECT l2.id
          FROM public.operator_task_links l2
          LEFT JOIN public.tasks t ON t.id = l2.kanban_task_id
         WHERE l2.kanban_task_id IS NOT NULL
           AND l2.status <> 'done'
           AND l2.status <> 'blocked'
           AND (t.id IS NULL OR t.deleted_at IS NOT NULL)
      ) alvo
     WHERE l.id = alvo.id
     RETURNING l.id
  )
  SELECT count(*) INTO _vinculos FROM encerrados;

  RETURN jsonb_build_object('propostas_fechadas', _propostas, 'runs_expirados', _runs, 'vinculos_encerrados', _vinculos);
END;
$$;

CREATE OR REPLACE FUNCTION public.operator_human_action(_link_id uuid, _new_status text DEFAULT NULL::text, _note text DEFAULT NULL::text, _resolve_approval boolean DEFAULT false)
 RETURNS operator_task_links
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _link public.operator_task_links%rowtype;
  _velho text;
  _quem text;
  _flag boolean;
begin
  select enabled into _flag from public.feature_flags where flag_key = 'operators_layer';
  if not coalesce(_flag, false) then
    raise exception 'flag_off: a camada de operadores esta desligada (operators_layer)';
  end if;

  -- Só a equipe move o quadro. Cliente não vê e não toca.
  if not (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    or public.has_role(auth.uid(), 'manager'::public.app_role)
    or public.has_role(auth.uid(), 'design'::public.app_role)
    or public.has_role(auth.uid(), 'traffic'::public.app_role)
  ) then
    raise exception 'not_allowed: somente a equipe move o quadro de execucao';
  end if;

  select * into _link from public.operator_task_links where id = _link_id;
  if not found then
    raise exception 'not_found: vinculo % nao existe', _link_id;
  end if;

  if _new_status is not null
    and _new_status not in ('queued', 'in_progress', 'done', 'review', 'awaiting_input', 'blocked')
  then
    raise exception 'invalid_status: %', _new_status;
  end if;

  _velho := _link.status;

  -- A mesma régua do agente vale para a mão humana: concluir sem
  -- evidência vira revisão. A regra é do trabalho, não de quem clica.
  if _new_status = 'done' and coalesce(trim(_link.last_evidence), '') = '' then
    _new_status := 'review';
  end if;

  update public.operator_task_links set
    status = coalesce(_new_status, status),
    block_reason = case
      when _new_status is not null and _new_status <> 'blocked' then null
      else coalesce(_note, block_reason)
    end,
    next_step = case when _note is not null and coalesce(_new_status, '') <> 'blocked'
      then _note else next_step end,
    approval_required = case when _resolve_approval then false else approval_required end,
    updated_at = now()
  where id = _link_id
  returning * into _link;

  select coalesce(p.full_name, 'equipe') into _quem
    from public.profiles p where p.id = auth.uid();

  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action, old_status, new_status, evidence, from_cron, approval_required)
  values
    (coalesce(_quem, 'equipe') || ' (humano)', _link.operator_id, _link.id, _link.kanban_task_id,
     case
       when _resolve_approval and _new_status is null then 'aprovacao resolvida pela equipe'
       when _new_status is not null then 'movido pela equipe'
       else 'anotacao da equipe'
     end,
     _velho, _link.status, null, false, _link.approval_required);

  return _link;
end;
$function$;

CREATE OR REPLACE FUNCTION public.operator_ordem_executada(_operator_slug text, _approval_id uuid, _evidence text, _run_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _op public.internal_operators%rowtype;
  _aprov public.operator_approvals%rowtype;
begin
  select * into _op from public.internal_operators where slug = lower(trim(_operator_slug));
  if not found then raise exception 'operator_not_found: % nao existe', _operator_slug; end if;
  if _op.status <> 'active' then
    raise exception 'operator_paused: % esta % e nao executa ordem', _op.slug, _op.status; end if;

  select * into _aprov from public.operator_approvals where id = _approval_id;
  if not found then raise exception 'approval_not_found: % nao existe', _approval_id; end if;
  if _aprov.operator_id <> _op.id then
    raise exception 'ordem_de_outro: esta ordem foi autorizada para outro agente'; end if;
  if _aprov.status <> 'aprovado' then
    raise exception 'nao_autorizada: a ordem esta como % e nao pode ser executada', _aprov.status; end if;
  if _aprov.executed_at is not null then
    raise exception 'ja_executada: cumprida em %; repetir publicaria ou gastaria duas vezes', _aprov.executed_at; end if;
  if _aprov.valid_until is not null and _aprov.valid_until <= now() then
    raise exception 'ordem_vencida: a autorizacao expirou em %; peca outra', _aprov.valid_until; end if;
  if coalesce(btrim(_evidence), '') = '' then
    raise exception 'sem_evidencia: acao externa exige prova (link do post, id da campanha, recibo).'; end if;

  update public.operator_approvals
     set executed_at = now(), execution_evidence = _evidence, execution_run_key = _run_key
   where id = _approval_id returning * into _aprov;

  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action, evidence, run_key)
  values ('mcp:' || _op.slug, _op.id, _aprov.task_link_id, _aprov.kanban_task_id,
          'ordem ' || _aprov.action_kind || ' EXECUTADA no mundo', _evidence, _run_key);

  return jsonb_build_object('ok', true, 'approval_id', _aprov.id,
    'executed_at', _aprov.executed_at, 'action_kind', _aprov.action_kind);
end;
$function$;

CREATE OR REPLACE FUNCTION public.operator_ordens_abertas(_operator_slug text)
 RETURNS TABLE(approval_id uuid, action_kind text, o_que text, por_que text, destino text, prazo date, reversivel boolean, custo_previsto numeric, payload jsonb, kanban_task_id uuid, task_link_id uuid, titulo_da_tarefa text, aprovada_em timestamp with time zone, nota_de_quem_aprovou text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Autorizada, ainda nao cumprida, e ainda dentro da validade. Ordem
  -- vencida NAO aparece: autorizacao de tres semanas atras pode nao valer
  -- mais, e executar em cima dela e agir com procuracao velha.
  select
    a.id, a.action_kind, a.o_que, a.por_que, a.destino, a.prazo,
    a.reversivel, a.custo_previsto, a.payload,
    a.kanban_task_id, a.task_link_id,
    t.title,
    a.decided_at, a.decision_note
  from public.operator_approvals a
  join public.internal_operators o on o.id = a.operator_id
  left join public.tasks t on t.id = a.kanban_task_id
  where o.slug = lower(trim(_operator_slug))
    and o.status = 'active'
    and a.status = 'aprovado'
    and a.executed_at is null
    and (a.valid_until is null or a.valid_until > now())
  order by a.prazo nulls last, a.decided_at;
$function$;

-- INERT ACL/dispatch stub; not a business behavior test: operator_participar
CREATE FUNCTION public.operator_participar(_operator_slug text, _link_id uuid, _entry_type text, _body text, _title text DEFAULT NULL::text, _attachments jsonb DEFAULT '[]'::jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: operator_pausar
CREATE FUNCTION public.operator_pausar(_slug text, _pausar boolean, _motivo text DEFAULT NULL::text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: operator_propor_responsavel
CREATE FUNCTION public.operator_propor_responsavel(_operator_slug text, _kanban_task_id uuid, _suggested_assignee uuid, _justificativa text, _evidencias jsonb DEFAULT '[]'::jsonb, _confianca numeric DEFAULT NULL::numeric, _prazo date DEFAULT NULL::date, _impacto text DEFAULT NULL::text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: operator_reconciliar_vinculos_gemeos
CREATE FUNCTION public.operator_reconciliar_vinculos_gemeos() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: operator_registrar_feito
CREATE FUNCTION public.operator_registrar_feito(_operator_slug text, _o_que text, _como text, _onde_acessar text, _onde_documentado text DEFAULT NULL::text, _kanban_task_id uuid DEFAULT NULL::uuid, _approval_id uuid DEFAULT NULL::uuid, _run_key text DEFAULT NULL::text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

CREATE OR REPLACE FUNCTION public.operator_report_event(_operator_slug text, _event text, _run_key text, _actor text, _kanban_task_id uuid DEFAULT NULL::uuid, _painel_task_id uuid DEFAULT NULL::uuid, _action text DEFAULT NULL::text, _evidence text DEFAULT NULL::text, _next_step text DEFAULT NULL::text, _block_reason text DEFAULT NULL::text, _error text DEFAULT NULL::text, _approval_required boolean DEFAULT false, _from_cron boolean DEFAULT false, _attempt integer DEFAULT 1, _timeout_seconds integer DEFAULT 900, _detail jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _flag boolean;
  _op public.internal_operators%rowtype;
  _link public.operator_task_links%rowtype;
  _run public.operator_runs%rowtype;
  _status_novo text;
  _status_velho text;
  _notifica boolean := false;
  _mensagem text;
  _client_id uuid;
  _titulo_tarefa text;
  _memoria_id uuid;
  _nome_cliente text;
  _pronto_cliente boolean := false;
  _tarefa uuid;
begin
  select enabled into _flag from public.feature_flags where flag_key = 'operators_layer';
  if not coalesce(_flag, false) then
    raise exception 'flag_off: a camada de operadores esta desligada (operators_layer)';
  end if;

  select * into _op from public.internal_operators
    where slug = lower(trim(_operator_slug));
  if not found then
    raise exception 'operator_not_found: % nao existe na hierarquia', _operator_slug;
  end if;
  if _op.status <> 'active' then
    raise exception
      'operator_paused: % esta com status % e nao recebe nem registra trabalho ate ser reativado',
      _op.slug, _op.status;
  end if;

  if _event not in ('started', 'progress', 'done', 'failed', 'blocked', 'review', 'awaiting_input', 'heartbeat') then
    raise exception 'invalid_event: %', _event;
  end if;

  if _evidence is not null and (
    _evidence ~* '(token|signature|x-amz|apikey|api_key|secret|sig)='
  ) then
    _evidence := split_part(_evidence, '?', 1) || ' [query removida: continha credencial]';
  end if;

  -- ── Achar o vinculo: PRIMEIRO pela chave de idempotencia ──────────────
  --
  -- O run_key identifica a execucao. Se ja existe vinculo deste operador
  -- com esta chave, e ELE, venha o id no campo que vier. Casar so pelo par
  -- de ids foi o que fez o mesmo trabalho virar dois vinculos quando o
  -- relato trocou kanban_task_id por painel_task_id.
  select * into _link from public.operator_task_links l
    where l.operator_id = _op.id
      and l.agent_run_id = _run_key
    order by l.created_at
    limit 1;

  if not found and (_kanban_task_id is not null or _painel_task_id is not null) then
    select * into _link from public.operator_task_links l
      where l.operator_id = _op.id
        and coalesce(l.kanban_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(_kanban_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and coalesce(l.painel_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(_painel_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
      order by l.created_at desc limit 1;
  end if;

  if _link.id is null and _event <> 'heartbeat'
     and (_kanban_task_id is not null or _painel_task_id is not null) then
    insert into public.operator_task_links
      (operator_id, agent_run_id, kanban_task_id, painel_task_id, execution_source)
    values (_op.id, _run_key, _kanban_task_id, _painel_task_id,
            case when _from_cron then 'cron' else 'mcp' end)
    returning * into _link;
  end if;

  _status_velho := _link.status;
  _status_novo := case _event
    when 'started' then 'in_progress'
    when 'progress' then 'in_progress'
    when 'done' then case when coalesce(trim(_evidence), '') = '' and coalesce(trim(_link.last_evidence), '') = ''
      then 'review' else 'done' end
    when 'failed' then 'blocked'
    when 'blocked' then 'blocked'
    when 'review' then 'review'
    when 'awaiting_input' then 'awaiting_input'
    else null
  end;

  if _link.id is not null and _status_novo is not null then
    update public.operator_task_links set
      status = _status_novo,
      agent_run_id = coalesce(_run_key, agent_run_id),
      -- O vinculo APRENDE o id que faltava, em vez de nascer um irmao.
      kanban_task_id = coalesce(kanban_task_id, _kanban_task_id),
      painel_task_id = coalesce(painel_task_id, _painel_task_id),
      last_action = coalesce(_action, last_action),
      last_evidence = coalesce(_evidence, last_evidence),
      next_step = coalesce(_next_step, next_step),
      block_reason = case when _event in ('failed', 'blocked')
        then coalesce(_block_reason, _error, block_reason) else null end,
      -- A flag ESPELHA a aprovacao, e nao o contrario. Antes isto era
      -- "_approval_required or approval_required": um OU que so sabia
      -- ligar, e prendia o vinculo numa pergunta que nunca existiu.
      approval_required = exists (
        select 1 from public.operator_approvals a
         where a.task_link_id = _link.id and a.status = 'pendente'
      ),
      updated_at = now()
    where id = _link.id
    returning * into _link;
  end if;

  insert into public.operator_runs
    (operator_id, run_key, task_link_id, status, attempt, timeout_seconds, error, detail)
  values (
    _op.id, _run_key, _link.id,
    public.operator_status_do_run(_event),
    greatest(_attempt, 1), _timeout_seconds, _error, _detail
  )
  on conflict (operator_id, run_key) do update set
    status = excluded.status,
    task_link_id = coalesce(excluded.task_link_id, operator_runs.task_link_id),
    attempt = greatest(operator_runs.attempt, excluded.attempt),
    heartbeat_at = now(),
    finished_at = case when excluded.status in ('done', 'failed', 'blocked', 'timeout')
      then now() else operator_runs.finished_at end,
    error = coalesce(excluded.error, operator_runs.error),
    detail = operator_runs.detail || excluded.detail
  returning * into _run;

  update public.internal_operators set last_run_at = now() where id = _op.id;

  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action, old_status,
     new_status, evidence, from_cron, approval_required, run_key)
  values
    (_actor, _op.id, _link.id, coalesce(_kanban_task_id, _link.kanban_task_id),
     coalesce(_action, _event), _status_velho, coalesce(_status_novo, _status_velho),
     _evidence, _from_cron, _approval_required, _run_key);

  -- ── A ponte com o progresso do cliente ────────────────────────────────
  --
  -- A tarefa sai do VINCULO, e nao so do parametro: quem relatou done por
  -- painel_task_id continua chegando na tarefa certa.
  -- SINALIZAR APROVACAO SEM ABRIR O PEDIDO agora deixa rastro.
  --
  -- O booleano nao diz QUAL acao o agente quer fazer, e action_kind e um
  -- vocabulario fechado: nao da para abrir o pedido por ele sem inventar a
  -- natureza da coisa. Entao o trabalho SEGUE e o desvio fica registrado,
  -- em vez de travar em silencio como travou treze vinculos.
  if _approval_required and _link.id is not null
     and not exists (
       select 1 from public.operator_approvals a
        where a.task_link_id = _link.id and a.status = 'pendente'
     ) then
    insert into public.operator_audit_log
      (actor, operator_id, task_link_id, kanban_task_id, action, evidence, run_key)
    values (
      'sistema', _op.id, _link.id, coalesce(_kanban_task_id, _link.kanban_task_id),
      'agente sinalizou aprovacao sem abrir o pedido',
      'O agente ' || _op.slug || ' passou _approval_required=true em report_event, '
        || 'mas nao ha aprovacao pendente para este vinculo. Pedido de aprovacao se '
        || 'abre por operator_request_approval, dizendo QUAL acao se quer fazer. '
        || 'O trabalho seguiu; nada ficou travado.',
      _run_key
    );
  end if;

  _tarefa := coalesce(_kanban_task_id, _link.kanban_task_id, _link.painel_task_id);

  if _status_novo = 'done' and _tarefa is not null then
    select pj.client_id, t.title into _client_id, _titulo_tarefa
      from public.tasks t
      join public.projects pj on pj.id = t.project_id
      where t.id = _tarefa
      limit 1;

    if _client_id is not null then
      select coalesce(nullif(trim(p.company_name), ''), p.full_name)
        into _nome_cliente
        from public.profiles p where p.id = _client_id;
      _pronto_cliente := true;

      select id into _memoria_id from public.project_memory
        where client_id = _client_id
          and source = 'operador'
          and metadata->>'run_key' = _run_key
        limit 1;

      if _memoria_id is null then
        insert into public.project_memory
          (client_id, kind, source, title, content, tags, metadata)
        values (
          _client_id,
          'entrega',
          'operador',
          coalesce(_titulo_tarefa, _action, 'Entrega concluida'),
          coalesce(_action, _titulo_tarefa, 'Entrega concluida')
            || E'\n\nEvidencia: ' || coalesce(_evidence, _link.last_evidence, '(sem link)')
            || E'\nOperador: ' || _op.display_name,
          array['operador', _op.slug],
          jsonb_build_object(
            'run_key', _run_key,
            'operator_slug', _op.slug,
            'kanban_task_id', _tarefa,
            'task_link_id', _link.id,
            'pronto_para_cliente', true,
            'client_visible', false
          )
        );
      end if;
    end if;
  end if;

  -- ── O dono sabe de tudo, menos do pulso do cron ───────────────────────
  _notifica := _event <> 'heartbeat';
  if _notifica then
    _mensagem := _op.display_name || case _event
      when 'started' then ' iniciou'
      when 'progress' then ' avancou em'
      when 'done' then case when _status_novo = 'review'
        then ' concluiu SEM evidencia (foi para revisao)' else ' concluiu' end
      when 'failed' then ' falhou em'
      when 'blocked' then ' bloqueou'
      when 'review' then ' enviou para revisao'
      when 'awaiting_input' then ' esta esperando resposta em'
      else ' atualizou'
    end || ' ' || coalesce(nullif(trim(_titulo_tarefa), ''), 'uma tarefa')
      || coalesce(' · ' || _nome_cliente, '')
      || case when _pronto_cliente then ' · PRONTO PARA O CLIENTE' else '' end
      || case when _approval_required then ' · precisa de aprovacao' else '' end;

    -- O link leva ao VINCULO e carrega a run: quem clica no aviso chega no
    -- registro exato, e nao numa lista para procurar de novo.
    insert into public.notifications (user_id, message, notification_type, link)
    select ur.user_id, _mensagem,
      case when _pronto_cliente then 'operator_pronto' else 'operator' end,
      '/execucao?vinculo=' || coalesce(_link.id::text, '')
        || coalesce('&run=' || _run.id::text, '')
    from public.user_roles ur
    where ur.role = 'admin';
  end if;

  -- ─── O CARD ANDA JUNTO ───────────────────────────────────────────
  --
  -- Ate aqui o agente trabalhava e a tarefa ficava parada onde estava:
  -- dezenas de "pendentes" que ja tinham sido tocadas. O card agora
  -- acompanha o trabalho — ate a revisao, nunca alem.
  --
  -- `assigned_to` NAO e tocado: mover a coluna e dizer em que pe esta o
  -- trabalho; dizer de quem ele e continua sendo decisao humana.
  if _tarefa is not null then
    declare
      _status_card text;
      _card_novo text;
    begin
      select t.status into _status_card from public.tasks t where t.id = _tarefa;
      _card_novo := public.operator_status_do_card(
        _event, _status_card, _evidence is not null and btrim(_evidence) <> ''
      );
      if _card_novo is not null and _card_novo is distinct from _status_card then
        update public.tasks set status = _card_novo where id = _tarefa;
        insert into public.operator_audit_log
          (actor, operator_id, task_link_id, kanban_task_id, action, old_status, new_status)
        values ('mcp:' || _op.slug, _op.id, _link.id, _tarefa,
                'card movido pelo trabalho do agente', _status_card, _card_novo);
      end if;
    exception when others then
      -- Mover o card NAO pode derrubar o relato. O trabalho aconteceu; se
      -- o Kanban recusar (guard editorial, por exemplo), isso vira nota na
      -- trilha e o evento segue.
      insert into public.operator_audit_log
        (actor, operator_id, task_link_id, kanban_task_id, action)
      values ('mcp:' || _op.slug, _op.id, _link.id, _tarefa,
              'card NAO moveu: ' || left(sqlerrm, 200));
    end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'operator', _op.slug,
    'link_id', _link.id,
    'run_id', _run.id,
    'run_status', _run.status,
    'link_status', coalesce(_status_novo, _status_velho),
    'attempt', _run.attempt,
    'notified', _notifica,
    'kanban_task_id', _tarefa,
    'registrado_no_progresso', (_status_novo = 'done' and _client_id is not null),
    'pronto_para_cliente', _pronto_cliente
  );
end;
$function$;

-- INERT ACL/dispatch stub; not a business behavior test: operator_request_approval
CREATE FUNCTION public.operator_request_approval(_operator_slug text, _link_id uuid, _action_kind text, _o_que text, _por_que text, _payload jsonb, _dados_usados text DEFAULT NULL::text, _destino text DEFAULT NULL::text, _impacto text DEFAULT NULL::text, _risco text DEFAULT NULL::text, _custo_previsto numeric DEFAULT NULL::numeric, _prazo date DEFAULT NULL::date, _reversivel boolean DEFAULT true, _evidencia text DEFAULT NULL::text, _valid_until timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN RETURN '{}'::jsonb; END $stub$;

CREATE OR REPLACE FUNCTION public.operator_update(_slug text, _actor text, _display_name text DEFAULT NULL::text, _role text DEFAULT NULL::text, _area text DEFAULT NULL::text, _parent_slug text DEFAULT NULL::text, _display_order integer DEFAULT NULL::integer, _scope text DEFAULT NULL::text, _status text DEFAULT NULL::text, _is_coordinator boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _op public.internal_operators%rowtype;
  _pai public.internal_operators%rowtype;
  _cursor text;
  _saltos integer := 0;
begin
  select * into _op from public.internal_operators where slug = lower(trim(_slug));
  if not found then
    raise exception 'operator_not_found: % nao existe', _slug;
  end if;

  if _status is not null and _status not in ('active', 'paused', 'retired') then
    raise exception 'invalid_status: use active, paused ou retired';
  end if;

  if _parent_slug is not null and trim(_parent_slug) <> '' then
    if lower(trim(_parent_slug)) = _op.slug then
      raise exception 'ciclo: um agente nao pode coordenar a si mesmo';
    end if;
    select * into _pai from public.internal_operators where slug = lower(trim(_parent_slug));
    if not found then
      raise exception 'parent_not_found: % nao e um operador conhecido', _parent_slug;
    end if;
    -- Sobe a cadeia do futuro chefe: se eu aparecer nela, o vinculo
    -- fecharia um laco. O teto de saltos protege contra ciclo ja gravado.
    _cursor := _pai.parent_slug;
    while _cursor is not null and _saltos < 40 loop
      if _cursor = _op.slug then
        raise exception 'ciclo: % ja responde a %, direta ou indiretamente', _parent_slug, _op.slug;
      end if;
      select parent_slug into _cursor from public.internal_operators where slug = _cursor;
      _saltos := _saltos + 1;
    end loop;
  end if;

  -- SEM updated_at: a coluna nunca existiu nesta tabela, e quem guarda o
  -- "quando mudou e por quem" e a trilha imutavel logo abaixo.
  update public.internal_operators set
    display_name   = coalesce(nullif(trim(_display_name), ''), display_name),
    role           = coalesce(nullif(trim(_role), ''), role),
    area           = coalesce(nullif(trim(_area), ''), area),
    parent_slug    = case when _parent_slug is null then parent_slug
                          when trim(_parent_slug) = '' then null
                          else lower(trim(_parent_slug)) end,
    display_order  = coalesce(_display_order, display_order),
    scope          = coalesce(nullif(trim(_scope), ''), scope),
    status         = coalesce(_status, status),
    is_coordinator = coalesce(_is_coordinator, is_coordinator)
  where id = _op.id
  returning * into _op;

  insert into public.operator_audit_log (actor, operator_id, action, old_status, new_status)
  values (_actor, _op.id, 'organograma atualizado: ' || _op.slug, null, _op.status);

  return jsonb_build_object(
    'ok', true,
    'slug', _op.slug,
    'display_name', _op.display_name,
    'role', _op.role,
    'area', _op.area,
    'parent_slug', _op.parent_slug,
    'display_order', _op.display_order,
    'status', _op.status,
    'is_coordinator', _op.is_coordinator
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_meta_ads_token_from_login(_token text, _label text DEFAULT 'Token do login da Meta'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _secret_id uuid;
  _id uuid;
  _igual boolean;
begin
  if btrim(coalesce(_token, '')) = '' then
    raise exception 'token vazio';
  end if;

  -- Ja e exatamente este token, e esta ativo? Entao nao ha o que fazer.
  select exists (
    select 1
      from social_private.ads_tokens as t
      join vault.decrypted_secrets as s on s.id = t.access_token_secret_id
     where t.revoked_at is null
       and t.external_account_id is null
       and s.decrypted_secret = btrim(_token)
  ) into _igual;

  if _igual then
    return jsonb_build_object('ok', true, 'mudou', false);
  end if;

  update social_private.ads_tokens
     set revoked_at = now()
   where revoked_at is null
     and external_account_id is null;

  select vault.create_secret(
    btrim(_token),
    'meta-ads-login-' || gen_random_uuid()::text,
    'Token de leitura do Meta Ads, vindo do login da Meta',
    null
  ) into _secret_id;

  insert into social_private.ads_tokens
    (external_account_id, access_token_secret_id, label, saved_by)
  values (null, _secret_id, btrim(_label), null)
  returning id into _id;

  return jsonb_build_object('ok', true, 'mudou', true, 'id', _id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.social_metrics_ciclo()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  _retrato jsonb;
  _tick jsonb;
begin
  _retrato := public.social_retrato_da_semana_corrente();
  _tick := public.social_metrics_tick();
  return jsonb_build_object('retrato_de_hoje', _retrato, 'tick', _tick);
end;
$function$;

-- INERT ACL/dispatch stub; not a business behavior test: social_metrics_tick
CREATE FUNCTION public.social_metrics_tick() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN INSERT INTO public.security_test_dispatch(routine) VALUES ('social_metrics_tick'); RETURN '{}'::jsonb; END $stub$;

-- INERT ACL/dispatch stub; not a business behavior test: social_retrato_da_semana_corrente
CREATE FUNCTION public.social_retrato_da_semana_corrente() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $stub$ BEGIN INSERT INTO public.security_test_dispatch(routine) VALUES ('social_retrato_da_semana_corrente'); RETURN '{}'::jsonb; END $stub$;

CREATE OR REPLACE FUNCTION public.upsert_current_dossier(_client_id uuid, _content text, _dossier_type text DEFAULT 'contexto'::text, _project_id uuid DEFAULT NULL::uuid, _summary text DEFAULT NULL::text, _change_reason text DEFAULT NULL::text, _source text DEFAULT NULL::text, _actor text DEFAULT NULL::text, _tags text[] DEFAULT '{}'::text[], _metadata jsonb DEFAULT '{}'::jsonb, _correlation_id text DEFAULT NULL::text, _idempotency_key text DEFAULT NULL::text, _expected_version integer DEFAULT NULL::integer)
 RETURNS client_dossiers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _atual public.client_dossiers%rowtype;
  _novo public.client_dossiers%rowtype;
begin
  -- Quem pode: serviço (sem uid) ou equipe. Cliente nunca escreve dossiê.
  if auth.uid() is not null
    and not (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      or public.has_role(auth.uid(), 'manager'::public.app_role)
      or public.has_role(auth.uid(), 'design'::public.app_role)
      or public.has_role(auth.uid(), 'traffic'::public.app_role)
    )
  then
    raise exception 'not_allowed: somente equipe atualiza dossie';
  end if;

  if coalesce(trim(_content), '') = '' then
    raise exception 'validation: content vazio';
  end if;

  perform 1 from public.profiles p
    where p.id = _client_id and p.deleted_at is null;
  if not found then
    raise exception 'not_found: client_id inexistente ou removido';
  end if;

  if _project_id is not null then
    perform 1 from public.projects pj
      where pj.id = _project_id
        and pj.client_id = _client_id
        and pj.deleted_at is null;
    if not found then
      raise exception 'validation: project_id nao pertence ao client_id ou foi removido';
    end if;
  end if;

  -- Replay: mesma idempotency_key devolve o que já foi gravado, sem
  -- criar versão nova. Gravação duplicada deixa de existir por construção.
  if _idempotency_key is not null then
    select * into _novo from public.client_dossiers d
      where d.client_id = _client_id
        and d.dossier_type = _dossier_type
        and d.idempotency_key = _idempotency_key
      limit 1;
    if found then
      return _novo;
    end if;
  end if;

  -- Tranca a chave inteira, não só a linha: na PRIMEIRA gravação de um
  -- cliente não existe linha para o for update segurar, e duas primeiras
  -- gravações simultâneas colidiriam no índice único em vez de virarem fila.
  perform pg_advisory_xact_lock(
    hashtext(
      _client_id::text || ':' || _dossier_type || ':'
      || coalesce(_project_id, '00000000-0000-0000-0000-000000000000'::uuid)::text
    )
  );

  -- Tranca a versão atual: duas atualizações simultâneas viram fila, não
  -- corrida — e a conta de versão nunca pula nem repete.
  select * into _atual from public.client_dossiers d
    where d.client_id = _client_id
      and d.dossier_type = _dossier_type
      and coalesce(d.project_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = coalesce(_project_id, '00000000-0000-0000-0000-000000000000'::uuid)
      and d.is_current
    for update;

  -- O bloqueio de regressão: quem escreve declara a versão que LEU. Se o
  -- mundo mudou desde então, a gravação para aqui, com conflito explícito —
  -- nunca retrocesso silencioso.
  if _expected_version is not null
    and coalesce(_atual.version, 0) <> _expected_version
  then
    raise exception 'version_conflict: a versao atual e % e voce esperava %',
      coalesce(_atual.version, 0), _expected_version;
  end if;

  if _atual.id is not null then
    update public.client_dossiers
      set is_current = false,
          superseded_at = now(),
          updated_at = now()
      where id = _atual.id;
  end if;

  insert into public.client_dossiers (
    client_id, project_id, dossier_type, version, content, summary,
    change_reason, prior_version_id, actor, source, tags, metadata,
    correlation_id, idempotency_key, is_current, effective_at
  ) values (
    _client_id, _project_id, _dossier_type,
    coalesce(_atual.version, 0) + 1,
    _content, _summary, _change_reason, _atual.id, _actor, _source,
    coalesce(_tags, '{}'),
    coalesce(_metadata, '{}'::jsonb) || jsonb_build_object('client_visible', false),
    _correlation_id, _idempotency_key, true, now()
  )
  returning * into _novo;

  if _atual.id is not null then
    update public.client_dossiers
      set superseded_by = _novo.id
      where id = _atual.id;
  end if;

  return _novo;
end;
$function$;

-- Reproduce the vulnerable inherited PUBLIC grants before applying the migration.
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO PUBLIC,anon,authenticated,service_role;

-- Snapshot populated BEFORE the new migration, including protected legacy
-- columns. It is synthetic data, not a password/token from any real system.
INSERT INTO public.profiles(id,full_name,plan_value,services_config,portal_password,first_access_token)
VALUES ('20000000-0000-4000-8000-000000000009','Preserved legacy fixture',2297,
  '{"social":true,"legacy_flag":"keep"}', 'synthetic-legacy-placeholder','synthetic-access-placeholder');
INSERT INTO public.client_dossiers(id,client_id,version,content,actor)
VALUES ('70000000-0000-4000-8000-000000000009','20000000-0000-4000-8000-000000000009',4,
  'Historical dossier fixture: must be preserved by the migration','fixture:historical');
CREATE TABLE public.security_test_before_migration AS SELECT
  (SELECT to_jsonb(p) FROM public.profiles p WHERE id='20000000-0000-4000-8000-000000000009') AS profile,
  (SELECT to_jsonb(d) FROM public.client_dossiers d WHERE id='70000000-0000-4000-8000-000000000009') AS dossier;
