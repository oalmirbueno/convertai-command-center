-- ACQ n8n — o resumo passa a rodar três vezes ao dia (11/11/2026, pedido do Almir: ver os grupos durante o dia).
-- Para a fila da Clio não encher de item repetido com outra redação, a rodada recebe os itens já escritos no dia
-- (ja_registrados) e o modelo repete o texto do que continua valendo. Só o schema isolado acq_n8n.

drop function if exists acq_n8n.resumo_dias_pendentes(text, date);
create function acq_n8n.resumo_dias_pendentes(_provedor text, _desde date)
returns table (client_id uuid, rotulo text, dia date, mensagens jsonb, anteriores jsonb, ja_registrados jsonb) language sql stable as $$
  with base as (
    select g.client_id, g.rotulo, (m.occurred_at at time zone 'America/Sao_Paulo')::date as dia, m.provider_message_id, m.occurred_at,
           m.received_at, m.papel, m.remetente_nome, m.tipo, m.transcricao, m.texto, m.classificacao
      from acq_n8n.grupos_cliente g
      join acq_n8n.mensagens_entrada m on m.provedor = g.provedor and m.group_id = g.group_id
     where g.provedor = _provedor and g.leitura_liberada
       and (m.occurred_at at time zone 'America/Sao_Paulo')::date >= _desde
       and (coalesce(m.transcricao, m.texto) is not null or m.tipo in ('imagem', 'video', 'documento'))
       and (m.tipo <> 'audio' or m.transcricao_status <> 'pendente')
  ), dias as (
    select b.client_id, b.rotulo, b.dia, max(b.received_at) as ultima from base b group by 1, 2, 3
  )
  select d.client_id, d.rotulo, d.dia,
    (select jsonb_agg(jsonb_build_object('id', b.provider_message_id, 'hora', to_char(b.occurred_at at time zone 'America/Sao_Paulo', 'HH24:MI'),
        'papel', b.papel, 'nome', b.remetente_nome, 'tipo', b.tipo, 'audio', b.tipo = 'audio', 'texto', coalesce(b.transcricao, b.texto, '[' || b.tipo || ' sem legenda]'),
        'jev', b.classificacao->>'tipo') order by b.occurred_at)
       from base b where b.client_id = d.client_id and b.dia = d.dia),
    (select coalesce(jsonb_agg(jsonb_build_object('dia', r2.dia, 'texto', r2.texto) order by r2.dia desc), '[]'::jsonb)
       from acq_n8n.resumos_dia r2 where r2.client_id = d.client_id and r2.dia < d.dia and r2.dia >= d.dia - 6 and r2.texto <> ''),
    coalesce((select jsonb_agg(jsonb_build_object('tipo', i->>'tipo', 'texto', i->>'texto')) from jsonb_array_elements(coalesce(r.conteudo->'itens', '[]'::jsonb)) i), '[]'::jsonb)
  from dias d
  left join acq_n8n.resumos_dia r on r.client_id = d.client_id and r.dia = d.dia
  where r.client_id is null or d.ultima > r.gerado_em or (r.estado = 'ok' and r.dossie_em is null)
  order by d.dia, d.rotulo;
$$;
revoke execute on all functions in schema acq_n8n from public;
grant execute on all functions in schema acq_n8n to acq_n8n_worker;
