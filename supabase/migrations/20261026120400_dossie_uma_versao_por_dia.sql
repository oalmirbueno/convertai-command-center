-- Dossiê: a seção automática no máximo 1 vez por dia e fora da fonte da revisão (26/10/2026, MCP 2.19).
-- Parte das versões vivas (pg_get_functiondef de 26/10). Idempotente.
--
-- Diagnóstico: dossie_registrar_avancos_interno criava ~7 versões por dia por cliente (seção "Avanços
-- recentes"); central_review_source muda a cada versão, então todo pedido preparado de manhã ficava
-- CENTRAL_SOURCE_STALE em central_review_prepare.
--
-- 1) app_private.dossie_versao_automatica(change_reason, tags): marca da versão que só trocou a seção.
-- 2) app_private.dossie_sem_avancos(content): o texto sem a seção automática.
-- 3) app_private.dossie_base_humana(id): a versão humana por trás de uma cadeia de versões automáticas.
-- 4) dossie_registrar_avancos_interno: no máximo 1 versão automática por dia por cliente.
-- 5) central_review_source: usa a versão humana e o conteúdo sem a seção. Rascunhos carimbados antes desta
--    migration ficam com a fonte antiga uma vez (o preparar do Hermes recarimba; a decisão do dono já
--    aceita fonte antiga desde 20261019180336).

create or replace function app_private.dossie_versao_automatica(_change_reason text, _tags text[])
returns boolean
language sql
immutable
set search_path to ''
as $$
  select coalesce(_change_reason, '') = 'Movimentos automáticos do painel (14 dias)'
    and 'avancos-automaticos' = any(coalesce(_tags, array[]::text[]));
$$;

create or replace function app_private.dossie_sem_avancos(_content text)
returns text
language sql
immutable
set search_path to ''
as $$
  select case when position('## Avanços recentes (automático' in coalesce(_content, '')) > 0
    then rtrim(left(_content, position('## Avanços recentes (automático' in _content) - 1), E' \t\r\n')
    else rtrim(coalesce(_content, ''), E' \t\r\n') end;
$$;

create or replace function app_private.dossie_base_humana(_id uuid)
returns setof public.client_dossiers
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  _d public.client_dossiers%rowtype;
  _passos integer := 0;
begin
  select * into _d from public.client_dossiers where id = _id;
  if not found then return; end if;
  while app_private.dossie_versao_automatica(_d.change_reason, _d.tags) and _d.prior_version_id is not null and _passos < 60 loop
    declare _ant public.client_dossiers%rowtype;
    begin
      select * into _ant from public.client_dossiers where id = _d.prior_version_id;
      exit when not found;
      -- Só desce se a parte humana não mudou (a versão automática é a anterior + a seção).
      exit when app_private.dossie_sem_avancos(_ant.content) is distinct from app_private.dossie_sem_avancos(_d.content);
      _d := _ant;
      _passos := _passos + 1;
    end;
  end loop;
  return next _d;
end;
$$;

revoke all on function app_private.dossie_versao_automatica(text, text[]) from public, anon, authenticated;
revoke all on function app_private.dossie_sem_avancos(text) from public, anon, authenticated;
revoke all on function app_private.dossie_base_humana(uuid) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.dossie_registrar_avancos_interno(_client_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  _atual public.client_dossiers%rowtype;
  _marcador constant text := '## Avanços recentes (automático';
  _humano text; _secao text; _novo text; _pos integer;
BEGIN
  select * into _atual from public.client_dossiers d
    where d.client_id = _client_id and d.dossier_type = 'contexto' and d.project_id is null and d.is_current limit 1;
  if not found then return false; end if;
  -- 26/10/2026: a seção automática cria no máximo 1 versão por dia por cliente (eram ~7/dia, e todo
  -- pedido de aprovação da Central expirava). Só passa de novo no mesmo dia se o dossiê atual perdeu
  -- a seção (uma edição humana sem ela), para a seção não sumir até amanhã.
  if position(_marcador in _atual.content) > 0 and exists (
    select 1 from public.client_dossiers d
     where d.client_id = _client_id and d.dossier_type = 'contexto' and d.project_id is null
       and app_private.dossie_versao_automatica(d.change_reason, d.tags)
       and d.created_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
  ) then return false; end if;
  _secao := public.dossie_avancos_texto(_client_id, 14);
  _pos := position(_marcador in _atual.content);
  _humano := case when _pos > 0 then rtrim(left(_atual.content, _pos - 1), E' \t\r\n') else rtrim(_atual.content, E' \t\r\n') end;
  if _pos > 0 and trim(substr(_atual.content, _pos)) = trim(_secao)
     and left(_atual.content, _pos - 1) = _humano || E'\n\n' then return false; end if;
  _novo := _humano || E'\n\n' || _secao;
  perform public.upsert_current_dossier(
    _client_id := _client_id, _content := _novo, _dossier_type := 'contexto', _project_id := null,
    _summary := _atual.summary, _change_reason := 'Movimentos automáticos do painel (14 dias)',
    _source := 'painel', _actor := 'ciclo', _tags := array['avancos-automaticos'],
    _metadata := coalesce(_atual.metadata, '{}'::jsonb) || jsonb_build_object('auto_avancos', true, 'auto_avancos_em', now()),
    _expected_version := _atual.version);
  return true;
end; $function$;

CREATE OR REPLACE FUNCTION public.central_review_source(_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE d public.client_dossiers%rowtype; scope jsonb;
 -- 26/10/2026: a fonte da revisão ignora a seção automática "Avanços recentes". Versão que só trocou
 -- essa seção conta como a versão humana de antes (app_private.dossie_base_humana) e o conteúdo entra
 -- no hash sem a seção (app_private.dossie_sem_avancos). Assim o pedido não expira à toa.
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) OR NOT public.can_access_client(_client_id) THEN
  RAISE EXCEPTION 'CENTRAL_CLIENT_SCOPE_DENIED' USING ERRCODE='42501';
 END IF;
 SELECT jsonb_build_object(
  'client_id',p.id,'plan_name',to_jsonb(p)->'plan_name','services_config',to_jsonb(p)->'services_config',
  'plan_status',to_jsonb(p)->'plan_status',
  'projects',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',pr.id,'status',to_jsonb(pr)->'status',
    'name',to_jsonb(pr)->'name','description',to_jsonb(pr)->'description','scope',to_jsonb(pr)->'scope',
    'objectives',to_jsonb(pr)->'objectives','updated_at',to_jsonb(pr)->'updated_at',
    'project_type',to_jsonb(pr)->'project_type') ORDER BY pr.id)
   FROM public.projects pr WHERE pr.client_id=p.id AND pr.deleted_at IS NULL),'[]'::jsonb),
  'dossiers',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',cd.id,'project_id',cd.project_id,
    'dossier_type',cd.dossier_type,'version',cd.version,'updated_at',cd.updated_at,'content',app_private.dossie_sem_avancos(cd.content),
    'summary',to_jsonb(cd)->'summary') ORDER BY cd.id)
   FROM public.client_dossiers c0 CROSS JOIN LATERAL app_private.dossie_base_humana(c0.id) cd
   WHERE c0.client_id=p.id AND c0.is_current),'[]'::jsonb))
 INTO scope FROM public.profiles p WHERE p.id=_client_id AND p.deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'CENTRAL_CLIENT_UNAVAILABLE'; END IF;
 SELECT b.* INTO d FROM public.client_dossiers c0 CROSS JOIN LATERAL app_private.dossie_base_humana(c0.id) b
 WHERE c0.client_id=_client_id AND c0.is_current
 ORDER BY (c0.dossier_type='contexto' AND c0.project_id IS NULL) DESC,c0.updated_at DESC,c0.id LIMIT 1;
 RETURN jsonb_build_object('dossier_id',d.id,'dossier_version',d.version,'dossier_updated_at',d.updated_at,
  'scope_hash',encode(extensions.digest(scope::text,'sha256'),'hex'));
END $function$;

-- Conferência (todas true):
-- select app_private.dossie_sem_avancos(E'texto\n\n## Avanços recentes (automático, 14 dias)\n- x') = 'texto',
--   app_private.dossie_versao_automatica('Movimentos automáticos do painel (14 dias)', array['avancos-automaticos']),
--   pg_get_functiondef('public.dossie_registrar_avancos_interno'::regproc) like '%dossie_versao_automatica%',
--   pg_get_functiondef('public.central_review_source'::regproc) like '%dossie_base_humana%';
