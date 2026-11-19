-- Central de acessos (19/11/2026, pedido do dono): "uma área para eu ver a senha de todos e o e-mail de
-- todos, e também poder redefinir senha e tudo, se acontecer algo, tanto no CRM quanto no e-mail; eu poder
-- adicionar por ali também e já gerar o link para a pessoa, e o link também vai por e-mail; e já sincroniza
-- com o financeiro e clientes."
--
-- Segurança (decidida com o dono):
--   * senha do CRM (login do Supabase Auth) não é recuperável e não aparece: a casa define uma senha nova
--     pela função produto (auth.admin), que aparece uma vez na tela e não é gravada em lugar nenhum;
--   * senha da caixa de e-mail: mora no Vault (produto_email_guardar_segredo_da_caixa, já existente). Ver
--     a senha é ação da função produto-email, só para o dono, e cada vez fica no histórico da empresa.
--
-- Este arquivo só cria leituras e uma ação de servidor:
--   1. produto_admin_pessoas()                 todas as pessoas do CRM, com o último acesso (auth.users)
--   2. produto_auth_usuario_por_email(e-mail)  o login de uma pessoa pelo e-mail (só a chave de serviço)
--   3. produto_admin_remover_membro(membro)    a casa tira uma pessoa do CRM (só a chave de serviço)

-- ---------------------------------------------------------------------------
-- 1. Pessoas do CRM, de todas as empresas, para a casa
-- ---------------------------------------------------------------------------
create or replace function public.produto_admin_pessoas()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.produto_dono() then
    raise exception 'Só a administração.' using errcode = '42501';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id,
      'conta_id', m.conta_id,
      'empresa', c.nome,
      'nome', m.nome,
      'email', m.email,
      'papel', m.papel,
      'estado', m.estado,
      'convidado_em', m.convidado_em,
      'entrou_em', m.entrou_em,
      'tem_login', u.id is not null,
      'ultimo_acesso', u.last_sign_in_at
    ) order by c.nome, m.nome, m.email), '[]'::jsonb)
    from public.produto_membros m
    join public.produto_contas c on c.id = m.conta_id
    left join auth.users u on u.id = coalesce(m.user_id, (select x.id from auth.users x where lower(x.email) = m.email limit 1))
    where m.estado <> 'removido'
  );
end;
$$;

revoke all on function public.produto_admin_pessoas() from public, anon;
grant execute on function public.produto_admin_pessoas() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. O login de uma pessoa pelo e-mail (a função produto define a senha nova por ele)
-- ---------------------------------------------------------------------------
create or replace function public.produto_auth_usuario_por_email(_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id from auth.users u where lower(u.email) = lower(btrim(coalesce(_email, ''))) limit 1
$$;

revoke all on function public.produto_auth_usuario_por_email(text) from public, anon, authenticated;
grant execute on function public.produto_auth_usuario_por_email(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. A casa tira uma pessoa do CRM (mesmas regras de produto_membro_mudar, com a casa como ator)
-- ---------------------------------------------------------------------------
create or replace function public.produto_admin_remover_membro(_membro uuid, _ator uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _m public.produto_membros;
  _admins integer;
  _ficam integer;
begin
  select * into _m from public.produto_membros where id = _membro for update;
  if _m.id is null or _m.estado = 'removido' then
    raise exception 'Essa pessoa não está mais na empresa.' using errcode = 'P0001';
  end if;
  select count(*) into _admins from public.produto_membros m
   where m.conta_id = _m.conta_id and m.estado <> 'removido' and m.papel = 'admin' and m.id <> _m.id;
  if _m.papel = 'admin' and _admins = 0 then
    raise exception 'A empresa precisa de pelo menos uma pessoa administradora. Ponha outra antes de tirar esta.' using errcode = 'P0001';
  end if;
  update public.produto_membros set estado = 'removido', gerente_id = null where id = _m.id;
  if _m.user_id is not null then
    -- Os negocios da pessoa ficam sem dono, para a equipe redistribuir.
    perform set_config('crm.automacao', '1', true);
    update public.crm_leads set owner_id = null where conta_id = _m.conta_id and owner_id = _m.user_id;
    update public.crm_activities set owner_id = null where conta_id = _m.conta_id and owner_id = _m.user_id and done_at is null;
    perform set_config('crm.automacao', '', true);
  end if;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_m.conta_id, _ator, 'membro_removido', jsonb_build_object('membro', _m.id, 'pela_casa', true));
  select count(*) into _ficam from public.produto_membros m where m.conta_id = _m.conta_id and m.estado <> 'removido';
  return jsonb_build_object('conta_id', _m.conta_id, 'pessoas', _ficam);
end;
$$;

revoke all on function public.produto_admin_remover_membro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.produto_admin_remover_membro(uuid, uuid) to service_role;
