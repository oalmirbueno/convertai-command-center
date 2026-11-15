-- Radar de anúncios (ACQ-13, 11/11/2026). Só leitura e aviso: nada aqui mexe em conta de anúncio.
-- 1) radar_anuncios_fatos(): uma leitura só, por rodada, do que o painel já coleta da Meta (ads_campaigns,
--    ads_campaign_daily, ads_account_snapshot, ads_creatives), já somado por janela. Resultado = o mesmo critério do
--    painel (mesa-ads/calculos.ts): conversa iniciada, lead (primeiro tipo presente) e compra (primeiro tipo presente).
-- 2) radar_anuncios_gravar(): guarda o estado de cada alerta (novo, continua, resolvido) para o resumo dizer o que
--    mudou em vez de repetir, e abre incidente (sino do dono) só para alerta crítico novo; fecha quando some.

create table if not exists acq_n8n.radar_anuncios_alertas (
  chave text primary key,
  client_id uuid,
  cliente text,
  tipo text not null,
  nivel text not null check (nivel in ('info', 'atencao', 'critico')),
  texto text not null,
  primeiro_em timestamptz not null default now(),
  ultimo_em timestamptz not null default now(),
  resolvido_em timestamptz,
  ocorrencias integer not null default 1
);
create index if not exists radar_anuncios_alertas_abertos on acq_n8n.radar_anuncios_alertas (ultimo_em) where resolvido_em is null;
alter table acq_n8n.radar_anuncios_alertas enable row level security;
revoke all on acq_n8n.radar_anuncios_alertas from public, anon, authenticated;

create or replace function acq_n8n.radar_anuncios_fatos()
returns jsonb language sql stable security definer set search_path = '' as $$
with h as (select (now() at time zone 'America/Sao_Paulo')::date as dia),
cl as (
  select p.id, coalesce(nullif(btrim(p.company_name), ''), nullif(btrim(p.full_name), ''), 'Cliente') as nome,
         coalesce(p.services_config->'trafego' = 'true'::jsonb, false) as trafego,
         coalesce(p.services_config->'internal_company' = 'true'::jsonb, false) as interno
    from public.profiles p
   where p.deleted_at is null and p.plan_status = 'active'
),
d as (
  select x.client_id, x.campaign_id, x.day, coalesce(x.spend, 0) as spend, coalesce(x.impressions, 0) as imp,
         coalesce(x.link_clicks, 0) as clk, coalesce(x.reach, 0) as alc,
         coalesce((m.mp->>'onsite_conversion.messaging_conversation_started_7d')::numeric, 0)
       + coalesce((m.mp->>'lead')::numeric, (m.mp->>'offsite_conversion.fb_pixel_lead')::numeric, (m.mp->>'onsite_web_lead')::numeric, 0)
       + coalesce((m.mp->>'purchase')::numeric, (m.mp->>'omni_purchase')::numeric, (m.mp->>'offsite_conversion.fb_pixel_purchase')::numeric, 0) as res
    from public.ads_campaign_daily x
    cross join lateral (
      select coalesce(jsonb_object_agg(a->>'action_type', a->'value'), '{}'::jsonb) as mp
        from jsonb_array_elements(case when jsonb_typeof(x.actions) = 'array' then x.actions else '[]'::jsonb end) a
       where a->>'action_type' is not null) m
   where x.day >= (select dia from h) - 35
),
ur as (select client_id, campaign_id, max(day) as dia from d where res > 0 and day < (select dia from h) group by 1, 2),
ca as (
  select d.client_id, d.campaign_id,
    sum(d.spend) filter (where d.day = h.dia) as g_hoje,
    sum(d.spend) filter (where d.day = h.dia - 1) as g_ontem,
    sum(d.res) filter (where d.day = h.dia - 1) as r_ontem,
    sum(d.spend) filter (where d.day between h.dia - 3 and h.dia - 1) as g3,
    sum(d.res) filter (where d.day between h.dia - 3 and h.dia - 1) as r3,
    sum(d.spend) filter (where d.day between h.dia - 7 and h.dia - 1) as g7,
    sum(d.res) filter (where d.day between h.dia - 7 and h.dia - 1) as r7,
    sum(d.imp) filter (where d.day between h.dia - 7 and h.dia - 1) as imp7,
    sum(d.clk) filter (where d.day between h.dia - 7 and h.dia - 1) as clk7,
    max(d.alc) filter (where d.day between h.dia - 7 and h.dia - 1) as alc7,
    sum(d.spend) filter (where d.day between h.dia - 14 and h.dia - 8) as g7ant,
    sum(d.res) filter (where d.day between h.dia - 14 and h.dia - 8) as r7ant,
    sum(d.imp) filter (where d.day between h.dia - 14 and h.dia - 8) as imp7ant,
    sum(d.clk) filter (where d.day between h.dia - 14 and h.dia - 8) as clk7ant,
    sum(d.spend) filter (where d.day between h.dia - 30 and h.dia - 1) as g30,
    sum(d.res) filter (where d.day between h.dia - 30 and h.dia - 1) as r30,
    sum(d.spend) filter (where d.day >= date_trunc('week', h.dia::timestamp)::date) as g_semana,
    max(d.day) filter (where d.spend > 0) as ultimo_gasto,
    sum(d.spend) filter (where d.day < h.dia and d.day >= h.dia - 30 and (u.dia is null or d.day > u.dia)) as g_sem_resultado
  from d cross join h left join ur u on u.client_id = d.client_id and u.campaign_id = d.campaign_id
  group by 1, 2
),
camp as (
  select c.client_id, jsonb_agg(jsonb_build_object(
      'campaign_id', c.campaign_id, 'nome', left(coalesce(c.name, c.campaign_id), 160), 'efetivo', c.effective_status, 'objetivo', c.objective,
      'inicio', c.start_time, 'fim', c.stop_time, 'orc_dia', c.daily_budget, 'orc_total', c.lifetime_budget, 'lida_em', c.updated_at,
      'g_hoje', coalesce(a.g_hoje, 0), 'g_ontem', coalesce(a.g_ontem, 0), 'r_ontem', coalesce(a.r_ontem, 0),
      'g3', coalesce(a.g3, 0), 'r3', coalesce(a.r3, 0), 'g7', coalesce(a.g7, 0), 'r7', coalesce(a.r7, 0),
      'imp7', coalesce(a.imp7, 0), 'clk7', coalesce(a.clk7, 0), 'alc7', coalesce(a.alc7, 0),
      'g7ant', coalesce(a.g7ant, 0), 'r7ant', coalesce(a.r7ant, 0), 'imp7ant', coalesce(a.imp7ant, 0), 'clk7ant', coalesce(a.clk7ant, 0),
      'g30', coalesce(a.g30, 0), 'r30', coalesce(a.r30, 0), 'g_semana', coalesce(a.g_semana, 0),
      'ultimo_gasto', a.ultimo_gasto, 'g_sem_resultado', coalesce(a.g_sem_resultado, 0)) order by c.name) as lista
    from public.ads_campaigns c left join ca a on a.client_id = c.client_id and a.campaign_id = c.campaign_id
   where c.effective_status = 'ACTIVE' or coalesce(a.g30, 0) > 0 or coalesce(a.g_hoje, 0) > 0
   group by 1
),
contas as (
  select s.client_id, jsonb_agg(jsonb_build_object(
      'conta', ea.display_name, 'status', s.account_status, 'motivo', s.disable_reason, 'pre_pago', s.is_prepay_account,
      'saldo', s.saldo_disponivel, 'a_pagar', s.balance, 'pagamento', s.funding_display, 'coletado_em', s.coletado_em,
      'tentado_em', s.tentado_em, 'erro', s.erro) order by ea.display_name) as lista
    from public.ads_account_snapshot s left join public.external_accounts ea on ea.id = s.external_account_id
   group by 1
),
ruins as (
  select k.client_id, jsonb_agg(jsonb_build_object('ad_id', k.ad_id, 'anuncio', left(k.ad_name, 120), 'campaign_id', k.campaign_id,
      'estado', k.effective_status, 'lido_em', k.updated_at) order by k.ad_name) as lista
    from public.ads_creatives k
    join public.ads_campaigns c on c.client_id = k.client_id and c.campaign_id = k.campaign_id and c.effective_status = 'ACTIVE'
   where k.effective_status in ('WITH_ISSUES', 'DISAPPROVED')
   group by 1
)
select jsonb_build_object(
  'hoje', (select dia from h),
  'agora', now(),
  'coleta', jsonb_build_object(
    'diario_em', (select max(captured_at) from public.ads_campaign_daily),
    'campanhas_em', (select max(updated_at) from public.ads_campaigns),
    'contas_em', (select max(coletado_em) from public.ads_account_snapshot)),
  'token', jsonb_build_object(
    'ativos', (select count(*) from social_private.ads_tokens t where t.revoked_at is null and cardinality(t.contas) > 0),
    'salvo_em', (select max(t.saved_at) from social_private.ads_tokens t where t.revoked_at is null and cardinality(t.contas) > 0)),
  'boletins_hoje', coalesce((select jsonb_agg(b.periodo order by b.criado_em) from public.ads_boletins b where b.dia = (select dia from h)), '[]'::jsonb),
  'clientes', coalesce((
    select jsonb_agg(jsonb_build_object(
        'client_id', cl.id, 'cliente', cl.nome, 'trafego', cl.trafego, 'interno', cl.interno,
        'teto_diario', r.teto_diario_brl, 'rotina_ligada', coalesce(r.ligada, false),
        'campanhas', coalesce(camp.lista, '[]'::jsonb), 'contas', coalesce(contas.lista, '[]'::jsonb),
        'anuncios_com_problema', coalesce(ruins.lista, '[]'::jsonb)) order by cl.nome)
      from cl
      left join camp on camp.client_id = cl.id
      left join contas on contas.client_id = cl.id
      left join ruins on ruins.client_id = cl.id
      left join public.ads_rotina r on r.client_id = cl.id
     where cl.trafego or camp.client_id is not null or contas.client_id is not null), '[]'::jsonb)
);
$$;
revoke all on function acq_n8n.radar_anuncios_fatos() from public, anon, authenticated;
grant execute on function acq_n8n.radar_anuncios_fatos() to acq_n8n_worker;

-- _alertas: [{chave, client_id, cliente, tipo, nivel, texto, curto}] = todos os alertas da rodada (toda rodada olha tudo).
-- O que estava aberto e não veio é dado como resolvido.
create or replace function acq_n8n.radar_anuncios_gravar(_alertas jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  _a jsonb; _novo boolean; _antes acq_n8n.radar_anuncios_alertas;
  _novos jsonb := '[]'::jsonb; _continuam jsonb := '[]'::jsonb; _resolvidos jsonb := '[]'::jsonb;
  _chaves text[] := coalesce((select array_agg(e->>'chave') from jsonb_array_elements(coalesce(_alertas, '[]'::jsonb)) e), '{}');
  _r record;
begin
  for _a in select * from jsonb_array_elements(coalesce(_alertas, '[]'::jsonb)) loop
    select * into _antes from acq_n8n.radar_anuncios_alertas where chave = _a->>'chave' for update;
    _novo := not found or _antes.resolvido_em is not null;
    insert into acq_n8n.radar_anuncios_alertas as t (chave, client_id, cliente, tipo, nivel, texto)
    values (_a->>'chave', nullif(_a->>'client_id', '')::uuid, _a->>'cliente', _a->>'tipo', _a->>'nivel', left(_a->>'texto', 600))
    on conflict (chave) do update set nivel = excluded.nivel, texto = excluded.texto, cliente = excluded.cliente, ultimo_em = now(),
      ocorrencias = t.ocorrencias + 1, resolvido_em = null,
      primeiro_em = case when t.resolvido_em is not null then now() else t.primeiro_em end;
    if _novo then
      _novos := _novos || jsonb_build_array(_a);
    else
      _continuam := _continuam || jsonb_build_array(_a || jsonb_build_object('desde', _antes.primeiro_em));
    end if;
    -- Crítico novo (ou que subiu para crítico) toca o sino do dono na hora; o incidente não repete enquanto aberto.
    if _a->>'nivel' = 'critico' and (_novo or _antes.nivel <> 'critico') then
      perform acq_n8n.incidente_registrar('ACQ-13|' || (_a->>'chave'), 'ACQ-13', nullif(_a->>'client_id', '')::uuid, 'critico',
        left('Anúncios, ' || coalesce(_a->>'curto', coalesce(_a->>'cliente', 'carteira') || ': ' || (_a->>'texto')), 130),
        jsonb_build_object('tipo', _a->>'tipo', 'texto', _a->>'texto', 'onde_ver', '/anuncios/hoje'));
    end if;
  end loop;
  for _r in
    update acq_n8n.radar_anuncios_alertas t set resolvido_em = now()
     where t.resolvido_em is null and not (t.chave = any(_chaves))
    returning t.chave, t.client_id, t.cliente, t.tipo, t.nivel, t.texto, t.primeiro_em
  loop
    _resolvidos := _resolvidos || jsonb_build_array(jsonb_build_object('chave', _r.chave, 'client_id', _r.client_id, 'cliente', _r.cliente,
      'tipo', _r.tipo, 'nivel', _r.nivel, 'texto', _r.texto, 'desde', _r.primeiro_em));
    if _r.nivel = 'critico' then
      perform acq_n8n.incidente_resolver('ACQ-13|' || _r.chave, 'O radar não encontra mais a condição.');
    end if;
  end loop;
  return jsonb_build_object('novos', _novos, 'continuam', _continuam, 'resolvidos', _resolvidos,
    'semana', (select jsonb_build_object(
       'abertos', count(*) filter (where primeiro_em >= now() - interval '7 days'),
       'resolvidos', count(*) filter (where resolvido_em >= now() - interval '7 days'),
       'em_aberto', count(*) filter (where resolvido_em is null),
       'mais_antigos', coalesce((select jsonb_agg(x) from (select cliente, tipo, texto, primeiro_em as desde from acq_n8n.radar_anuncios_alertas
                                   where resolvido_em is null and nivel <> 'info' order by primeiro_em limit 5) x), '[]'::jsonb))
       from acq_n8n.radar_anuncios_alertas));
end $$;
revoke all on function acq_n8n.radar_anuncios_gravar(jsonb) from public, anon, authenticated;
grant execute on function acq_n8n.radar_anuncios_gravar(jsonb) to acq_n8n_worker;
