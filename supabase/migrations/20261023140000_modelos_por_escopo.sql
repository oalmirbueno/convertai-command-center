-- 23/10/2026 (dono: "o seletor tem que ser no gerar a copy do conteúdo e não da legenda; adicione um seletor
-- no motor que faz a copy do conteúdo, no refinar copy e no estrategista"). Três escolhas de modelo lembradas
-- por cliente, cada uma na sua coluna: copy do conteúdo (modelo_copy_id, da rodada anterior), refinar copy
-- (modelo_refino_id) e estrategista do Mês (modelo_estrategista_id). Gravação só pela RPC, que confere o acesso.

alter table public.mesa_cliente_config add column if not exists modelo_copy_id text;
alter table public.mesa_cliente_config add column if not exists modelo_refino_id text;
alter table public.mesa_cliente_config add column if not exists modelo_estrategista_id text;

create or replace function public.definir_modelo_do_cliente(_client_id uuid, _escopo text, _modelo_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _id text := nullif(btrim(coalesce(_modelo_id, '')), '');
begin
  if _uid is null or not public.is_staff(_uid) or not public.can_access_client(_client_id) then
    raise exception 'sem_acesso' using errcode = '42501';
  end if;
  if _escopo is null or _escopo not in ('copy', 'refino', 'estrategista') then
    raise exception 'escopo_invalido' using errcode = '22023';
  end if;
  if _id is not null and not exists (select 1 from public.ia_modelos m where m.id = _id and m.tipo = 'texto' and m.ativo) then
    raise exception 'modelo_invalido' using errcode = '22023';
  end if;
  insert into public.mesa_cliente_config (client_id, atualizado_em, atualizado_por)
  values (_client_id, now(), _uid)
  on conflict (client_id) do nothing;
  if _escopo = 'copy' then
    update public.mesa_cliente_config set modelo_copy_id = _id, atualizado_em = now(), atualizado_por = _uid where client_id = _client_id;
  elsif _escopo = 'refino' then
    update public.mesa_cliente_config set modelo_refino_id = _id, atualizado_em = now(), atualizado_por = _uid where client_id = _client_id;
  else
    update public.mesa_cliente_config set modelo_estrategista_id = _id, atualizado_em = now(), atualizado_por = _uid where client_id = _client_id;
  end if;
  return _id;
end;
$$;

revoke all on function public.definir_modelo_do_cliente(uuid, text, text) from public, anon;
grant execute on function public.definir_modelo_do_cliente(uuid, text, text) to authenticated, service_role;
