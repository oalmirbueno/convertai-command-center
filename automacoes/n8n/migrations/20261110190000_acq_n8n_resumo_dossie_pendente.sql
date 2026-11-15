-- ACQ n8n — resumo do dia: o dossiê que ficou por gravar é tentado de novo na rodada seguinte (10/11/2026).
-- Antes, só o resumo que mudava ia para o dossiê: se a escrita falhasse (ou fosse simulada), nunca mais era tentada.
-- Só o schema isolado acq_n8n.

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
  where r.client_id is null or d.ultima > r.gerado_em or (r.estado = 'ok' and r.dossie_em is null)
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
    return jsonb_build_object('novo', false, 'mudou', false, 'versao', _ex.versao, 'dossie_pendente', _ex.estado = 'ok' and _ex.dossie_em is null);
  end if;
  update acq_n8n.resumos_dia set estado = _estado, conteudo = _conteudo, texto = coalesce(_texto, ''), hash = _hash, mensagens = _mensagens,
    versao = versao + 1, gerado_em = now(), dossie_em = null where client_id = _client and dia = _dia;
  return jsonb_build_object('novo', false, 'mudou', true, 'versao', _ex.versao + 1);
end $$;

-- A seção do dossiê leva os últimos dias de uma vez: gravar o dia mais novo quita os anteriores do mesmo cliente.
create or replace function acq_n8n.resumo_dossie_ok(_client uuid, _dia date)
returns jsonb language plpgsql as $$
begin
  update acq_n8n.resumos_dia set dossie_em = now() where client_id = _client and dia <= _dia and dossie_em is null and estado = 'ok';
  return jsonb_build_object('gravado', found);
end $$;

revoke execute on all functions in schema acq_n8n from public;
grant execute on all functions in schema acq_n8n to acq_n8n_worker;
