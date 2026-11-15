-- ACQ n8n — entender imagem, vídeo e documento dos grupos (11/11/2026, pedido do Almir: "ler imagens, áudios e
-- vídeos, entender o contexto e guardar no projeto do cliente"). O leitor baixa a mídia; o ACQ-12 descreve a imagem
-- ou os quadros do vídeo com um modelo de visão e grava a descrição aqui; o resumo do dia passa a ler a descrição.
-- O arquivo do cliente é guardado no painel pela Clio (pasta Materiais do projeto) e o id volta para cá.
-- Só o schema isolado acq_n8n.

alter table acq_n8n.mensagens_entrada
  add column if not exists descricao_midia text,
  add column if not exists midia jsonb,
  add column if not exists midia_em timestamptz;

-- O que o ACQ-12 precisa saber da mensagem antes de descrever. `guardar` = material enviado pelo cliente (o que a
-- própria agência manda no grupo é descrito, mas não vira arquivo do cliente). Projeto: o ativo mais recente; sem
-- ativo, o em planejamento.
create or replace function acq_n8n.midia_ler(_provedor text, _msg text)
returns jsonb language sql stable security definer set search_path = acq_n8n, public as $$
  select coalesce((
    select jsonb_build_object('existe', true, 'id', m.id, 'client_id', m.client_id, 'cliente', split_part(g.rotulo, ' - ', 1),
      'papel', m.papel, 'tipo', m.tipo, 'legenda', m.texto, 'nome', m.remetente_nome,
      'quando', to_char(m.occurred_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24:MI'),
      'descricao', m.descricao_midia, 'midia', m.midia,
      'guardar', m.client_id is not null and m.papel like 'cliente%' and m.tipo in ('imagem', 'video', 'documento'),
      'project_id', (select pr.id from public.projects pr where pr.client_id = m.client_id and pr.status in ('active', 'planning')
                      order by case pr.status when 'active' then 0 else 1 end, pr.created_at desc limit 1))
      from acq_n8n.mensagens_entrada m
      left join acq_n8n.grupos_cliente g on g.provedor = m.provedor and g.group_id = m.group_id
     where m.provedor = _provedor and m.provider_message_id = _msg
  ), jsonb_build_object('existe', false));
$$;

-- Grava a descrição uma vez (a primeira vale: repetir a entrega não troca o texto nem reabre o resumo).
create or replace function acq_n8n.midia_registrar(_provedor text, _msg text, _descricao text, _meta jsonb)
returns jsonb language plpgsql security definer set search_path = acq_n8n, public as $$
declare _m acq_n8n.mensagens_entrada; _novo boolean := false;
begin
  select * into _m from acq_n8n.mensagens_entrada where provedor = _provedor and provider_message_id = _msg for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'mensagem_nao_registrada'); end if;
  if _m.midia_em is null then
    update acq_n8n.mensagens_entrada
       set descricao_midia = nullif(btrim(left(coalesce(_descricao, ''), 2400)), ''),
           midia = coalesce(_meta, '{}'::jsonb), media_hash = coalesce(media_hash, _meta->>'hash'), midia_em = now()
     where id = _m.id;
    _novo := true;
  end if;
  return acq_n8n.midia_ler(_provedor, _msg) || jsonb_build_object('ok', true, 'novo', _novo);
end $$;

-- A Clio guardou o arquivo no painel: anota o id do arquivo na mensagem.
create or replace function acq_n8n.midia_arquivo(_provedor text, _msg text, _file_id uuid)
returns jsonb language plpgsql security definer set search_path = acq_n8n, public as $$
begin
  update acq_n8n.mensagens_entrada
     set midia = coalesce(midia, '{}'::jsonb) || jsonb_build_object('arquivo_id', _file_id, 'arquivo_em', now())
   where provedor = _provedor and provider_message_id = _msg;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'mensagem_nao_registrada'); end if;
  return jsonb_build_object('ok', true, 'arquivo_id', _file_id);
end $$;

-- Resumo do dia: a mensagem com mídia entra com a descrição do que foi enviado; mídia descrita nunca é tratada
-- como ruído; e a descrição que chega depois do último resumo reabre o dia (midia_em conta como novidade).
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
  order by d.dia, d.rotulo;
$$;
revoke execute on all functions in schema acq_n8n from public;
grant execute on all functions in schema acq_n8n to acq_n8n_worker;
