-- Mensagem da semana no grupo do cliente (ACQ-11, 10/11/2026).
-- Uma leitura só, por rodada: para cada cliente com grupo, diz se a mensagem deste dia da semana já saiu (ou já tem
-- rascunho do fluxo), qual projeto recebe o rascunho e entrega as fontes que o Jev usa para conferir o texto:
-- dossiê atual, resumos das conversas dos últimos dias e as últimas mensagens enviadas (para não repetir).

create or replace function acq_n8n.mensagem_semana_alvos(_clientes jsonb, _semana date, _chave_ciclo text, _ritual text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'client_id', c.client_id,
    'grupo', c.grupo,
    'cliente', coalesce(nullif(btrim(p.company_name), ''), p.full_name),
    'ativo', p.deleted_at is null and coalesce(p.plan_status, '') not in ('inactive', 'standby'),
    'ja_enviada', exists (select 1 from public.cycle_rituals cr where cr.client_id = c.client_id and cr.week_start = _semana and cr.ritual_key = _chave_ciclo),
    'ja_escrita', exists (select 1 from public.reports r where r.client_id = c.client_id and r.metrics->>'written_by' = 'n8n:ACQ-11'
                           and r.metrics->>'ritual_type' = _ritual and r.metrics->'conferencia'->>'semana' = _semana::text),
    'project_id', coalesce(
      (select r.project_id from public.reports r where r.client_id = c.client_id and r.metrics ? 'ritual_type' and r.project_id is not null order by r.created_at desc limit 1),
      (select pr.id from public.projects pr where pr.client_id = c.client_id and pr.deleted_at is null order by pr.created_at desc limit 1)),
    'dossie', (select left(d.content, 30000) from public.client_dossiers d where d.client_id = c.client_id and d.dossier_type = 'contexto' and d.project_id is null and d.is_current limit 1),
    'conversas', (select coalesce(jsonb_agg(jsonb_build_object('dia', rd.dia, 'texto', left(rd.texto, 2500)) order by rd.dia desc), '[]'::jsonb)
                    from acq_n8n.resumos_dia rd where rd.client_id = c.client_id and rd.estado = 'ok' and rd.dia >= _semana - 7),
    'anteriores', (select coalesce(jsonb_agg(x.t order by x.q desc), '[]'::jsonb) from (
                     select left(m.content, 1500) as t, m.created_at as q from public.project_memory m
                      where m.client_id = c.client_id and m.kind = 'ritual' order by m.created_at desc limit 4) x)
  ) order by c.ord), '[]'::jsonb)
  from (select (e.value->>'client_id')::uuid as client_id, e.value->>'grupo' as grupo, e.ordinality as ord
          from jsonb_array_elements(_clientes) with ordinality e) c
  join public.profiles p on p.id = c.client_id;
$$;
revoke all on function acq_n8n.mensagem_semana_alvos(jsonb, date, text, text) from public, anon, authenticated;
grant execute on function acq_n8n.mensagem_semana_alvos(jsonb, date, text, text) to acq_n8n_worker;
