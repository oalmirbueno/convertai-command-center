-- ACQ n8n — situação dos grupos e resumo que se refaz (18/11/2026).
-- Pedido do Almir: "melhorar a leitura, entender o que eu envio e como eu respondo, deixar mais inteligente e
-- sempre atualizado". Duas coisas, só no schema isolado acq_n8n:
-- 1) grupos_situacao: por cliente, quem está esperando resposta da agência, há quanto tempo, e o tempo que a
--    agência costuma levar para responder. É conta, não julgamento: usa a ordem das mensagens e a classificação
--    que o Jev já deu (cumprimento e emoji não contam como mensagem do cliente).
-- 2) resumo_dias_pendentes: dia que falhou na redação (ex.: modelo sem crédito em 17 e 18/11) volta a ser
--    pendente e se refaz sozinho na rodada seguinte, em vez de ficar parado até chegar mensagem nova.

create or replace function acq_n8n.grupos_situacao(_dias int default 7)
returns table (client_id uuid, cliente text, conversas int, respondidas int, mediana_resposta_min int,
  esperando_desde timestamptz, esperando_mensagens int, esperando_texto text, esperando_quem text,
  ultima_do_cliente timestamptz, ultima_da_agencia timestamptz)
language sql stable security definer set search_path = acq_n8n, public as $$
  with m as (
    select g.client_id, split_part(g.rotulo, ' - ', 1) as cliente, x.occurred_at, x.papel, x.remetente_nome,
           coalesce(x.transcricao, x.texto, x.descricao_midia, '[' || x.tipo || ']') as txt
      from acq_n8n.grupos_cliente g
      join acq_n8n.mensagens_entrada x on x.provedor = g.provedor and x.group_id = g.group_id
     where g.leitura_liberada and x.occurred_at > now() - make_interval(days => greatest(_dias, 1))
       and (x.papel = 'agencia'
            or (x.papel like 'cliente%' and (coalesce(x.classificacao->>'tipo', '') <> 'ruido' or x.descricao_midia is not null)))
  ), s as (
    select m.*, lag(m.papel) over w as antes,
           min(m.occurred_at) filter (where m.papel = 'agencia') over (partition by m.client_id order by m.occurred_at rows between 1 following and unbounded following) as prox_ag
      from m window w as (partition by m.client_id order by m.occurred_at)
  ), blocos as (
    -- Uma "conversa" começa quando o cliente fala depois da agência (ou abre o período) e termina na resposta dela.
    select s.client_id, s.cliente, s.occurred_at as inicio, s.prox_ag from s where s.papel like 'cliente%' and (s.antes is null or s.antes = 'agencia')
  ), aberto as (
    select s.client_id, min(s.occurred_at) as desde, count(*)::int as n,
           (array_agg(left(regexp_replace(s.txt, '\s+', ' ', 'g'), 240) order by s.occurred_at desc))[1] as texto,
           (array_agg(s.remetente_nome order by s.occurred_at desc))[1] as quem
      from s where s.papel like 'cliente%' and s.prox_ag is null group by s.client_id
  )
  select b.client_id, b.cliente, count(*)::int, count(b.prox_ag)::int,
         round((percentile_cont(0.5) within group (order by extract(epoch from b.prox_ag - b.inicio) / 60) filter (where b.prox_ag is not null))::numeric)::int,
         a.desde, coalesce(a.n, 0), a.texto, a.quem,
         (select max(m.occurred_at) from m where m.client_id = b.client_id and m.papel like 'cliente%'),
         (select max(m.occurred_at) from m where m.client_id = b.client_id and m.papel = 'agencia')
    from blocos b left join aberto a on a.client_id = b.client_id
   group by b.client_id, b.cliente, a.desde, a.n, a.texto, a.quem
   order by a.desde nulls last, b.cliente;
$$;

drop function if exists acq_n8n.resumo_dias_pendentes(text, date);
create function acq_n8n.resumo_dias_pendentes(_provedor text, _desde date)
returns table (client_id uuid, rotulo text, dia date, mensagens jsonb, anteriores jsonb, ja_registrados jsonb) language sql stable as $$
  with base as (
    select g.client_id, g.rotulo, (m.occurred_at at time zone 'America/Sao_Paulo')::date as dia, m.provider_message_id, m.occurred_at,
           greatest(m.received_at, coalesce(m.midia_em, m.received_at)) as received_at, m.papel, m.remetente_nome, m.tipo, m.transcricao, m.texto,
           m.classificacao, m.descricao_midia
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
        'papel', b.papel, 'nome', b.remetente_nome, 'tipo', b.tipo, 'audio', b.tipo = 'audio',
        'texto', coalesce(nullif(concat_ws(' ', coalesce(b.transcricao, b.texto),
                   case when b.descricao_midia is not null then '[' || b.tipo || ' enviada, descrição automática: ' || b.descricao_midia || ']' end), ''),
                 '[' || b.tipo || ' sem legenda]'),
        'jev', case when b.descricao_midia is not null and b.classificacao->>'tipo' = 'ruido' then 'midia' else b.classificacao->>'tipo' end) order by b.occurred_at)
       from base b where b.client_id = d.client_id and b.dia = d.dia),
    (select coalesce(jsonb_agg(jsonb_build_object('dia', r2.dia, 'texto', r2.texto) order by r2.dia desc), '[]'::jsonb)
       from acq_n8n.resumos_dia r2 where r2.client_id = d.client_id and r2.dia < d.dia and r2.dia >= d.dia - 6 and r2.texto <> ''),
    coalesce((select jsonb_agg(jsonb_build_object('tipo', i->>'tipo', 'texto', i->>'texto')) from jsonb_array_elements(coalesce(r.conteudo->'itens', '[]'::jsonb)) i), '[]'::jsonb)
  from dias d
  left join acq_n8n.resumos_dia r on r.client_id = d.client_id and r.dia = d.dia
  where r.client_id is null or d.ultima > r.gerado_em or (r.estado = 'ok' and r.dossie_em is null)
     or r.estado in ('falhou_redacao', 'sem_conferencia')
  order by d.dia, d.rotulo;
$$;
revoke execute on all functions in schema acq_n8n from public;
grant execute on all functions in schema acq_n8n to acq_n8n_worker;
