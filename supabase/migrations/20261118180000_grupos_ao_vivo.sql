-- Grupos dos clientes ao vivo (18/11/2026). Dono: "quero ver os grupos sempre atualizados, numa tela no painel".
-- Uma leitura só para a tela /grupos: por cliente, quem espera resposta da agência e desde quando, o tempo de
-- resposta, o resumo do dia (o que o n8n escreve e o Jev confere) e as últimas mensagens, com a transcrição dos
-- áudios e a descrição das imagens e dos vídeos.
--
-- Os dados moram no schema isolado acq_n8n (leitura dos grupos pelo n8n), que o navegador não enxerga. Esta função
-- é a única porta: só equipe (is_staff), só leitura. Onde o acq_n8n não existe (banco de teste), responde
-- { "disponivel": false } em vez de falhar; por isso é plpgsql (as tabelas só são procuradas na hora de rodar).

create or replace function public.grupos_ao_vivo()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  _clientes jsonb;
  _saude jsonb;
begin
  if not coalesce(public.is_staff(auth.uid()), false) then
    raise exception 'Somente a equipe vê os grupos.' using errcode = '42501';
  end if;
  if to_regclass('acq_n8n.mensagens_entrada') is null or to_regprocedure('acq_n8n.grupos_situacao(integer)') is null then
    return jsonb_build_object('disponivel', false);
  end if;

  select jsonb_build_object(
    'ultima_mensagem', (select max(m.received_at) from acq_n8n.mensagens_entrada m where m.provedor = 'baileys_3429'),
    'ultimo_resumo', (select max(r.gerado_em) from acq_n8n.resumos_dia r where r.estado = 'ok'),
    'resumos_com_falha', (select count(*) from acq_n8n.resumos_dia r
                           where r.estado in ('falhou_redacao', 'sem_conferencia') and r.dia >= (now() at time zone 'America/Sao_Paulo')::date - 1),
    'midias_24h', (select count(*) from acq_n8n.mensagens_entrada m
                    where m.provedor = 'baileys_3429' and m.tipo in ('imagem', 'video', 'documento') and m.received_at > now() - interval '24 hours'),
    'midias_entendidas_24h', (select count(*) from acq_n8n.mensagens_entrada m
                    where m.provedor = 'baileys_3429' and m.tipo in ('imagem', 'video', 'documento') and m.received_at > now() - interval '24 hours' and m.midia_em is not null)
  ) into _saude;

  select coalesce(jsonb_agg(c order by (c->>'esperando_desde') nulls last, c->>'cliente'), '[]'::jsonb) into _clientes
  from (
    select jsonb_build_object(
      'client_id', g.client_id,
      'cliente', btrim(split_part(g.rotulo, ' - ', 1)),
      'conversas', coalesce(s.conversas, 0),
      'respondidas', coalesce(s.respondidas, 0),
      'mediana_resposta_min', s.mediana_resposta_min,
      'esperando_desde', s.esperando_desde,
      'esperando_mensagens', coalesce(s.esperando_mensagens, 0),
      'esperando_texto', s.esperando_texto,
      'esperando_quem', s.esperando_quem,
      'ultima_do_cliente', s.ultima_do_cliente,
      'ultima_da_agencia', s.ultima_da_agencia,
      'mensagens_hoje', (select count(*) from acq_n8n.mensagens_entrada m
                          where m.provedor = g.provedor and m.group_id = g.group_id
                            and (m.occurred_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date),
      'tarefas_abertas', (select count(*) from public.tasks t join public.projects p on p.id = t.project_id
                           where p.client_id = g.client_id and t.origem_externa like 'grupo:%' and t.deleted_at is null and t.status not in ('done', 'cancelled')),
      'resumo', (select jsonb_build_object('dia', r.dia, 'gerado_em', r.gerado_em, 'no_dossie', r.dossie_em is not null,
                          'resumo', r.conteudo->>'resumo', 'itens', coalesce(r.conteudo->'itens', '[]'::jsonb), 'sugestoes', coalesce(r.conteudo->'sugestoes', '[]'::jsonb))
                   from acq_n8n.resumos_dia r
                  where r.client_id = g.client_id and r.estado = 'ok' and r.dia >= (now() at time zone 'America/Sao_Paulo')::date - 3
                  order by r.dia desc limit 1),
      'resumo_falhou_hoje', exists (select 1 from acq_n8n.resumos_dia r where r.client_id = g.client_id
                                     and r.dia = (now() at time zone 'America/Sao_Paulo')::date and r.estado in ('falhou_redacao', 'sem_conferencia')),
      'mensagens', (select coalesce(jsonb_agg(x.j order by x.quando), '[]'::jsonb) from (
                      select m.occurred_at as quando, jsonb_build_object('id', m.provider_message_id, 'quando', m.occurred_at, 'papel', m.papel, 'nome', m.remetente_nome,
                               'tipo', m.tipo, 'texto', left(coalesce(m.transcricao, m.texto), 1500), 'descricao', left(m.descricao_midia, 900),
                               'ruido', coalesce(m.classificacao->>'tipo', '') = 'ruido' and m.descricao_midia is null,
                               'guardada', m.midia->>'arquivo_id' is not null) as j
                        from acq_n8n.mensagens_entrada m
                       where m.provedor = g.provedor and m.group_id = g.group_id and m.occurred_at > now() - interval '3 days'
                       order by m.occurred_at desc limit 60) x)
    ) as c
    from acq_n8n.grupos_cliente g
    left join acq_n8n.grupos_situacao(7) s on s.client_id = g.client_id
    where g.provedor = 'baileys_3429' and g.leitura_liberada
  ) q;

  return jsonb_build_object('disponivel', true, 'gerado_em', now(), 'saude', _saude, 'clientes', _clientes);
end;
$$;

revoke all on function public.grupos_ao_vivo() from public, anon;
grant execute on function public.grupos_ao_vivo() to authenticated;
