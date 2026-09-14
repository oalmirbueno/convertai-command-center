\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'acq_isolated_central_%' OR current_setting('aceleriq.isolated_tests',true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'isolated database required'; END IF; END $$;
CREATE SCHEMA extensions;
CREATE FUNCTION extensions.digest(text,text) RETURNS bytea LANGUAGE sql IMMUTABLE AS 'SELECT public.digest($1,$2)';
CREATE TYPE public.app_role AS ENUM('admin','manager','design','traffic','client');
CREATE TABLE public.profiles(id uuid PRIMARY KEY,deleted_at timestamptz,plan_name text,services_config jsonb,plan_status text);
CREATE TABLE public.user_roles(user_id uuid,role app_role);
CREATE TABLE public.team_client_assignments(user_id uuid,client_id uuid);
CREATE FUNCTION public.has_role(u uuid,r app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=u AND role=r) $$;


CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN (
        'admin'::public.app_role,
        'design'::public.app_role,
        'traffic'::public.app_role,
        'manager'::public.app_role
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (
        public.has_role(auth.uid(), 'client'::public.app_role)
        AND auth.uid() = _client_id
      )
      OR (
        (
          public.has_role(auth.uid(), 'manager'::public.app_role)
          OR public.has_role(auth.uid(), 'design'::public.app_role)
          OR public.has_role(auth.uid(), 'traffic'::public.app_role)
        )
        AND EXISTS (
          SELECT 1 FROM public.team_client_assignments tca
          WHERE tca.user_id = auth.uid() AND tca.client_id = _client_id
        )
      )
    )
$$;

REVOKE ALL ON FUNCTION public.can_access_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_client(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_manage_client(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (
        public.has_role(auth.uid(), 'manager'::public.app_role)
        AND EXISTS (
          SELECT 1 FROM public.team_client_assignments tca
          WHERE tca.user_id = auth.uid() AND tca.client_id = _client_id
        )
      )
    )
$$;

REVOKE ALL ON FUNCTION public.can_manage_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_client(uuid) TO authenticated, service_role;

CREATE TABLE public.projects(id uuid PRIMARY KEY,client_id uuid REFERENCES profiles,deleted_at timestamptz,status text,project_type text,name text,description text,scope text,objectives text,updated_at timestamptz);
CREATE TABLE public.client_dossiers(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),client_id uuid,project_id uuid,dossier_type text,is_current boolean,version int,updated_at timestamptz,content text NOT NULL);
CREATE TABLE public.reports(id uuid PRIMARY KEY,client_id uuid REFERENCES profiles,project_id uuid REFERENCES projects,title text,summary text,next_steps text,metrics jsonb,period_start date,period_end date,status text,created_at timestamptz DEFAULT now());
CREATE TABLE public.internal_operators(id uuid PRIMARY KEY);
CREATE TABLE public.operator_task_links(id uuid PRIMARY KEY,approval_required boolean,updated_at timestamptz);
CREATE TABLE public.operator_audit_log(actor text,operator_id uuid,task_link_id uuid,kanban_task_id uuid,action text);
create table if not exists public.operator_approvals (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.internal_operators(id),
  task_link_id uuid references public.operator_task_links(id) on delete set null,
  kanban_task_id uuid,
  -- O catalogo fechado das acoes que EXIGEM humano. Fora desta lista o
  -- agente nao pede aprovacao: ou e acao interna (nao precisa) ou e acao
  -- que nem pedindo pode (nao existe no catalogo de tools).
  action_kind text not null check (action_kind in (
    'publicar', 'agendar', 'enviar_mensagem', 'contatar_cliente',
    'criar_proposta', 'enviar_contrato', 'ativar_campanha',
    'alterar_orcamento', 'gastar', 'alterar_financeiro',
    'alterar_permissoes', 'exportar_dados', 'excluir_dados',
    'mudar_estrategia', 'alterar_responsavel', 'promover_autonomia'
  )),
  o_que text not null,
  por_que text not null,
  dados_usados text,
  destino text,
  impacto text,
  risco text,
  custo_previsto numeric,
  prazo date,
  reversivel boolean not null default true,
  payload jsonb not null default '{}'::jsonb,
  payload_version integer not null default 1,
  evidencia text,
  status text not null default 'pendente' check (status in (
    'pendente', 'aprovado', 'rejeitado', 'alteracoes_pedidas', 'adiado', 'expirado'
  )),
  valid_until timestamptz,
  decided_by uuid references public.profiles(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);


ALTER TABLE public.operator_approvals ADD executed_at timestamptz, ADD execution_evidence text, ADD execution_run_key text;
ALTER TABLE public.operator_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_le_aprovacoes ON public.operator_approvals FOR SELECT USING(public.is_staff(auth.uid()));
GRANT SELECT ON public.operator_approvals TO authenticated;
create or replace function public.operator_approval_payload_imutavel()
returns trigger
language plpgsql
as $$
begin
  if new.payload is distinct from old.payload
     or new.payload_version is distinct from old.payload_version
     or new.action_kind is distinct from old.action_kind
     or new.o_que is distinct from old.o_que then
    raise exception
      'payload_imutavel: a acao aprovavel nao muda depois de criada; crie outra aprovacao com payload_version maior';
  end if;
  return new;
end;
$$;

drop trigger if exists operator_approvals_payload_imutavel on public.operator_approvals;
create trigger operator_approvals_payload_imutavel
  before update on public.operator_approvals
  for each row execute function public.operator_approval_payload_imutavel();

create or replace function public.operator_approval_decidir(
  _approval_id uuid,
  _decisao text,
  _nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _aprov public.operator_approvals%rowtype;
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'apenas_admin: decidir aprovacao e acao de comando';
  end if;
  if _decisao not in ('aprovado', 'rejeitado', 'alteracoes_pedidas', 'adiado') then
    raise exception 'decisao_invalida: % (use aprovado, rejeitado, alteracoes_pedidas ou adiado)', _decisao;
  end if;

  select * into _aprov from public.operator_approvals where id = _approval_id;
  if not found then
    raise exception 'approval_not_found: % nao existe', _approval_id;
  end if;
  -- Adiado volta a ser decidivel; o resto e final. Redecidir "aprovado"
  -- para "rejeitado" depois do fato apagaria a base de uma acao ja
  -- executada.
  if _aprov.status not in ('pendente', 'adiado') then
    raise exception 'ja_decidida: esta aprovacao esta como % e nao volta atras; crie outra versao', _aprov.status;
  end if;

  update public.operator_approvals
    set status = _decisao, decided_by = auth.uid(), decided_at = now(),
        decision_note = nullif(trim(_nota), '')
    where id = _approval_id
    returning * into _aprov;

  -- O selo do vinculo so cai quando nao resta pedido pendente nele.
  if not exists (
    select 1 from public.operator_approvals
    where task_link_id = _aprov.task_link_id and status = 'pendente'
  ) then
    update public.operator_task_links
      set approval_required = false, updated_at = now()
      where id = _aprov.task_link_id;
  end if;

  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action)
  values ('painel:' || auth.uid()::text, _aprov.operator_id, _aprov.task_link_id,
          _aprov.kanban_task_id,
          'aprovacao ' || _aprov.action_kind || ' v' || _aprov.payload_version
            || ' -> ' || _decisao);

  return jsonb_build_object(
    'ok', true, 'approval_id', _aprov.id, 'status', _aprov.status,
    'payload_version', _aprov.payload_version
  );
end;
$$;

revoke all on function public.operator_approval_decidir(uuid, text, text) from anon;

-- Real report boundary extracted verbatim from the versioned 20260727132145
-- and 20260909100000 migrations. Surrounding fixture data remains synthetic.
ALTER TABLE public.reports ADD file_url text, ADD created_by uuid REFERENCES public.profiles,
 ADD highlights text, ADD internal_notes text, ADD images jsonb DEFAULT '[]',
 ADD chart_data jsonb DEFAULT '[]', ADD chart_type text DEFAULT 'area';
ALTER TABLE public.reports ALTER project_id SET NOT NULL, ALTER client_id SET NOT NULL, ALTER title SET NOT NULL;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
GRANT INSERT,UPDATE,DELETE ON public.reports TO authenticated;
-- Storage transport is outside this contract. Every test uses null file_url;
-- any unexpected storage lookup fails closed instead of simulating ownership.
CREATE FUNCTION public.file_storage_matches_client(text,text,uuid) RETURNS boolean
 LANGUAGE sql IMMUTABLE AS 'SELECT false';
CREATE OR REPLACE FUNCTION public.files_reference_path(_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _marker text;
  _position integer;
BEGIN
  IF _url IS NULL THEN
    RETURN NULL;
  END IF;
  IF left(_url, length('files://')) = 'files://' THEN
    RETURN substring(_url FROM length('files://') + 1);
  END IF;

  FOREACH _marker IN ARRAY ARRAY[
    '/storage/v1/object/public/files/',
    '/storage/v1/object/sign/files/',
    '/storage/v1/object/authenticated/files/'
  ]
  LOOP
    _position := strpos(_url, _marker);
    IF _position > 0 THEN
      RETURN split_part(
        substring(_url FROM _position + length(_marker)),
        '?',
        1
      );
    END IF;
  END LOOP;

  RETURN NULL;
END
$$;

CREATE OR REPLACE FUNCTION public.reports_secure_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  _path text;
  _actor uuid := auth.uid();
BEGIN
  -- Purga de conta (admin_purge_user): a cascata declarada no banco leva
  -- tudo que era do cliente, e esta guarda nao deve segurar a propria purga.
  IF current_setting('app.purge_in_progress', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'published' THEN
      RAISE EXCEPTION 'published reports are immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.status NOT IN ('draft', 'published') THEN
    RAISE EXCEPTION 'invalid report status';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.projects AS project
    WHERE project.id = NEW.project_id
      AND project.client_id = NEW.client_id
  ) THEN
    RAISE EXCEPTION 'report project must belong to the same client';
  END IF;

  _path := public.files_reference_path(NEW.file_url);
  IF _path IS NOT NULL
    AND NOT public.file_storage_matches_client(
      'files',
      _path,
      NEW.client_id
    ) THEN
    RAISE EXCEPTION 'report file must belong to the same client';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF auth.role() = 'authenticated'
      AND NEW.created_by IS DISTINCT FROM _actor THEN
      RAISE EXCEPTION 'report creator must be the authenticated actor';
    END IF;
    IF NEW.status = 'published'
      AND (
        _actor IS NULL
        OR NOT public.can_manage_client(NEW.client_id)
      ) THEN
      RAISE EXCEPTION 'only an assigned manager can publish reports';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published reports are immutable';
  END IF;
  IF NEW.client_id IS DISTINCT FROM OLD.client_id
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'protected report fields are immutable';
  END IF;
  IF NEW.status = 'published'
    AND (
      _actor IS NULL
      OR NOT public.can_manage_client(NEW.client_id)
    ) THEN
    RAISE EXCEPTION 'only an assigned manager can publish reports';
  END IF;

  RETURN NEW;
END
$function$;


CREATE TRIGGER reports_secure_guard_trg BEFORE INSERT OR UPDATE OR DELETE ON public.reports FOR EACH ROW EXECUTE FUNCTION public.reports_secure_guard();
CREATE POLICY reports_secure_select
ON public.reports
FOR SELECT TO authenticated
USING (
  (
    client_id = auth.uid()
    AND status = 'published'
  )
  OR (
    public.is_staff(auth.uid())
    AND public.can_access_client(client_id)
  )
);

CREATE POLICY reports_secure_insert
ON public.reports
FOR INSERT TO authenticated
WITH CHECK (
  public.is_staff(auth.uid())
  AND public.can_access_client(client_id)
  AND created_by = auth.uid()
  AND (
    status = 'draft'
    OR public.can_manage_client(client_id)
  )
);

CREATE POLICY reports_manager_update
ON public.reports
FOR UPDATE TO authenticated
USING (public.can_manage_client(client_id))
WITH CHECK (public.can_manage_client(client_id));

CREATE POLICY reports_admin_delete
ON public.reports
FOR DELETE TO authenticated
USING (
  status = 'draft'
  AND public.has_role(auth.uid(), 'admin'::public.app_role)
  AND public.can_access_client(client_id)
);

REVOKE SELECT ON public.reports FROM authenticated;
GRANT SELECT (
  id,
  project_id,
  client_id,
  title,
  period_start,
  period_end,
  metrics,
  summary,
  file_url,
  status,
  created_by,
  created_at,
  highlights,
  next_steps,
  chart_type,
  chart_data,
  images
) ON public.reports TO authenticated;
