-- Venda automática do E-mail profissional, fase 1 (19/11/2026).
--
-- O pedido da página /email/pedir passa a ter ofertas adicionais (order bumps) e a ser pago de uma
-- vez só, sem a casa no meio:
--   1. produto_ofertas: o catálogo das ofertas do pedido (nome, valor, mensal ou uma vez, marcada ou não).
--   2. O pedido guarda a foto das ofertas escolhidas (o preço que o cliente viu é o que vale).
--   3. produto_email_cobranca_do_pedido: o que se paga hoje (migração, 1º mês e ofertas) e o que
--      vira a mensalidade. A função `produto` abre a cobrança no Asaas com isso.
--   4. produto_email_assinaturas: a mensalidade do e-mail mora separada da assinatura do CRM. Quem
--      compra só o e-mail nunca é cobrado pelo CRM em teste; e o CRM, quando assinado, não cobra o
--      e-mail duas vezes (produto_itens_da_conta deixa o e-mail de fora quando ele já tem assinatura).
--
-- O pagamento continua passando pelo caminho que já existe: a cobrança tem a referência
-- "conta:<id>:migracao", o aviso do Asaas grava em produto_cobrancas e o gatilho
-- produto_email_cobranca_paga libera o pedido. O aviso cria a assinatura mensal depois de pago.
--
-- Tudo é acréscimo e idempotente. Retorno lógico: sem ofertas ativas e sem assinaturas de e-mail,
-- o comportamento é o de antes.

-- ---------------------------------------------------------------------------
-- 1. O catálogo das ofertas do pedido
-- ---------------------------------------------------------------------------
create table if not exists public.produto_ofertas (
  id text primary key check (id ~ '^[a-z][a-z0-9_]{1,39}$'),
  nome text not null check (length(btrim(nome)) between 2 and 60),
  descricao text not null default '' check (length(descricao) <= 240),
  cobranca text not null check (cobranca in ('mensal', 'unica')),
  valor numeric(10, 2) not null check (valor > 0 and valor <= 100000),
  -- Onde aparece: no e-mail novo, na migração ou nos dois.
  mostra_em text not null default 'ambos' check (mostra_em in ('novo', 'migracao', 'ambos')),
  marcada boolean not null default false,
  ativo boolean not null default true,
  ordem integer not null default 100,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.produto_ofertas enable row level security;
revoke all on public.produto_ofertas from anon;
grant select on public.produto_ofertas to authenticated;
drop policy if exists "produto dono le as ofertas" on public.produto_ofertas;
create policy "produto dono le as ofertas" on public.produto_ofertas
  for select to authenticated using (public.produto_dono());

-- Preços iniciais (a casa muda na tela de preços). Ficam ligadas: a venda só cobra com pagamentos_ativos.
insert into public.produto_ofertas (id, nome, descricao, cobranca, valor, mostra_em, marcada, ordem) values
  ('dominio_gerenciado', 'Domínio gerenciado', 'A Aceleriq cuida do DNS, da renovação e avisa antes de vencer.', 'mensal', 14.90, 'ambos', true, 10),
  ('site_cuidado', 'Site hospedado e cuidado', 'O site da empresa no ar, com cadeado, cópia e ajustes pequenos inclusos.', 'mensal', 69.00, 'ambos', false, 20),
  ('backup_antigo', 'Backup do e-mail antigo', 'Uma cópia de tudo o que está no e-mail de hoje, guardada por 1 ano.', 'unica', 97.00, 'migracao', false, 30),
  ('migracao_expressa', 'Migração expressa em 24 horas', 'A migração começa no mesmo dia e fica pronta em até 24 horas úteis.', 'unica', 197.00, 'migracao', false, 40)
on conflict (id) do nothing;

-- O que a página pública mostra: só o que está ativo, sem nada da casa.
create or replace function public.produto_ofertas_publicas()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', o.id, 'nome', o.nome, 'descricao', o.descricao, 'cobranca', o.cobranca, 'valor', o.valor,
           'mostra_em', o.mostra_em, 'marcada', o.marcada) order by o.ordem, o.id), '[]'::jsonb)
    from public.produto_ofertas o where o.ativo
$$;

revoke all on function public.produto_ofertas_publicas() from public;
grant execute on function public.produto_ofertas_publicas() to anon, authenticated, service_role;

-- A casa cria ou muda uma oferta. Mudar o preço não mexe em pedido já feito (ele guarda a foto).
create or replace function public.produto_oferta_salvar(
  _id text,
  _nome text,
  _cobranca text,
  _valor numeric,
  _descricao text default '',
  _mostra_em text default 'ambos',
  _marcada boolean default false,
  _ativo boolean default true,
  _ordem integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _o public.produto_ofertas;
  _chave text := lower(btrim(coalesce(_id, '')));
begin
  if not public.produto_email_pela_casa() then
    raise exception 'Só a administração da Aceleriq muda as ofertas.' using errcode = '42501';
  end if;
  if _chave !~ '^[a-z][a-z0-9_]{1,39}$' then
    raise exception 'O código da oferta usa letras minúsculas, números e _.' using errcode = 'P0001';
  end if;
  if length(btrim(coalesce(_nome, ''))) < 2 then
    raise exception 'Diga o nome da oferta.' using errcode = 'P0001';
  end if;
  if _cobranca not in ('mensal', 'unica') then
    raise exception 'A oferta é mensal ou de uma vez só.' using errcode = 'P0001';
  end if;
  if coalesce(_valor, 0) <= 0 then
    raise exception 'Diga o valor da oferta.' using errcode = 'P0001';
  end if;
  insert into public.produto_ofertas (id, nome, descricao, cobranca, valor, mostra_em, marcada, ativo, ordem)
  values (_chave, left(btrim(_nome), 60), left(btrim(coalesce(_descricao, '')), 240), _cobranca, round(_valor, 2),
          case when _mostra_em in ('novo', 'migracao', 'ambos') then _mostra_em else 'ambos' end,
          coalesce(_marcada, false), coalesce(_ativo, true), coalesce(_ordem, 100))
  on conflict (id) do update set
    nome = excluded.nome, descricao = excluded.descricao, cobranca = excluded.cobranca, valor = excluded.valor,
    mostra_em = excluded.mostra_em, marcada = excluded.marcada, ativo = excluded.ativo, ordem = excluded.ordem,
    atualizado_em = now()
  returning * into _o;
  return to_jsonb(_o);
end;
$$;

revoke all on function public.produto_oferta_salvar(text, text, text, numeric, text, text, boolean, boolean, integer) from public, anon;
grant execute on function public.produto_oferta_salvar(text, text, text, numeric, text, text, boolean, boolean, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. As ofertas no pedido e a cobrança aberta dele
-- ---------------------------------------------------------------------------
alter table public.produto_email_pedidos
  add column if not exists ofertas jsonb not null default '[]'::jsonb,
  add column if not exists cobranca_asaas_id text,
  add column if not exists cobranca_link text,
  add column if not exists cobranca_valor numeric(10, 2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'produto_email_pedidos_ofertas_lista') then
    alter table public.produto_email_pedidos add constraint produto_email_pedidos_ofertas_lista
      check (jsonb_typeof(ofertas) = 'array' and pg_column_size(ofertas) < 20000);
  end if;
end;
$$;

-- O pedido como a tela e o MCP leem (agora com as ofertas e a cobrança aberta).
create or replace function public.produto_email_pedido_json(_p public.produto_email_pedidos)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', _p.id, 'conta_id', _p.conta_id, 'extra_id', _p.extra_id, 'dominio_id', _p.dominio_id, 'tipo', _p.tipo,
    'dominio', _p.dominio, 'caixas', _p.caixas, 'provedor_atual', _p.provedor_atual, 'observacao', _p.observacao,
    'origem', _p.origem, 'estado', _p.estado, 'valor_migracao', _p.valor_migracao, 'valor_mensal', _p.valor_mensal,
    'pago_em', _p.pago_em, 'forma_pagamento', _p.forma_pagamento, 'valor_pago', _p.valor_pago,
    'cobranca_id', _p.cobranca_id, 'billing_id', _p.billing_id, 'nota', _p.nota,
    'ofertas', _p.ofertas, 'cobranca_link', _p.cobranca_link, 'cobranca_valor', _p.cobranca_valor,
    'criado_em', _p.criado_em, 'atualizado_em', _p.atualizado_em)
$$;

revoke all on function public.produto_email_pedido_json(public.produto_email_pedidos) from public, anon, authenticated;
grant execute on function public.produto_email_pedido_json(public.produto_email_pedidos) to service_role;

-- Escolher as ofertas do pedido. Guarda a foto do catálogo de agora. Só antes de pagar.
create or replace function public.produto_email_escolher_ofertas(_pedido uuid, _ofertas text[], _ator uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _p public.produto_email_pedidos;
  _foto jsonb;
begin
  select * into _p from public.produto_email_pedidos where id = _pedido for update;
  if _p.id is null then
    raise exception 'O pedido não foi encontrado.' using errcode = 'P0001';
  end if;
  if not public.produto_email_pela_casa() and not public.produto_sou_admin_da_conta(_p.conta_id) then
    raise exception 'Só quem administra a empresa escolhe as ofertas.' using errcode = '42501';
  end if;
  if _p.estado not in ('novo', 'aguardando_pagamento') or _p.pago_em is not null then
    raise exception 'O pedido já foi pago. Para somar algo, fale com a Aceleriq.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'nome', o.nome, 'cobranca', o.cobranca, 'valor', o.valor) order by o.ordem, o.id), '[]'::jsonb)
    into _foto
    from public.produto_ofertas o
   where o.ativo
     and o.id = any (coalesce(_ofertas, array[]::text[]))
     and (o.mostra_em = 'ambos' or o.mostra_em = _p.tipo);
  update public.produto_email_pedidos set ofertas = _foto, atualizado_em = now() where id = _p.id returning * into _p;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_p.conta_id, coalesce(_ator, auth.uid()), 'email_ofertas', jsonb_build_object('pedido', _p.id, 'ofertas', _foto));
  return public.produto_email_pedido_json(_p);
end;
$$;

revoke all on function public.produto_email_escolher_ofertas(uuid, text[], uuid) from public, anon;
grant execute on function public.produto_email_escolher_ofertas(uuid, text[], uuid) to authenticated, service_role;

-- O que se paga hoje e o que vira mensalidade, do jeito que o Asaas recebe (itens com quantidade e unitário).
--   hoje: migração (uma vez), 1º mês do e-mail, 1º mês de cada oferta mensal e as ofertas de uma vez;
--   mensal: e-mail e ofertas mensais, a partir do mês seguinte.
create or replace function public.produto_email_cobranca_do_pedido(_pedido uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with p as (select * from public.produto_email_pedidos where id = _pedido),
       ofertas as (
         select o ->> 'id' as id, o ->> 'nome' as nome, o ->> 'cobranca' as cobranca, round((o ->> 'valor')::numeric, 2) as valor, n
           from p, jsonb_array_elements(p.ofertas) with ordinality as x(o, n)
          where (o ->> 'valor') ~ '^[0-9]+(\.[0-9]+)?$'
       ),
       hoje as (
         select 1 as ordem, 'migracao' as chave, 'Migração do e-mail' as nome, (select valor_migracao from p) as unitario
          where (select valor_migracao from p) > 0
         union all
         select 2, 'email', 'E-mail profissional, 1º mês', (select valor_mensal from p) where (select valor_mensal from p) > 0
         union all
         select 10 + n::integer, 'oferta_' || id, case when cobranca = 'mensal' then nome || ', 1º mês' else nome end, valor from ofertas
       ),
       mensal as (
         select 1 as ordem, 'email' as chave, 'E-mail profissional' as nome, (select valor_mensal from p) as unitario
          where (select valor_mensal from p) > 0
         union all
         select 10 + n::integer, 'oferta_' || id, nome, valor from ofertas where cobranca = 'mensal'
       )
  select case when not exists (select 1 from p) then null else jsonb_build_object(
    'pedido_id', (select id from p),
    'conta_id', (select conta_id from p),
    'tipo', (select tipo from p),
    'itens_hoje', coalesce((select jsonb_agg(jsonb_build_object('chave', chave, 'nome', nome, 'quantidade', 1, 'unitario', unitario, 'total', unitario) order by ordem) from hoje), '[]'::jsonb),
    'itens_mensais', coalesce((select jsonb_agg(jsonb_build_object('chave', chave, 'nome', nome, 'quantidade', 1, 'unitario', unitario, 'total', unitario) order by ordem) from mensal), '[]'::jsonb),
    'total_hoje', coalesce((select sum(unitario) from hoje), 0),
    'total_mensal', coalesce((select sum(unitario) from mensal), 0)) end
$$;

revoke all on function public.produto_email_cobranca_do_pedido(uuid) from public, anon, authenticated;
grant execute on function public.produto_email_cobranca_do_pedido(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. A mensalidade do e-mail, separada da do CRM
-- ---------------------------------------------------------------------------
create table if not exists public.produto_email_assinaturas (
  conta_id uuid primary key references public.produto_contas(id) on delete cascade,
  pedido_id uuid references public.produto_email_pedidos(id) on delete set null,
  asaas_assinatura_id text unique check (asaas_assinatura_id is null or asaas_assinatura_id ~ '^sub_[a-zA-Z0-9_-]{1,100}$'),
  asaas_cliente_id text,
  estado text not null default 'ativa' check (estado in ('ativa', 'atrasada', 'cancelada')),
  valor_mensal numeric(10, 2) not null default 0 check (valor_mensal >= 0),
  itens jsonb not null default '[]'::jsonb check (jsonb_typeof(itens) = 'array' and pg_column_size(itens) < 20000),
  proximo_vencimento date,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.produto_email_assinaturas enable row level security;
revoke all on public.produto_email_assinaturas from anon;
grant select on public.produto_email_assinaturas to authenticated;
drop policy if exists "produto dono le as assinaturas do email" on public.produto_email_assinaturas;
create policy "produto dono le as assinaturas do email" on public.produto_email_assinaturas
  for select to authenticated using (public.produto_dono());

-- Preço da mensalidade do CRM (o checkout e o Financeiro leem daqui). Igual ao de antes, com uma
-- regra a mais: o e-mail que já tem assinatura própria não entra de novo.
create or replace function public.produto_itens_da_conta(_conta uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with c as (select * from public.produto_contas where id = _conta),
       p as (select pl.* from public.produto_planos pl join c on c.plano_id = pl.id),
       g as (select * from public.produto_config where id),
       email_a_parte as (
         select exists (select 1 from public.produto_email_assinaturas a
                         where a.conta_id = _conta and a.estado in ('ativa', 'atrasada')) as sim
       ),
       inclusas as (
         select case when (select email_caixas_incluidas from p) > 0
                     then (select email_caixas_incluidas from p) else 0 end as n
       ),
       linhas as (
         select 1 as ordem, 'crm' as chave,
                format('CRM %s', (select nome from p)) as nome,
                (select usuarios_contratados from c) as quantidade,
                (select preco_usuario from p) as unitario
          where (select crm_ativo from c)
         union all
         select 2, 'email', 'E-mail profissional', 1, (select email_mensal from g)
          where (select email_ativo from c) and (select n from inclusas) = 0 and not (select sim from email_a_parte)
         union all
         select 3, 'email_caixa_extra', 'Caixa de e-mail adicional',
                greatest(0, (select email_caixas_contratadas from c)
                            - case when (select n from inclusas) > 0 then (select n from inclusas)
                                   else (select email_caixas_no_mensal from g) end),
                (select email_caixa_extra from g)
          where (select email_ativo from c) and not (select sim from email_a_parte)
       )
  select coalesce(jsonb_agg(jsonb_build_object(
           'chave', chave, 'nome', nome, 'quantidade', quantidade, 'unitario', unitario,
           'total', round(quantidade * unitario, 2)) order by ordem), '[]'::jsonb)
    from linhas where quantidade > 0
$$;

revoke all on function public.produto_itens_da_conta(uuid) from public, anon, authenticated;
grant execute on function public.produto_itens_da_conta(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Migadu: o correio da Aceleriq (escolha do dono em 19/11/2026)
-- ---------------------------------------------------------------------------
-- O provedor novo entra na lista e vira o padrão dos domínios que nascem do pagamento. Os domínios que
-- já existem (Zoho, Google) não mudam. O correio no painel continua desligado até a chave da API do
-- Migadu estar nos segredos da função e o dono ligar domínio por domínio.
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'produto_email_dominios_provedor_check'
              and pg_get_constraintdef(oid) not like '%migadu%') then
    alter table public.produto_email_dominios drop constraint produto_email_dominios_provedor_check;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'produto_email_dominios_provedor_check') then
    alter table public.produto_email_dominios add constraint produto_email_dominios_provedor_check
      check (provedor in ('migadu', 'zoho', 'google', 'microsoft', 'outro'));
  end if;
end;
$$;
alter table public.produto_email_dominios alter column provedor set default 'migadu';

-- O pagamento liga o e-mail e cria o domínio (igual a 20261118170000, agora no Migadu).
create or replace function public.produto_email_aplicar_pagamento(_pedido uuid, _ator uuid)
returns public.produto_email_pedidos
language plpgsql
security definer
set search_path = ''
as $$
declare
  _p public.produto_email_pedidos;
  _c public.produto_contas;
  _d uuid;
begin
  select * into _p from public.produto_email_pedidos where id = _pedido for update;
  select * into _c from public.produto_contas where id = _p.conta_id for update;

  -- O domínio: o que já existe na empresa, ou nasce agora (o gatilho semeia as 8 etapas).
  if _p.dominio_id is null and _p.dominio is not null then
    select d.id into _d from public.produto_email_dominios d where d.conta_id = _p.conta_id and d.dominio = _p.dominio;
    if _d is null then
      insert into public.produto_email_dominios (conta_id, dominio, provedor, provedor_antigo, dns_em, estado, observacao, correio_provedor)
      values (_p.conta_id, _p.dominio, 'migadu', _p.provedor_atual, 'Cloudflare', 'levantamento',
              nullif(left(coalesce(_p.observacao, ''), 1500), ''), 'migadu')
      returning id into _d;
    end if;
  else
    _d := _p.dominio_id;
  end if;

  update public.produto_contas set
    email_ativo = true,
    email_caixas_contratadas = greatest(email_caixas_contratadas, _p.caixas),
    atualizado_em = now()
   where id = _p.conta_id;

  update public.produto_email_pedidos set
    dominio_id = _d,
    estado = case when _d is null then 'pago' else 'em_andamento' end,
    pago_em = coalesce(pago_em, now()),
    pago_por = coalesce(pago_por, _ator),
    atualizado_em = now()
   where id = _p.id
  returning * into _p;

  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_p.conta_id, _ator, 'email_pago', jsonb_build_object('pedido', _p.id, 'forma', _p.forma_pagamento, 'valor', _p.valor_pago, 'dominio', _d));
  return _p;
end;
$$;

revoke all on function public.produto_email_aplicar_pagamento(uuid, uuid) from public, anon, authenticated;

-- As caixas no Migadu nascem por convite: o link de criar a senha vai para o e-mail de hoje da pessoa.
-- O apelido guarda as caixas de destino. Nenhuma senha passa pelo painel.
alter table public.produto_email_caixas
  add column if not exists email_convite text,
  add column if not exists destinos text[];

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'produto_email_caixas_email_convite_formato') then
    alter table public.produto_email_caixas add constraint produto_email_caixas_email_convite_formato
      check (email_convite is null or (email_convite = lower(btrim(email_convite)) and email_convite ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'produto_email_caixas_destinos_limite') then
    alter table public.produto_email_caixas add constraint produto_email_caixas_destinos_limite
      check (destinos is null or cardinality(destinos) <= 50);
  end if;
end;
$$;

-- A conferência do Migadu (domínio, registros e caixas) fica junto das outras, em integracao.migadu.
create or replace function public.produto_email_gravar_conferencia(_dominio_id uuid, _onde text, _resultado jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Só as funções do servidor gravam a conferência.' using errcode = '42501';
  end if;
  if _onde = 'dns' then
    update public.produto_email_dominios set checagem = _resultado, checado_em = now() where id = _dominio_id;
  elsif _onde in ('cloudflare', 'zoho', 'migadu') then
    update public.produto_email_dominios set
      integracao = jsonb_set(integracao, array[_onde], _resultado, true),
      integracao_conferida_em = now(),
      zoho_conectado = case when _onde = 'zoho' then coalesce((_resultado ->> 'ok')::boolean, false) else zoho_conectado end
     where id = _dominio_id;
  else
    raise exception 'Conferência desconhecida.' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.produto_email_gravar_conferencia(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.produto_email_gravar_conferencia(uuid, text, jsonb) to service_role;
