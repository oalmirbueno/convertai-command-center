-- CRM cobrado no plano do cliente da Aceleriq (18/11/2026, pedido do dono).
--
-- "Colocar ali na entrada também como produto: eu marcando como pago ali já libera o uso do CRM, e o
--  usuário separado sem confundir com o painel. O CRM é por usuário mas o banco de dados da empresa é
--  o mesmo. Paga por usuário mensal, junto no plano ou separado via assinatura: as duas rotas contam,
--  mas não pode ter duplicidade."
--
-- Duas rotas, uma conta por empresa:
--   assinatura: a empresa paga o CRM no cartão pelo checkout do Asaas (o que ja existia);
--   plano:      o CRM e um extra "crm" na ficha do cliente da Aceleriq. O dono marca a cobranca do
--               extra como paga e o acesso libera ate o fim do mes pago (mais a tolerancia).
-- Sem duplicidade:
--   * uma conta do produto por cliente da Aceleriq (indice unico em produto_contas.client_id);
--   * um extra de CRM vivo por cliente (indice unico parcial);
--   * conta com assinatura no cartao em dia nao passa para o plano (e vice-versa: o checkout recusa);
--   * a receita do plano entra no Financeiro pela cobranca do extra (billing); a conta pelo plano sai
--     da receita recorrente do produto, para o mesmo dinheiro nao aparecer duas vezes.
-- Acesso separado: o login geral do painel (o cliente) nao vira usuario do CRM. Quem administra o CRM
-- entra com o e-mail da propria pessoa.

-- ---------------------------------------------------------------------------
-- 1. As colunas novas
-- ---------------------------------------------------------------------------
alter table public.produto_contas
  add column if not exists cobranca_por text not null default 'assinatura',
  add column if not exists extra_id uuid references public.client_extras(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'produto_contas_cobranca_por_check') then
    alter table public.produto_contas add constraint produto_contas_cobranca_por_check check (cobranca_por in ('assinatura', 'plano'));
  end if;
end;
$$;

create unique index if not exists produto_contas_um_por_cliente on public.produto_contas (client_id) where client_id is not null;
create index if not exists produto_contas_por_extra on public.produto_contas (extra_id) where extra_id is not null;

alter table public.client_extras
  add column if not exists quantidade integer,
  add column if not exists produto_plano_id text references public.produto_planos(id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'client_extras_quantidade_check') then
    alter table public.client_extras add constraint client_extras_quantidade_check check (quantidade is null or quantidade between 1 and 500);
  end if;
end;
$$;

create unique index if not exists client_extras_um_crm_vivo on public.client_extras (client_id) where categoria = 'crm' and status <> 'encerrado';

-- ---------------------------------------------------------------------------
-- 2. O acesso da conta pelo plano segue o que foi pago
-- ---------------------------------------------------------------------------
-- Pago ate: o fim do mes de cada cobranca paga do extra (competencia, ou o vencimento quando nao ha).
-- Acesso ate: pago ate + a tolerancia. Extra encerrado: vale o que foi pago e depois para.
create or replace function public.produto_crm_recalcular(_conta uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _c public.produto_contas;
  _e public.client_extras;
  _tol integer;
  _pago_ate timestamptz;
  _acesso timestamptz;
begin
  select * into _c from public.produto_contas where id = _conta for update;
  if _c.id is null or _c.extra_id is null then
    return;
  end if;
  select * into _e from public.client_extras where id = _c.extra_id;
  select coalesce(g.tolerancia_dias, 5) into _tol from public.produto_config g where g.id;
  select max(((date_trunc('month', coalesce(b.competencia, b.due_date)::timestamp) + interval '1 month') at time zone 'America/Sao_Paulo'))
    into _pago_ate
    from public.billing b
   where b.extra_id = _c.extra_id and b.status = 'paid';
  _acesso := case when _pago_ate is null then null else _pago_ate + make_interval(days => coalesce(_tol, 5)) end;

  if _e.id is null or _e.status = 'encerrado' then
    -- Saiu do plano: vale o que foi pago e a empresa pode passar a assinar no cartao.
    update public.produto_contas set
      cobranca_por = 'assinatura',
      estado = case when _acesso is not null and _acesso > now() then 'cancelada' else 'suspensa' end,
      acesso_ate = _acesso,
      atualizado_em = now()
    where id = _conta and cobranca_por = 'plano';
    return;
  end if;

  update public.produto_contas set
    cobranca_por = 'plano',
    estado = case when _acesso is not null and _acesso > now() then 'ativa' else 'suspensa' end,
    acesso_ate = _acesso,
    teste_ate = null,
    atrasada_desde = null,
    plano_id = coalesce(_e.produto_plano_id, plano_id),
    usuarios_contratados = greatest(coalesce(_e.quantidade, usuarios_contratados),
                                    (select count(*)::integer from public.produto_membros m where m.conta_id = _conta and m.estado <> 'removido'), 1),
    atualizado_em = now()
  where id = _conta;
end;
$$;

revoke all on function public.produto_crm_recalcular(uuid) from public, anon, authenticated;
grant execute on function public.produto_crm_recalcular(uuid) to service_role;

-- A cobranca do extra mudou (paga, desfeita, apagada): o acesso acompanha na hora.
create or replace function public.produto_crm_cobranca_mudou()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare _conta uuid;
begin
  begin
    for _conta in
      select c.id from public.produto_contas c
       where c.extra_id is not null
         and c.extra_id in (case when tg_op = 'DELETE' then null else new.extra_id end, case when tg_op = 'INSERT' then null else old.extra_id end)
    loop
      perform public.produto_crm_recalcular(_conta);
    end loop;
  exception when others then
    -- O financeiro nunca deixa de salvar por causa do CRM.
    raise warning 'produto crm: recalculo falhou: %', sqlerrm;
  end;
  return coalesce(new, old);
end;
$$;

revoke all on function public.produto_crm_cobranca_mudou() from public, anon, authenticated;

drop trigger if exists produto_crm_cobranca_mudou_trg on public.billing;
drop trigger if exists produto_crm_cobranca_nova_trg on public.billing;
drop trigger if exists produto_crm_cobranca_apagada_trg on public.billing;
create trigger produto_crm_cobranca_nova_trg
  after insert on public.billing
  for each row when (new.extra_id is not null)
  execute function public.produto_crm_cobranca_mudou();
create trigger produto_crm_cobranca_mudou_trg
  after update of status, competencia, due_date, extra_id on public.billing
  for each row when (new.extra_id is not null or old.extra_id is not null)
  execute function public.produto_crm_cobranca_mudou();
create trigger produto_crm_cobranca_apagada_trg
  after delete on public.billing
  for each row when (old.extra_id is not null)
  execute function public.produto_crm_cobranca_mudou();

-- O extra mudou (encerrado, usuarios, plano): a conta acompanha.
create or replace function public.produto_crm_extra_mudou()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare _conta uuid;
begin
  begin
    for _conta in select c.id from public.produto_contas c where c.extra_id = new.id loop
      perform public.produto_crm_recalcular(_conta);
    end loop;
  exception when others then
    raise warning 'produto crm: recalculo falhou: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.produto_crm_extra_mudou() from public, anon, authenticated;

drop trigger if exists produto_crm_extra_mudou_trg on public.client_extras;
create trigger produto_crm_extra_mudou_trg
  after update of status, quantidade, produto_plano_id on public.client_extras
  for each row execute function public.produto_crm_extra_mudou();

-- ---------------------------------------------------------------------------
-- 3. Ligar o CRM ao plano do cliente (a funcao do produto chama, com a chave de servico, so pelo dono)
-- ---------------------------------------------------------------------------
create or replace function public.produto_crm_pelo_plano(_extra uuid, _email text, _nome text default '', _ator uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _e public.client_extras;
  _p public.profiles;
  _c public.produto_contas;
  _limpo text := lower(btrim(coalesce(_email, '')));
  _ocupados integer;
  _membro uuid;
  _admin_existe boolean;
  _assinando boolean;
begin
  select * into _e from public.client_extras where id = _extra for update;
  if _e.id is null or _e.categoria <> 'crm' or _e.status = 'encerrado' then
    raise exception 'Esse extra não é um CRM ativo.' using errcode = 'P0001';
  end if;
  if _e.cobranca <> 'mensal' then
    raise exception 'O CRM pelo plano é mensal: cadastre o extra com cobrança mensal.' using errcode = 'P0001';
  end if;
  select * into _p from public.profiles where id = _e.client_id;
  if _p.id is null then
    raise exception 'Cliente não encontrado.' using errcode = 'P0001';
  end if;

  select * into _c from public.produto_contas where client_id = _e.client_id for update;
  if _c.id is null and _e.produto_conta_id is not null then
    select * into _c from public.produto_contas where id = _e.produto_conta_id for update;
  end if;

  -- A empresa que ja paga no cartao nao passa a pagar tambem no plano.
  if _c.id is not null and _c.cobranca_por = 'assinatura' then
    select exists (
      select 1 from public.produto_assinaturas a
       where a.conta_id = _c.id and a.asaas_assinatura_id is not null and a.estado in ('ativa', 'atrasada', 'aguardando')
    ) into _assinando;
    if _assinando then
      raise exception 'Esta empresa já paga o CRM pela assinatura no cartão. Cancele a assinatura antes de cobrar no plano, para não cobrar duas vezes.' using errcode = 'P0001';
    end if;
  end if;
  if _c.id is not null and _c.client_id is not null and _c.client_id <> _e.client_id then
    raise exception 'Essa empresa do CRM é de outro cliente.' using errcode = 'P0001';
  end if;

  if _c.id is null then
    insert into public.produto_contas (nome, email_cobranca, client_id, plano_id, usuarios_contratados, estado, origem, cobranca_por, extra_id, observacao)
    values (left(coalesce(nullif(btrim(_p.company_name), ''), nullif(btrim(_p.full_name), ''), 'Empresa'), 120),
            nullif(lower(btrim(coalesce(_p.email, ''))), ''), _e.client_id,
            coalesce(_e.produto_plano_id, 'starter'), greatest(coalesce(_e.quantidade, 1), 1),
            'suspensa', 'painel', 'plano', _e.id, 'Cobrado no plano do cliente da Aceleriq.')
    returning * into _c;
    insert into public.produto_assinaturas (conta_id) values (_c.id) on conflict do nothing;
  else
    select count(*) into _ocupados from public.produto_membros m where m.conta_id = _c.id and m.estado <> 'removido';
    if coalesce(_e.quantidade, 1) < _ocupados then
      raise exception 'A empresa já tem % pessoas no CRM. Contrate pelo menos isso ou remova alguém antes.', _ocupados using errcode = 'P0001';
    end if;
    update public.produto_contas set client_id = _e.client_id, cobranca_por = 'plano', extra_id = _e.id, atualizado_em = now()
     where id = _c.id;
  end if;
  update public.client_extras set produto_conta_id = _c.id, updated_at = now() where id = _e.id;

  -- Quem administra o CRM: uma pessoa, com o e-mail dela. O login geral do painel fica so no painel.
  select exists (select 1 from public.produto_membros m where m.conta_id = _c.id and m.papel = 'admin' and m.estado <> 'removido') into _admin_existe;
  if _limpo <> '' then
    if _limpo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'E-mail inválido.' using errcode = 'P0001';
    end if;
    if _limpo = lower(btrim(coalesce(_p.email, ''))) then
      raise exception 'O acesso ao CRM é separado do painel: use o e-mail da pessoa que vai administrar o CRM, não o login geral do painel.' using errcode = 'P0001';
    end if;
    select m.id into _membro from public.produto_membros m where m.conta_id = _c.id and m.email = _limpo and m.estado <> 'removido';
    if _membro is null then
      if exists (select 1 from public.produto_membros m where m.email = _limpo and m.estado = 'ativo' and m.conta_id <> _c.id) then
        raise exception 'Esse e-mail já usa o CRM em outra empresa.' using errcode = 'P0001';
      end if;
      insert into public.produto_membros (conta_id, email, nome, papel, estado, convidado_por)
      values (_c.id, _limpo, left(btrim(coalesce(_nome, '')), 120), case when _admin_existe then 'usuario' else 'admin' end, 'convidado', _ator)
      returning id into _membro;
    else
      _membro := null;
    end if;
  elsif not _admin_existe then
    raise exception 'Diga o e-mail de quem vai administrar o CRM.' using errcode = 'P0001';
  end if;

  perform public.produto_crm_recalcular(_c.id);
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_c.id, _ator, 'crm_pelo_plano', jsonb_build_object('extra', _e.id, 'usuarios', _e.quantidade, 'plano', _e.produto_plano_id));

  select * into _c from public.produto_contas where id = _c.id;
  return jsonb_build_object('conta_id', _c.id, 'membro_id', _membro, 'estado', _c.estado, 'acesso_ate', _c.acesso_ate,
                            'liberada', public.produto_conta_liberada(_c.id));
end;
$$;

revoke all on function public.produto_crm_pelo_plano(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.produto_crm_pelo_plano(uuid, text, text, uuid) to service_role;

-- O que a ficha do cliente mostra do CRM dele (so o dono da casa le).
create or replace function public.produto_crm_do_cliente(_client uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare _c public.produto_contas;
begin
  if not public.produto_dono() then
    raise exception 'Só a administração.' using errcode = '42501';
  end if;
  select * into _c from public.produto_contas where client_id = _client;
  if _c.id is null then
    return null;
  end if;
  return jsonb_build_object(
    'conta_id', _c.id, 'nome', _c.nome, 'estado', _c.estado, 'cobranca_por', _c.cobranca_por, 'extra_id', _c.extra_id,
    'plano_id', _c.plano_id, 'usuarios_contratados', _c.usuarios_contratados, 'acesso_ate', _c.acesso_ate,
    'liberada', public.produto_conta_liberada(_c.id),
    'usuarios_ativos', (select count(*) from public.produto_membros m where m.conta_id = _c.id and m.estado = 'ativo'),
    'convites', (select count(*) from public.produto_membros m where m.conta_id = _c.id and m.estado = 'convidado'),
    'equipe', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome, 'email', m.email, 'papel', m.papel, 'estado', m.estado)
                 order by case m.papel when 'admin' then 0 when 'gerente' then 1 else 2 end, m.nome), '[]'::jsonb)
                 from public.produto_membros m where m.conta_id = _c.id and m.estado <> 'removido'),
    'assinatura_no_cartao', exists (select 1 from public.produto_assinaturas a where a.conta_id = _c.id and a.asaas_assinatura_id is not null and a.estado in ('ativa', 'atrasada', 'aguardando'))
  );
end;
$$;

revoke all on function public.produto_crm_do_cliente(uuid) from public, anon;
grant execute on function public.produto_crm_do_cliente(uuid) to authenticated, service_role;

-- Todo dia: a conta pelo plano que passou do acesso pago muda de estado (o acesso ja e cortado na hora
-- pela regra de liberacao; isto so deixa o estado da tela certo).
create or replace function public.produto_crm_plano_vigia()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare _c record; _n integer := 0;
begin
  for _c in select id from public.produto_contas where extra_id is not null and cobranca_por = 'plano' loop
    perform public.produto_crm_recalcular(_c.id);
    _n := _n + 1;
  end loop;
  return _n;
end;
$$;

revoke all on function public.produto_crm_plano_vigia() from public, anon, authenticated;
grant execute on function public.produto_crm_plano_vigia() to service_role;

do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    begin
      perform cron.unschedule('produto-crm-plano-vigia');
    exception when others then null;
    end;
    perform cron.schedule('produto-crm-plano-vigia', '15 4 * * *', 'select public.produto_crm_plano_vigia();');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Funcoes existentes que passam a conhecer a rota do plano
-- ---------------------------------------------------------------------------

-- liberada (20261113120000_produto_crm_e_email.sql)
create or replace function public.produto_conta_liberada(_conta uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.produto_contas c, public.produto_config g
     where c.id = _conta
       and (
         (c.estado = 'cortesia' or (c.estado = 'ativa' and (c.cobranca_por <> 'plano' or (c.acesso_ate is not null and c.acesso_ate > now()))))
         or (c.estado = 'teste' and c.teste_ate is not null and c.teste_ate > now())
         or (c.estado = 'atrasada' and coalesce(c.atrasada_desde, now()) + make_interval(days => g.tolerancia_dias) > now())
         or (c.estado = 'cancelada' and c.acesso_ate is not null and c.acesso_ate > now())
       )
  )
$$;

-- estado (20261113200000_crm_cargos_campos_e_automacoes.sql)
create or replace function public.produto_estado()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _eu uuid := auth.uid();
  _conta public.produto_contas;
  _eu_membro public.produto_membros;
  _plano public.produto_planos;
  _cfg public.produto_config;
  _admin boolean;
  _gestor boolean;
  _mes date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
begin
  if _eu is null then
    raise exception 'sem sessao' using errcode = '28000';
  end if;
  select * into _cfg from public.produto_config where id;
  select m.* into _eu_membro from public.produto_membros m where m.user_id = _eu and m.estado = 'ativo' limit 1;

  if _eu_membro.id is null then
    return jsonb_build_object(
      'conta', null,
      'convite', (select jsonb_build_object('conta', c.nome, 'papel', m.papel)
                    from public.produto_membros m join public.produto_contas c on c.id = m.conta_id
                   where m.estado = 'convidado' and m.email = lower((select u.email from auth.users u where u.id = _eu))
                   order by m.convidado_em desc limit 1),
      'dono_da_casa', public.produto_dono(),
      'pagamentos_ativos', _cfg.pagamentos_ativos,
      'teste_dias', _cfg.teste_dias,
      -- Quem entrou com o login geral do painel: a empresa dele tem CRM (o acesso ao CRM e por pessoa).
      'crm_da_empresa', (select jsonb_build_object('nome', c.nome) from public.produto_contas c where c.client_id = _eu limit 1)
    );
  end if;

  select * into _conta from public.produto_contas where id = _eu_membro.conta_id;
  select * into _plano from public.produto_planos where id = _conta.plano_id;
  _admin := _eu_membro.papel = 'admin';
  _gestor := _eu_membro.papel in ('admin', 'gerente');

  return jsonb_build_object(
    'conta', jsonb_build_object(
      'id', _conta.id, 'nome', _conta.nome, 'estado', _conta.estado, 'plano_id', _conta.plano_id,
      'usuarios_contratados', _conta.usuarios_contratados, 'crm_ativo', _conta.crm_ativo,
      'email_ativo', _conta.email_ativo, 'email_caixas_contratadas', _conta.email_caixas_contratadas,
      'teste_ate', _conta.teste_ate, 'atrasada_desde', _conta.atrasada_desde, 'acesso_ate', _conta.acesso_ate,
      'visibilidade', _conta.visibilidade,
      'cobranca_por', _conta.cobranca_por,
      'tem_painel', _conta.client_id is not null,
      'aparencia', _conta.aparencia,
      'perfil', _conta.perfil,
      'documento', case when _admin then _conta.documento end,
      'email_cobranca', case when _admin then _conta.email_cobranca end,
      'telefone', case when _admin then _conta.telefone end
    ),
    'eu', jsonb_build_object('membro_id', _eu_membro.id, 'papel', _eu_membro.papel, 'nome', _eu_membro.nome, 'email', _eu_membro.email,
                             'cargo', _eu_membro.cargo, 'gerente_id', _eu_membro.gerente_id),
    'plano', jsonb_build_object('id', _plano.id, 'nome', _plano.nome, 'preco_usuario', _plano.preco_usuario,
                                'limites', _plano.limites, 'email_caixas_incluidas', _plano.email_caixas_incluidas),
    'liberada', public.produto_conta_liberada(_conta.id),
    'crm', _conta.crm_ativo and public.produto_conta_liberada(_conta.id),
    'email', _conta.email_ativo and public.produto_conta_liberada(_conta.id),
    'dono_da_casa', public.produto_dono(),
    'pagamentos_ativos', _cfg.pagamentos_ativos,
    'tolerancia_dias', _cfg.tolerancia_dias,
    've_tudo', public.crm_ve_tudo(),
    'equipe', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', m.id, 'user_id', m.user_id, 'nome', m.nome, 'email', case when _gestor or m.user_id = _eu then m.email end,
                  'papel', m.papel, 'estado', m.estado, 'entrou_em', m.entrou_em,
                  'cargo', m.cargo, 'gerente_id', m.gerente_id, 'foto', m.foto, 'sobre', m.sobre,
                  'telefone', case when _gestor or m.user_id = _eu then m.telefone end,
                  'meta_mensal', case when _gestor or m.user_id = _eu then m.meta_mensal end)
                  order by case m.papel when 'admin' then 0 when 'gerente' then 1 else 2 end, m.nome), '[]'::jsonb)
                 from public.produto_membros m where m.conta_id = _conta.id and m.estado <> 'removido'),
    'avisos_novos', (select count(*) from public.crm_avisos a where a.conta_id = _conta.id and a.para = _eu and a.lido_em is null),
    -- Busca cancelada so nao conta se foi cancelada antes de a maquina comecar.
    'maquina_no_mes', (select count(*) from public.leads_buscas b
                        where b.conta_id = _conta.id and (b.situacao <> 'cancelada' or b.pego_em is not null)
                          and (b.created_at at time zone 'America/Sao_Paulo') >= _mes),
    'assinatura', case when _admin then (
        select jsonb_build_object('estado', a.estado, 'valor_mensal', a.valor_mensal, 'proximo_vencimento', a.proximo_vencimento,
                                  'cartao_final', a.cartao_final, 'cartao_bandeira', a.cartao_bandeira, 'itens', a.itens,
                                  'troca_agendada', a.troca_agendada,
                                  'checkout_link', case when a.estado = 'aguardando' and a.checkout_expira > now() then a.checkout_link end)
          from public.produto_assinaturas a where a.conta_id = _conta.id) end
  );
end;
$$;

-- admin_contas (20261113120000_produto_crm_e_email.sql)
create or replace function public.produto_admin_contas()
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
      'id', c.id, 'nome', c.nome, 'documento', c.documento, 'email_cobranca', c.email_cobranca, 'telefone', c.telefone,
      'client_id', c.client_id, 'plano_id', c.plano_id, 'usuarios_contratados', c.usuarios_contratados,
      'crm_ativo', c.crm_ativo, 'email_ativo', c.email_ativo, 'email_caixas_contratadas', c.email_caixas_contratadas,
      'estado', c.estado, 'teste_ate', c.teste_ate, 'atrasada_desde', c.atrasada_desde, 'acesso_ate', c.acesso_ate,
      'visibilidade', c.visibilidade, 'origem', c.origem, 'cobranca_por', c.cobranca_por, 'extra_id', c.extra_id, 'observacao', c.observacao, 'criado_em', c.criado_em,
      'liberada', public.produto_conta_liberada(c.id),
      'valor_mensal', public.produto_valor_da_conta(c.id),
      'itens', public.produto_itens_da_conta(c.id),
      'usuarios_ativos', (select count(*) from public.produto_membros m where m.conta_id = c.id and m.estado = 'ativo'),
      'convites', (select count(*) from public.produto_membros m where m.conta_id = c.id and m.estado = 'convidado'),
      'equipe', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'nome', m.nome, 'email', m.email, 'papel', m.papel,
                         'estado', m.estado, 'entrou_em', m.entrou_em) order by m.papel, m.nome), '[]'::jsonb)
                   from public.produto_membros m where m.conta_id = c.id and m.estado <> 'removido'),
      'assinatura', (select jsonb_build_object('estado', a.estado, 'valor_mensal', a.valor_mensal,
                         'proximo_vencimento', a.proximo_vencimento, 'cartao_final', a.cartao_final,
                         'asaas_assinatura_id', a.asaas_assinatura_id)
                       from public.produto_assinaturas a where a.conta_id = c.id),
      'dominios', (select count(*) from public.produto_email_dominios d where d.conta_id = c.id),
      -- So contagem: o conteudo do CRM do cliente e dele.
      'negocios', (select count(*) from public.crm_leads l where l.conta_id = c.id and l.archived_at is null),
      'ultimo_uso', (select max(e.created_at) from public.crm_lead_events e where e.conta_id = c.id)
    ) order by c.criado_em desc), '[]'::jsonb)
    from public.produto_contas c
  );
end;
$$;

-- faturamento (20261113120000_produto_crm_e_email.sql)
create or replace function public.produto_faturamento(_mes date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _m date := date_trunc('month', coalesce(_mes, (now() at time zone 'America/Sao_Paulo')::date))::date;
  _fim date := (_m + interval '1 month')::date;
  _cfg public.produto_config;
  _recebido numeric;
  _liquido numeric;
  _mrr numeric;
  _custos numeric;
  _caixas_extra integer;
  _custo_email numeric;
begin
  if not public.produto_dono() then
    raise exception 'Só a administração.' using errcode = '42501';
  end if;
  select * into _cfg from public.produto_config where id;

  select coalesce(sum(b.valor), 0), coalesce(sum(coalesce(b.valor_liquido, b.valor)), 0)
    into _recebido, _liquido
    from public.produto_cobrancas b
   where b.estado = 'paga' and (b.pago_em at time zone 'America/Sao_Paulo')::date >= _m
     and (b.pago_em at time zone 'America/Sao_Paulo')::date < _fim;

  select coalesce(sum(public.produto_valor_da_conta(c.id)), 0) into _mrr
    from public.produto_contas c where c.estado in ('ativa', 'atrasada') and c.cobranca_por <> 'plano';

  select coalesce(sum(k.valor), 0) into _custos from public.produto_custos k where k.competencia = _m;

  -- Caixas alem do que o provedor da de graca custam para a casa todo mes.
  select coalesce(sum(greatest(0, c.email_caixas_contratadas - _cfg.email_caixas_no_mensal)), 0) into _caixas_extra
    from public.produto_contas c where c.email_ativo and c.estado in ('ativa', 'atrasada', 'cortesia', 'teste');
  _custo_email := round(_caixas_extra * _cfg.custo_email_caixa_extra, 2);

  return jsonb_build_object(
    'mes', _m,
    'mrr', _mrr,
    'recebido', _recebido,
    'recebido_liquido', _liquido,
    -- As taxas entram em produto_custos a cada pagamento (tipo taxa_asaas): contam uma vez so, dentro dos lancados.
    'taxas', (select coalesce(sum(k.valor), 0) from public.produto_custos k where k.competencia = _m and k.tipo = 'taxa_asaas'),
    'a_receber', (select coalesce(sum(b.valor), 0) from public.produto_cobrancas b
                   where b.estado = 'aberta' and b.vencimento >= _m and b.vencimento < _fim),
    'atrasado', (select coalesce(sum(b.valor), 0) from public.produto_cobrancas b where b.estado = 'atrasada'),
    'imposto', round(_recebido * _cfg.imposto_pct / 100, 2),
    'custos_lancados', _custos,
    'custo_fixo', _cfg.custo_fixo_mensal,
    'custo_email', _custo_email,
    'custo_total', round(_custos + _cfg.custo_fixo_mensal + _custo_email + _recebido * _cfg.imposto_pct / 100, 2),
    'contas', (select jsonb_build_object(
                 'ativas', count(*) filter (where estado = 'ativa'),
                 'teste', count(*) filter (where estado = 'teste' and teste_ate > now()),
                 'atrasadas', count(*) filter (where estado = 'atrasada'),
                 'suspensas', count(*) filter (where estado = 'suspensa'),
                 'canceladas', count(*) filter (where estado = 'cancelada'),
                 'cortesia', count(*) filter (where estado = 'cortesia'),
                 'usuarios_pagos', coalesce(sum(usuarios_contratados) filter (where estado in ('ativa', 'atrasada') and crm_ativo), 0),
                 'com_email', count(*) filter (where email_ativo and estado in ('ativa', 'atrasada', 'cortesia')))
                 from public.produto_contas),
    'custos_por_tipo', (select coalesce(jsonb_object_agg(tipo, total), '{}'::jsonb)
                          from (select k.tipo, sum(k.valor) as total from public.produto_custos k
                                 where k.competencia = _m group by k.tipo) x),
    'serie', (select coalesce(jsonb_agg(jsonb_build_object('mes', s.mes, 'recebido', s.recebido, 'custos', s.custos) order by s.mes), '[]'::jsonb)
                from (
                  select g.mes::date as mes,
                         (select coalesce(sum(b.valor), 0) from public.produto_cobrancas b
                           where b.estado = 'paga' and date_trunc('month', (b.pago_em at time zone 'America/Sao_Paulo'))::date = g.mes::date) as recebido,
                         (select coalesce(sum(k.valor), 0) from public.produto_custos k where k.competencia = g.mes::date) as custos
                    from generate_series(_m - interval '5 months', _m, interval '1 month') as g(mes)
                ) s),
    'por_conta', (select coalesce(jsonb_agg(jsonb_build_object(
                    'conta_id', c.id, 'nome', c.nome, 'estado', c.estado, 'plano_id', c.plano_id,
                    'usuarios', c.usuarios_contratados, 'mensal', public.produto_valor_da_conta(c.id),
                    'recebido', (select coalesce(sum(b.valor), 0) from public.produto_cobrancas b
                                  where b.conta_id = c.id and b.estado = 'paga'
                                    and (b.pago_em at time zone 'America/Sao_Paulo')::date >= _m
                                    and (b.pago_em at time zone 'America/Sao_Paulo')::date < _fim),
                    'aberto', (select coalesce(sum(b.valor), 0) from public.produto_cobrancas b
                                where b.conta_id = c.id and b.estado in ('aberta', 'atrasada')),
                    'custo', (select coalesce(sum(k.valor), 0) from public.produto_custos k
                               where k.conta_id = c.id and k.competencia = _m)
                  ) order by c.nome), '[]'::jsonb)
                    from public.produto_contas c where c.estado <> 'cancelada' or c.acesso_ate > now())
  );
end;
$$;

-- convidar (20261113200000_crm_cargos_campos_e_automacoes.sql)
create or replace function public.produto_convidar(_email text, _nome text default '', _papel text default 'usuario', _gerente uuid default null, _cargo text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _eu uuid := auth.uid();
  _conta uuid := public.produto_minha_conta();
  _c public.produto_contas;
  _limpo text := lower(btrim(coalesce(_email, '')));
  _ocupados integer;
  _id uuid;
begin
  if _conta is null or not public.produto_sou_admin_da_conta(_conta) then
    raise exception 'Só quem administra a empresa convida.' using errcode = '42501';
  end if;
  if _limpo !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'E-mail inválido.' using errcode = 'P0001';
  end if;
  if coalesce(_papel, 'usuario') not in ('admin', 'gerente', 'usuario') then
    raise exception 'Cargo inválido.' using errcode = 'P0001';
  end if;
  select * into _c from public.produto_contas where id = _conta for update;
  if exists (select 1 from public.produto_membros m where m.conta_id = _conta and m.email = _limpo and m.estado <> 'removido') then
    raise exception 'Essa pessoa já está na empresa.' using errcode = 'P0001';
  end if;
  -- O login geral do painel do cliente nao vira usuario do CRM: cada pessoa entra com o proprio e-mail.
  if _c.client_id is not null and exists (select 1 from public.profiles p where p.id = _c.client_id and lower(btrim(coalesce(p.email, ''))) = _limpo) then
    raise exception 'Esse é o login geral do painel da empresa. No CRM cada pessoa entra com o próprio e-mail.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.produto_membros m where m.email = _limpo and m.estado = 'ativo') then
    raise exception 'Esse e-mail já usa o produto em outra empresa.' using errcode = 'P0001';
  end if;
  select count(*) into _ocupados from public.produto_membros m where m.conta_id = _conta and m.estado <> 'removido';
  if _ocupados >= _c.usuarios_contratados then
    raise exception 'Todos os % usuários do plano estão em uso. Aumente os usuários para convidar.', _c.usuarios_contratados using errcode = 'P0001';
  end if;
  insert into public.produto_membros (conta_id, email, nome, papel, estado, convidado_por, gerente_id, cargo)
  values (_conta, _limpo, left(btrim(coalesce(_nome, '')), 120), coalesce(_papel, 'usuario'), 'convidado', _eu,
          case when coalesce(_papel, 'usuario') = 'usuario' then _gerente end, left(btrim(coalesce(_cargo, '')), 60))
  returning id into _id;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_conta, _eu, 'membro_convidado', jsonb_build_object('membro', _id, 'papel', coalesce(_papel, 'usuario')));
  return _id;
end;
$$;

-- criar_conta (20261113120000_produto_crm_e_email.sql)
create or replace function public.produto_criar_conta(_nome text, _documento text default null, _telefone text default null,
                                                      _plano text default 'starter', _usuarios integer default 1,
                                                      _perfil jsonb default '{}'::jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _eu uuid := auth.uid();
  _usuario record;
  _cfg public.produto_config;
  _p public.produto_planos;
  _id uuid;
begin
  select u.email, u.email_confirmed_at, coalesce(u.raw_user_meta_data ->> 'full_name', '') as nome
    into _usuario from auth.users u where u.id = _eu;
  if _usuario.email is null or _usuario.email_confirmed_at is null then
    raise exception 'Confirme o seu e-mail antes de criar a empresa.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.produto_membros m where m.user_id = _eu and m.estado = 'ativo') then
    raise exception 'Você já faz parte de uma empresa.' using errcode = 'P0001';
  end if;
  -- O login geral do painel de uma empresa que ja tem CRM nao abre outra: cada pessoa entra com o proprio usuario.
  if exists (select 1 from public.produto_contas c where c.client_id = _eu) then
    raise exception 'A sua empresa já tem CRM. Entre com o seu usuário do CRM, e não com o login geral do painel.' using errcode = 'P0001';
  end if;
  select * into _p from public.produto_planos where id = coalesce(_plano, 'starter') and ativo;
  if _p.id is null then
    raise exception 'Plano indisponível.' using errcode = 'P0001';
  end if;
  select * into _cfg from public.produto_config where id;

  insert into public.produto_contas (nome, documento, telefone, email_cobranca, responsavel_id, plano_id,
                                     usuarios_contratados, estado, teste_ate, origem, perfil)
  values (left(btrim(_nome), 120), nullif(regexp_replace(coalesce(_documento, ''), '\D', '', 'g'), ''),
          nullif(btrim(coalesce(_telefone, '')), ''), lower(_usuario.email), _eu, _p.id,
          greatest(_p.minimo_usuarios, least(500, coalesce(_usuarios, 1))),
          'teste', now() + make_interval(days => _cfg.teste_dias), 'site',
          public.produto_perfil_valido(coalesce(_perfil, '{}'::jsonb)))
  returning id into _id;

  insert into public.produto_membros (conta_id, user_id, email, nome, papel, estado, entrou_em)
  values (_id, _eu, lower(_usuario.email),
          coalesce(nullif((select pr.full_name from public.profiles pr where pr.id = _eu), ''), _usuario.nome, ''),
          'admin', 'ativo', now());
  insert into public.produto_assinaturas (conta_id) values (_id) on conflict do nothing;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_id, _eu, 'conta_criada', jsonb_build_object('plano', _p.id, 'origem', 'site'));
  return _id;
end;
$$;
