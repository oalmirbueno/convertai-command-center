-- Produto CRM e E-mail (13/11/2026).
--
-- Um produto a parte do painel e da area de membros: a empresa cliente assina
-- por usuario, o dono da empresa convida a equipe, e cada empresa so enxerga
-- os proprios dados. O CRM e o mesmo do Comercial da casa: as tabelas crm_*
-- sao copias de estrutura das commercial_*, com a coluna conta_id e RLS por
-- empresa. Nada das tabelas da casa muda de regra.
--
-- So acrescenta. Pode rodar de novo sem efeito.

-- ---------------------------------------------------------------------------
-- 1. Catalogo e configuracao
-- ---------------------------------------------------------------------------
create table if not exists public.produto_planos (
  id text primary key check (id ~ '^[a-z0-9_]{2,40}$'),
  nome text not null check (length(btrim(nome)) between 2 and 60),
  resumo text not null default '',
  preco_usuario numeric(10, 2) not null check (preco_usuario >= 0),
  minimo_usuarios integer not null default 1 check (minimo_usuarios between 1 and 500),
  recursos jsonb not null default '[]'::jsonb,
  -- maquina_buscas_mes, maquina_google_maps, maquina_limite_por_busca,
  -- privacidade_por_vendedor, campanhas
  limites jsonb not null default '{}'::jsonb,
  -- Caixas de e-mail profissional que o plano ja inclui na mensalidade.
  email_caixas_incluidas integer not null default 0 check (email_caixas_incluidas between 0 and 500),
  destaque boolean not null default false,
  ativo boolean not null default true,
  ordem integer not null default 0,
  atualizado_em timestamptz not null default now()
);

insert into public.produto_planos (id, nome, resumo, preco_usuario, recursos, limites, email_caixas_incluidas, destaque, ordem)
values
  ('starter', 'Starter', 'O CRM completo para organizar a venda.', 49.90,
   '["Funil de vendas com arrastar e soltar", "Empresas, contatos e histórico", "Agenda e lembretes", "Metas do mês", "Máquina de leads: 5 buscas por mês"]'::jsonb,
   '{"maquina_buscas_mes": 5, "maquina_google_maps": false, "maquina_limite_por_busca": 50, "privacidade_por_vendedor": false, "campanhas": false}'::jsonb,
   0, false, 1),
  ('pro', 'Pro', 'Para a equipe que prospecta todo dia.', 79.90,
   '["Tudo do Starter", "Máquina de leads: 30 buscas por mês, com Google Maps", "Campanhas e custo por cliente", "Cada vendedor vê só os próprios negócios", "E-mail profissional incluído na mensalidade"]'::jsonb,
   '{"maquina_buscas_mes": 30, "maquina_google_maps": true, "maquina_limite_por_busca": 150, "privacidade_por_vendedor": true, "campanhas": true}'::jsonb,
   5, true, 2)
on conflict (id) do nothing;

-- Uma linha so: precos do e-mail, prazos e os custos que a casa tem.
create table if not exists public.produto_config (
  id boolean primary key default true check (id),
  -- Chave geral da cobranca. Desligada, ninguem e cobrado e o checkout nao abre.
  pagamentos_ativos boolean not null default false,
  teste_dias integer not null default 7 check (teste_dias between 0 and 60),
  tolerancia_dias integer not null default 5 check (tolerancia_dias between 0 and 30),
  email_migracao numeric(10, 2) not null default 597.00 check (email_migracao >= 0),
  email_mensal numeric(10, 2) not null default 39.90 check (email_mensal >= 0),
  email_caixas_no_mensal integer not null default 5 check (email_caixas_no_mensal between 0 and 500),
  email_caixa_extra numeric(10, 2) not null default 14.90 check (email_caixa_extra >= 0),
  -- Custos da casa, para a margem no Financeiro.
  custo_fixo_mensal numeric(10, 2) not null default 0 check (custo_fixo_mensal >= 0),
  custo_email_caixa_extra numeric(10, 2) not null default 0 check (custo_email_caixa_extra >= 0),
  custo_lugar_google_usd numeric(10, 4) not null default 0.004 check (custo_lugar_google_usd >= 0),
  dolar numeric(10, 4) not null default 5.60 check (dolar > 0),
  imposto_pct numeric(5, 2) not null default 6.00 check (imposto_pct between 0 and 100),
  atualizado_em timestamptz not null default now()
);

insert into public.produto_config (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Empresa, usuarios, assinatura, cobrancas, custos
-- ---------------------------------------------------------------------------
create table if not exists public.produto_contas (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(btrim(nome)) between 2 and 120),
  documento text,
  email_cobranca text,
  telefone text,
  responsavel_id uuid references auth.users(id) on delete set null,
  -- Quando a empresa tambem e cliente da agencia no painel.
  client_id uuid references public.profiles(id) on delete set null,
  plano_id text not null default 'starter' references public.produto_planos(id),
  usuarios_contratados integer not null default 1 check (usuarios_contratados between 1 and 500),
  crm_ativo boolean not null default true,
  email_ativo boolean not null default false,
  email_caixas_contratadas integer not null default 0 check (email_caixas_contratadas between 0 and 500),
  estado text not null default 'teste'
    check (estado in ('teste', 'ativa', 'atrasada', 'suspensa', 'cancelada', 'cortesia')),
  teste_ate timestamptz,
  atrasada_desde timestamptz,
  acesso_ate timestamptz,
  visibilidade text not null default 'todos' check (visibilidade in ('todos', 'proprios')),
  -- Personalizacao da empresa: cor de destaque, logo (imagem pequena embutida) e nome curto do topo.
  aparencia jsonb not null default '{}'::jsonb check (pg_column_size(aparencia) < 200000),
  -- O que a empresa respondeu ao chegar: nicho, objetivo e os nomes das etapas do funil dela.
  perfil jsonb not null default '{}'::jsonb check (pg_column_size(perfil) < 8000),
  origem text not null default 'painel' check (origem in ('site', 'painel')),
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

alter table public.produto_contas
  add column if not exists aparencia jsonb not null default '{}'::jsonb,
  add column if not exists perfil jsonb not null default '{}'::jsonb;

create index if not exists produto_contas_por_estado on public.produto_contas (estado, criado_em desc);
create index if not exists produto_contas_por_cliente on public.produto_contas (client_id) where client_id is not null;

create table if not exists public.produto_membros (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  email text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  nome text not null default '',
  papel text not null default 'usuario' check (papel in ('admin', 'usuario')),
  estado text not null default 'convidado' check (estado in ('convidado', 'ativo', 'removido')),
  convidado_por uuid,
  convidado_em timestamptz not null default now(),
  entrou_em timestamptz,
  criado_em timestamptz not null default now()
);

create unique index if not exists produto_membros_email_na_conta
  on public.produto_membros (conta_id, email) where estado <> 'removido';
-- Uma pessoa trabalha numa empresa so.
create unique index if not exists produto_membros_um_por_pessoa
  on public.produto_membros (user_id) where estado = 'ativo' and user_id is not null;
create index if not exists produto_membros_por_conta on public.produto_membros (conta_id, estado);

create table if not exists public.produto_assinaturas (
  conta_id uuid primary key references public.produto_contas(id) on delete cascade,
  asaas_cliente_id text,
  asaas_assinatura_id text unique,
  asaas_checkout_id text unique,
  checkout_link text,
  checkout_expira timestamptz,
  estado text not null default 'sem' check (estado in ('sem', 'aguardando', 'ativa', 'atrasada', 'cancelada')),
  valor_mensal numeric(10, 2) not null default 0 check (valor_mensal >= 0),
  itens jsonb not null default '[]'::jsonb,
  proximo_vencimento date,
  cartao_final text,
  cartao_bandeira text,
  atualizado_em timestamptz not null default now()
);

-- pedidos: para cada checkout aberto, o plano e os usuarios daquele pedido (o pagamento vale pelo que foi pago).
-- troca_agendada: reducao de plano ou de usuarios pedida no meio do ciclo, aplicada depois da proxima cobranca.
alter table public.produto_assinaturas
  add column if not exists pedidos jsonb not null default '{}'::jsonb,
  add column if not exists troca_agendada jsonb;

create table if not exists public.produto_cobrancas (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  asaas_pagamento_id text unique,
  tipo text not null default 'mensalidade' check (tipo in ('mensalidade', 'migracao', 'avulsa')),
  descricao text not null default '',
  valor numeric(10, 2) not null check (valor >= 0),
  valor_liquido numeric(10, 2),
  vencimento date,
  estado text not null default 'aberta' check (estado in ('aberta', 'paga', 'atrasada', 'estornada', 'cancelada')),
  pago_em timestamptz,
  forma text,
  link text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists produto_cobrancas_por_conta on public.produto_cobrancas (conta_id, vencimento desc);
create index if not exists produto_cobrancas_por_pagamento on public.produto_cobrancas (pago_em) where pago_em is not null;

-- Cada aviso do Asaas entra uma vez so.
create table if not exists public.produto_eventos (
  id text primary key,
  tipo text not null,
  conta_id uuid,
  resumo jsonb not null default '{}'::jsonb,
  recebido_em timestamptz not null default now()
);

create table if not exists public.produto_historico (
  id bigint generated always as identity primary key,
  conta_id uuid references public.produto_contas(id) on delete cascade,
  ator uuid,
  acao text not null,
  detalhe jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now()
);

create index if not exists produto_historico_por_conta on public.produto_historico (conta_id, criado_em desc);

-- O que a casa gasta para entregar o produto.
create table if not exists public.produto_custos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid references public.produto_contas(id) on delete set null,
  competencia date not null check (competencia = date_trunc('month', competencia)::date),
  tipo text not null check (tipo in ('taxa_asaas', 'maquina_de_leads', 'conferencia', 'email', 'fixo', 'outro')),
  valor numeric(10, 2) not null check (valor >= 0),
  descricao text not null default '',
  estimado boolean not null default false,
  origem_ref text unique,
  criado_em timestamptz not null default now()
);

create index if not exists produto_custos_por_mes on public.produto_custos (competencia, tipo);

-- ---------------------------------------------------------------------------
-- 3. E-mail profissional: dominio, caixas e o passo a passo da migracao
-- ---------------------------------------------------------------------------
create table if not exists public.produto_email_dominios (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  dominio text not null check (dominio = lower(btrim(dominio)) and dominio ~ '^([a-z0-9-]+\.)+[a-z]{2,}$'),
  provedor text not null default 'zoho' check (provedor in ('zoho', 'google', 'microsoft', 'outro')),
  provedor_antigo text,
  dns_em text,
  registro_em text,
  webmail_url text,
  dkim_seletor text,
  estado text not null default 'levantamento'
    check (estado in ('levantamento', 'preparando', 'virada', 'concluido', 'pausado')),
  checagem jsonb not null default '{}'::jsonb,
  checado_em timestamptz,
  observacao text,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (conta_id, dominio)
);

create table if not exists public.produto_email_caixas (
  id uuid primary key default gen_random_uuid(),
  dominio_id uuid not null references public.produto_email_dominios(id) on delete cascade,
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  endereco text not null check (endereco = lower(btrim(endereco)) and endereco ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  pessoa text not null default '',
  tipo text not null default 'caixa' check (tipo in ('caixa', 'apelido', 'grupo')),
  estado text not null default 'pedida' check (estado in ('pedida', 'criada', 'copiando', 'ativa', 'removida')),
  tamanho_origem text,
  observacao text,
  pedido_por uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists produto_email_caixas_endereco
  on public.produto_email_caixas (endereco) where estado <> 'removida';
create index if not exists produto_email_caixas_por_conta on public.produto_email_caixas (conta_id, estado);

create table if not exists public.produto_email_etapas (
  id uuid primary key default gen_random_uuid(),
  dominio_id uuid not null references public.produto_email_dominios(id) on delete cascade,
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  ordem integer not null,
  chave text not null,
  titulo text not null,
  ajuda text not null default '',
  feito_em timestamptz,
  feito_por uuid,
  nota text,
  unique (dominio_id, chave)
);

-- O passo a passo nasce junto com o dominio (o modelo veio da primeira migracao feita pela casa).
create or replace function public.produto_email_semear_etapas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.produto_email_etapas (dominio_id, conta_id, ordem, chave, titulo, ajuda)
  values
    (new.id, new.conta_id, 1, 'levantamento', 'Levantar caixas e DNS de hoje',
     'Listar cada caixa com o tamanho, quem usa POP ou IMAP, e copiar todos os registros de DNS atuais.'),
    (new.id, new.conta_id, 2, 'contas', 'Contas do cliente criadas',
     'Conta do provedor de e-mail e do DNS no nome e no e-mail do titular. A senha é dele.'),
    (new.id, new.conta_id, 3, 'dns_copiado', 'Zona de DNS copiada e conferida',
     'Importar a zona no DNS novo sem mudar o e-mail e comparar registro por registro com o antigo.'),
    (new.id, new.conta_id, 4, 'caixas_criadas', 'Domínio verificado e caixas criadas',
     'Verificar o domínio no provedor novo e criar cada caixa da lista.'),
    (new.id, new.conta_id, 5, 'historico', 'Histórico copiado',
     'Copiar as mensagens antigas de cada caixa e conferir a contagem. Histórico que só existe no computador do usuário é exportado antes.'),
    (new.id, new.conta_id, 6, 'virada', 'Virada do e-mail',
     'Trocar o MX para o provedor novo e publicar SPF, DKIM e DMARC.'),
    (new.id, new.conta_id, 7, 'teste', 'Envio e recebimento testados',
     'Mandar e receber em cada caixa, de dentro e de fora, e conferir a checagem do domínio.'),
    (new.id, new.conta_id, 8, 'encerramento', 'Contrato antigo encerrado',
     'Só depois de tudo conferido: transferir o registro do domínio para o titular, se preciso, e cancelar o serviço antigo.')
  on conflict (dominio_id, chave) do nothing;
  return new;
end;
$$;

revoke all on function public.produto_email_semear_etapas() from public, anon, authenticated;

drop trigger if exists produto_email_semear_etapas_trg on public.produto_email_dominios;
create trigger produto_email_semear_etapas_trg
  after insert on public.produto_email_dominios
  for each row execute function public.produto_email_semear_etapas();

-- ---------------------------------------------------------------------------
-- 4. Quem e quem
-- ---------------------------------------------------------------------------
create or replace function public.produto_dono()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public.has_role(auth.uid(), 'admin'::public.app_role) $$;

-- A empresa da pessoa logada (uma so).
create or replace function public.produto_minha_conta()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.conta_id from public.produto_membros m
   where m.user_id = auth.uid() and m.estado = 'ativo'
   limit 1
$$;

create or replace function public.produto_sou_admin_da_conta(_conta uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.produto_membros m
     where m.conta_id = _conta and m.user_id = auth.uid() and m.estado = 'ativo' and m.papel = 'admin'
  )
$$;

-- A empresa esta com o acesso em dia? Teste dentro do prazo, paga, atraso
-- dentro da tolerancia, cancelada ate o fim do periodo pago, ou cortesia.
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
         c.estado in ('ativa', 'cortesia')
         or (c.estado = 'teste' and c.teste_ate is not null and c.teste_ate > now())
         or (c.estado = 'atrasada' and coalesce(c.atrasada_desde, now()) + make_interval(days => g.tolerancia_dias) > now())
         or (c.estado = 'cancelada' and c.acesso_ate is not null and c.acesso_ate > now())
       )
  )
$$;

-- A empresa onde a pessoa pode usar o CRM agora (nulo quando nao pode).
create or replace function public.crm_conta_atual()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.produto_contas c
   where c.id = public.produto_minha_conta()
     and c.crm_ativo
     and public.produto_conta_liberada(c.id)
$$;

-- Enxerga os negocios de todo mundo? Admin sempre; usuario, so se a empresa nao separa por vendedor.
create or replace function public.crm_ve_tudo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.produto_membros m
      join public.produto_contas c on c.id = m.conta_id
      join public.produto_planos p on p.id = c.plano_id
     where m.user_id = auth.uid() and m.estado = 'ativo'
       and (
         m.papel = 'admin'
         or c.visibilidade = 'todos'
         or coalesce((p.limites ->> 'privacidade_por_vendedor')::boolean, false) is not true
       )
  )
$$;

do $$
declare _f text;
begin
  foreach _f in array array[
    'produto_dono()', 'produto_minha_conta()', 'produto_sou_admin_da_conta(uuid)',
    'produto_conta_liberada(uuid)', 'crm_conta_atual()', 'crm_ve_tudo()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', _f);
    execute format('grant execute on function public.%s to authenticated, service_role', _f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. RLS das tabelas da conta: a pessoa le o que e da empresa dela; a casa
--    (admin do painel) administra. Escrita do cliente so por funcao.
-- ---------------------------------------------------------------------------
do $$
declare _t text;
begin
  foreach _t in array array[
    'produto_planos', 'produto_config', 'produto_contas', 'produto_membros', 'produto_assinaturas',
    'produto_cobrancas', 'produto_eventos', 'produto_historico', 'produto_custos',
    'produto_email_dominios', 'produto_email_caixas', 'produto_email_etapas'
  ] loop
    execute format('alter table public.%I enable row level security', _t);
    execute format('revoke all on public.%I from anon', _t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', _t);
    execute format('drop policy if exists "produto dono administra" on public.%I', _t);
    execute format($p$create policy "produto dono administra" on public.%I
      for all to authenticated using (public.produto_dono()) with check (public.produto_dono())$p$, _t);
  end loop;

  -- A casa LE a equipe das empresas, mas nao escreve nela direto: entrar numa empresa daria o CRM dela.
  -- Convite e mudanca de equipe passam pelas funcoes, que deixam historico.
  drop policy if exists "produto dono administra" on public.produto_membros;
  drop policy if exists "produto dono le a equipe" on public.produto_membros;
  create policy "produto dono le a equipe" on public.produto_membros
    for select to authenticated using (public.produto_dono());

  -- Os planos a venda sao publicos (a pagina de venda mostra o preco sem login).
  grant select on public.produto_planos to anon;
  drop policy if exists "produto planos leitura" on public.produto_planos;
  create policy "produto planos leitura" on public.produto_planos
    for select to anon, authenticated using (ativo);
  -- A configuracao guarda os custos da casa: o cliente le os precos por produto_precos().
  drop policy if exists "produto config leitura" on public.produto_config;

  -- A empresa NAO le produto_contas direto: a linha guarda a anotacao interna da casa.
  -- O que e dela chega por produto_estado().
  drop policy if exists "produto conta da pessoa" on public.produto_contas;

  -- A equipe chega por produto_estado(), que esconde o e-mail dos colegas de quem nao administra.
  drop policy if exists "produto colegas" on public.produto_membros;

  -- Assinatura e cobrancas: so quem administra a empresa. O historico e da casa.
  drop policy if exists "produto admin da conta le" on public.produto_historico;
  foreach _t in array array['produto_assinaturas', 'produto_cobrancas'] loop
    execute format('drop policy if exists "produto admin da conta le" on public.%I', _t);
    execute format($p$create policy "produto admin da conta le" on public.%I
      for select to authenticated using (public.produto_sou_admin_da_conta(conta_id))$p$, _t);
  end loop;

  -- Dominio, caixas e etapas guardam anotacoes da casa: a empresa le por produto_email_da_conta().
  foreach _t in array array['produto_email_dominios', 'produto_email_caixas', 'produto_email_etapas'] loop
    execute format('drop policy if exists "produto email da conta" on public.%I', _t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. O CRM da empresa: mesma estrutura do Comercial da casa, com conta_id.
-- ---------------------------------------------------------------------------
do $$
declare
  _par text[];
  _t text;
begin
  foreach _par slice 1 in array array[
    array['commercial_campaigns', 'crm_campaigns'],
    array['commercial_organizations', 'crm_organizations'],
    array['commercial_contacts', 'crm_contacts'],
    array['commercial_leads', 'crm_leads'],
    array['commercial_lead_events', 'crm_lead_events'],
    array['commercial_activities', 'crm_activities'],
    array['commercial_goals', 'crm_goals'],
    array['commercial_lead_messages', 'crm_lead_messages']
  ] loop
    _t := _par[2];
    execute format(
      'create table if not exists public.%I (like public.%I including defaults including constraints including generated including identity)',
      _t, _par[1]);
    execute format('alter table public.%I add column if not exists conta_id uuid not null default public.crm_conta_atual() references public.produto_contas(id) on delete cascade', _t);
    if not exists (select 1 from pg_constraint where conrelid = format('public.%I', _t)::regclass and contype = 'p') then
      execute format('alter table public.%I add primary key (id)', _t);
    end if;
    execute format('alter table public.%I enable row level security', _t);
    execute format('revoke all on public.%I from anon', _t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', _t);
  end loop;
end;
$$;

-- A copia de estrutura traz a regra "uma meta por mes para o sistema inteiro"; aqui e por empresa.
alter table public.crm_goals drop constraint if exists commercial_goals_periodo_metrica;
create unique index if not exists crm_goals_periodo_metrica on public.crm_goals (conta_id, period, metric);

-- Ligacoes entre as tabelas do CRM (a copia de estrutura nao traz chave estrangeira).
do $$
declare _l text[];
begin
  foreach _l slice 1 in array array[
    array['crm_contacts', 'organization_id', 'crm_organizations', 'set null'],
    array['crm_leads', 'organization_id', 'crm_organizations', 'set null'],
    array['crm_leads', 'contact_id', 'crm_contacts', 'set null'],
    array['crm_leads', 'campaign_id', 'crm_campaigns', 'set null'],
    array['crm_lead_events', 'lead_id', 'crm_leads', 'cascade'],
    array['crm_activities', 'lead_id', 'crm_leads', 'cascade'],
    array['crm_lead_messages', 'lead_id', 'crm_leads', 'cascade']
  ] loop
    if not exists (
      select 1 from pg_constraint
       where conrelid = format('public.%I', _l[1])::regclass and conname = format('%s_%s_fk', _l[1], _l[2])
    ) then
      execute format('alter table public.%I add constraint %I foreign key (%I) references public.%I(id) on delete %s',
        _l[1], format('%s_%s_fk', _l[1], _l[2]), _l[2], _l[3], _l[4]);
    end if;
  end loop;
end;
$$;

create index if not exists crm_leads_da_conta on public.crm_leads (conta_id, stage, created_at desc) where archived_at is null;
create index if not exists crm_leads_por_dono on public.crm_leads (conta_id, owner_id) where archived_at is null;
create index if not exists crm_leads_por_empresa on public.crm_leads (organization_id) where organization_id is not null;
create index if not exists crm_lead_events_por_lead on public.crm_lead_events (lead_id, created_at desc);
create index if not exists crm_lead_events_da_conta on public.crm_lead_events (conta_id, created_at desc);
create index if not exists crm_activities_da_conta on public.crm_activities (conta_id, due_at) where done_at is null;
create index if not exists crm_activities_por_lead on public.crm_activities (lead_id);
create index if not exists crm_organizations_da_conta on public.crm_organizations (conta_id, name) where archived_at is null;
create unique index if not exists crm_organizations_nome_na_conta
  on public.crm_organizations (conta_id, lower(btrim(name))) where archived_at is null;
create index if not exists crm_contacts_por_empresa on public.crm_contacts (organization_id) where archived_at is null;
create index if not exists crm_campaigns_da_conta on public.crm_campaigns (conta_id, created_at desc);
create index if not exists crm_lead_messages_por_lead on public.crm_lead_messages (lead_id, created_at);

-- updated_at, como no Comercial da casa.
do $$
declare _t text;
begin
  foreach _t in array array['crm_campaigns', 'crm_organizations', 'crm_contacts', 'crm_leads', 'crm_activities', 'crm_goals'] loop
    execute format('drop trigger if exists %I on public.%I', _t || '_updated_at', _t);
    execute format('create trigger %I before update on public.%I for each row execute function public.update_updated_at_column()', _t || '_updated_at', _t);
  end loop;
end;
$$;

-- O lead cria ou acha a ficha da empresa e do contato, dentro da propria conta.
create or replace function public.crm_lead_liga_empresa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _empresa text := nullif(btrim(coalesce(new.company, '')), '');
  _pessoa text := nullif(btrim(coalesce(new.name, '')), '');
  _org uuid;
  _contato uuid;
begin
  -- Numa alteracao a empresa e a que ja estava gravada: este gatilho roda antes do que trava o conta_id.
  if tg_op = 'UPDATE' then
    new.conta_id := old.conta_id;
  end if;
  if new.organization_id is null and _empresa is not null then
    select o.id into _org from public.crm_organizations o
     where o.conta_id = new.conta_id and lower(btrim(o.name)) = lower(_empresa) and o.archived_at is null
     order by o.created_at limit 1;
    if _org is null then
      insert into public.crm_organizations (conta_id, name, owner_id, created_by)
      values (new.conta_id, left(_empresa, 160), new.owner_id, coalesce(new.created_by, auth.uid()))
      returning id into _org;
    end if;
    new.organization_id := _org;
  end if;

  if new.contact_id is null and new.organization_id is not null and _pessoa is not null
     and lower(_pessoa) is distinct from lower(coalesce(_empresa, ''))
     and (nullif(btrim(coalesce(new.email, '')), '') is not null or nullif(btrim(coalesce(new.whatsapp, '')), '') is not null) then
    select c.id into _contato from public.crm_contacts c
     where c.conta_id = new.conta_id and c.organization_id = new.organization_id and c.archived_at is null
       and (lower(btrim(c.name)) = lower(_pessoa)
            or (new.email is not null and lower(btrim(coalesce(c.email, ''))) = lower(btrim(new.email))))
     order by c.created_at limit 1;
    if _contato is null then
      insert into public.crm_contacts (conta_id, organization_id, name, email, whatsapp, is_primary, created_by)
      values (
        new.conta_id, new.organization_id, left(_pessoa, 160),
        nullif(btrim(coalesce(new.email, '')), ''), nullif(btrim(coalesce(new.whatsapp, '')), ''),
        not exists (select 1 from public.crm_contacts x where x.organization_id = new.organization_id and x.archived_at is null),
        coalesce(new.created_by, auth.uid())
      ) returning id into _contato;
    end if;
    new.contact_id := _contato;
  end if;
  return new;
end;
$$;

revoke all on function public.crm_lead_liga_empresa() from public, anon, authenticated;

drop trigger if exists crm_lead_liga_empresa_trg on public.crm_leads;
create trigger crm_lead_liga_empresa_trg
  before insert or update of company, organization_id, name, email, whatsapp on public.crm_leads
  for each row execute function public.crm_lead_liga_empresa();

-- Um registro do CRM so aponta para registro da MESMA empresa (negocio, ficha, contato, campanha).
-- A chave estrangeira sozinha deixaria apontar para o id de outra conta.
create or replace function public.crm_mesma_conta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _linha jsonb := to_jsonb(new);
  _par text[];
  _id uuid;
  _dona uuid;
begin
  foreach _par slice 1 in array array[
    array['lead_id', 'crm_leads'], array['organization_id', 'crm_organizations'],
    array['contact_id', 'crm_contacts'], array['campaign_id', 'crm_campaigns']
  ] loop
    if _linha ? _par[1] and nullif(_linha ->> _par[1], '') is not null then
      _id := (_linha ->> _par[1])::uuid;
      execute format('select conta_id from public.%I where id = $1', _par[2]) into _dona using _id;
      if _dona is distinct from new.conta_id then
        raise exception 'Registro de outra empresa.' using errcode = '42501';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

revoke all on function public.crm_mesma_conta() from public, anon, authenticated;

do $$
declare _t text;
begin
  foreach _t in array array['crm_leads', 'crm_contacts', 'crm_activities', 'crm_lead_events', 'crm_lead_messages'] loop
    -- O nome comeca com zz para rodar por ultimo: depois de o conta_id ser travado e de a ficha ser ligada.
    execute format('drop trigger if exists %I on public.%I', 'zz_' || _t || '_mesma_conta', _t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.crm_mesma_conta()', 'zz_' || _t || '_mesma_conta', _t);
  end loop;
end;
$$;

-- Ninguem muda um registro de empresa: o conta_id gravado e o que vale.
create or replace function public.crm_conta_nao_muda()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.conta_id := old.conta_id;
  return new;
end;
$$;

do $$
declare _t text;
begin
  foreach _t in array array[
    'crm_campaigns', 'crm_organizations', 'crm_contacts', 'crm_leads',
    'crm_lead_events', 'crm_activities', 'crm_goals', 'crm_lead_messages'
  ] loop
    execute format('drop trigger if exists %I on public.%I', _t || '_conta_fixa', _t);
    execute format('create trigger %I before update on public.%I for each row execute function public.crm_conta_nao_muda()', _t || '_conta_fixa', _t);

    execute format('drop policy if exists "crm da conta" on public.%I', _t);
  end loop;

  -- Negocios e compromissos respeitam "cada vendedor ve os proprios".
  create policy "crm da conta" on public.crm_leads
    for all to authenticated
    using (conta_id = (select public.crm_conta_atual())
           and ((select public.crm_ve_tudo()) or owner_id is null or owner_id = auth.uid()))
    with check (conta_id = (select public.crm_conta_atual()));

  create policy "crm da conta" on public.crm_activities
    for all to authenticated
    using (conta_id = (select public.crm_conta_atual())
           and ((select public.crm_ve_tudo()) or owner_id is null or owner_id = auth.uid()))
    with check (conta_id = (select public.crm_conta_atual()));

  -- Historia e conversa seguem o negocio: quem nao ve o negocio nao ve o resto.
  foreach _t in array array['crm_lead_events', 'crm_lead_messages'] loop
    execute format($p$create policy "crm da conta" on public.%I
      for all to authenticated
      using (conta_id = (select public.crm_conta_atual())
             and exists (select 1 from public.crm_leads l where l.id = lead_id))
      with check (conta_id = (select public.crm_conta_atual())
             and exists (select 1 from public.crm_leads l where l.id = lead_id))$p$, _t);
  end loop;

  foreach _t in array array['crm_campaigns', 'crm_organizations', 'crm_contacts', 'crm_goals'] loop
    execute format($p$create policy "crm da conta" on public.%I
      for all to authenticated
      using (conta_id = (select public.crm_conta_atual()))
      with check (conta_id = (select public.crm_conta_atual()))$p$, _t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Maquina de leads por empresa: a mesma fila, marcada com a conta.
-- ---------------------------------------------------------------------------
alter table public.leads_buscas
  add column if not exists conta_id uuid references public.produto_contas(id) on delete cascade,
  add column if not exists crm_campanha_id uuid;
alter table public.leads_candidatos
  add column if not exists crm_lead_id uuid;

create index if not exists leads_buscas_da_conta on public.leads_buscas (conta_id, created_at desc) where conta_id is not null;

-- A regra antiga (admin e manager veem tudo) passaria a mostrar a prospeccao das empresas: fica so com a da casa.
drop policy if exists "comercial admin e manager" on public.leads_buscas;
create policy "comercial admin e manager" on public.leads_buscas
  for all to authenticated
  using (conta_id is null and (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'manager'::public.app_role)))
  with check (conta_id is null and (public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'manager'::public.app_role)));

drop policy if exists "comercial admin e manager" on public.leads_candidatos;
create policy "comercial admin e manager" on public.leads_candidatos
  for all to authenticated
  using ((public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'manager'::public.app_role))
         and exists (select 1 from public.leads_buscas b where b.id = busca_id and b.conta_id is null))
  with check ((public.has_role(auth.uid(), 'admin'::public.app_role) or public.has_role(auth.uid(), 'manager'::public.app_role))
         and exists (select 1 from public.leads_buscas b where b.id = busca_id and b.conta_id is null));

-- ---------------------------------------------------------------------------
-- 8. O que a tela do produto le numa chamada
-- ---------------------------------------------------------------------------
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
      'teste_dias', _cfg.teste_dias
    );
  end if;

  select * into _conta from public.produto_contas where id = _eu_membro.conta_id;
  select * into _plano from public.produto_planos where id = _conta.plano_id;
  _admin := _eu_membro.papel = 'admin';

  return jsonb_build_object(
    'conta', jsonb_build_object(
      'id', _conta.id, 'nome', _conta.nome, 'estado', _conta.estado, 'plano_id', _conta.plano_id,
      'usuarios_contratados', _conta.usuarios_contratados, 'crm_ativo', _conta.crm_ativo,
      'email_ativo', _conta.email_ativo, 'email_caixas_contratadas', _conta.email_caixas_contratadas,
      'teste_ate', _conta.teste_ate, 'atrasada_desde', _conta.atrasada_desde, 'acesso_ate', _conta.acesso_ate,
      'visibilidade', _conta.visibilidade,
      'aparencia', _conta.aparencia,
      'perfil', _conta.perfil,
      'documento', case when _admin then _conta.documento end,
      'email_cobranca', case when _admin then _conta.email_cobranca end,
      'telefone', case when _admin then _conta.telefone end
    ),
    'eu', jsonb_build_object('membro_id', _eu_membro.id, 'papel', _eu_membro.papel, 'nome', _eu_membro.nome, 'email', _eu_membro.email),
    'plano', jsonb_build_object('id', _plano.id, 'nome', _plano.nome, 'preco_usuario', _plano.preco_usuario,
                                'limites', _plano.limites, 'email_caixas_incluidas', _plano.email_caixas_incluidas),
    'liberada', public.produto_conta_liberada(_conta.id),
    'crm', _conta.crm_ativo and public.produto_conta_liberada(_conta.id),
    'email', _conta.email_ativo and public.produto_conta_liberada(_conta.id),
    'dono_da_casa', public.produto_dono(),
    'pagamentos_ativos', _cfg.pagamentos_ativos,
    'tolerancia_dias', _cfg.tolerancia_dias,
    'equipe', (select coalesce(jsonb_agg(jsonb_build_object(
                  'id', m.id, 'user_id', m.user_id, 'nome', m.nome, 'email', case when _admin or m.user_id = _eu then m.email end,
                  'papel', m.papel, 'estado', m.estado, 'entrou_em', m.entrou_em) order by m.papel, m.nome), '[]'::jsonb)
                 from public.produto_membros m where m.conta_id = _conta.id and m.estado <> 'removido'),
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

-- ---------------------------------------------------------------------------
-- 9. O que o cliente faz por conta propria
-- ---------------------------------------------------------------------------
-- Preco da mensalidade de uma conta, do jeito que o checkout e o Financeiro leem.
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
       -- Caixas que o plano ja cobre: o que ele inclui por usuario contratado.
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
         -- A estrutura do e-mail e cobrada quando o plano nao inclui e-mail.
         select 2, 'email', 'E-mail profissional', 1, (select email_mensal from g)
          where (select email_ativo from c) and (select n from inclusas) = 0
         union all
         select 3, 'email_caixa_extra', 'Caixa de e-mail adicional',
                greatest(0, (select email_caixas_contratadas from c)
                            - case when (select n from inclusas) > 0 then (select n from inclusas)
                                   else (select email_caixas_no_mensal from g) end),
                (select email_caixa_extra from g)
          where (select email_ativo from c)
       )
  select coalesce(jsonb_agg(jsonb_build_object(
           'chave', chave, 'nome', nome, 'quantidade', quantidade, 'unitario', unitario,
           'total', round(quantidade * unitario, 2)) order by ordem), '[]'::jsonb)
    from linhas where quantidade > 0
$$;

revoke all on function public.produto_itens_da_conta(uuid) from public, anon, authenticated;
grant execute on function public.produto_itens_da_conta(uuid) to service_role;

create or replace function public.produto_valor_da_conta(_conta uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((i ->> 'total')::numeric), 0)
    from jsonb_array_elements(public.produto_itens_da_conta(_conta)) i
$$;

revoke all on function public.produto_valor_da_conta(uuid) from public, anon, authenticated;
grant execute on function public.produto_valor_da_conta(uuid) to service_role;

-- A pessoa abre a propria empresa (periodo de teste) e vira a administradora.
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

-- Quem foi convidado entra na empresa ao abrir o produto com o e-mail confirmado.
create or replace function public.produto_aceitar_convite()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _eu uuid := auth.uid();
  _usuario record;
  _m public.produto_membros;
begin
  select u.email, u.email_confirmed_at into _usuario from auth.users u where u.id = _eu;
  if _usuario.email is null or _usuario.email_confirmed_at is null then
    return null;
  end if;
  if exists (select 1 from public.produto_membros m where m.user_id = _eu and m.estado = 'ativo') then
    return (select m.conta_id from public.produto_membros m where m.user_id = _eu and m.estado = 'ativo' limit 1);
  end if;
  select * into _m from public.produto_membros m
   where m.estado = 'convidado' and m.email = lower(_usuario.email)
   order by m.convidado_em desc limit 1 for update;
  if _m.id is null then
    return null;
  end if;
  update public.produto_membros
     set user_id = _eu, estado = 'ativo', entrou_em = now(),
         nome = case when btrim(nome) = '' then coalesce((select pr.full_name from public.profiles pr where pr.id = _eu), '') else nome end
   where id = _m.id;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_m.conta_id, _eu, 'membro_entrou', jsonb_build_object('membro', _m.id));
  return _m.conta_id;
end;
$$;

-- Quem foi convidado pode recusar: o lugar volta para a empresa.
create or replace function public.produto_recusar_convite()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _email text;
begin
  select lower(u.email) into _email from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
  if _email is null then
    return;
  end if;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  select m.conta_id, auth.uid(), 'convite_recusado', jsonb_build_object('membro', m.id)
    from public.produto_membros m where m.estado = 'convidado' and m.email = _email;
  update public.produto_membros set estado = 'removido' where estado = 'convidado' and email = _email;
end;
$$;

-- A pessoa sai da empresa por conta propria (a ultima administradora nao sai: a empresa ficaria sem dono).
create or replace function public.produto_sair()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _m public.produto_membros;
begin
  select * into _m from public.produto_membros where user_id = auth.uid() and estado = 'ativo' limit 1 for update;
  if _m.id is null then
    return;
  end if;
  if _m.papel = 'admin' and not exists (
    select 1 from public.produto_membros x where x.conta_id = _m.conta_id and x.estado = 'ativo' and x.papel = 'admin' and x.id <> _m.id
  ) then
    raise exception 'Você é a única pessoa que administra a empresa. Passe a administração para alguém antes de sair.' using errcode = 'P0001';
  end if;
  update public.produto_membros set estado = 'removido' where id = _m.id;
  update public.crm_leads set owner_id = null where conta_id = _m.conta_id and owner_id = _m.user_id;
  update public.crm_activities set owner_id = null where conta_id = _m.conta_id and owner_id = _m.user_id and done_at is null;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_m.conta_id, auth.uid(), 'membro_saiu', jsonb_build_object('membro', _m.id));
end;
$$;

-- Os precos que o cliente pode ver (sem os custos da casa).
create or replace function public.produto_precos()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'pagamentos_ativos', g.pagamentos_ativos, 'teste_dias', g.teste_dias, 'tolerancia_dias', g.tolerancia_dias,
    'email_migracao', g.email_migracao, 'email_mensal', g.email_mensal,
    'email_caixas_no_mensal', g.email_caixas_no_mensal, 'email_caixa_extra', g.email_caixa_extra)
    from public.produto_config g where g.id
$$;

-- Convite: reserva o lugar. O e-mail sai pela funcao do produto.
create or replace function public.produto_convidar(_email text, _nome text default '', _papel text default 'usuario')
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
  if coalesce(_papel, 'usuario') not in ('admin', 'usuario') then
    raise exception 'Papel inválido.' using errcode = 'P0001';
  end if;
  select * into _c from public.produto_contas where id = _conta for update;
  if exists (select 1 from public.produto_membros m where m.conta_id = _conta and m.email = _limpo and m.estado <> 'removido') then
    raise exception 'Essa pessoa já está na empresa.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.produto_membros m where m.email = _limpo and m.estado = 'ativo') then
    raise exception 'Esse e-mail já usa o produto em outra empresa.' using errcode = 'P0001';
  end if;
  select count(*) into _ocupados from public.produto_membros m where m.conta_id = _conta and m.estado <> 'removido';
  if _ocupados >= _c.usuarios_contratados then
    raise exception 'Todos os % usuários do plano estão em uso. Aumente os usuários para convidar.', _c.usuarios_contratados using errcode = 'P0001';
  end if;
  insert into public.produto_membros (conta_id, email, nome, papel, estado, convidado_por)
  values (_conta, _limpo, left(btrim(coalesce(_nome, '')), 120), coalesce(_papel, 'usuario'), 'convidado', _eu)
  returning id into _id;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_conta, _eu, 'membro_convidado', jsonb_build_object('membro', _id, 'papel', coalesce(_papel, 'usuario')));
  return _id;
end;
$$;

create or replace function public.produto_membro_mudar(_membro uuid, _papel text default null, _remover boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _eu uuid := auth.uid();
  _m public.produto_membros;
  _admins integer;
begin
  select * into _m from public.produto_membros where id = _membro for update;
  if _m.id is null or not public.produto_sou_admin_da_conta(_m.conta_id) then
    raise exception 'Só quem administra a empresa altera a equipe.' using errcode = '42501';
  end if;
  select count(*) into _admins from public.produto_membros m
   where m.conta_id = _m.conta_id and m.estado = 'ativo' and m.papel = 'admin' and m.id <> _m.id;
  if _m.papel = 'admin' and _m.estado = 'ativo' and _admins = 0
     and (_remover or coalesce(_papel, 'admin') <> 'admin') then
    raise exception 'A empresa precisa de pelo menos uma pessoa administradora.' using errcode = 'P0001';
  end if;
  if _remover then
    update public.produto_membros set estado = 'removido' where id = _m.id;
    -- Os negocios da pessoa ficam sem dono, para a equipe redistribuir.
    update public.crm_leads set owner_id = null where conta_id = _m.conta_id and owner_id = _m.user_id;
    update public.crm_activities set owner_id = null where conta_id = _m.conta_id and owner_id = _m.user_id and done_at is null;
    insert into public.produto_historico (conta_id, ator, acao, detalhe)
    values (_m.conta_id, _eu, 'membro_removido', jsonb_build_object('membro', _m.id));
  elsif _papel in ('admin', 'usuario') then
    update public.produto_membros set papel = _papel where id = _m.id;
    insert into public.produto_historico (conta_id, ator, acao, detalhe)
    values (_m.conta_id, _eu, 'membro_papel', jsonb_build_object('membro', _m.id, 'papel', _papel));
  end if;
end;
$$;

-- O perfil da empresa: nicho e objetivo de listas fechadas, e um nome proprio (curto) para cada etapa do funil.
create or replace function public.produto_perfil_valido(_p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'nicho', case when _p ->> 'nicho' in ('imobiliaria', 'saude', 'servicos', 'varejo', 'agencia', 'educacao', 'b2b', 'outro') then _p ->> 'nicho' end,
    'objetivo', case when _p ->> 'objetivo' in ('organizar', 'prospectar', 'equipe', 'pos_venda') then _p ->> 'objetivo' end,
    'etapas', (
      select case when count(*) > 0 then jsonb_object_agg(e.chave, left(btrim(e.valor), 24)) end
        from jsonb_each_text(case when jsonb_typeof(_p -> 'etapas') = 'object' then _p -> 'etapas' else '{}'::jsonb end) as e(chave, valor)
       where e.chave in ('novo', 'contato', 'diagnostico', 'proposta', 'negociacao', 'ganho', 'perdido')
         and length(btrim(e.valor)) between 2 and 24
    )
  ))
$$;

revoke all on function public.produto_perfil_valido(jsonb) from public, anon;
grant execute on function public.produto_perfil_valido(jsonb) to authenticated, service_role;

-- So entra o que a tela de personalizacao oferece: cor da lista, logo em imagem pequena e nome curto.
create or replace function public.produto_aparencia_valida(_a jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'cor', case when _a ->> 'cor' in ('verde', 'azul', 'roxo', 'laranja', 'rosa', 'ciano') then _a ->> 'cor' end,
    'nome_curto', nullif(left(btrim(coalesce(_a ->> 'nome_curto', '')), 40), ''),
    'logo', case when _a ->> 'logo' ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$' and length(_a ->> 'logo') <= 160000
                 then _a ->> 'logo' end
  ))
$$;

revoke all on function public.produto_aparencia_valida(jsonb) from public, anon;
grant execute on function public.produto_aparencia_valida(jsonb) to authenticated, service_role;

create or replace function public.produto_conta_salvar(_dados jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _conta uuid := public.produto_minha_conta();
begin
  if _conta is null or not public.produto_sou_admin_da_conta(_conta) then
    raise exception 'Só quem administra a empresa altera os dados.' using errcode = '42501';
  end if;
  update public.produto_contas set
    nome = case when _dados ? 'nome' and length(btrim(_dados ->> 'nome')) >= 2 then left(btrim(_dados ->> 'nome'), 120) else nome end,
    documento = case when _dados ? 'documento' then nullif(regexp_replace(coalesce(_dados ->> 'documento', ''), '\D', '', 'g'), '') else documento end,
    telefone = case when _dados ? 'telefone' then nullif(btrim(coalesce(_dados ->> 'telefone', '')), '') else telefone end,
    email_cobranca = case when _dados ? 'email_cobranca' and lower(btrim(_dados ->> 'email_cobranca')) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
                          then lower(btrim(_dados ->> 'email_cobranca')) else email_cobranca end,
    visibilidade = case when _dados ->> 'visibilidade' in ('todos', 'proprios') then _dados ->> 'visibilidade' else visibilidade end,
    aparencia = case when _dados ? 'aparencia' then public.produto_aparencia_valida(_dados -> 'aparencia') else aparencia end,
    perfil = case when _dados ? 'perfil' then public.produto_perfil_valido(_dados -> 'perfil') else perfil end,
    atualizado_em = now()
  where id = _conta;
end;
$$;

-- O cliente pede uma caixa nova; a casa cria no provedor e marca como ativa.
create or replace function public.produto_email_pedir_caixa(_endereco text, _pessoa text default '')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  _conta uuid := public.produto_minha_conta();
  _d public.produto_email_dominios;
  _limpo text := lower(btrim(coalesce(_endereco, '')));
  _id uuid;
begin
  if _conta is null or not public.produto_sou_admin_da_conta(_conta) then
    raise exception 'Só quem administra a empresa pede caixas.' using errcode = '42501';
  end if;
  select * into _d from public.produto_email_dominios
   where conta_id = _conta and dominio = split_part(_limpo, '@', 2) limit 1;
  if _d.id is null then
    raise exception 'O endereço precisa ser de um domínio da empresa.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.produto_email_caixas x where x.endereco = _limpo and x.estado <> 'removida') then
    raise exception 'Esse endereço já existe.' using errcode = 'P0001';
  end if;
  insert into public.produto_email_caixas (dominio_id, conta_id, endereco, pessoa, estado, pedido_por)
  values (_d.id, _conta, _limpo, left(btrim(coalesce(_pessoa, '')), 120), 'pedida', auth.uid())
  returning id into _id;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_conta, auth.uid(), 'email_caixa_pedida', jsonb_build_object('caixa', _id));
  return _id;
end;
$$;

-- O e-mail da empresa como ela pode ver: sem as anotacoes internas da casa.
create or replace function public.produto_email_da_conta()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _conta uuid := public.produto_minha_conta();
begin
  if _conta is null then
    raise exception 'Sem empresa.' using errcode = '42501';
  end if;
  return jsonb_build_object(
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

-- ---------------------------------------------------------------------------
-- 10. O que a casa le: contas e faturamento do produto
-- ---------------------------------------------------------------------------
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
      'visibilidade', c.visibilidade, 'origem', c.origem, 'observacao', c.observacao, 'criado_em', c.criado_em,
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

-- Faturamento e custo do produto num mes (para o Financeiro da casa).
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
    from public.produto_contas c where c.estado in ('ativa', 'atrasada');

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

do $$
declare _f text;
begin
  foreach _f in array array[
    'produto_estado()', 'produto_criar_conta(text, text, text, text, integer, jsonb)', 'produto_aceitar_convite()',
    'produto_convidar(text, text, text)', 'produto_membro_mudar(uuid, text, boolean)', 'produto_conta_salvar(jsonb)',
    'produto_email_pedir_caixa(text, text)', 'produto_email_da_conta()', 'produto_recusar_convite()', 'produto_sair()', 'produto_precos()', 'produto_admin_contas()', 'produto_faturamento(date)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', _f);
    execute format('grant execute on function public.%s to authenticated', _f);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. A casa fica sabendo: empresa nova, pedido de caixa, pagamento e atraso
-- ---------------------------------------------------------------------------
create or replace function public.produto_avisar_casa(_mensagem text, _link text default '/produto')
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (user_id, message, notification_type, link)
  select distinct r.user_id, left(_mensagem, 280), 'produto', coalesce(_link, '/produto')
    from public.user_roles r where r.role = 'admin'::public.app_role
$$;

revoke all on function public.produto_avisar_casa(text, text) from public, anon, authenticated;
grant execute on function public.produto_avisar_casa(text, text) to service_role;

create or replace function public.produto_conta_nova_avisa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.origem = 'site' then
    perform public.produto_avisar_casa(format('CRM: %s abriu uma conta em teste.', new.nome), '/produto');
  end if;
  return new;
end;
$$;

revoke all on function public.produto_conta_nova_avisa() from public, anon, authenticated;

drop trigger if exists produto_conta_nova_avisa_trg on public.produto_contas;
create trigger produto_conta_nova_avisa_trg
  after insert on public.produto_contas
  for each row execute function public.produto_conta_nova_avisa();

create or replace function public.produto_caixa_pedida_avisa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estado = 'pedida' and new.pedido_por is not null then
    perform public.produto_avisar_casa(
      format('E-mail: %s pediu a caixa %s.', (select c.nome from public.produto_contas c where c.id = new.conta_id), new.endereco),
      '/produto?area=email');
  end if;
  return new;
end;
$$;

revoke all on function public.produto_caixa_pedida_avisa() from public, anon, authenticated;

drop trigger if exists produto_caixa_pedida_avisa_trg on public.produto_email_caixas;
create trigger produto_caixa_pedida_avisa_trg
  after insert on public.produto_email_caixas
  for each row execute function public.produto_caixa_pedida_avisa();

-- ---------------------------------------------------------------------------
-- 12. Chaves de API da empresa (para o site, automacoes, Claude e ChatGPT)
-- ---------------------------------------------------------------------------
create table if not exists public.produto_chaves_api (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid not null references public.produto_contas(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 2 and 60),
  -- Os primeiros caracteres, para a pessoa reconhecer a chave. A chave inteira nunca e guardada.
  prefixo text not null,
  hash text not null unique,
  criado_por uuid,
  criado_em timestamptz not null default now(),
  ultimo_uso_em timestamptz,
  revogada_em timestamptz
);

create index if not exists produto_chaves_api_da_conta on public.produto_chaves_api (conta_id, criado_em desc);

alter table public.produto_chaves_api enable row level security;
revoke all on public.produto_chaves_api from anon, authenticated;
-- A tela le a lista sem a coluna do hash.
grant select (id, conta_id, nome, prefixo, criado_por, criado_em, ultimo_uso_em, revogada_em) on public.produto_chaves_api to authenticated;

drop policy if exists "produto chaves do admin da conta" on public.produto_chaves_api;
create policy "produto chaves do admin da conta" on public.produto_chaves_api
  for select to authenticated using (public.produto_sou_admin_da_conta(conta_id));

-- Cria a chave e devolve o texto dela UMA vez. No banco fica so o resumo (sha256).
create or replace function public.produto_chave_criar(_nome text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _conta uuid := public.produto_minha_conta();
  _chave text := 'acq_' || replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  _id uuid;
begin
  if _conta is null or not public.produto_sou_admin_da_conta(_conta) then
    raise exception 'Só quem administra a empresa cria chaves.' using errcode = '42501';
  end if;
  if length(btrim(coalesce(_nome, ''))) < 2 then
    raise exception 'Dê um nome à chave, para saber onde ela é usada.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.produto_chaves_api k where k.conta_id = _conta and k.revogada_em is null) >= 10 then
    raise exception 'A empresa já tem 10 chaves ativas. Revogue uma antes de criar outra.' using errcode = 'P0001';
  end if;
  insert into public.produto_chaves_api (conta_id, nome, prefixo, hash, criado_por)
  values (_conta, left(btrim(_nome), 60), left(_chave, 12), encode(sha256(convert_to(_chave, 'UTF8')), 'hex'), auth.uid())
  returning id into _id;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_conta, auth.uid(), 'chave_criada', jsonb_build_object('chave', _id));
  return jsonb_build_object('id', _id, 'chave', _chave);
end;
$$;

create or replace function public.produto_chave_revogar(_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _k public.produto_chaves_api;
begin
  select * into _k from public.produto_chaves_api where id = _id for update;
  if _k.id is null or not public.produto_sou_admin_da_conta(_k.conta_id) then
    raise exception 'Só quem administra a empresa revoga chaves.' using errcode = '42501';
  end if;
  update public.produto_chaves_api set revogada_em = coalesce(revogada_em, now()) where id = _id;
  insert into public.produto_historico (conta_id, ator, acao, detalhe)
  values (_k.conta_id, auth.uid(), 'chave_revogada', jsonb_build_object('chave', _id));
end;
$$;

-- A funcao da API confere a chave pelo resumo: devolve a empresa so se a chave vale e o CRM esta liberado.
create or replace function public.produto_chave_usar(_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _k public.produto_chaves_api;
  _c public.produto_contas;
begin
  select * into _k from public.produto_chaves_api where hash = _hash and revogada_em is null;
  if _k.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'chave_invalida');
  end if;
  select * into _c from public.produto_contas where id = _k.conta_id;
  if _c.id is null or not _c.crm_ativo or not public.produto_conta_liberada(_c.id) then
    return jsonb_build_object('ok', false, 'motivo', 'conta_bloqueada');
  end if;
  -- O ultimo uso e anotado no maximo uma vez por minuto, para a API nao escrever a cada chamada.
  if _k.ultimo_uso_em is null or _k.ultimo_uso_em < now() - interval '1 minute' then
    update public.produto_chaves_api set ultimo_uso_em = now() where id = _k.id;
  end if;
  return jsonb_build_object('ok', true, 'conta_id', _c.id, 'conta', _c.nome, 'chave_id', _k.id, 'criado_por', _k.criado_por,
                            'etapas', coalesce(_c.perfil -> 'etapas', '{}'::jsonb));
end;
$$;

revoke all on function public.produto_chave_criar(text) from public, anon;
grant execute on function public.produto_chave_criar(text) to authenticated;
revoke all on function public.produto_chave_revogar(uuid) from public, anon;
grant execute on function public.produto_chave_revogar(uuid) to authenticated;
revoke all on function public.produto_chave_usar(text) from public, anon, authenticated;
grant execute on function public.produto_chave_usar(text) to service_role;
