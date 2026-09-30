-- Conferência periódica da RLS "por linha" (frente PERF-banco, 30/09/2026).
-- SÓ LEITURA: roda numa transação read only e não altera nada.
--
-- Como rodar:
--   npx --yes supabase@2.117.0 db query --linked --project-ref jjjtkowvxemvituvywvf -f scripts/conferir-rls-por-linha.sql
--   (ou colar no SQL Editor). Devolve um JSON só, na coluna "conferencia".
--
-- O que mostra:
--   1) politicas_com_cac_por_linha: políticas do public que ainda chamam
--      can_access_client(...) por linha. Não é erro (algumas têm formato
--      próprio, como "client_id IS NULL OR ..."), mas cada uma custa até 9
--      has_role por linha lida. Nova política de mesa deve usar a forma de
--      conjunto: ver supabase/migrations/20260930296200_rls_mesas_em_conjunto.sql.
--   2) politicas_com_auth_uid_por_linha: políticas do public com auth.uid() ou
--      auth.role() fora de (SELECT ...) (é o que o advisor auth_rls_initplan
--      acusa). Esperado: 0 depois da 20260930296200.
--   3) equivalencia: para cada usuário de user_roles, um uid inexistente e
--      anon, compara can_access_client(c) com a forma de conjunto dos
--      ajudantes app_private.eh_admin_atual / clientes_da_equipe_atual, para
--      todo client_id que existe no public (e nulo); e
--      can_staff_access_project(p) com app_private.projetos_da_equipe(), para
--      todo projeto. Esperado: divergencias = 0. Se can_access_client mudar um
--      dia, é aqui que a diferença aparece, e os ajudantes mudam junto.
--      (Precisa das migrations 20260930296100 e 20260930296200 aplicadas;
--      antes delas este item volta "ajudantes ausentes".)

begin read only;

do $conferencia$
declare
  _res jsonb := '{}'::jsonb;
  _usuarios uuid[];
  _u uuid;
  _cands uuid[];
  _arr uuid[];
  _t record;
  _n bigint;
  _div jsonb := '[]'::jsonb;
  _checagens int := 0;
begin
  _res := _res || jsonb_build_object('politicas_com_cac_por_linha', (
    select coalesce(jsonb_agg(jsonb_build_object('tabela', tablename, 'politica', policyname, 'cmd', cmd) order by tablename, policyname), '[]'::jsonb)
      from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') like '%can_access_client(%' or coalesce(with_check, '') like '%can_access_client(%')));

  _res := _res || jsonb_build_object('politicas_com_auth_uid_por_linha', (
    select coalesce(jsonb_agg(jsonb_build_object('tabela', tablename, 'politica', policyname) order by tablename, policyname), '[]'::jsonb)
      from pg_policies
     where schemaname = 'public'
       and (replace(replace(coalesce(qual, ''), '( SELECT auth.uid() AS uid)', ''), '( SELECT auth.role() AS role)', '') ~ 'auth\.(uid|role)\(\)'
         or replace(replace(coalesce(with_check, ''), '( SELECT auth.uid() AS uid)', ''), '( SELECT auth.role() AS role)', '') ~ 'auth\.(uid|role)\(\)')));

  if to_regprocedure('app_private.eh_admin_atual()') is null
     or to_regprocedure('app_private.clientes_da_equipe_atual()') is null
     or to_regprocedure('app_private.projetos_da_equipe()') is null then
    _res := _res || jsonb_build_object('equivalencia', 'ajudantes ausentes: aplicar 20260930296100 e 20260930296200');
  else
    select array_agg(distinct user_id) into _usuarios from public.user_roles;
    _usuarios := _usuarios || ARRAY['00000000-0000-4000-8000-00000000abcd'::uuid, NULL::uuid];

    _cands := ARRAY['00000000-0000-4000-8000-00000000abcd'::uuid];
    for _t in
      select c.table_name
        from information_schema.columns c
        join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
       where c.table_schema = 'public' and c.column_name = 'client_id' and c.data_type = 'uuid' and tb.table_type = 'BASE TABLE'
    loop
      execute format('select array_agg(distinct client_id) from public.%I', _t.table_name) into _arr;
      _cands := _cands || coalesce(_arr, '{}');
    end loop;
    _cands := _cands || (select array_agg(id) from public.profiles) || (select array_agg(user_id) from public.user_roles);
    select array_agg(distinct x) into _arr from unnest(_cands) x where x is not null;
    _cands := coalesce(_arr, '{}') || ARRAY[NULL::uuid];

    foreach _u in array _usuarios loop
      if _u is null then
        perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      else
        perform set_config('request.jwt.claims', json_build_object('sub', _u, 'role', 'authenticated')::text, true);
      end if;

      select count(*) into _n
        from unnest(_cands) as k(c)
       where coalesce(public.is_staff(auth.uid()) and public.can_access_client(k.c), false)
          is distinct from coalesce((select public.is_staff((select auth.uid()))) and (
                (select app_private.eh_admin_atual())
             or (k.c = (select auth.uid()) and (select public.has_role((select auth.uid()), 'client'::public.app_role)))
             or k.c = any ((select app_private.clientes_da_equipe_atual())::uuid[])), false);
      _checagens := _checagens + 1;
      if _n > 0 then
        _div := _div || jsonb_build_array(jsonb_build_object('usuario', coalesce(left(_u::text, 8), 'anon'), 'onde', 'can_access_client', 'n', _n));
      end if;

      select count(*) into _n
        from (select id from public.projects union all select null::uuid) as k(p)
       where coalesce(public.can_staff_access_project(k.p), false)
          is distinct from coalesce(k.p in (select app_private.projetos_da_equipe()), false);
      _checagens := _checagens + 1;
      if _n > 0 then
        _div := _div || jsonb_build_array(jsonb_build_object('usuario', coalesce(left(_u::text, 8), 'anon'), 'onde', 'can_staff_access_project', 'n', _n));
      end if;
    end loop;

    _res := _res || jsonb_build_object('equivalencia', jsonb_build_object(
      'usuarios', cardinality(_usuarios), 'client_ids', cardinality(_cands),
      'checagens', _checagens, 'divergencias', _div));
  end if;

  perform set_config('conferencia.rls', _res::text, false);
end
$conferencia$;

select current_setting('conferencia.rls')::jsonb as conferencia;
