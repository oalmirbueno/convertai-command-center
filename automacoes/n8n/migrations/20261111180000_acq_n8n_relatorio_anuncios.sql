-- Relatório semanal de anúncios para o cliente (ACQ-15, 11/11/2026). Uma leitura por rodada: para cada cliente com
-- grupo, os números da última semana fechada (segunda a domingo) e da anterior, as ações que a equipe registrou na
-- conta (ads_rotina_acoes, feitas e não desfeitas) desde o começo dessa semana, os relatórios anteriores deste fluxo
-- (para não repetir) e se o desta semana já foi escrito. Resultado = mesmo critério do painel (conversa, lead, compra).

create or replace function acq_n8n.relatorio_anuncios_alvos(_clientes jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
with h as (select (now() at time zone 'America/Sao_Paulo')::date as dia),
s as (select h.dia, date_trunc('week', h.dia::timestamp)::date - 7 as ini, date_trunc('week', h.dia::timestamp)::date - 1 as fim from h),
c as (select (e.value->>'client_id')::uuid as client_id, e.value->>'grupo' as grupo, e.ordinality as ord
        from jsonb_array_elements(_clientes) with ordinality e),
d as (
  select x.client_id, x.campaign_id, x.day, coalesce(x.spend, 0) as spend, coalesce(x.impressions, 0) as imp, coalesce(x.link_clicks, 0) as clk,
         coalesce((m.mp->>'onsite_conversion.messaging_conversation_started_7d')::numeric, 0)
       + coalesce((m.mp->>'lead')::numeric, (m.mp->>'offsite_conversion.fb_pixel_lead')::numeric, (m.mp->>'onsite_web_lead')::numeric, 0)
       + coalesce((m.mp->>'purchase')::numeric, (m.mp->>'omni_purchase')::numeric, (m.mp->>'offsite_conversion.fb_pixel_purchase')::numeric, 0) as res
    from public.ads_campaign_daily x
    cross join lateral (
      select coalesce(jsonb_object_agg(a->>'action_type', a->'value'), '{}'::jsonb) as mp
        from jsonb_array_elements(case when jsonb_typeof(x.actions) = 'array' then x.actions else '[]'::jsonb end) a
       where a->>'action_type' is not null) m
   where x.client_id in (select client_id from c) and x.day >= (select ini from s) - 7
)
select coalesce(jsonb_agg(jsonb_build_object(
  'client_id', c.client_id, 'grupo', c.grupo,
  'cliente', coalesce(nullif(btrim(p.company_name), ''), p.full_name),
  'ativo', p.deleted_at is null and coalesce(p.plan_status, '') not in ('inactive', 'standby'),
  'semana_inicio', s.ini, 'semana_fim', s.fim, 'hoje', s.dia,
  'project_id', coalesce(
    (select r.project_id from public.reports r where r.client_id = c.client_id and r.metrics ? 'ritual_type' and r.project_id is not null order by r.created_at desc limit 1),
    (select pr.id from public.projects pr where pr.client_id = c.client_id and pr.deleted_at is null order by pr.created_at desc limit 1)),
  'numeros', (select jsonb_build_object(
      'contatos', coalesce(sum(d.res) filter (where d.day between s.ini and s.fim), 0),
      'contatos_ant', coalesce(sum(d.res) filter (where d.day between s.ini - 7 and s.ini - 1), 0),
      'apareceu', coalesce(sum(d.imp) filter (where d.day between s.ini and s.fim), 0),
      'apareceu_ant', coalesce(sum(d.imp) filter (where d.day between s.ini - 7 and s.ini - 1), 0),
      'cliques', coalesce(sum(d.clk) filter (where d.day between s.ini and s.fim), 0),
      'cliques_ant', coalesce(sum(d.clk) filter (where d.day between s.ini - 7 and s.ini - 1), 0),
      'gasto', coalesce(sum(d.spend) filter (where d.day between s.ini and s.fim), 0),
      'campanhas_no_ar', count(distinct d.campaign_id) filter (where d.day >= s.dia - 3 and d.spend > 0))
     from d where d.client_id = c.client_id),
  'acoes', coalesce((select jsonb_agg(jsonb_build_object('dia', to_char(a.criado_em at time zone 'America/Sao_Paulo', 'DD/MM'), 'tipo', a.tipo,
                       'o_que', left(a.resumo, 400), 'por_que', left(a.porque, 400)) order by a.criado_em)
                       from public.ads_rotina_acoes a
                      where a.client_id = c.client_id and a.estado = 'feita' and a.desfeita_em is null
                        and (a.criado_em at time zone 'America/Sao_Paulo')::date between s.ini and s.dia), '[]'::jsonb),
  'anteriores', coalesce((select jsonb_agg(x.t order by x.q desc) from (
                   select left(r.summary, 1500) as t, r.created_at as q from public.reports r
                    where r.client_id = c.client_id and r.metrics->>'written_by' = 'n8n:ACQ-15' and r.metrics->>'semana' <> s.ini::text
                      and r.metrics->>'semana' not like 'ensaio:%'
                    order by r.created_at desc limit 3) x), '[]'::jsonb),
  'ja_escrito', exists (select 1 from public.reports r where r.client_id = c.client_id and r.metrics->>'written_by' = 'n8n:ACQ-15' and r.metrics->>'semana' = s.ini::text)
) order by c.ord), '[]'::jsonb)
from c join public.profiles p on p.id = c.client_id cross join s;
$$;
revoke all on function acq_n8n.relatorio_anuncios_alvos(jsonb) from public, anon, authenticated;
grant execute on function acq_n8n.relatorio_anuncios_alvos(jsonb) to acq_n8n_worker;
