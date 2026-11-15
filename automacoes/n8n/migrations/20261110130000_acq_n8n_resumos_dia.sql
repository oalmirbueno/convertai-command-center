-- ACQ n8n — resumo do dia das conversas dos grupos, por cliente (ACQ-09, pedido do Almir em 09/11/2026).
-- Só o schema isolado acq_n8n. Um resumo por cliente por dia: o novo SUBSTITUI o anterior, nunca soma.

create table if not exists acq_n8n.resumos_dia (
  client_id uuid not null,
  dia date not null,
  estado text not null check (estado in ('ok', 'sem_novidade', 'sem_conferencia', 'falhou_redacao')),
  conteudo jsonb not null,
  texto text not null default '',
  hash text not null,
  mensagens integer not null default 0,
  versao integer not null default 1,
  gerado_em timestamptz not null default now(),
  dossie_em timestamptz,
  primary key (client_id, dia)
);

-- Dias que precisam de resumo: têm mensagem com texto recebida depois do último resumo daquele dia.
-- O dia é o de São Paulo. Roda de novo sem efeito quando não chegou nada novo.
create or replace function acq_n8n.resumo_dias_pendentes(_provedor text, _desde date)
returns table (client_id uuid, rotulo text, dia date, mensagens jsonb, anteriores jsonb) language sql stable as $$
  with base as (
    select g.client_id, g.rotulo, (m.occurred_at at time zone 'America/Sao_Paulo')::date as dia, m.provider_message_id, m.occurred_at,
           m.received_at, m.papel, m.remetente_nome, m.tipo, m.transcricao, m.texto, m.classificacao
      from acq_n8n.grupos_cliente g
      join acq_n8n.mensagens_entrada m on m.provedor = g.provedor and m.group_id = g.group_id
     where g.provedor = _provedor and g.leitura_liberada
       and (m.occurred_at at time zone 'America/Sao_Paulo')::date >= _desde
       and coalesce(m.transcricao, m.texto) is not null
       and (m.tipo <> 'audio' or m.transcricao_status <> 'pendente')
  ), dias as (
    select b.client_id, b.rotulo, b.dia, max(b.received_at) as ultima from base b group by 1, 2, 3
  )
  select d.client_id, d.rotulo, d.dia,
    (select jsonb_agg(jsonb_build_object('id', b.provider_message_id, 'hora', to_char(b.occurred_at at time zone 'America/Sao_Paulo', 'HH24:MI'),
        'papel', b.papel, 'nome', b.remetente_nome, 'tipo', b.tipo, 'audio', b.tipo = 'audio', 'texto', coalesce(b.transcricao, b.texto),
        'jev', b.classificacao->>'tipo') order by b.occurred_at)
       from base b where b.client_id = d.client_id and b.dia = d.dia),
    (select coalesce(jsonb_agg(jsonb_build_object('dia', r.dia, 'texto', r.texto) order by r.dia desc), '[]'::jsonb)
       from acq_n8n.resumos_dia r where r.client_id = d.client_id and r.dia < d.dia and r.dia >= d.dia - 6 and r.texto <> '')
  from dias d
  left join acq_n8n.resumos_dia r on r.client_id = d.client_id and r.dia = d.dia
  where r.client_id is null or d.ultima > r.gerado_em
  order by d.dia, d.rotulo;
$$;

create or replace function acq_n8n.resumo_gravar(_client uuid, _dia date, _estado text, _conteudo jsonb, _texto text, _hash text, _mensagens integer)
returns jsonb language plpgsql as $$
declare _ex acq_n8n.resumos_dia;
begin
  select * into _ex from acq_n8n.resumos_dia where client_id = _client and dia = _dia for update;
  if not found then
    insert into acq_n8n.resumos_dia (client_id, dia, estado, conteudo, texto, hash, mensagens) values (_client, _dia, _estado, _conteudo, coalesce(_texto, ''), _hash, _mensagens);
    return jsonb_build_object('novo', true, 'mudou', true, 'versao', 1);
  end if;
  -- Falha de redação ou de conferência nunca apaga um resumo bom que já existe: só registra que tentou.
  if _estado in ('sem_conferencia', 'falhou_redacao') and _ex.estado in ('ok', 'sem_novidade') then
    return jsonb_build_object('novo', false, 'mudou', false, 'versao', _ex.versao, 'mantido', true);
  end if;
  if _ex.hash = _hash then
    update acq_n8n.resumos_dia set gerado_em = now(), mensagens = _mensagens where client_id = _client and dia = _dia;
    return jsonb_build_object('novo', false, 'mudou', false, 'versao', _ex.versao);
  end if;
  update acq_n8n.resumos_dia set estado = _estado, conteudo = _conteudo, texto = coalesce(_texto, ''), hash = _hash, mensagens = _mensagens,
    versao = versao + 1, gerado_em = now(), dossie_em = null where client_id = _client and dia = _dia;
  return jsonb_build_object('novo', false, 'mudou', true, 'versao', _ex.versao + 1);
end $$;

create or replace function acq_n8n.resumo_semana(_client uuid, _ate date, _dias integer)
returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('dia', r.dia, 'texto', r.texto) order by r.dia desc), '[]'::jsonb)
    from acq_n8n.resumos_dia r where r.client_id = _client and r.dia <= _ate and r.dia > _ate - _dias and r.estado = 'ok' and r.texto <> '';
$$;

create or replace function acq_n8n.resumo_dossie_ok(_client uuid, _dia date)
returns jsonb language plpgsql as $$
begin
  update acq_n8n.resumos_dia set dossie_em = now() where client_id = _client and dia = _dia;
  return jsonb_build_object('gravado', found);
end $$;

grant select, insert, update on all tables in schema acq_n8n to acq_n8n_worker;
grant execute on all functions in schema acq_n8n to acq_n8n_worker;
revoke all on all tables in schema acq_n8n from anon, authenticated;
revoke execute on all functions in schema acq_n8n from public;
grant execute on all functions in schema acq_n8n to acq_n8n_worker;
