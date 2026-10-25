-- Motor "leads" do Aceleriq Motores e as URLs coladas na Máquina de leads (25/10/2026).
-- Complementa 20261025100000_comercial_mercurio_e_maquina_de_leads.sql. Só amplia e é idempotente.
--
-- 1) leads_buscas.urls: os sites que a equipe cola (fonte "lista") passam pela mesma leitura do site.
-- 2) O motor "leads" (worker Node que chama o buscador em Python com Scrapling, workers/leads) passa a ser
--    aceito nas máquinas: os CHECK de motores_maquinas e motores_pareamentos e a função
--    app_private.motores_limpar_motores (a versão vigente de 20260930326000, só com 'leads' a mais).
--    O padrão de um pareamento novo continua render, codigo e navegador (o leads se liga na tela).
-- 3) As máquinas que já rodam motores e não foram removidas ganham o "leads" (a casa usa nesta máquina).

alter table public.leads_buscas add column if not exists urls text[] not null default '{}';

do $$
declare
  _r record;
begin
  for _r in
    select c.conrelid::regclass::text as tabela, c.conname
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid in ('public.motores_maquinas'::regclass, 'public.motores_pareamentos'::regclass)
      and pg_get_constraintdef(c.oid) like '%motores <@%'
  loop
    execute format('alter table %s drop constraint %I', _r.tabela, _r.conname);
  end loop;
end;
$$;

alter table public.motores_maquinas
  add constraint motores_maquinas_motores_check check (motores <@ array['render', 'codigo', 'navegador', 'leads']::text[]);
alter table public.motores_pareamentos
  add constraint motores_pareamentos_motores_check check (motores <@ array['render', 'codigo', 'navegador', 'leads']::text[]);

CREATE OR REPLACE FUNCTION app_private.motores_limpar_motores(_motores text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path TO ''
AS $body$
  SELECT COALESCE(array_agg(m ORDER BY array_position(ARRAY['render', 'codigo', 'navegador', 'leads'], m)), ARRAY[]::text[])
  FROM (SELECT DISTINCT m FROM unnest(COALESCE(_motores, ARRAY[]::text[])) AS m WHERE m IN ('render', 'codigo', 'navegador', 'leads')) AS x;
$body$;

REVOKE ALL ON FUNCTION app_private.motores_limpar_motores(text[]) FROM PUBLIC, anon, authenticated;

update public.motores_maquinas
set motores = motores || array['leads']::text[]
where revogada_em is null and cardinality(motores) > 0 and not ('leads' = any(motores));

-- Conferência (todas true):
-- select exists (select 1 from information_schema.columns where table_name = 'leads_buscas' and column_name = 'urls'),
--   app_private.motores_limpar_motores(array['leads', 'x']) = array['leads'],
--   not exists (select 1 from public.motores_maquinas where revogada_em is null and cardinality(motores) > 0 and not ('leads' = any(motores)));
