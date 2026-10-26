-- Boletim de anúncios que sempre chega (27/10/2026). Só amplia e é idempotente.
--
-- Diagnóstico de 26/10 (SELECT em mcp_audit_log e ads_boletins): 0 boletins. O Gestor do Paperclip não
-- chamou aceleriq_ads_boletim nenhuma vez; a rodada das 17h dele usou o OAuth f11c6245 só com o escopo
-- clients:read (scope_denied já em aceleriq_list_editorial_calendar e aceleriq_operator_queue), que não
-- escreve boletim. O único boletim tentado foi do Hermes (chave "Hermes Agent MCP", 17h47), recusado na
-- validação por nivel "medio" (o MCP 2.22 passa a aceitar medio/baixo/alto) e não repetido.
--
-- 1) public.ads_boletim_minimo_fatos(): só leitura. Os boletins de hoje, as campanhas (ativas ou com gasto
--    em 30 dias) dos clientes ativos com os dias de ads_campaign_daily, e os saldos (ads_account_snapshot).
--    As regras (só exceções, sem IA) moram em supabase/functions/mesa-ads/modulos/boletim-minimo.ts.
-- 2) Cron 'ads-boletim-minimo' às 9h15 BRT de segunda a sexta (mesa-ads, acao boletim_minimo_cron): se
--    nenhum boletim do dia foi gravado, grava o mínimo por ads_boletim_registrar (período "09h", um aviso no
--    sino). Se o agente gravar depois com o mesmo período, o boletim é atualizado sem novo aviso.

create or replace function public.ads_boletim_minimo_fatos()
returns jsonb
language sql
stable
security definer
set search_path to ''
as $$
-- [fatos]
with h as (
  select (now() at time zone 'America/Sao_Paulo')::date as dia
),
clientes as (
  select p.id, coalesce(nullif(btrim(p.company_name), ''), nullif(btrim(p.full_name), ''), 'Cliente') as nome
    from public.profiles p
   where p.deleted_at is null and p.plan_status = 'active'
),
camps as (
  select c.client_id, cl.nome as cliente, c.external_account_id, c.campaign_id, c.name, c.effective_status, c.objective,
         c.start_time, c.stop_time
    from public.ads_campaigns c
    join clientes cl on cl.id = c.client_id
   where c.effective_status = 'ACTIVE'
      or exists (select 1 from public.ads_campaign_daily d
                  where d.client_id = c.client_id and d.campaign_id = c.campaign_id
                    and d.day >= (select h.dia from h) - 30 and d.spend > 0)
)
select jsonb_build_object(
  'hoje', (select h.dia from h),
  'boletins_hoje', coalesce((
    select jsonb_agg(jsonb_build_object('periodo', b.periodo, 'criado_em', b.criado_em, 'principal', b.principal,
                                        'operator_slug', b.operator_slug) order by b.criado_em)
      from public.ads_boletins b where b.dia = (select h.dia from h)), '[]'::jsonb),
  'campanhas', coalesce((
    select jsonb_agg(jsonb_build_object(
             'client_id', x.client_id, 'cliente', x.cliente, 'external_account_id', x.external_account_id,
             'campaign_id', x.campaign_id, 'nome', left(coalesce(x.name, x.campaign_id), 160),
             'effective_status', x.effective_status, 'objective', x.objective,
             'start_time', x.start_time, 'stop_time', x.stop_time,
             'dias', coalesce((
               select jsonb_agg(jsonb_build_object('day', d.day, 'spend', d.spend, 'actions', d.actions) order by d.day)
                 from public.ads_campaign_daily d
                where d.client_id = x.client_id and d.campaign_id = x.campaign_id
                  and d.day >= (select h.dia from h) - 30), '[]'::jsonb)
           ) order by x.cliente, x.name)
      from camps x), '[]'::jsonb),
  'contas', coalesce((
    select jsonb_agg(jsonb_build_object(
             'client_id', s.client_id, 'cliente', cl.nome, 'external_account_id', s.external_account_id,
             'saldo_disponivel', s.saldo_disponivel, 'is_prepay_account', s.is_prepay_account))
      from public.ads_account_snapshot s
      join clientes cl on cl.id = s.client_id
     where exists (select 1 from camps x where x.client_id = s.client_id)), '[]'::jsonb)
)
-- [/fatos]
$$;
revoke all on function public.ads_boletim_minimo_fatos() from public, anon, authenticated;
grant execute on function public.ads_boletim_minimo_fatos() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'ads-boletim-minimo';
    perform cron.schedule('ads-boletim-minimo', '15 12 * * 1-5', $cron$
      select net.http_post(
        url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/mesa-ads',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
          'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
        ),
        body := jsonb_build_object('acao', 'boletim_minimo_cron'),
        timeout_milliseconds := 120000
      );
    $cron$);
  end if;
end $$;

-- Conferência (todas true):
-- select exists (select 1 from pg_proc where proname = 'ads_boletim_minimo_fatos'),
--   exists (select 1 from cron.job where jobname = 'ads-boletim-minimo');
-- Simulação (não grava): POST mesa-ads {"acao":"boletim_minimo_cron","simular":true} com x-cron-secret.
