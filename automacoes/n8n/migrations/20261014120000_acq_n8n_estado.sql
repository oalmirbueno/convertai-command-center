-- ACQ n8n — estado persistente dos cinco workflows.
-- Aplicada no projeto jjjtkowvxemvituvywvf em 14/10/2026 com autorização explícita do Almir
-- (schema isolado acq_n8n; nenhuma tabela do painel é tocada). Fica fora de supabase/migrations de
-- propósito: não entra no manifesto, no deploy nem no CI. Remoção: drop schema acq_n8n cascade.
--
-- Por que Postgres: a deduplicação precisa sobreviver a reinício do n8n e a execuções
-- concorrentes; unique index + INSERT ... ON CONFLICT e UPDATE ... FOR UPDATE SKIP LOCKED
-- dão isso. Data Tables do n8n e static data não garantem atomicidade.
--
-- Isolamento: schema próprio (acq_n8n), fora das tabelas do painel; o n8n entra com um
-- papel dedicado (acq_n8n_worker) que só enxerga este schema. Nada aqui escreve em tabela
-- do painel: o painel continua sendo a fonte dos estados e aprovações.

create schema if not exists acq_n8n;

-- ============================================================ eventos (contrato comum)
create table if not exists acq_n8n.eventos (
  id bigserial primary key,
  schema_version text not null,
  event_id uuid not null unique,
  workflow_id text not null,
  run_id text not null,
  client_id uuid,
  entity_type text not null,
  entity_id text not null,
  occurred_at timestamptz not null,
  observed_at timestamptz not null,
  source text not null,
  source_version text,
  correlation_id text,
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  tipo text not null,
  payload jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  ambiente text not null check (ambiente in ('test', 'pilot', 'production')),
  registrado_em timestamptz not null default now(),
  constraint eventos_idem unique (workflow_id, idempotency_key)
);
create index if not exists eventos_cliente_tipo on acq_n8n.eventos (client_id, tipo, registrado_em desc);

-- Registra um evento uma única vez. Replay devolve o existente; mesma chave com payload
-- diferente é conflito (não sobrescreve).
create or replace function acq_n8n.registrar_evento(_e jsonb, _ambiente text)
returns jsonb language plpgsql as $$
declare
  _id bigint;
  _hash text;
begin
  insert into acq_n8n.eventos (schema_version, event_id, workflow_id, run_id, client_id, entity_type, entity_id,
    occurred_at, observed_at, source, source_version, correlation_id, idempotency_key, evidence_refs, tipo,
    payload, payload_hash, ambiente)
  values (_e->>'schema_version', (_e->>'event_id')::uuid, _e->>'workflow_id', _e->>'run_id',
    nullif(_e->>'client_id', '')::uuid, _e->>'entity_type', _e->>'entity_id', (_e->>'occurred_at')::timestamptz,
    (_e->>'observed_at')::timestamptz, _e->>'source', _e->>'source_version', _e->>'correlation_id',
    _e->>'idempotency_key', coalesce(_e->'evidence_refs', '[]'::jsonb), coalesce(_e->>'tipo', _e->>'entity_type'),
    coalesce(_e->'payload', '{}'::jsonb), _e->>'payload_hash', _ambiente)
  on conflict do nothing
  returning id into _id;
  if _id is not null then
    return jsonb_build_object('novo', true, 'id', _id, 'event_id', _e->>'event_id');
  end if;
  select id, payload_hash into _id, _hash from acq_n8n.eventos
   where workflow_id = _e->>'workflow_id' and idempotency_key = _e->>'idempotency_key';
  if _id is null then
    -- event_id colidiu com outra chave: não acontece com event_id derivado da chave.
    select id, payload_hash into _id, _hash from acq_n8n.eventos where event_id = (_e->>'event_id')::uuid;
  end if;
  return jsonb_build_object('novo', false, 'id', _id, 'event_id', _e->>'event_id',
    'conflito', _hash is distinct from _e->>'payload_hash');
end $$;

-- ============================================================ cursores (com compare-and-set)
create table if not exists acq_n8n.cursores (
  workflow_id text not null,
  chave text not null,
  valor jsonb not null,
  versao integer not null default 1,
  atualizado_em timestamptz not null default now(),
  primary key (workflow_id, chave)
);

create or replace function acq_n8n.cursor_ler(_wf text, _chave text)
returns jsonb language sql stable as $$
  select coalesce((select jsonb_build_object('existe', true, 'valor', valor, 'versao', versao, 'atualizado_em', atualizado_em)
    from acq_n8n.cursores where workflow_id = _wf and chave = _chave), jsonb_build_object('existe', false, 'versao', 0));
$$;

-- Avança só se a versão lida ainda for a atual (0 = cursor novo). Duas execuções que leram
-- a mesma versão: apenas uma avança; a outra recebe avancou=false e não anuncia nada.
create or replace function acq_n8n.cursor_avancar(_wf text, _chave text, _versao_lida integer, _valor jsonb)
returns jsonb language plpgsql as $$
declare _v integer;
begin
  if _versao_lida = 0 then
    insert into acq_n8n.cursores (workflow_id, chave, valor) values (_wf, _chave, _valor)
    on conflict do nothing returning versao into _v;
  else
    update acq_n8n.cursores set valor = _valor, versao = versao + 1, atualizado_em = now()
     where workflow_id = _wf and chave = _chave and versao = _versao_lida
    returning versao into _v;
  end if;
  return jsonb_build_object('avancou', _v is not null, 'versao', _v);
end $$;

-- ============================================================ observações (sem mudança, sem aviso)
create table if not exists acq_n8n.observacoes (
  workflow_id text not null,
  client_id uuid not null,
  chave text not null,
  hash text not null,
  dados jsonb not null default '{}'::jsonb,
  observado_em timestamptz not null default now(),
  mudou_em timestamptz not null default now(),
  primary key (workflow_id, client_id, chave)
);

create or replace function acq_n8n.observar(_wf text, _client uuid, _chave text, _hash text, _dados jsonb)
returns jsonb language plpgsql as $$
declare _anterior acq_n8n.observacoes;
begin
  select * into _anterior from acq_n8n.observacoes where workflow_id = _wf and client_id = _client and chave = _chave for update;
  if not found then
    insert into acq_n8n.observacoes (workflow_id, client_id, chave, hash, dados) values (_wf, _client, _chave, _hash, _dados)
    on conflict (workflow_id, client_id, chave) do nothing;
    if not found then
      return jsonb_build_object('mudou', false, 'primeira', false, 'concorrente', true);
    end if;
    return jsonb_build_object('mudou', true, 'primeira', true);
  end if;
  if _anterior.hash = _hash then
    update acq_n8n.observacoes set observado_em = now() where workflow_id = _wf and client_id = _client and chave = _chave;
    return jsonb_build_object('mudou', false, 'primeira', false, 'desde', _anterior.mudou_em);
  end if;
  update acq_n8n.observacoes set hash = _hash, dados = _dados, observado_em = now(), mudou_em = now()
   where workflow_id = _wf and client_id = _client and chave = _chave;
  return jsonb_build_object('mudou', true, 'primeira', false, 'anterior', _anterior.dados, 'anterior_em', _anterior.mudou_em);
end $$;

-- ============================================================ incidentes (deduplicados)
create table if not exists acq_n8n.incidentes (
  incident_key text primary key,
  workflow_id text not null,
  client_id uuid,
  severidade text not null check (severidade in ('info', 'aviso', 'alto', 'critico')),
  titulo text not null,
  detalhe jsonb not null default '{}'::jsonb,
  estado text not null default 'aberto' check (estado in ('aberto', 'resolvido')),
  ocorrencias integer not null default 1,
  primeiro_em timestamptz not null default now(),
  ultimo_em timestamptz not null default now(),
  resolvido_em timestamptz,
  resolucao text
);

-- notificar=true só quando o incidente nasce, reabre ou sobe de severidade.
create or replace function acq_n8n.incidente_registrar(_key text, _wf text, _client uuid, _sev text, _titulo text, _detalhe jsonb)
returns jsonb language plpgsql as $$
declare _i acq_n8n.incidentes; _rank jsonb := '{"info":0,"aviso":1,"alto":2,"critico":3}';
begin
  insert into acq_n8n.incidentes (incident_key, workflow_id, client_id, severidade, titulo, detalhe)
  values (_key, _wf, _client, _sev, _titulo, coalesce(_detalhe, '{}'::jsonb))
  on conflict (incident_key) do nothing;
  if found then
    return jsonb_build_object('novo', true, 'reaberto', false, 'notificar', true, 'ocorrencias', 1);
  end if;
  select * into _i from acq_n8n.incidentes where incident_key = _key for update;
  update acq_n8n.incidentes set ocorrencias = ocorrencias + 1, ultimo_em = now(), detalhe = coalesce(_detalhe, detalhe),
    severidade = case when (_rank->>_sev)::int > (_rank->>severidade)::int then _sev else severidade end,
    estado = 'aberto', resolvido_em = null, resolucao = null
   where incident_key = _key;
  return jsonb_build_object('novo', false, 'reaberto', _i.estado = 'resolvido',
    'notificar', _i.estado = 'resolvido' or (_rank->>_sev)::int > (_rank->>_i.severidade)::int,
    'ocorrencias', _i.ocorrencias + 1);
end $$;

create or replace function acq_n8n.incidente_resolver(_key text, _resolucao text)
returns jsonb language plpgsql as $$
begin
  update acq_n8n.incidentes set estado = 'resolvido', resolvido_em = now(), resolucao = _resolucao
   where incident_key = _key and estado = 'aberto';
  return jsonb_build_object('resolvido', found);
end $$;

-- ============================================================ propostas (saídas locais / homologação)
create table if not exists acq_n8n.propostas (
  id uuid primary key default gen_random_uuid(),
  workflow_id text not null,
  client_id uuid not null,
  tipo text not null check (tipo in ('contexto', 'ritual', 'pedido_revisao', 'aviso_publicacao', 'pauta_dia',
    'reconciliacao_dia', 'contexto_conversa', 'excecao_editorial')),
  referencia text not null,
  idempotency_key text not null unique,
  base_versao integer,
  conteudo jsonb not null,
  hash text not null,
  estado text not null default 'proposta' check (estado in ('proposta', 'em_revisao', 'aplicada', 'descartada',
    'substituida', 'conflito_versao', 'aguardando_extensao_revisao', 'bloqueada')),
  motivo text,
  ambiente text not null check (ambiente in ('test', 'pilot', 'production')),
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create index if not exists propostas_cliente on acq_n8n.propostas (client_id, tipo, criada_em desc);

create or replace function acq_n8n.proposta_registrar(_p jsonb)
returns jsonb language plpgsql as $$
declare _id uuid; _ex acq_n8n.propostas;
begin
  insert into acq_n8n.propostas (workflow_id, client_id, tipo, referencia, idempotency_key, base_versao, conteudo, hash, estado, motivo, ambiente)
  values (_p->>'workflow_id', (_p->>'client_id')::uuid, _p->>'tipo', _p->>'referencia', _p->>'idempotency_key',
    nullif(_p->>'base_versao', '')::int, _p->'conteudo', _p->>'hash', coalesce(_p->>'estado', 'proposta'), _p->>'motivo', _p->>'ambiente')
  on conflict (idempotency_key) do nothing returning id into _id;
  if _id is not null then
    -- Uma proposta nova da mesma referência substitui as anteriores ainda abertas.
    update acq_n8n.propostas set estado = 'substituida', atualizada_em = now()
     where client_id = (_p->>'client_id')::uuid and tipo = _p->>'tipo' and referencia = _p->>'referencia'
       and id <> _id and estado in ('proposta', 'em_revisao', 'conflito_versao');
    return jsonb_build_object('novo', true, 'id', _id);
  end if;
  select * into _ex from acq_n8n.propostas where idempotency_key = _p->>'idempotency_key';
  return jsonb_build_object('novo', false, 'id', _ex.id, 'estado', _ex.estado);
end $$;

create or replace function acq_n8n.proposta_mudar_estado(_id uuid, _de text[], _para text, _motivo text)
returns jsonb language plpgsql as $$
begin
  update acq_n8n.propostas set estado = _para, motivo = coalesce(_motivo, motivo), atualizada_em = now()
   where id = _id and estado = any(_de);
  return jsonb_build_object('mudou', found);
end $$;

-- ============================================================ destinos aprovados (identidade técnica)
-- Nome de grupo não é identificador: o envio usa destino_tecnico (JID/ID do provedor), aprovado
-- por uma pessoa com evidência. A resolução é por igualdade exata (client_id + rótulo).
create table if not exists acq_n8n.destinos_aprovados (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  canal text not null check (canal in ('whatsapp_grupo', 'whatsapp_contato', 'teste')),
  provedor text not null,
  rotulo text not null,
  destino_tecnico text not null,
  aprovado_por text not null,
  aprovado_em timestamptz not null,
  evidencia text not null check (length(evidencia) >= 3),
  ativo boolean not null default true,
  unique (provedor, destino_tecnico)
);
create unique index if not exists destinos_rotulo_ativo on acq_n8n.destinos_aprovados (client_id, rotulo) where ativo;

-- ============================================================ saídas (despachante único)
create table if not exists acq_n8n.saidas (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  origem text not null check (origem in ('central_review', 'aviso_publicacao')),
  ambiente text not null check (ambiente in ('test', 'pilot', 'production')),
  approval_id uuid,
  report_id uuid,
  client_id uuid not null,
  payload_version integer,
  payload_hash text not null,
  payload jsonb not null,
  destino_rotulo text not null,
  destino_id uuid references acq_n8n.destinos_aprovados (id),
  valid_until timestamptz,
  estado text not null default 'pendente' check (estado in ('pendente', 'reivindicada', 'enviando', 'aceita', 'entregue',
    'lida', 'envio_incerto', 'falhou', 'bloqueada', 'simulada', 'invalidada')),
  motivo text,
  lease_dono text,
  lease_ate timestamptz,
  tentativas integer not null default 0,
  provedor text,
  provider_message_id text,
  aceita_em timestamptz,
  entregue_em timestamptz,
  lida_em timestamptz,
  painel_registrado_em timestamptz,
  painel_tentativas integer not null default 0,
  painel_erro text,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now(),
  -- payload congelado: não se edita depois de enfileirado
  constraint saida_payload_hash_ok check (length(payload_hash) = 64)
);
create unique index if not exists saidas_provider_msg on acq_n8n.saidas (provedor, provider_message_id) where provider_message_id is not null;
create index if not exists saidas_estado on acq_n8n.saidas (estado, criada_em);

create or replace function acq_n8n.saida_imutavel() returns trigger language plpgsql as $$
begin
  if new.payload is distinct from old.payload or new.payload_hash is distinct from old.payload_hash
     or new.approval_id is distinct from old.approval_id or new.client_id is distinct from old.client_id
     or new.destino_rotulo is distinct from old.destino_rotulo or new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'ACQ_SAIDA_CONGELADA';
  end if;
  new.atualizada_em := now();
  return new;
end $$;
drop trigger if exists saida_imutavel on acq_n8n.saidas;
create trigger saida_imutavel before update on acq_n8n.saidas for each row execute function acq_n8n.saida_imutavel();

create or replace function acq_n8n.saida_enfileirar(_s jsonb)
returns jsonb language plpgsql as $$
declare _id uuid; _ex acq_n8n.saidas;
begin
  insert into acq_n8n.saidas (idempotency_key, origem, ambiente, approval_id, report_id, client_id, payload_version,
    payload_hash, payload, destino_rotulo, valid_until)
  values (_s->>'idempotency_key', _s->>'origem', _s->>'ambiente', nullif(_s->>'approval_id', '')::uuid,
    nullif(_s->>'report_id', '')::uuid, (_s->>'client_id')::uuid, nullif(_s->>'payload_version', '')::int,
    _s->>'payload_hash', _s->'payload', _s->>'destino_rotulo', nullif(_s->>'valid_until', '')::timestamptz)
  on conflict (idempotency_key) do nothing returning id into _id;
  if _id is not null then return jsonb_build_object('novo', true, 'id', _id); end if;
  select * into _ex from acq_n8n.saidas where idempotency_key = _s->>'idempotency_key';
  return jsonb_build_object('novo', false, 'id', _ex.id, 'estado', _ex.estado);
end $$;

-- Reivindicação atômica: um consumidor por saída. SKIP LOCKED evita que duas execuções
-- peguem a mesma linha; a lease expira e a linha volta ao jogo só se o envio não começou.
create or replace function acq_n8n.saida_reivindicar(_dono text, _lease_segundos integer, _limite integer, _ambiente text)
returns setof acq_n8n.saidas language sql as $$
  update acq_n8n.saidas s set estado = 'reivindicada', lease_dono = _dono,
    lease_ate = now() + make_interval(secs => _lease_segundos), tentativas = s.tentativas + 1
   where s.id in (
     select id from acq_n8n.saidas
      where ambiente = _ambiente and (estado = 'pendente' or (estado = 'reivindicada' and lease_ate < now()))
      order by criada_em
      for update skip locked
      limit _limite)
  returning s.*;
$$;

-- Ponto sem volta: daqui em diante uma falha sem resposta vira envio_incerto, nunca reenvio.
create or replace function acq_n8n.saida_iniciar_envio(_id uuid, _dono text, _destino_id uuid, _provedor text)
returns jsonb language plpgsql as $$
begin
  update acq_n8n.saidas set estado = 'enviando', destino_id = _destino_id, provedor = _provedor
   where id = _id and estado = 'reivindicada' and lease_dono = _dono and lease_ate > now();
  return jsonb_build_object('pode_enviar', found);
end $$;

create or replace function acq_n8n.saida_concluir_sem_envio(_id uuid, _dono text, _estado text, _motivo text)
returns jsonb language plpgsql as $$
begin
  if _estado not in ('bloqueada', 'simulada', 'invalidada') then raise exception 'ACQ_ESTADO_INVALIDO'; end if;
  update acq_n8n.saidas set estado = _estado, motivo = _motivo, lease_dono = null, lease_ate = null
   where id = _id and estado = 'reivindicada' and lease_dono = _dono;
  return jsonb_build_object('mudou', found);
end $$;

-- resultado: 'aceita' (com provider_message_id), 'rejeitada' (provedor recusou de forma explícita,
-- nada saiu) ou 'incerta' (timeout/5xx/rede depois de iniciar: não se sabe se saiu).
create or replace function acq_n8n.saida_resultado_transporte(_id uuid, _dono text, _resultado text, _provider_message_id text, _motivo text)
returns jsonb language plpgsql as $$
declare _novo text;
begin
  _novo := case _resultado when 'aceita' then 'aceita' when 'rejeitada' then 'falhou' when 'incerta' then 'envio_incerto' else null end;
  if _novo is null then raise exception 'ACQ_RESULTADO_INVALIDO'; end if;
  if _novo = 'aceita' and coalesce(_provider_message_id, '') = '' then raise exception 'ACQ_ACEITE_SEM_ID'; end if;
  update acq_n8n.saidas set estado = _novo, provider_message_id = coalesce(_provider_message_id, provider_message_id),
    aceita_em = case when _novo = 'aceita' then now() else aceita_em end, motivo = _motivo, lease_ate = null
   where id = _id and estado = 'enviando' and lease_dono = _dono;
  return jsonb_build_object('gravado', found, 'estado', _novo);
end $$;

-- Envios presos em 'enviando' (o n8n caiu no meio) viram incertos, nunca voltam para a fila.
create or replace function acq_n8n.saida_expirar_envios()
returns jsonb language sql as $$
  with x as (
    update acq_n8n.saidas set estado = 'envio_incerto', motivo = 'execucao_interrompida_durante_envio'
     where estado = 'enviando' and lease_ate < now() returning id)
  select jsonb_build_object('incertos', count(*)) from x;
$$;

-- Conciliação humana/provedor de um envio incerto: só com evidência e id do provedor.
create or replace function acq_n8n.saida_conciliar_incerta(_id uuid, _saiu boolean, _provider_message_id text, _evidencia text)
returns jsonb language plpgsql as $$
begin
  if length(coalesce(_evidencia, '')) < 3 then raise exception 'ACQ_EVIDENCIA_OBRIGATORIA'; end if;
  update acq_n8n.saidas set estado = case when _saiu then 'aceita' else 'falhou' end,
    provider_message_id = case when _saiu then _provider_message_id else provider_message_id end,
    aceita_em = case when _saiu then now() else aceita_em end, motivo = 'conciliado: ' || _evidencia
   where id = _id and estado = 'envio_incerto' and (not _saiu or coalesce(_provider_message_id, '') <> '');
  return jsonb_build_object('conciliado', found);
end $$;

create or replace function acq_n8n.saida_registro_painel(_id uuid, _ok boolean, _erro text)
returns jsonb language plpgsql as $$
begin
  update acq_n8n.saidas set painel_registrado_em = case when _ok then now() else painel_registrado_em end,
    painel_tentativas = painel_tentativas + 1, painel_erro = case when _ok then null else _erro end
   where id = _id and estado in ('aceita', 'entregue', 'lida') and painel_registrado_em is null;
  return jsonb_build_object('gravado', found);
end $$;

-- ============================================================ recibos do provedor
create table if not exists acq_n8n.recibos (
  id bigserial primary key,
  provedor text not null,
  provider_message_id text not null,
  status text not null check (status in ('aceita', 'entregue', 'lida', 'falhou')),
  ocorrido_em timestamptz not null,
  recebido_em timestamptz not null default now(),
  bruto jsonb not null default '{}'::jsonb,
  unique (provedor, provider_message_id, status)
);

-- Callbacks duplicados não contam duas vezes; fora de ordem não regridem o estado.
create or replace function acq_n8n.recibo_registrar(_provedor text, _msg text, _status text, _ocorrido timestamptz, _bruto jsonb)
returns jsonb language plpgsql as $$
declare _rank jsonb := '{"aceita":1,"entregue":2,"lida":3}'; _s acq_n8n.saidas; _novo text;
begin
  insert into acq_n8n.recibos (provedor, provider_message_id, status, ocorrido_em, bruto)
  values (_provedor, _msg, _status, _ocorrido, coalesce(_bruto, '{}'::jsonb))
  on conflict (provedor, provider_message_id, status) do nothing;
  if not found then return jsonb_build_object('duplicado', true); end if;
  select * into _s from acq_n8n.saidas where provedor = _provedor and provider_message_id = _msg for update;
  if not found then return jsonb_build_object('duplicado', false, 'saida', null, 'orfao', true); end if;
  if _status = 'falhou' then
    return jsonb_build_object('duplicado', false, 'saida', _s.id, 'estado', _s.estado, 'aviso', 'falha_pos_aceite_registrada');
  end if;
  _novo := case when coalesce((_rank->>_s.estado)::int, 0) >= (_rank->>_status)::int then _s.estado else _status end;
  update acq_n8n.saidas set estado = case when _s.estado in ('aceita', 'entregue', 'lida', 'envio_incerto') then _novo else estado end,
    aceita_em = coalesce(aceita_em, case when _s.estado = 'envio_incerto' then _ocorrido end),
    entregue_em = case when _status = 'entregue' then coalesce(entregue_em, _ocorrido) else entregue_em end,
    lida_em = case when _status = 'lida' then coalesce(lida_em, _ocorrido) else lida_em end
   where id = _s.id;
  return jsonb_build_object('duplicado', false, 'saida', _s.id, 'estado_anterior', _s.estado, 'estado', _novo);
end $$;

-- ============================================================ conversas (workflow 04)
create table if not exists acq_n8n.grupos_cliente (
  provedor text not null,
  group_id text not null,
  client_id uuid not null,
  rotulo text not null,
  leitura_liberada boolean not null default false,
  aprovado_por text not null,
  aprovado_em timestamptz not null,
  primary key (provedor, group_id)
);

create table if not exists acq_n8n.remetentes (
  id bigserial primary key,
  provedor text not null,
  remetente text not null,
  client_id uuid,
  papel text not null check (papel in ('cliente_decisor', 'cliente_equipe', 'agencia', 'bot')),
  nome text,
  -- client_id nulo só para agência/bot (valem em qualquer grupo)
  constraint remetente_cliente_ou_global check (client_id is not null or papel in ('agencia', 'bot'))
);
create unique index if not exists remetentes_unico on acq_n8n.remetentes
  (provedor, remetente, coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table if not exists acq_n8n.mensagens_entrada (
  id uuid primary key default gen_random_uuid(),
  provedor text not null,
  provider_message_id text not null,
  group_id text,
  client_id uuid,
  remetente text not null,
  papel text,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  tipo text not null check (tipo in ('texto', 'audio', 'imagem', 'video', 'documento', 'outro')),
  texto text,
  media_id text,
  media_hash text,
  transcricao text,
  transcricao_status text not null default 'nao_aplicavel'
    check (transcricao_status in ('nao_aplicavel', 'pendente', 'ok', 'ilegivel', 'falhou')),
  classificacao jsonb,
  estado text not null default 'recebida' check (estado in ('recebida', 'processada', 'em_revisao', 'descartada')),
  motivo text,
  event_id uuid,
  unique (provedor, provider_message_id)
);
create index if not exists mensagens_grupo_tempo on acq_n8n.mensagens_entrada (group_id, occurred_at desc);

-- Registro durável antes de confirmar o webhook. Resolve grupo→cliente e remetente→papel por
-- igualdade exata; grupo sem vínculo aprovado fica sem cliente e vai para revisão.
create or replace function acq_n8n.mensagem_registrar(_m jsonb)
returns jsonb language plpgsql as $$
declare _id uuid; _g acq_n8n.grupos_cliente; _papel text; _ex acq_n8n.mensagens_entrada;
begin
  select * into _g from acq_n8n.grupos_cliente where provedor = _m->>'provedor' and group_id = _m->>'group_id';
  select papel into _papel from acq_n8n.remetentes
   where provedor = _m->>'provedor' and remetente = _m->>'remetente' and (client_id = _g.client_id or papel in ('agencia', 'bot'))
   order by case papel when 'bot' then 0 else 1 end limit 1;
  insert into acq_n8n.mensagens_entrada (provedor, provider_message_id, group_id, client_id, remetente, papel, occurred_at,
    tipo, texto, media_id, transcricao_status, estado, motivo)
  values (_m->>'provedor', _m->>'provider_message_id', _m->>'group_id',
    case when _g.leitura_liberada then _g.client_id end, _m->>'remetente', _papel, (_m->>'occurred_at')::timestamptz,
    _m->>'tipo', _m->>'texto', _m->>'media_id',
    case when _m->>'tipo' = 'audio' then 'pendente' else 'nao_aplicavel' end,
    case when _papel = 'bot' then 'descartada' when _g.client_id is null or not _g.leitura_liberada then 'em_revisao'
         when _papel is null then 'em_revisao' else 'recebida' end,
    case when _papel = 'bot' then 'mensagem_do_proprio_bot' when _g.client_id is null then 'grupo_sem_vinculo_aprovado'
         when not _g.leitura_liberada then 'leitura_do_grupo_nao_liberada'
         when _papel is null then 'remetente_desconhecido' end)
  on conflict (provedor, provider_message_id) do nothing returning id into _id;
  if _id is not null then
    select * into _ex from acq_n8n.mensagens_entrada where id = _id;
    return jsonb_build_object('novo', true, 'id', _id, 'client_id', _ex.client_id, 'papel', _ex.papel, 'estado', _ex.estado, 'motivo', _ex.motivo);
  end if;
  select * into _ex from acq_n8n.mensagens_entrada where provedor = _m->>'provedor' and provider_message_id = _m->>'provider_message_id';
  return jsonb_build_object('novo', false, 'id', _ex.id, 'client_id', _ex.client_id, 'papel', _ex.papel, 'estado', _ex.estado, 'motivo', 'duplicada');
end $$;

create or replace function acq_n8n.mensagem_transcricao(_id uuid, _status text, _texto text, _media_hash text)
returns jsonb language plpgsql as $$
begin
  update acq_n8n.mensagens_entrada set transcricao_status = _status, transcricao = _texto, media_hash = coalesce(_media_hash, media_hash),
    estado = case when _status in ('ilegivel', 'falhou') then 'em_revisao' else estado end,
    motivo = case when _status in ('ilegivel', 'falhou') then 'audio_' || _status else motivo end
   where id = _id and transcricao_status in ('pendente', 'falhou');
  return jsonb_build_object('gravado', found);
end $$;

-- Desfecho do processamento. Só sai de 'recebida'; reprocessar a mesma mensagem não muda nada.
create or replace function acq_n8n.mensagem_concluir(_id uuid, _estado text, _motivo text, _classificacao jsonb, _event uuid)
returns jsonb language plpgsql as $$
begin
  if _estado not in ('processada', 'em_revisao', 'descartada') then raise exception 'ACQ_ESTADO_INVALIDO'; end if;
  update acq_n8n.mensagens_entrada set estado = _estado, motivo = _motivo, classificacao = _classificacao, event_id = _event
   where id = _id and estado = 'recebida';
  return jsonb_build_object('gravado', found);
end $$;

-- Fatos por cliente: um evento atrasado nunca sobrescreve um fato mais recente.
create table if not exists acq_n8n.fatos_cliente (
  client_id uuid not null,
  chave text not null,
  valor jsonb not null,
  occurred_at timestamptz not null,
  fonte_event_id uuid,
  atualizado_em timestamptz not null default now(),
  primary key (client_id, chave)
);

create or replace function acq_n8n.fato_propor(_client uuid, _chave text, _valor jsonb, _occurred timestamptz, _event uuid)
returns jsonb language plpgsql as $$
declare _atual acq_n8n.fatos_cliente;
begin
  insert into acq_n8n.fatos_cliente (client_id, chave, valor, occurred_at, fonte_event_id)
  values (_client, _chave, _valor, _occurred, _event)
  on conflict (client_id, chave) do update set valor = excluded.valor, occurred_at = excluded.occurred_at,
    fonte_event_id = excluded.fonte_event_id, atualizado_em = now()
   where acq_n8n.fatos_cliente.occurred_at < excluded.occurred_at;
  if found then return jsonb_build_object('aplicado', true); end if;
  select * into _atual from acq_n8n.fatos_cliente where client_id = _client and chave = _chave;
  return jsonb_build_object('aplicado', false, 'motivo', 'fato_mais_recente_existente', 'atual_em', _atual.occurred_at, 'atual', _atual.valor);
end $$;

-- ============================================================ papel do n8n
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'acq_n8n_worker') then
    create role acq_n8n_worker nologin;
  end if;
end $$;
revoke all on schema acq_n8n from public;
grant usage on schema acq_n8n to acq_n8n_worker;
grant select, insert, update on all tables in schema acq_n8n to acq_n8n_worker;
grant usage on all sequences in schema acq_n8n to acq_n8n_worker;
grant execute on all functions in schema acq_n8n to acq_n8n_worker;
-- Sem DELETE: histórico de envio, recibo e incidente não se apaga pela automação.
-- Os papéis públicos do painel (Supabase) nunca enxergam este schema.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema acq_n8n from anon, authenticated';
    execute 'revoke all on schema acq_n8n from anon, authenticated';
  end if;
end $$;
revoke execute on all functions in schema acq_n8n from public;
grant execute on all functions in schema acq_n8n to acq_n8n_worker;
