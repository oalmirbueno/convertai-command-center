-- E-mail profissional numa rota só (18/11/2026, pedido do dono).
--
-- "O cliente pede e-mail profissional ou migração pela LP, o pedido chega para mim no admin, o cliente
--  paga e eu já parto dali. No admin eu escolho a entrada do cliente, marco como pago e o cliente cai
--  direto na área certa do /app. Rápido, simples e sem burocracia."
--
-- O que existia (auditoria em docs/produto/EMAIL-ROTA-UNICA.md):
--   * o pedido (página /email/pedir e o formulário dentro de /app/email) virava só histórico, um aviso
--     no sino e um negócio no Comercial a cada envio. Não havia o pedido em si: o dono recadastrava o
--     domínio à mão e nada dizia se já tinha pago;
--   * o pagamento do e-mail só existia pelo Asaas (migração avulsa) e pagar não ligava o e-mail;
--   * o acesso à área de E-mail dependia do teste do CRM: quem comprou só o e-mail perdia a tela quando
--     os 7 dias de teste do CRM acabavam.
--
-- O que entra:
--   1. produto_email_pedidos: a entrada. Um pedido aberto por empresa (índice único parcial), com
--      domínio, caixas, tipo (novo ou migração), valores e o andamento.
--   2. Marcar como pago (produto_email_marcar_pago): grava o dinheiro em UM livro só
--        - pedido ligado a um extra do cliente da Aceleriq: quita a cobrança aberta do extra (billing);
--        - sem extra: lança a cobrança paga no produto (produto_cobrancas, forma manual);
--        - cortesia: não lança dinheiro.
--      e então liga o e-mail da empresa, cria o domínio com o passo a passo e deixa a migração andando.
--      O mesmo vale quando o Asaas confirma a migração (gatilho em produto_cobrancas).
--   3. produto_email_liberado(): o acesso ao E-mail é do e-mail. Pedido pago libera, mesmo com o CRM
--      fora do teste. A área de E-mail não depende mais de produto_estado nem de produto_conta_liberada
--      (as duas estão sendo mudadas por outro lote: esta migration não as redefine).
--   4. Integração por domínio (Cloudflare e Zoho): ids e conferências, nunca senha nem token. O token do
--      Zoho de cada cliente fica no Vault (vault.secrets), lido só pela chave de serviço.
--   5. Funções para o MCP (chave de serviço, com o autor da ação) e para a tela do dono.
--
-- Tudo é acréscimo e idempotente. Retorno lógico: as funções novas podem ficar sem uso; a tabela de
-- pedidos e as colunas novas não mudam nenhuma regra antiga.

-- ---------------------------------------------------------------------------
-- 1. A entrada: o pedido de e-mail
-- ---------------------------------------------------------------------------
create table if not exists public.produto_email_pedidos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  extra_id uuid references public.client_extras(id) on delete set null,
  dominio_id uuid references public.produto_email_dominios(id) on delete set null,
  tipo text not null default 'migracao' check (tipo in ('migracao', 'novo')),
  dominio text check (dominio is null or (dominio = lower(btrim(dominio)) and dominio ~ '^([a-z0-9-]+\.)+[a-z]{2,}$')),
  caixas integer not null default 1 check (caixas between 1 and 500),
  provedor_atual text,
  observacao text,
  origem text not null default 'pagina' check (origem in ('pagina', 'app', 'casa', 'agente')),
  estado text not null default 'novo'
    check (estado in ('novo', 'aguardando_pagamento', 'pago', 'em_andamento', 'concluido', 'cancelado')),
  valor_migracao numeric(10, 2) not null default 0 check (valor_migracao >= 0),
  valor_mensal numeric(10, 2) not null default 0 check (valor_mensal >= 0),
  pago_em timestamptz,
  pago_por uuid,
  forma_pagamento text check (forma_pagamento is null or forma_pagamento in ('pix', 'boleto', 'cartao', 'transferencia', 'dinheiro', 'asaas', 'extra', 'cortesia', 'ja_lancado')),
  valor_pago numeric(10, 2) check (valor_pago is null or valor_pago >= 0),
  cobranca_id uuid references public.produto_cobrancas(id) on delete set null,
  billing_id uuid,
  nota text,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Sem duplicidade: uma entrada viva por empresa. Pedir de novo atualiza a mesma.
create unique index if not exists produto_email_pedidos_um_aberto
  on public.produto_email_pedidos (conta_id) where estado not in ('concluido', 'cancelado');
create index if not exists produto_email_pedidos_por_estado on public.produto_email_pedidos (estado, criado_em desc);

alter table public.produto_email_pedidos enable row level security;
revoke all on public.produto_email_pedidos from anon;
grant select on public.produto_email_pedidos to authenticated;
-- Escrita só pelas funções (deixam histórico). A casa lê tudo; a empresa lê pela produto_email_da_conta().
drop policy if exists "produto dono le os pedidos" on public.produto_email_pedidos;
create policy "produto dono le os pedidos" on public.produto_email_pedidos
  for select to authenticated using (public.produto_dono());

-- ---------------------------------------------------------------------------
-- 2. Integração do domínio: Cloudflare e Zoho (ids e conferência; segredo nunca)
-- ---------------------------------------------------------------------------
alter table public.produto_email_dominios
  add column if not exists cloudflare_zona_id text,
  add column if not exists zoho_org_id text,
  add column if not exists zoho_dc text,
  add column if not exists zoho_admin text,
  add column if not exists zoho_plano text,
  add column if not exists zoho_conectado boolean not null default false,
  add column if not exists integracao jsonb not null default '{}'::jsonb,
  add column if not exists integracao_conferida_em timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'produto_email_dominios_zoho_dc_check') then
    alter table public.produto_email_dominios add constraint produto_email_dominios_zoho_dc_check
      check (zoho_dc is null or zoho_dc in ('com', 'eu', 'in', 'com.au', 'jp', 'ca', 'sa'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'produto_email_dominios_zoho_plano_check') then
    alter table public.produto_email_dominios add constraint produto_email_dominios_zoho_plano_check
      check (zoho_plano is null or zoho_plano in ('gratuito', 'lite', 'premium', 'workplace'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'produto_email_dominios_cloudflare_zona_check') then
    alter table public.produto_email_dominios add constraint produto_email_dominios_cloudflare_zona_check
      check (cloudflare_zona_id is null or cloudflare_zona_id ~ '^[0-9a-f]{32}$');
  end if;
  -- A conferência guarda o que foi lido, nunca chave: limite de tamanho para não virar depósito.
  if not exists (select 1 from pg_constraint where conname = 'produto_email_dominios_integracao_tamanho') then
    alter table public.produto_email_dominios add constraint produto_email_dominios_integracao_tamanho
      check (pg_column_size(integracao) < 60000);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Quem pode: o dono da casa (pela tela) ou a chave de serviço (MCP e funções)
-- ---------------------------------------------------------------------------
create or replace function public.produto_email_pela_casa()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.role(), '') = 'service_role' or public.produto_dono()
$$;

revoke all on function public.produto_email_pela_casa() from public, anon;
grant execute on function public.produto_email_pela_casa() to authenticated, service_role;

-- O e-mail da empresa está liberado? E-mail ligado e (empresa em dia OU um pedido de e-mail pago).
create or replace function public.produto_email_liberado(_conta uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.produto_contas c
     where c.id = _conta and c.email_ativo
       and (
         public.produto_conta_liberada(c.id)
         or exists (select 1 from public.produto_email_pedidos p
                     where p.conta_id = c.id and p.estado in ('pago', 'em_andamento', 'concluido'))
       )
  )
$$;

revoke all on function public.produto_email_liberado(uuid) from public, anon;
grant execute on function public.produto_email_liberado(uuid) to authenticated, service_role;

-- O pedido como a tela e o MCP leem.
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
    'criado_em', _p.criado_em, 'atualizado_em', _p.atualizado_em)
$$;

revoke all on function public.produto_email_pedido_json(public.produto_email_pedidos) from public, anon, authenticated;
grant execute on function public.produto_email_pedido_json(public.produto_email_pedidos) to service_role;

-- Valores do pedido pela tabela de preços: migração uma vez (zero para domínio novo) e a mensalidade
-- das caixas (zero quando o plano da empresa já inclui o e-mail).
create or replace function public.produto_email_valores(_conta uuid, _tipo text, _caixas integer)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with g as (select * from public.produto_config where id),
       inclusas as (select coalesce(p.email_caixas_incluidas, 0) as n
                      from public.produto_contas c left join public.produto_planos p on p.id = c.plano_id
                     where c.id = _conta)
  select jsonb_build_object(
    'migracao', case when _tipo = 'novo' then 0 else (select email_migracao from g) end,
    'mensal', case when coalesce((select n from inclusas), 0) > 0 then 0
                   else (select email_mensal from g)
                        + greatest(0, greatest(1, coalesce(_caixas, 1)) - (select email_caixas_no_mensal from g)) * (select email_caixa_extra from g) end)
$$;

revoke all on function public.produto_email_valores(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.produto_email_valores(uuid, text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Registrar o pedido (a página, o /app, a casa e o agente passam por aqui)
-- ---------------------------------------------------------------------------
-- Devolve { pedido, novo }. "novo" é true só quando nasceu uma entrada: é isso que decide se abre
-- negócio no Comercial (antes, cada envio abria outro).
create or replace function public.produto_email_registrar_pedido(
  _conta uuid,
  _dominio text default null,
  _caixas integer default null,
  _tipo text default null,
  _observacao text default null,
  _origem text default 'pagina',
  _ator uuid default null,
  _extra uuid default null,
  _provedor_atual text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _c public.produto_contas;
  _p public.produto_email_pedidos;
  _dom text := nullif(lower(btrim(coalesce(_dominio, ''))), '');
  _n integer := greatest(1, least(500, coalesce(_caixas, 1)));
  _t text := case when _tipo in ('novo', 'migracao') then _tipo when _dom is null then 'novo' else 'migracao' end;
  _o text := case when _origem in ('pagina', 'app', 'casa', 'agente') then _origem else 'pagina' end;
  _v jsonb;
  _novo boolean := false;
begin
  -- A empresa só registra o próprio pedido; a casa e a chave de serviço registram de qualquer uma.
  if not public.produto_email_pela_casa() and not (public.produto_sou_admin_da_conta(_conta) and _o in ('pagina', 'app')) then
    raise exception 'Só quem administra a empresa faz o pedido.' using errcode = '42501';
  end if;
  select * into _c from public.produto_contas where id = _conta for update;
  if _c.id is null then
    raise exception 'A empresa não foi encontrada.' using errcode = 'P0001';
  end if;
  if _dom is not null and _dom !~ '^([a-z0-9-]+\.)+[a-z]{2,}$' then
    raise exception 'Confira o domínio. O formato é suaempresa.com.br.' using errcode = 'P0001';
  end if;
  if _extra is not null and not exists (
    select 1 from public.client_extras e
     where e.id = _extra and e.categoria = 'email' and e.status <> 'encerrado'
       and (_c.client_id is null or e.client_id = _c.client_id)
  ) then
    raise exception 'Esse extra não é um e-mail ativo deste cliente.' using errcode = 'P0001';
  end if;
  _v := public.produto_email_valores(_conta, _t, _n);

  select * into _p from public.produto_email_pedidos
   where conta_id = _conta and estado not in ('concluido', 'cancelado') for update;
  if _p.id is null then
    insert into public.produto_email_pedidos (conta_id, extra_id, tipo, dominio, caixas, provedor_atual, observacao, origem,
                                              valor_migracao, valor_mensal, criado_por)
    values (_conta, _extra, _t, _dom, _n, nullif(left(btrim(coalesce(_provedor_atual, '')), 120), ''),
            nullif(left(btrim(coalesce(_observacao, '')), 1500), ''), _o,
            (_v ->> 'migracao')::numeric, (_v ->> 'mensal')::numeric, _ator)
    returning * into _p;
    _novo := true;
  else
    -- Pedir de novo completa a mesma entrada; valores só mudam enquanto não foi pago.
    update public.produto_email_pedidos set
      dominio = coalesce(_dom, dominio),
      caixas = case when _caixas is null then caixas else _n end,
      tipo = case when _tipo in ('novo', 'migracao') then _tipo else tipo end,
      extra_id = coalesce(_extra, extra_id),
      provedor_atual = coalesce(nullif(left(btrim(coalesce(_provedor_atual, '')), 120), ''), provedor_atual),
      observacao = case when nullif(btrim(coalesce(_observacao, '')), '') is null then observacao
                        else left(concat_ws(E'\n', observacao, btrim(_observacao)), 1500) end,
      valor_migracao = case when estado in ('novo', 'aguardando_pagamento')
                            then (public.produto_email_valores(_conta, case when _tipo in ('novo', 'migracao') then _tipo else tipo end,
                                                                case when _caixas is null then caixas else _n end) ->> 'migracao')::numeric
                            else valor_migracao end,
      valor_mensal = case when estado in ('novo', 'aguardando_pagamento')
                          then (public.produto_email_valores(_conta, case when _tipo in ('novo', 'migracao') then _tipo else tipo end,
                                                              case when _caixas is null then caixas else _n end) ->> 'mensal')::numeric
                          else valor_mensal end,
      atualizado_em = now()
     where id = _p.id
    returning * into _p;
  end if;

  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_conta, _ator, case when _novo then 'email_pedido' else 'email_pedido_atualizado' end,
          jsonb_build_object('pedido', _p.id, 'dominio', _p.dominio, 'caixas', _p.caixas, 'tipo', _p.tipo, 'origem', _o));
  if _novo then
    perform public.produto_avisar_casa(
      format('E-mail profissional: %s pediu%s, %s %s.', _c.nome,
             case when _p.dominio is null then '' else ' para ' || _p.dominio end,
             _p.caixas, case when _p.caixas = 1 then 'caixa' else 'caixas' end),
      '/produto?area=email');
  end if;
  return jsonb_build_object('pedido', public.produto_email_pedido_json(_p), 'novo', _novo);
end;
$$;

revoke all on function public.produto_email_registrar_pedido(uuid, text, integer, text, text, text, uuid, uuid, text) from public, anon;
grant execute on function public.produto_email_registrar_pedido(uuid, text, integer, text, text, text, uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. O pagamento: liga o e-mail e começa a migração (o miolo, sem decidir o livro do dinheiro)
-- ---------------------------------------------------------------------------
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
      insert into public.produto_email_dominios (conta_id, dominio, provedor, provedor_antigo, dns_em, estado, observacao)
      values (_p.conta_id, _p.dominio, 'zoho', _p.provedor_atual, 'Cloudflare', 'levantamento',
              nullif(left(coalesce(_p.observacao, ''), 1500), ''))
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

-- Marcar como pago (o botão do dono e o MCP). Um livro só para o dinheiro:
--   _forma = 'cortesia'            → nada no financeiro;
--   _forma = 'ja_lancado'          → o dinheiro já está no Financeiro (ex.: parcela paga no extra): nada de novo;
--   pedido com extra_id            → quita a cobrança aberta mais antiga do extra (billing);
--   sem extra                      → cobrança paga no produto (produto_cobrancas), forma manual.
-- Repetir não lança de novo: pedido já pago devolve o que está (ja_estava_pago).
create or replace function public.produto_email_marcar_pago(
  _pedido uuid,
  _forma text default 'pix',
  _valor numeric default null,
  _pago_em date default null,
  _ator uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _p public.produto_email_pedidos;
  _c public.produto_contas;
  _quem uuid := coalesce(_ator, auth.uid());
  _f text := lower(btrim(coalesce(_forma, '')));
  _dia date := coalesce(_pago_em, (now() at time zone 'America/Sao_Paulo')::date);
  _quando timestamptz;
  _total numeric;
  _cobranca uuid;
  _billing uuid;
  _b record;
begin
  if not public.produto_email_pela_casa() then
    raise exception 'Só a administração da Aceleriq marca o pagamento.' using errcode = '42501';
  end if;
  if _f not in ('pix', 'boleto', 'cartao', 'transferencia', 'dinheiro', 'cortesia', 'ja_lancado') then
    raise exception 'Forma de pagamento desconhecida.' using errcode = 'P0001';
  end if;
  if _dia > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'A data do pagamento não pode ser no futuro.' using errcode = 'P0001';
  end if;
  _quando := (_dia::timestamp + interval '12 hours') at time zone 'America/Sao_Paulo';

  select * into _p from public.produto_email_pedidos where id = _pedido for update;
  if _p.id is null then
    raise exception 'O pedido não foi encontrado.' using errcode = 'P0001';
  end if;
  if _p.estado = 'cancelado' then
    raise exception 'O pedido está cancelado. Reabra antes de marcar o pagamento.' using errcode = 'P0001';
  end if;
  if _p.pago_em is not null then
    return jsonb_build_object('pedido', public.produto_email_pedido_json(_p), 'ja_estava_pago', true);
  end if;
  select * into _c from public.produto_contas where id = _p.conta_id;

  if _f = 'cortesia' then
    _total := 0;
  elsif _f = 'ja_lancado' then
    _total := nullif(round(coalesce(_valor, 0), 2), 0);
  elsif _p.extra_id is not null then
    -- O dinheiro mora no extra do cliente da Aceleriq: quita a cobrança aberta mais antiga dele.
    select b.id, b.amount into _b from public.billing b
     where b.extra_id = _p.extra_id and b.status <> 'paid'
     order by b.due_date asc, b.created_at asc limit 1 for update;
    if _b.id is null then
      raise exception 'O extra de e-mail deste cliente não tem cobrança aberta. Lance a cobrança no extra ou marque o pagamento por lá.' using errcode = 'P0001';
    end if;
    _total := round(coalesce(nullif(_valor, 0), _b.amount), 2);
    update public.billing set status = 'paid', paid_date = _dia, paid_amount = _total where id = _b.id;
    _billing := _b.id;
    _f := 'extra';
  else
    _total := round(coalesce(nullif(_valor, 0), case when _p.tipo = 'migracao' then _p.valor_migracao else _p.valor_mensal end), 2);
    if _total is null or _total <= 0 then
      raise exception 'Diga o valor pago (ou marque como cortesia).' using errcode = 'P0001';
    end if;
    insert into public.produto_cobrancas (conta_id, tipo, descricao, valor, valor_liquido, vencimento, estado, pago_em, forma)
    values (_p.conta_id, case when _p.tipo = 'migracao' then 'migracao' else 'avulsa' end,
            case when _p.tipo = 'migracao' then 'Migração do e-mail profissional' else 'E-mail profissional' end
              || coalesce(' (' || _p.dominio || ')', ''),
            _total, _total, _dia, 'paga', _quando, 'manual:' || _f)
    returning id into _cobranca;
  end if;

  update public.produto_email_pedidos set
    forma_pagamento = _f, valor_pago = _total, cobranca_id = coalesce(_cobranca, cobranca_id),
    billing_id = coalesce(_billing, billing_id), pago_em = _quando, pago_por = _quem, atualizado_em = now()
   where id = _p.id;
  _p := public.produto_email_aplicar_pagamento(_p.id, _quem);
  return jsonb_build_object('pedido', public.produto_email_pedido_json(_p), 'ja_estava_pago', false,
                            'livro', case when _cobranca is not null then 'produto' when _billing is not null then 'extra' else 'nenhum' end);
end;
$$;

revoke all on function public.produto_email_marcar_pago(uuid, text, numeric, date, uuid) from public, anon;
grant execute on function public.produto_email_marcar_pago(uuid, text, numeric, date, uuid) to authenticated, service_role;

-- O Asaas confirmou a migração (aviso do webhook): o pedido aberto da empresa segue igual ao manual.
create or replace function public.produto_email_cobranca_paga()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare _p public.produto_email_pedidos;
begin
  begin
    select * into _p from public.produto_email_pedidos
     where conta_id = new.conta_id and estado in ('novo', 'aguardando_pagamento') and pago_em is null
     for update;
    if _p.id is not null then
      update public.produto_email_pedidos set
        forma_pagamento = 'asaas', valor_pago = new.valor, cobranca_id = new.id, pago_em = coalesce(new.pago_em, now()), atualizado_em = now()
       where id = _p.id;
      perform public.produto_email_aplicar_pagamento(_p.id, null);
    end if;
  exception when others then
    -- O aviso do Asaas nunca deixa de gravar o pagamento por causa do e-mail.
    raise warning 'produto e-mail: pagamento nao aplicado ao pedido: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.produto_email_cobranca_paga() from public, anon, authenticated;

drop trigger if exists produto_email_cobranca_paga_trg on public.produto_cobrancas;
create trigger produto_email_cobranca_paga_trg
  after insert or update of estado on public.produto_cobrancas
  for each row
  when (new.tipo = 'migracao' and new.estado = 'paga' and new.asaas_pagamento_id is not null)
  execute function public.produto_email_cobranca_paga();

-- ---------------------------------------------------------------------------
-- 6. Andamento do pedido (sem dinheiro): aguardando pagamento, concluído, cancelado, reaberto
-- ---------------------------------------------------------------------------
create or replace function public.produto_email_pedido_mudar(_pedido uuid, _estado text, _nota text default null, _ator uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _p public.produto_email_pedidos;
  _quem uuid := coalesce(_ator, auth.uid());
begin
  if not public.produto_email_pela_casa() then
    raise exception 'Só a administração da Aceleriq muda o pedido.' using errcode = '42501';
  end if;
  select * into _p from public.produto_email_pedidos where id = _pedido for update;
  if _p.id is null then
    raise exception 'O pedido não foi encontrado.' using errcode = 'P0001';
  end if;
  if _estado not in ('aguardando_pagamento', 'concluido', 'cancelado', 'reabrir') then
    raise exception 'Esse andamento não existe. Para o pagamento, use marcar como pago.' using errcode = 'P0001';
  end if;
  if _estado = 'aguardando_pagamento' and _p.pago_em is not null then
    raise exception 'O pedido já está pago.' using errcode = 'P0001';
  end if;
  if _estado = 'concluido' and _p.pago_em is null then
    raise exception 'Marque o pagamento antes de concluir.' using errcode = 'P0001';
  end if;
  if _estado = 'reabrir' and exists (
    select 1 from public.produto_email_pedidos o where o.conta_id = _p.conta_id and o.id <> _p.id and o.estado not in ('concluido', 'cancelado')
  ) then
    raise exception 'A empresa já tem outro pedido aberto.' using errcode = 'P0001';
  end if;

  update public.produto_email_pedidos set
    estado = case _estado
               when 'reabrir' then case when pago_em is null then 'novo' when dominio_id is null then 'pago' else 'em_andamento' end
               else _estado end,
    nota = coalesce(nullif(left(btrim(coalesce(_nota, '')), 1500), ''), nota),
    atualizado_em = now()
   where id = _p.id
  returning * into _p;
  if _p.estado = 'concluido' and _p.dominio_id is not null then
    update public.produto_email_dominios set estado = 'concluido', atualizado_em = now()
     where id = _p.dominio_id and estado <> 'concluido';
  end if;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_p.conta_id, _quem, 'email_pedido_' || _estado, jsonb_build_object('pedido', _p.id, 'nota', _nota));
  return jsonb_build_object('pedido', public.produto_email_pedido_json(_p));
end;
$$;

revoke all on function public.produto_email_pedido_mudar(uuid, text, text, uuid) from public, anon;
grant execute on function public.produto_email_pedido_mudar(uuid, text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. As leituras
-- ---------------------------------------------------------------------------
-- As entradas para a casa (tela do dono e MCP): os pedidos com a empresa, o contato e o andamento.
create or replace function public.produto_email_pedidos_da_casa(_estado text default null, _limite integer default 100)
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
    select jsonb_agg(x.j order by x.ordem, x.criado_em desc)
      from (
        select public.produto_email_pedido_json(p) || jsonb_build_object(
                 'empresa', c.nome, 'email_contato', c.email_cobranca, 'telefone', c.telefone, 'client_id', c.client_id,
                 'extra_nome', e.nome,
                 'etapas_feitas', (select count(*) from public.produto_email_etapas t where t.dominio_id = p.dominio_id and t.feito_em is not null),
                 'etapas_total', (select count(*) from public.produto_email_etapas t where t.dominio_id = p.dominio_id),
                 'extras_de_email', (select coalesce(jsonb_agg(jsonb_build_object('id', x2.id, 'nome', x2.nome, 'cobranca', x2.cobranca, 'valor', x2.valor)), '[]'::jsonb)
                                       from public.client_extras x2
                                      where c.client_id is not null and x2.client_id = c.client_id and x2.categoria = 'email' and x2.status <> 'encerrado')) as j,
               case p.estado when 'novo' then 0 when 'aguardando_pagamento' then 1 when 'pago' then 2 when 'em_andamento' then 3 else 4 end as ordem,
               p.criado_em
          from public.produto_email_pedidos p
          join public.produto_contas c on c.id = p.conta_id
          left join public.client_extras e on e.id = p.extra_id
         where _estado is null
            or (_estado = 'abertos' and p.estado not in ('concluido', 'cancelado'))
            or p.estado = _estado
         order by p.criado_em desc
         limit greatest(1, least(500, coalesce(_limite, 100)))
      ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.produto_email_pedidos_da_casa(text, integer) from public, anon;
grant execute on function public.produto_email_pedidos_da_casa(text, integer) to authenticated, service_role;

-- Uma migração inteira para o MCP: pedido, empresa, domínio com integração, caixas, etapas e o histórico do e-mail.
create or replace function public.produto_email_migracao(_pedido uuid default null, _dominio_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _p public.produto_email_pedidos;
  _d public.produto_email_dominios;
  _conta uuid;
begin
  if not public.produto_email_pela_casa() then
    raise exception 'Só a administração da Aceleriq.' using errcode = '42501';
  end if;
  if _pedido is not null then
    select * into _p from public.produto_email_pedidos where id = _pedido;
    if _p.id is null then
      raise exception 'O pedido não foi encontrado.' using errcode = 'P0001';
    end if;
    _conta := _p.conta_id;
    if _p.dominio_id is not null then
      select * into _d from public.produto_email_dominios where id = _p.dominio_id;
    end if;
  elsif _dominio_id is not null then
    select * into _d from public.produto_email_dominios where id = _dominio_id;
    if _d.id is null then
      raise exception 'O domínio não foi encontrado.' using errcode = 'P0001';
    end if;
    _conta := _d.conta_id;
    select * into _p from public.produto_email_pedidos where dominio_id = _d.id order by criado_em desc limit 1;
  else
    raise exception 'Diga o pedido ou o domínio.' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'pedido', case when _p.id is null then null else public.produto_email_pedido_json(_p) end,
    'empresa', (select jsonb_build_object('id', c.id, 'nome', c.nome, 'estado', c.estado, 'client_id', c.client_id,
                                          'email_ativo', c.email_ativo, 'email_caixas_contratadas', c.email_caixas_contratadas,
                                          'email_liberado', public.produto_email_liberado(c.id))
                  from public.produto_contas c where c.id = _conta),
    'dominio', case when _d.id is null then null else jsonb_build_object(
        'id', _d.id, 'dominio', _d.dominio, 'provedor', _d.provedor, 'provedor_antigo', _d.provedor_antigo, 'dns_em', _d.dns_em,
        'registro_em', _d.registro_em, 'dkim_seletor', _d.dkim_seletor, 'estado', _d.estado, 'checagem', _d.checagem,
        'checado_em', _d.checado_em, 'observacao', _d.observacao, 'cloudflare_zona_id', _d.cloudflare_zona_id,
        'zoho_org_id', _d.zoho_org_id, 'zoho_dc', _d.zoho_dc, 'zoho_admin', _d.zoho_admin, 'zoho_plano', _d.zoho_plano,
        'zoho_conectado', _d.zoho_conectado, 'integracao', _d.integracao, 'integracao_conferida_em', _d.integracao_conferida_em) end,
    'caixas', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'endereco', x.endereco, 'pessoa', x.pessoa, 'tipo', x.tipo,
                                                            'estado', x.estado, 'tamanho_origem', x.tamanho_origem, 'observacao', x.observacao)
                                         order by x.endereco), '[]'::jsonb)
                 from public.produto_email_caixas x where x.dominio_id = _d.id and x.estado <> 'removida'),
    'etapas', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'ordem', e.ordem, 'chave', e.chave, 'titulo', e.titulo,
                                                            'ajuda', e.ajuda, 'feito_em', e.feito_em, 'nota', e.nota) order by e.ordem), '[]'::jsonb)
                 from public.produto_email_etapas e where e.dominio_id = _d.id),
    'historico', (select coalesce(jsonb_agg(jsonb_build_object('acao', h.acao, 'detalhe', h.detalhe, 'criado_em', h.criado_em) order by h.criado_em desc), '[]'::jsonb)
                    from (select * from public.produto_historico h
                           where h.conta_id = _conta and (h.acao like 'email%' or h.acao = 'migracao_cobrada')
                           order by h.criado_em desc limit 30) h)
  );
end;
$$;

revoke all on function public.produto_email_migracao(uuid, uuid) from public, anon;
grant execute on function public.produto_email_migracao(uuid, uuid) to authenticated, service_role;

-- A empresa vê o próprio e-mail (redefinida de 20261113120000): agora com o pedido e a liberação do e-mail.
create or replace function public.produto_email_da_conta()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _conta uuid := public.produto_minha_conta();
  _p public.produto_email_pedidos;
begin
  if _conta is null then
    raise exception 'Sem empresa.' using errcode = '42501';
  end if;
  select * into _p from public.produto_email_pedidos where conta_id = _conta
   order by (estado in ('concluido', 'cancelado')), criado_em desc limit 1;
  return jsonb_build_object(
    'liberado', public.produto_email_liberado(_conta),
    'pedido', case when _p.id is null then null else jsonb_build_object(
        'id', _p.id, 'tipo', _p.tipo, 'dominio', _p.dominio, 'caixas', _p.caixas, 'estado', _p.estado,
        'valor_migracao', _p.valor_migracao, 'valor_mensal', _p.valor_mensal, 'pago_em', _p.pago_em, 'criado_em', _p.criado_em) end,
    'dominios', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', d.id, 'conta_id', d.conta_id, 'dominio', d.dominio, 'provedor', d.provedor, 'webmail_url', d.webmail_url,
        'estado', d.estado, 'checagem', d.checagem, 'checado_em', d.checado_em) order by d.criado_em), '[]'::jsonb)
      from public.produto_email_dominios d where d.conta_id = _conta),
    'caixas', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'dominio_id', c.dominio_id, 'conta_id', c.conta_id, 'endereco', c.endereco, 'pessoa', c.pessoa,
        'tipo', c.tipo, 'estado', c.estado) order by c.endereco), '[]'::jsonb)
      from public.produto_email_caixas c where c.conta_id = _conta and c.estado <> 'removida'),
    'etapas', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'dominio_id', e.dominio_id, 'ordem', e.ordem, 'chave', e.chave, 'titulo', e.titulo, 'feito_em', e.feito_em) order by e.ordem), '[]'::jsonb)
      from public.produto_email_etapas e where e.conta_id = _conta)
  );
end;
$$;

revoke all on function public.produto_email_da_conta() from public, anon;
grant execute on function public.produto_email_da_conta() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. O avanço pelo MCP (chave de serviço, com o autor): domínio, caixa e etapa, com histórico
-- ---------------------------------------------------------------------------
-- _dados do domínio: provedor_antigo, dns_em, registro_em, webmail_url, dkim_seletor, estado, observacao,
-- cloudflare_zona_id, zoho_org_id, zoho_dc, zoho_admin, zoho_plano. Só muda o que vier.
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
  -- Nada de segredo aqui: token e senha ficam no Vault (produto_email_guardar_token_zoho).
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

-- Cria ou atualiza uma caixa (ou apelido) do domínio. O endereço é a chave: repetir não duplica.
create or replace function public.produto_email_caixa_salvar(
  _dominio_id uuid, _endereco text, _pessoa text default null, _tipo text default null, _estado text default null,
  _tamanho text default null, _observacao text default null, _ator uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _d public.produto_email_dominios;
  _limpo text := lower(btrim(coalesce(_endereco, '')));
  _id uuid;
  _novo boolean := false;
  _quem uuid := coalesce(_ator, auth.uid());
begin
  if not public.produto_email_pela_casa() then
    raise exception 'Só a administração da Aceleriq.' using errcode = '42501';
  end if;
  select * into _d from public.produto_email_dominios where id = _dominio_id;
  if _d.id is null then
    raise exception 'O domínio não foi encontrado.' using errcode = 'P0001';
  end if;
  if position('@' in _limpo) = 0 then
    _limpo := _limpo || '@' || _d.dominio;
  end if;
  if _limpo !~ '^[a-z0-9._+-]{1,64}@([a-z0-9-]+\.)+[a-z]{2,}$' or split_part(_limpo, '@', 2) <> _d.dominio then
    raise exception 'O endereço precisa ser deste domínio (nome@%).', _d.dominio using errcode = 'P0001';
  end if;
  if _tipo is not null and _tipo not in ('caixa', 'apelido', 'grupo') then
    raise exception 'Tipo de caixa desconhecido.' using errcode = 'P0001';
  end if;
  if _estado is not null and _estado not in ('pedida', 'criada', 'copiando', 'ativa', 'removida') then
    raise exception 'Situação de caixa desconhecida.' using errcode = 'P0001';
  end if;
  select x.id into _id from public.produto_email_caixas x where x.endereco = _limpo and x.estado <> 'removida';
  if _id is not null and not exists (select 1 from public.produto_email_caixas x where x.id = _id and x.dominio_id = _d.id) then
    raise exception 'Esse endereço já está em outro domínio.' using errcode = 'P0001';
  end if;
  if _id is null then
    insert into public.produto_email_caixas (dominio_id, conta_id, endereco, pessoa, tipo, estado, tamanho_origem, observacao)
    values (_d.id, _d.conta_id, _limpo, left(btrim(coalesce(_pessoa, '')), 120), coalesce(_tipo, 'caixa'), coalesce(_estado, 'criada'),
            nullif(left(btrim(coalesce(_tamanho, '')), 40), ''), nullif(left(btrim(coalesce(_observacao, '')), 600), ''))
    returning id into _id;
    _novo := true;
  else
    update public.produto_email_caixas set
      pessoa = coalesce(left(btrim(_pessoa), 120), pessoa),
      tipo = coalesce(_tipo, tipo),
      estado = coalesce(_estado, estado),
      tamanho_origem = coalesce(nullif(left(btrim(coalesce(_tamanho, '')), 40), ''), tamanho_origem),
      observacao = coalesce(nullif(left(btrim(coalesce(_observacao, '')), 600), ''), observacao),
      atualizado_em = now()
     where id = _id;
  end if;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_d.conta_id, _quem, case when _novo then 'email_caixa_criada' else 'email_caixa_atualizada' end,
          jsonb_build_object('caixa', _id, 'endereco', _limpo, 'estado', _estado));
  return jsonb_build_object('caixa_id', _id, 'endereco', _limpo, 'nova', _novo);
end;
$$;

revoke all on function public.produto_email_caixa_salvar(uuid, text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.produto_email_caixa_salvar(uuid, text, text, text, text, text, text, uuid) to authenticated, service_role;

-- Marca ou desmarca uma etapa do passo a passo (pela chave ou pela ordem), com nota.
create or replace function public.produto_email_etapa_marcar(
  _dominio_id uuid, _etapa text, _feito boolean default true, _nota text default null, _ator uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _e public.produto_email_etapas;
  _quem uuid := coalesce(_ator, auth.uid());
begin
  if not public.produto_email_pela_casa() then
    raise exception 'Só a administração da Aceleriq.' using errcode = '42501';
  end if;
  select * into _e from public.produto_email_etapas
   where dominio_id = _dominio_id and (chave = _etapa or (_etapa ~ '^[0-9]+$' and ordem = _etapa::integer))
   for update;
  if _e.id is null then
    raise exception 'Essa etapa não existe neste domínio. Leia as etapas antes.' using errcode = 'P0001';
  end if;
  update public.produto_email_etapas set
    feito_em = case when _feito then coalesce(feito_em, now()) else null end,
    feito_por = case when _feito then coalesce(feito_por, _quem) else null end,
    nota = case when nullif(btrim(coalesce(_nota, '')), '') is null then nota
                else left(concat_ws(E'\n', nota, btrim(_nota)), 1500) end
   where id = _e.id
  returning * into _e;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_e.conta_id, _quem, case when _feito then 'email_etapa_feita' else 'email_etapa_desfeita' end,
          jsonb_build_object('dominio', _dominio_id, 'etapa', _e.chave));
  return jsonb_build_object('etapa', _e.chave, 'ordem', _e.ordem, 'feito_em', _e.feito_em,
    'feitas', (select count(*) from public.produto_email_etapas t where t.dominio_id = _dominio_id and t.feito_em is not null),
    'total', (select count(*) from public.produto_email_etapas t where t.dominio_id = _dominio_id));
end;
$$;

revoke all on function public.produto_email_etapa_marcar(uuid, text, boolean, text, uuid) from public, anon;
grant execute on function public.produto_email_etapa_marcar(uuid, text, boolean, text, uuid) to authenticated, service_role;

-- Guarda o resultado de uma conferência (DNS público, Cloudflare ou Zoho). Só o que foi lido.
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
  elsif _onde in ('cloudflare', 'zoho') then
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

-- ---------------------------------------------------------------------------
-- 9. O token do Zoho de cada cliente: no Vault, nunca numa tabela do painel
-- ---------------------------------------------------------------------------
-- Uma conta Zoho por cliente: o refresh token (OAuth, só leitura das contas e domínios) do cliente vai
-- para vault.secrets com o nome produto_email_zoho_<dominio>. A tela manda o token uma vez, pela função
-- produto-email; ninguém lê de volta pela tela. Só a chave de serviço lê.
create or replace function public.produto_email_guardar_token_zoho(_dominio_id uuid, _token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  _nome text := 'produto_email_zoho_' || _dominio_id::text;
  _id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Só as funções do servidor guardam o token.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.produto_email_dominios where id = _dominio_id) then
    raise exception 'O domínio não foi encontrado.' using errcode = 'P0001';
  end if;
  select id into _id from vault.secrets where name = _nome;
  if nullif(btrim(coalesce(_token, '')), '') is null then
    if _id is not null then
      delete from vault.secrets where id = _id;
    end if;
    update public.produto_email_dominios set zoho_conectado = false where id = _dominio_id;
    return false;
  end if;
  if _id is null then
    perform vault.create_secret(btrim(_token), _nome, 'Zoho Mail do cliente (refresh token, produto e-mail)');
  else
    perform vault.update_secret(_id, btrim(_token));
  end if;
  return true;
end;
$$;

revoke all on function public.produto_email_guardar_token_zoho(uuid, text) from public, anon, authenticated;
grant execute on function public.produto_email_guardar_token_zoho(uuid, text) to service_role;

create or replace function public.produto_email_ler_token_zoho(_dominio_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Só as funções do servidor leem o token.' using errcode = '42501';
  end if;
  return (select s.decrypted_secret from vault.decrypted_secrets s where s.name = 'produto_email_zoho_' || _dominio_id::text limit 1);
end;
$$;

revoke all on function public.produto_email_ler_token_zoho(uuid) from public, anon, authenticated;
grant execute on function public.produto_email_ler_token_zoho(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 10. Quem já tinha o e-mail ligado na mão continua com acesso (sem pedido, a liberação é a de antes)
-- ---------------------------------------------------------------------------
-- Nada a migrar: produto_email_liberado() cai em produto_conta_liberada() quando não há pedido pago.
