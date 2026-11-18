-- Central de e-mail e a estrutura do correio (18/11/2026, pedido do dono).
--
-- "Crie uma central onde eu administro os clientes e vejo a saúde, de forma fácil, os e-mails dos
--  clientes e quando vai vencer. Cada usuário tem a sua caixa de entrada e um master vê todas. Deixe a
--  estrutura pronta: depois contratamos o plano e só espelhamos."
--
-- O que entra (só acréscimo, idempotente):
--   1. Vencimentos e custo por domínio (registro do domínio, plano do provedor) e qual provedor de
--      correio atende o domínio (nenhum, zoho, migadu, imap). "nenhum" = a estrutura existe e o correio
--      fica desligado.
--   2. Caixa por usuário: produto_email_caixas.membro_id diz de quem é a caixa. Master: quem administra
--      a empresa, ou quem tiver produto_membros.email_master.
--   3. produto_email_central(): a leitura da casa, uma linha por empresa com tudo o que a tela de saúde
--      precisa (a nota de saúde é calculada na tela, em src/lib/produto/email-central.ts, com teste).
--   4. produto_email_minhas_caixas(): o que a pessoa logada pode abrir no correio.
--   5. O segredo de cada caixa (senha de aplicativo do IMAP) mora no Vault, lido só pelo servidor.

-- ---------------------------------------------------------------------------
-- 1. Vencimentos, custo e provedor de correio
-- ---------------------------------------------------------------------------
alter table public.produto_email_dominios
  add column if not exists dominio_vence_em date,
  add column if not exists provedor_vence_em date,
  add column if not exists provedor_custo_mensal numeric(10, 2),
  add column if not exists correio_provedor text not null default 'nenhum',
  add column if not exists correio_ligado boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'produto_email_dominios_correio_provedor_check') then
    alter table public.produto_email_dominios add constraint produto_email_dominios_correio_provedor_check
      check (correio_provedor in ('nenhum', 'zoho', 'migadu', 'imap'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'produto_email_dominios_custo_check') then
    alter table public.produto_email_dominios add constraint produto_email_dominios_custo_check
      check (provedor_custo_mensal is null or provedor_custo_mensal >= 0);
  end if;
  -- Correio ligado sem provedor não existe.
  if not exists (select 1 from pg_constraint where conname = 'produto_email_dominios_correio_ligado_check') then
    alter table public.produto_email_dominios add constraint produto_email_dominios_correio_ligado_check
      check (not correio_ligado or correio_provedor <> 'nenhum');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Caixa por usuário e master
-- ---------------------------------------------------------------------------
alter table public.produto_email_caixas
  add column if not exists membro_id uuid references public.produto_membros(id) on delete set null,
  add column if not exists tem_segredo boolean not null default false;
create index if not exists produto_email_caixas_por_membro on public.produto_email_caixas (membro_id) where membro_id is not null;

alter table public.produto_membros
  add column if not exists email_master boolean not null default false;

-- A pessoa logada é master do e-mail da empresa? Quem administra a empresa, ou quem recebeu a marca.
create or replace function public.produto_email_sou_master(_conta uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.produto_membros m
     where m.conta_id = _conta and m.user_id = auth.uid() and m.estado = 'ativo'
       and (m.papel = 'admin' or m.email_master)
  )
$$;

revoke all on function public.produto_email_sou_master(uuid) from public, anon;
grant execute on function public.produto_email_sou_master(uuid) to authenticated, service_role;

-- Liga a caixa a uma pessoa da mesma empresa (ou desliga com _membro nulo). A casa ou quem administra a empresa.
create or replace function public.produto_email_caixa_atribuir(_caixa uuid, _membro uuid default null, _ator uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _c public.produto_email_caixas;
begin
  select * into _c from public.produto_email_caixas where id = _caixa for update;
  if _c.id is null then
    raise exception 'A caixa não foi encontrada.' using errcode = 'P0001';
  end if;
  if not (public.produto_email_pela_casa() or public.produto_sou_admin_da_conta(_c.conta_id)) then
    raise exception 'Só quem administra a empresa escolhe de quem é a caixa.' using errcode = '42501';
  end if;
  if _c.tipo <> 'caixa' then
    raise exception 'Apelido e grupo não têm caixa de entrada própria.' using errcode = 'P0001';
  end if;
  if _membro is not null and not exists (
    select 1 from public.produto_membros m where m.id = _membro and m.conta_id = _c.conta_id and m.estado <> 'removido'
  ) then
    raise exception 'Essa pessoa não é desta empresa.' using errcode = 'P0001';
  end if;
  update public.produto_email_caixas set membro_id = _membro, atualizado_em = now() where id = _caixa;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_c.conta_id, coalesce(_ator, auth.uid()), 'email_caixa_atribuida', jsonb_build_object('caixa', _caixa, 'membro', _membro));
  return jsonb_build_object('caixa_id', _caixa, 'membro_id', _membro);
end;
$$;

revoke all on function public.produto_email_caixa_atribuir(uuid, uuid, uuid) from public, anon;
grant execute on function public.produto_email_caixa_atribuir(uuid, uuid, uuid) to authenticated, service_role;

-- Marca ou desmarca alguém como master do e-mail (vê todas as caixas da empresa). Só a casa ou quem administra.
create or replace function public.produto_email_master_definir(_membro uuid, _master boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _m public.produto_membros;
begin
  select * into _m from public.produto_membros where id = _membro for update;
  if _m.id is null or _m.estado = 'removido' then
    raise exception 'A pessoa não foi encontrada.' using errcode = 'P0001';
  end if;
  if not (public.produto_email_pela_casa() or public.produto_sou_admin_da_conta(_m.conta_id)) then
    raise exception 'Só quem administra a empresa escolhe o master.' using errcode = '42501';
  end if;
  update public.produto_membros set email_master = coalesce(_master, false) where id = _membro;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_m.conta_id, auth.uid(), 'email_master_definido', jsonb_build_object('membro', _membro, 'master', coalesce(_master, false)));
  return jsonb_build_object('membro_id', _membro, 'email_master', coalesce(_master, false));
end;
$$;

revoke all on function public.produto_email_master_definir(uuid, boolean) from public, anon;
grant execute on function public.produto_email_master_definir(uuid, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. O que a pessoa logada pode abrir no correio
-- ---------------------------------------------------------------------------
-- A própria caixa (ligada a ela ou com o mesmo endereço do login) e, sendo master, todas as da empresa.
-- Devolve também se o correio está ligado: sem provedor contratado, a tela mostra "em preparação".
create or replace function public.produto_email_minhas_caixas()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _conta uuid := public.produto_minha_conta();
  _eu public.produto_membros;
  _master boolean;
begin
  if _conta is null then
    return jsonb_build_object('conta', null, 'master', false, 'liberado', false, 'caixas', '[]'::jsonb);
  end if;
  select * into _eu from public.produto_membros m where m.conta_id = _conta and m.user_id = auth.uid() and m.estado = 'ativo' limit 1;
  _master := public.produto_email_sou_master(_conta);
  return jsonb_build_object(
    'conta', (select jsonb_build_object('id', c.id, 'nome', c.nome) from public.produto_contas c where c.id = _conta),
    'master', _master,
    'liberado', public.produto_email_liberado(_conta),
    'caixas', (
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', x.id, 'endereco', x.endereco, 'pessoa', x.pessoa, 'minha', (x.membro_id = _eu.id or x.endereco = _eu.email),
          'dono', (select m.nome from public.produto_membros m where m.id = x.membro_id),
          'dominio', d.dominio, 'provedor', d.correio_provedor,
          'ligado', d.correio_ligado and x.tem_segredo)
        order by (x.membro_id = _eu.id or x.endereco = _eu.email) desc, x.endereco), '[]'::jsonb)
        from public.produto_email_caixas x
        join public.produto_email_dominios d on d.id = x.dominio_id
       where x.conta_id = _conta and x.tipo = 'caixa' and x.estado in ('criada', 'copiando', 'ativa')
         and (_master or x.membro_id = _eu.id or x.endereco = _eu.email)
    )
  );
end;
$$;

revoke all on function public.produto_email_minhas_caixas() from public, anon;
grant execute on function public.produto_email_minhas_caixas() to authenticated;

-- A pessoa (pelo id do login) pode abrir esta caixa? A função do correio pergunta antes de ler qualquer mensagem.
create or replace function public.produto_email_pode_abrir(_caixa uuid, _usuario uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.produto_email_caixas x
      join public.produto_membros m on m.conta_id = x.conta_id and m.user_id = _usuario and m.estado = 'ativo'
     where x.id = _caixa and x.tipo = 'caixa' and x.estado in ('criada', 'copiando', 'ativa')
       and public.produto_email_liberado(x.conta_id)
       and (m.papel = 'admin' or m.email_master or x.membro_id = m.id or x.endereco = m.email)
  )
$$;

revoke all on function public.produto_email_pode_abrir(uuid, uuid) from public, anon, authenticated;
grant execute on function public.produto_email_pode_abrir(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. O segredo de cada caixa (senha de aplicativo do IMAP): só no Vault
-- ---------------------------------------------------------------------------
create or replace function public.produto_email_guardar_segredo_da_caixa(_caixa uuid, _segredo text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _nome text := 'produto_email_caixa_' || _caixa::text;
  _id uuid;
  _tem boolean := nullif(btrim(coalesce(_segredo, '')), '') is not null;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Só as funções do servidor guardam o segredo.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.produto_email_caixas where id = _caixa) then
    raise exception 'A caixa não foi encontrada.' using errcode = 'P0001';
  end if;
  select id into _id from vault.secrets where name = _nome;
  if not _tem then
    if _id is not null then
      delete from vault.secrets where id = _id;
    end if;
  elsif _id is null then
    perform vault.create_secret(btrim(_segredo), _nome, 'Caixa de e-mail do cliente (senha de aplicativo, produto e-mail)');
  else
    perform vault.update_secret(_id, btrim(_segredo));
  end if;
  update public.produto_email_caixas set tem_segredo = _tem, atualizado_em = now() where id = _caixa;
  return _tem;
end;
$$;

revoke all on function public.produto_email_guardar_segredo_da_caixa(uuid, text) from public, anon, authenticated;
grant execute on function public.produto_email_guardar_segredo_da_caixa(uuid, text) to service_role;

create or replace function public.produto_email_ler_segredo_da_caixa(_caixa uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Só as funções do servidor leem o segredo.' using errcode = '42501';
  end if;
  return (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'produto_email_caixa_' || _caixa::text limit 1);
end;
$$;

revoke all on function public.produto_email_ler_segredo_da_caixa(uuid) from public, anon, authenticated;
grant execute on function public.produto_email_ler_segredo_da_caixa(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. A central da casa: uma linha por empresa que tem e-mail (ligado, pedido ou domínio)
-- ---------------------------------------------------------------------------
create or replace function public.produto_email_central()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.produto_email_pela_casa() then
    raise exception 'Só a administração da Aceleriq.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(l.j order by l.nome)
      from (
        select c.nome,
               jsonb_build_object(
                 'conta_id', c.id, 'empresa', c.nome, 'estado_da_conta', c.estado, 'client_id', c.client_id,
                 'email_ativo', c.email_ativo, 'liberado', public.produto_email_liberado(c.id),
                 'caixas_contratadas', c.email_caixas_contratadas,
                 'caixas', (select count(*) from public.produto_email_caixas x where x.conta_id = c.id and x.tipo = 'caixa' and x.estado <> 'removida'),
                 'apelidos', (select count(*) from public.produto_email_caixas x where x.conta_id = c.id and x.tipo <> 'caixa' and x.estado <> 'removida'),
                 'caixas_pedidas', (select count(*) from public.produto_email_caixas x where x.conta_id = c.id and x.estado = 'pedida'),
                 'caixas_sem_dono', (select count(*) from public.produto_email_caixas x where x.conta_id = c.id and x.tipo = 'caixa' and x.estado <> 'removida' and x.membro_id is null),
                 'dominios', (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', d.id, 'dominio', d.dominio, 'provedor', d.provedor, 'estado', d.estado,
                       'dns_pronto', case when d.checagem ? 'pronto' then (d.checagem ->> 'pronto')::boolean end,
                       'dns_faltas', (select count(*) from jsonb_array_elements(coalesce(d.checagem -> 'itens', '[]'::jsonb)) i where i ->> 'estado' = 'falta'),
                       'checado_em', d.checado_em, 'zoho_plano', d.zoho_plano, 'zoho_conectado', d.zoho_conectado,
                       'cloudflare', d.cloudflare_zona_id is not null,
                       'dominio_vence_em', d.dominio_vence_em, 'provedor_vence_em', d.provedor_vence_em,
                       'provedor_custo_mensal', d.provedor_custo_mensal,
                       'correio_provedor', d.correio_provedor, 'correio_ligado', d.correio_ligado,
                       'etapas_feitas', (select count(*) from public.produto_email_etapas e where e.dominio_id = d.id and e.feito_em is not null),
                       'etapas_total', (select count(*) from public.produto_email_etapas e where e.dominio_id = d.id)
                     ) order by d.criado_em), '[]'::jsonb)
                   from public.produto_email_dominios d where d.conta_id = c.id),
                 'pedido', (select jsonb_build_object('id', p.id, 'estado', p.estado, 'tipo', p.tipo, 'pago_em', p.pago_em, 'criado_em', p.criado_em,
                                                      'valor_mensal', p.valor_mensal, 'extra_id', p.extra_id)
                              from public.produto_email_pedidos p where p.conta_id = c.id
                             order by (p.estado in ('concluido', 'cancelado')), p.criado_em desc limit 1),
                 -- O que o cliente paga pelo e-mail: o extra da ficha (cliente da Aceleriq) ou a assinatura do produto.
                 'cobranca', (
                   select jsonb_build_object(
                     'por', 'extra', 'mensal', e.valor,
                     'proximo_vencimento', (select min(b.due_date) from public.billing b where b.extra_id = e.id and b.status <> 'paid'),
                     'em_atraso', (select count(*) from public.billing b where b.extra_id = e.id and b.status <> 'paid' and b.due_date < (now() at time zone 'America/Sao_Paulo')::date))
                     from public.client_extras e
                    where c.client_id is not null and e.client_id = c.client_id and e.categoria = 'email' and e.status <> 'encerrado'
                    order by (e.cobranca = 'mensal') desc, e.created_at desc limit 1),
                 'assinatura', (select jsonb_build_object('estado', a.estado, 'proximo_vencimento', a.proximo_vencimento, 'valor_mensal', a.valor_mensal)
                                  from public.produto_assinaturas a where a.conta_id = c.id)
               ) as j
          from public.produto_contas c
         where c.email_ativo
            or exists (select 1 from public.produto_email_dominios d where d.conta_id = c.id)
            or exists (select 1 from public.produto_email_pedidos p where p.conta_id = c.id and p.estado <> 'cancelado')
      ) l
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.produto_email_central() from public, anon;
grant execute on function public.produto_email_central() to authenticated, service_role;

-- Os campos novos do domínio entram pela mesma função de atualizar (redefinida de 20261118170000):
-- vencimentos, custo e provedor de correio. O resto fica igual.
create or replace function public.produto_email_dominio_atualizar(_dominio_id uuid, _dados jsonb, _ator uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _d public.produto_email_dominios;
  _quem uuid := coalesce(_ator, auth.uid());
  _texto text;
begin
  if not public.produto_email_pela_casa() then
    raise exception 'Só a administração da Aceleriq.' using errcode = '42501';
  end if;
  _texto := lower(coalesce(_dados::text, ''));
  if _texto ~ '"(senha|password|token|refresh_token|secret|api_key|chave)"' then
    raise exception 'Senha e token não entram no banco do painel. Guarde no cofre.' using errcode = 'P0001';
  end if;
  update public.produto_email_dominios set
    provedor_antigo = case when _dados ? 'provedor_antigo' then nullif(left(btrim(_dados ->> 'provedor_antigo'), 120), '') else provedor_antigo end,
    dns_em = case when _dados ? 'dns_em' then nullif(left(btrim(_dados ->> 'dns_em'), 120), '') else dns_em end,
    registro_em = case when _dados ? 'registro_em' then nullif(left(btrim(_dados ->> 'registro_em'), 120), '') else registro_em end,
    webmail_url = case when _dados ? 'webmail_url' then nullif(btrim(_dados ->> 'webmail_url'), '') else webmail_url end,
    dkim_seletor = case when _dados ? 'dkim_seletor' then nullif(left(btrim(_dados ->> 'dkim_seletor'), 63), '') else dkim_seletor end,
    estado = case when _dados ? 'estado' then _dados ->> 'estado' else estado end,
    observacao = case when _dados ? 'observacao' then nullif(left(_dados ->> 'observacao', 1500), '') else observacao end,
    cloudflare_zona_id = case when _dados ? 'cloudflare_zona_id' then nullif(lower(btrim(_dados ->> 'cloudflare_zona_id')), '') else cloudflare_zona_id end,
    zoho_org_id = case when _dados ? 'zoho_org_id' then nullif(left(btrim(_dados ->> 'zoho_org_id'), 40), '') else zoho_org_id end,
    zoho_dc = case when _dados ? 'zoho_dc' then nullif(lower(btrim(_dados ->> 'zoho_dc')), '') else zoho_dc end,
    zoho_admin = case when _dados ? 'zoho_admin' then nullif(lower(left(btrim(_dados ->> 'zoho_admin'), 254)), '') else zoho_admin end,
    zoho_plano = case when _dados ? 'zoho_plano' then nullif(lower(btrim(_dados ->> 'zoho_plano')), '') else zoho_plano end,
    dominio_vence_em = case when _dados ? 'dominio_vence_em' then nullif(_dados ->> 'dominio_vence_em', '')::date else dominio_vence_em end,
    provedor_vence_em = case when _dados ? 'provedor_vence_em' then nullif(_dados ->> 'provedor_vence_em', '')::date else provedor_vence_em end,
    provedor_custo_mensal = case when _dados ? 'provedor_custo_mensal' then nullif(_dados ->> 'provedor_custo_mensal', '')::numeric else provedor_custo_mensal end,
    correio_provedor = case when _dados ? 'correio_provedor' then coalesce(nullif(lower(btrim(_dados ->> 'correio_provedor')), ''), 'nenhum') else correio_provedor end,
    correio_ligado = case when _dados ? 'correio_ligado' then coalesce((_dados ->> 'correio_ligado')::boolean, false) else correio_ligado end,
    atualizado_em = now()
   where id = _dominio_id
  returning * into _d;
  if _d.id is null then
    raise exception 'O domínio não foi encontrado.' using errcode = 'P0001';
  end if;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_d.conta_id, _quem, 'email_dominio_atualizado', jsonb_build_object('dominio', _d.id, 'campos', (select jsonb_agg(k) from jsonb_object_keys(_dados) k)));
  return public.produto_email_migracao(null, _d.id);
end;
$$;

revoke all on function public.produto_email_dominio_atualizar(uuid, jsonb, uuid) from public, anon;
grant execute on function public.produto_email_dominio_atualizar(uuid, jsonb, uuid) to authenticated, service_role;
