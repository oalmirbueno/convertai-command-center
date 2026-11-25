-- CI ONLY. Staged by scripts/prepare-ci-n8n-replay.mjs into the empty CI database,
-- right before 20261104140829_n8n_avisa_no_sino.sql. Never applied in production.
-- Em produção o schema acq_n8n nasce do repositório do n8n (lf-N8N), fora deste ledger;
-- o banco vazio do CI precisa só das duas tabelas em que a migration pendura gatilhos
-- e das duas relações que as funções LANGUAGE sql do intermediador validam ao nascer.
-- Fonte conferida: __SOURCE_SHA256__
-- Intermediador conferido: __INTERMEDIADOR_SHA256__
create schema if not exists acq_n8n;

create table if not exists acq_n8n.propostas (
  id uuid primary key default gen_random_uuid(),
  workflow_id text not null,
  client_id uuid not null,
  tipo text not null,
  referencia text not null,
  idempotency_key text not null,
  base_versao integer,
  conteudo jsonb not null default '{}'::jsonb,
  hash text not null,
  estado text not null,
  motivo text,
  ambiente text not null,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);

create table if not exists acq_n8n.incidentes (
  incident_key text primary key,
  workflow_id text not null,
  client_id uuid,
  severidade text not null,
  titulo text not null,
  detalhe jsonb not null default '{}'::jsonb,
  estado text not null,
  ocorrencias integer not null default 1,
  primeiro_em timestamptz not null default now(),
  ultimo_em timestamptz not null default now(),
  resolvido_em timestamptz,
  resolucao text
);

-- 20261125120000_intermediador_dos_grupos.sql cria funções LANGUAGE sql que leem estas
-- relações; o Postgres confere tabela, coluna e tipo de retorno já no CREATE FUNCTION.
-- Só as colunas que essas funções citam, com os tipos da DDL oficial do lf-N8N
-- (automacoes/n8n/migrations 20261014120000, 20261109230000 e 20261111120000).
-- Vazias, sem dados e sem grant. Sem acq_n8n.grupos_situacao, public.grupos_ao_vivo()
-- segue respondendo { "disponivel": false } no CI.
create table if not exists acq_n8n.grupos_cliente (
  group_id text,
  client_id uuid,
  rotulo text,
  leitura_liberada boolean,
  aprovado_em timestamptz
);

create table if not exists acq_n8n.mensagens_entrada (
  provider_message_id text,
  group_id text,
  client_id uuid,
  remetente text,
  remetente_nome text,
  papel text,
  tipo text,
  texto text,
  transcricao text,
  transcricao_status text,
  descricao_midia text,
  resposta_a text,
  occurred_at timestamptz,
  received_at timestamptz
);

revoke all on schema acq_n8n from public, anon, authenticated;
