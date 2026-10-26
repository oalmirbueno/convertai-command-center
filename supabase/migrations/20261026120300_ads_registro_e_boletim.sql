-- Anúncios: ações reais registradas e boletim do dia (26/10/2026, MCP 2.19). Só amplia e é idempotente.
--
-- Decisão do dono: o Paperclip cuida dos anúncios; o que ele faz na conta (pela Composio) aparece numa
-- página só do painel (/anuncios/hoje) e cada boletim gera UM aviso no sino.
-- Diagnóstico: 0 linhas em ads_rotina_acoes desde 10/10 apesar de ações reais; o boletim Meta das
-- 9h/17h30 não chegava ao dono.
--
-- 1) ads_rotina_acoes.tipo aceita também 'data_fim', 'arquivar' e 'outro' (o MCP traduz verba -> orcamento
--    e criar -> montar_campanha; os tipos antigos continuam).
-- 2) public.ads_boletins: um boletim por dia e período (09h, 17h30...). Reenviar o mesmo período no mesmo
--    dia atualiza o boletim e não toca o sino de novo. RLS: a equipe lê.
-- 3) public.ads_boletim_registrar(...): grava (ou atualiza) e, só no boletim novo, avisa a equipe uma vez
--    (avisar_equipe, tipo 'ads_boletim', link /anuncios/hoje?boletim=<id>).

do $$
declare _r record;
begin
  for _r in select c.conname from pg_constraint c
    where c.conrelid = 'public.ads_rotina_acoes'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%tipo = ANY%'
  loop
    execute format('alter table public.ads_rotina_acoes drop constraint %I', _r.conname);
  end loop;
end;
$$;
alter table public.ads_rotina_acoes add constraint ads_rotina_acoes_tipo_check check (tipo = any (array[
  'pausar', 'ativar', 'orcamento', 'renomear', 'duplicar_anuncio', 'trocar_criativo', 'vincular_criativo',
  'montar_campanha', 'ativar_campanha', 'proposta', 'parada', 'data_fim', 'arquivar', 'outro']));

create table if not exists public.ads_boletins (
  id uuid primary key default gen_random_uuid(),
  dia date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  periodo text not null check (length(periodo) between 1 and 40),
  resumo text not null check (length(resumo) between 1 and 2000),
  alertas jsonb not null default '[]'::jsonb check (jsonb_typeof(alertas) = 'array'),
  por_cliente jsonb not null default '[]'::jsonb check (jsonb_typeof(por_cliente) = 'array'),
  texto_completo text check (texto_completo is null or length(texto_completo) <= 40000),
  operator_slug text,
  principal text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (dia, periodo)
);
create index if not exists ads_boletins_recentes on public.ads_boletins (criado_em desc);

alter table public.ads_boletins enable row level security;
drop policy if exists ads_boletins_equipe_le on public.ads_boletins;
create policy ads_boletins_equipe_le on public.ads_boletins
  for select to authenticated using (public.is_staff(auth.uid()));
revoke all on public.ads_boletins from anon;
grant select on public.ads_boletins to authenticated;
grant select, insert, update on public.ads_boletins to service_role;

create or replace function public.ads_boletim_registrar(
  _periodo text, _resumo text, _alertas jsonb default '[]'::jsonb, _por_cliente jsonb default '[]'::jsonb,
  _texto_completo text default null, _operator_slug text default null, _principal text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  _dia date := (now() at time zone 'America/Sao_Paulo')::date;
  _id uuid;
  _novo boolean;
  _avisados integer := 0;
  _aviso_id uuid;
  _n_alertas integer := case when jsonb_typeof(_alertas) = 'array' then jsonb_array_length(_alertas) else 0 end;
begin
  insert into public.ads_boletins as b (dia, periodo, resumo, alertas, por_cliente, texto_completo, operator_slug, principal)
  values (_dia, left(btrim(_periodo), 40), left(btrim(_resumo), 2000),
    case when jsonb_typeof(_alertas) = 'array' then _alertas else '[]'::jsonb end,
    case when jsonb_typeof(_por_cliente) = 'array' then _por_cliente else '[]'::jsonb end,
    left(_texto_completo, 40000), _operator_slug, _principal)
  on conflict (dia, periodo) do update set
    resumo = excluded.resumo, alertas = excluded.alertas, por_cliente = excluded.por_cliente,
    texto_completo = excluded.texto_completo, operator_slug = excluded.operator_slug,
    principal = excluded.principal, atualizado_em = now()
  returning b.id, (b.criado_em = b.atualizado_em) into _id, _novo;

  if _novo then
    _avisados := public.avisar_equipe(
      left('Boletim de anúncios ' || btrim(_periodo) || ': ' || btrim(_resumo)
        || case when _n_alertas > 0 then ' (' || _n_alertas || case when _n_alertas = 1 then ' alerta)' else ' alertas)' end else '' end, 500),
      'ads_boletim',
      '/anuncios/hoje?boletim=' || _id::text);
  end if;
  -- O aviso deste boletim (um por pessoa; devolve o mais recente), para a ponte confirmar o envio.
  select n.id into _aviso_id from public.notifications n
   where n.notification_type = 'ads_boletim' and n.link = '/anuncios/hoje?boletim=' || _id::text
   order by n.created_at desc limit 1;
  return jsonb_build_object('ok', true, 'boletim_id', _id, 'novo', _novo, 'dia', _dia, 'avisados', _avisados, 'notification_id', _aviso_id);
end;
$$;
revoke all on function public.ads_boletim_registrar(text, text, jsonb, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.ads_boletim_registrar(text, text, jsonb, jsonb, text, text, text) to service_role;

-- Conferência (todas true):
-- select exists (select 1 from pg_constraint where conname = 'ads_rotina_acoes_tipo_check' and pg_get_constraintdef(oid) like '%data_fim%'),
--   exists (select 1 from information_schema.tables where table_name = 'ads_boletins'),
--   exists (select 1 from pg_proc where proname = 'ads_boletim_registrar');
