-- ============================================================================
-- CICLO: a prova da etapa passa a ficar GRAVADA, e o dossiê ganha os avanços.
--
-- 1. weekly_cycle_progress.proof / auto
--    A tela do Ciclo prova etapas sozinha ("o painel mostra isso resolvido",
--    "posts agendados") mas nada era gravado: o coach, o pulso e o brain-log
--    liam só marcação manual e diziam "parado em conteúdo criado" para um
--    cliente com a semana fechada na tela. A prova agora vira linha, com
--    done_by nulo, auto=true e o texto da prova. Se o fato sumir do painel,
--    a tela apaga a linha automática (nunca a humana).
--
-- 2. dossie_registrar_avancos(cliente)
--    O dossiê "onde estamos" é escrito por gente/MCP. Os AVANÇOS (tarefas
--    concluídas, publicações no ar, artes aprovadas, marcos fechados) ficam
--    espalhados pelo painel e nunca chegavam nele. Uma seção automática,
--    sempre substituída (nunca acumulada), entra no fim do dossiê atual toda
--    sexta e sempre que a equipe pedir. O texto humano fica intocado: a
--    seção tem marcador próprio e é recortada antes de reescrever.
-- ============================================================================

alter table public.weekly_cycle_progress
  add column if not exists proof text,
  add column if not exists auto boolean not null default false;

comment on column public.weekly_cycle_progress.proof is
  'Quando auto=true: o fato do painel que provou a etapa (texto legível).';
comment on column public.weekly_cycle_progress.auto is
  'true = gravada pela prova automática do painel; false = marcada por gente.';

-- ─────────────────────────────────────────────────────────────────────────
-- Avanços automáticos no dossiê
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.dossie_avancos_texto(_client_id uuid, _dias integer default 7)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  with proj as (
    select id, name from public.projects where client_id = _client_id and deleted_at is null
  ),
  tarefas as (
    select t.title from public.tasks t
    join proj on proj.id = t.project_id
    where t.status = 'done' and t.deleted_at is null
      and t.updated_at >= now() - make_interval(days => _dias)
    order by t.updated_at desc limit 12
  ),
  pubs as (
    select coalesce(p.title, 'publicação') as title, e.published_at, e.platform
    from public.editorial_publications e
    left join public.editorial_posts p on p.id = e.post_id
    where e.client_id = _client_id and e.status = 'published'
      and e.published_at >= now() - make_interval(days => _dias)
    order by e.published_at desc limit 12
  ),
  aprovadas as (
    select distinct f.file_name
    from public.file_approval_events ev
    join public.files f on f.id = ev.file_id
    where ev.client_id = _client_id and ev.to_status = 'approved'
      and ev.created_at >= now() - make_interval(days => _dias)
    limit 12
  ),
  marcos as (
    select m.title, m.updated_at from public.milestones m
    join proj on proj.id = m.project_id
    where m.status = 'completed' and m.deleted_at is null
      and m.updated_at >= now() - make_interval(days => _dias)
    order by m.updated_at desc limit 8
  ),
  agenda as (
    select count(*) as n from public.editorial_publications e
    where e.client_id = _client_id and e.status = 'scheduled' and e.scheduled_at > now()
  )
  select concat_ws(E'\n',
    '## Avanços recentes (automático, ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') || ')',
    'Registro gerado pelo painel a partir do que aconteceu nos últimos ' || _dias || ' dias. Não edite esta seção: ela é reescrita.',
    case when exists (select 1 from tarefas) then
      E'\n**Tarefas concluídas:** ' || (select string_agg(title, '; ') from tarefas) end,
    case when exists (select 1 from pubs) then
      E'\n**Publicações no ar:** ' || (select string_agg(title || ' (' || to_char(published_at at time zone 'America/Sao_Paulo', 'DD/MM') || ')', '; ') from pubs) end,
    case when exists (select 1 from aprovadas) then
      E'\n**Materiais aprovados pelo cliente:** ' || (select string_agg(file_name, '; ') from aprovadas) end,
    case when exists (select 1 from marcos) then
      E'\n**Marcos concluídos:** ' || (select string_agg(title, '; ') from marcos) end,
    E'\n**Agenda à frente:** ' || (select n from agenda) || ' publicação(ões) agendada(s).'
  );
$$;

create or replace function public.dossie_registrar_avancos(_client_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _atual public.client_dossiers%rowtype;
  _marcador constant text := '## Avanços recentes (automático';
  _humano text;
  _secao text;
  _novo text;
  _pos integer;
begin
  select * into _atual from public.client_dossiers d
    where d.client_id = _client_id and d.dossier_type = 'contexto'
      and d.project_id is null and d.is_current
    limit 1;
  if not found then
    return false; -- sem dossiê humano, nada a anexar: o painel não inventa dossiê
  end if;

  _secao := public.dossie_avancos_texto(_client_id, 7);

  -- Recorta a seção automática anterior (sempre a última do texto).
  _pos := position(_marcador in _atual.content);
  _humano := case when _pos > 0 then rtrim(left(_atual.content, _pos - 1)) else rtrim(_atual.content) end;

  -- Sem mudança na seção, não cria versão: versão nova só quando há fato novo.
  if _pos > 0 and trim(substr(_atual.content, _pos)) = trim(_secao) then
    return false;
  end if;

  _novo := _humano || E'\n\n' || _secao;

  perform public.upsert_current_dossier(
    _client_id := _client_id,
    _content := _novo,
    _dossier_type := 'contexto',
    _project_id := null,
    _summary := _atual.summary,
    _change_reason := 'Avanços automáticos do painel (7 dias)',
    _source := 'painel',
    _actor := 'ciclo',
    _tags := array['avancos-automaticos'],
    _metadata := coalesce(_atual.metadata, '{}'::jsonb) || jsonb_build_object('auto_avancos', true, 'auto_avancos_em', now()),
    _expected_version := _atual.version
  );
  return true;
end;
$$;

create or replace function public.dossie_registrar_avancos_todos()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  _c record;
  _n integer := 0;
begin
  for _c in
    select distinct d.client_id from public.client_dossiers d
    join public.profiles p on p.id = d.client_id and p.deleted_at is null
    where d.is_current and d.dossier_type = 'contexto' and d.project_id is null
  loop
    begin
      if public.dossie_registrar_avancos(_c.client_id) then _n := _n + 1; end if;
    exception when others then
      raise warning 'dossie_registrar_avancos(%): %', _c.client_id, sqlerrm;
    end;
  end loop;
  return _n;
end;
$$;

revoke all on function public.dossie_avancos_texto(uuid, integer) from public, anon;
revoke all on function public.dossie_registrar_avancos(uuid) from public, anon;
revoke all on function public.dossie_registrar_avancos_todos() from public, anon;
grant execute on function public.dossie_avancos_texto(uuid, integer) to authenticated, service_role;
grant execute on function public.dossie_registrar_avancos(uuid) to authenticated, service_role;
grant execute on function public.dossie_registrar_avancos_todos() to service_role;

-- Toda sexta 18h (Brasília = 21h UTC), antes do ritual de fechamento.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'dossie-avancos-semanais') then
    perform cron.schedule('dossie-avancos-semanais', '0 21 * * 5', $cron$select public.dossie_registrar_avancos_todos();$cron$);
  end if;
end $$;
