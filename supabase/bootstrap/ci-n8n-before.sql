-- CI ONLY. Staged by scripts/prepare-ci-n8n-replay.mjs into the empty CI database,
-- right before 20261104140829_n8n_avisa_no_sino.sql. Never applied in production.
-- Em produção o schema acq_n8n nasce do repositório do n8n (lf-N8N), fora deste ledger;
-- o banco vazio do CI precisa só das duas tabelas em que a migration pendura gatilhos.
-- Fonte conferida: __SOURCE_SHA256__
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

revoke all on schema acq_n8n from public, anon, authenticated;
