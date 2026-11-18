-- Monitor do produto CRM e E-mail (18/11/2026, pedido do dono: "uma área admin completa para eu
-- monitorar se está tudo em ordem e acompanhar o CRM de cada um em tempo real").
--
-- Duas leituras, só para a administração da casa:
--   produto_admin_monitor()            a saúde do produto (e-mails, cobrança, rotinas, integrações,
--                                      convites) e o movimento do CRM de cada empresa;
--   produto_admin_monitor_conta(conta) o funil, as pessoas e os últimos movimentos de uma empresa.
--
-- O que NÃO sai daqui: nome, telefone ou e-mail de lead. A casa acompanha números e movimento; o
-- conteúdo do CRM continua sendo da empresa. Nada é gravado: as duas funções só leem.

create or replace function public.produto_admin_monitor()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _hoje timestamptz := date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  _mes timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  _saude jsonb := '[]'::jsonb;
  _n integer; _m integer; _k integer; _t text; _q timestamptz; _v numeric;
begin
  if not public.produto_dono() then
    raise exception 'Só a administração.' using errcode = '42501';
  end if;

  -- 1. E-mails: o último estado de cada mensagem das últimas 24 horas.
  with ult as (
    select distinct on (coalesce(l.message_id, l.id::text)) l.status, l.error_message, l.created_at
      from public.email_send_log l
     where l.created_at > now() - interval '24 hours'
     order by coalesce(l.message_id, l.id::text), l.created_at desc
  )
  select count(*) filter (where status = 'sent'),
         count(*) filter (where status in ('dlq', 'failed', 'bounced') or (status = 'pending' and created_at < now() - interval '30 minutes'))
    into _n, _m from ult;
  select left(l.error_message, 160) into _t from public.email_send_log l
   where l.created_at > now() - interval '24 hours' and l.error_message is not null order by l.created_at desc limit 1;
  select max(l.created_at) into _q from public.email_send_log l where l.status = 'sent';
  _saude := _saude || jsonb_build_object(
    'chave', 'emails', 'titulo', 'E-mails',
    'nivel', case when _m > 0 and _n = 0 then 'problema' when _m > 0 then 'atencao' else 'ok' end,
    'resumo', case when _m > 0 and _n = 0 then format('Nenhum saiu em 24 horas; %s falharam', _m)
                   when _m > 0 then format('%s enviados e %s falharam em 24 horas', _n, _m)
                   when _n > 0 then format('%s enviados em 24 horas, sem falha', _n)
                   else 'Nenhum envio em 24 horas' end,
    'detalhe', case when _m > 0 then _t end, 'quando', _q, 'rotulo_quando', 'último envio');

  -- 2. Cobrança.
  select count(*) filter (where c.estado = 'atrasada'), count(*) filter (where c.estado = 'suspensa') into _n, _m from public.produto_contas c;
  select coalesce(sum(b.valor), 0) into _v from public.produto_cobrancas b where b.estado = 'atrasada';
  _saude := _saude || jsonb_build_object(
    'chave', 'cobranca', 'titulo', 'Cobrança',
    'nivel', case when _n > 0 or _m > 0 or _v > 0 then 'atencao' else 'ok' end,
    'resumo', case when _n > 0 or _m > 0 or _v > 0 then format('%s em atraso, %s suspensas', _n, _m) else 'Nenhuma empresa em atraso' end,
    'detalhe', case when _v > 0 then 'R$ ' || replace(to_char(_v, 'FM999999990.00'), '.', ',') || ' em cobranças atrasadas' end);

  -- 3. CRM pelo plano do cliente: acesso que acaba em até 5 dias sem o mês seguinte pago.
  select count(*), string_agg(c.nome, ', ' order by c.acesso_ate) into _n, _t from public.produto_contas c
   where c.cobranca_por = 'plano' and c.estado = 'ativa' and c.acesso_ate is not null and c.acesso_ate < now() + interval '5 days';
  _saude := _saude || jsonb_build_object(
    'chave', 'plano', 'titulo', 'CRM pelo plano do cliente',
    'nivel', case when _n > 0 then 'atencao' else 'ok' end,
    'resumo', case when _n > 0 then format('%s com acesso acabando em até 5 dias', _n) else 'Acessos em dia' end,
    'detalhe', case when _n > 0 then left(_t, 160) end);

  -- 4. Rotinas do produto (a última execução de cada uma).
  if to_regclass('cron.job') is not null then
    select count(*),
           count(*) filter (where u.status is not null and u.status <> 'succeeded'),
           string_agg(j.jobname, ', ') filter (where u.status is not null and u.status <> 'succeeded'),
           max(u.end_time)
      into _n, _m, _t, _q
      from cron.job j
      left join lateral (select d.status, d.end_time from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1) u on true
     where j.jobname in ('crm-automacoes-de-tempo', 'crm-conversoes-meta-2min', 'crm-whats-rotina-2min', 'produto-crm-plano-vigia', 'vigia-dos-emails');
    _saude := _saude || jsonb_build_object(
      'chave', 'rotinas', 'titulo', 'Rotinas automáticas',
      'nivel', case when _m > 0 then 'problema' when _n < 5 then 'atencao' else 'ok' end,
      'resumo', case when _m > 0 then format('%s de %s falharam na última execução', _m, _n)
                     when _n < 5 then format('Só %s de 5 rotinas agendadas', _n) else format('%s rotinas rodando', _n) end,
      'detalhe', case when _m > 0 then left(_t, 160) end, 'quando', _q, 'rotulo_quando', 'última execução');
  end if;

  -- 5. Anúncios da Meta (Lead Ads) e conversões.
  select count(*), string_agg(c.nome, ', ') into _n, _t from public.crm_integracoes i join public.produto_contas c on c.id = i.conta_id
   where i.ativo and i.ultimo_erro is not null;
  select count(*) into _m from public.crm_meta_leads x where x.situacao = 'erro' and x.criado_em > now() - interval '7 days';
  select count(*) into _k from public.crm_conversoes x where x.criado_em > now() - interval '7 days'
     and (x.situacao = 'erro' or (x.situacao = 'pendente' and x.criado_em < now() - interval '1 hour'));
  _saude := _saude || jsonb_build_object(
    'chave', 'meta', 'titulo', 'Leads e conversões da Meta',
    'nivel', case when _n > 0 or _m > 0 or _k > 0 then 'atencao' else 'ok' end,
    'resumo', case when _n > 0 or _m > 0 or _k > 0 then format('%s conexões com erro, %s leads e %s conversões com falha em 7 dias', _n, _m, _k) else 'Sem falha em 7 dias' end,
    'detalhe', case when _n > 0 then left(_t, 160) end);

  -- 6. WhatsApp.
  select count(*) filter (where x.situacao = 'erro'), count(*) filter (where x.situacao = 'pendente' and x.criado_em < now() - interval '30 minutes')
    into _n, _m from public.crm_whats_envios x where x.criado_em > now() - interval '24 hours';
  select left(x.erro, 160) into _t from public.crm_whats_envios x where x.situacao = 'erro' and x.criado_em > now() - interval '24 hours' order by x.criado_em desc limit 1;
  _saude := _saude || jsonb_build_object(
    'chave', 'whatsapp', 'titulo', 'WhatsApp',
    'nivel', case when _n > 0 or _m > 0 then 'atencao' else 'ok' end,
    'resumo', case when _n > 0 or _m > 0 then format('%s com erro e %s parados em 24 horas', _n, _m) else 'Sem falha em 24 horas' end,
    'detalhe', case when _n > 0 then _t end);

  -- 7. Convites que ninguém aceitou.
  select count(*) into _n from public.produto_membros m where m.estado = 'convidado' and m.convidado_em < now() - interval '3 days';
  _saude := _saude || jsonb_build_object(
    'chave', 'convites', 'titulo', 'Convites',
    'nivel', case when _n > 0 then 'atencao' else 'ok' end,
    'resumo', case when _n > 0 then format('%s parados há mais de 3 dias', _n) else 'Nenhum convite parado' end,
    'detalhe', case when _n > 0 then 'Abra a empresa e copie o link de acesso para mandar por WhatsApp.' end);

  return jsonb_build_object(
    'gerado_em', now(),
    'saude', _saude,
    'empresas', (
      select coalesce(jsonb_agg(e.linha order by e.ultima desc nulls last, e.nome), '[]'::jsonb)
        from (
          select c.nome, a.ultima,
                 jsonb_build_object(
                   'id', c.id, 'nome', c.nome, 'estado', c.estado, 'cobranca_por', c.cobranca_por,
                   'liberada', public.produto_conta_liberada(c.id), 'crm_ativo', c.crm_ativo,
                   'usuarios_ativos', (select count(*) from public.produto_membros m where m.conta_id = c.id and m.estado = 'ativo'),
                   'convites', (select count(*) from public.produto_membros m where m.conta_id = c.id and m.estado = 'convidado'),
                   'ultimo_acesso', (select max(u.last_sign_in_at) from public.produto_membros m join auth.users u on u.id = m.user_id where m.conta_id = c.id and m.estado = 'ativo'),
                   'ultima_atividade', a.ultima,
                   'abertos', l.abertos, 'valor_aberto', l.valor_aberto, 'novos_hoje', l.novos_hoje, 'novos_7d', l.novos_7d,
                   'ganhos_mes', l.ganhos_mes, 'valor_ganho_mes', l.valor_ganho_mes,
                   'movimentos_hoje', (select count(*) from public.crm_lead_events ev where ev.conta_id = c.id and ev.created_at >= _hoje),
                   'tarefas_atrasadas', (select count(*) from public.crm_activities t where t.conta_id = c.id and t.done_at is null and t.due_at < now())
                 ) as linha
            from public.produto_contas c
            cross join lateral (
              select count(*) filter (where x.archived_at is null and x.stage not in ('ganho', 'perdido')) as abertos,
                     coalesce(sum(coalesce(x.monthly_value, 0) + coalesce(x.one_off_value, 0)) filter (where x.archived_at is null and x.stage not in ('ganho', 'perdido')), 0) as valor_aberto,
                     count(*) filter (where x.created_at >= _hoje) as novos_hoje,
                     count(*) filter (where x.created_at >= now() - interval '7 days') as novos_7d,
                     count(*) filter (where x.stage = 'ganho' and x.closed_at >= _mes) as ganhos_mes,
                     coalesce(sum(coalesce(x.monthly_value, 0) + coalesce(x.one_off_value, 0)) filter (where x.stage = 'ganho' and x.closed_at >= _mes), 0) as valor_ganho_mes,
                     max(x.updated_at) as mexido
                from public.crm_leads x where x.conta_id = c.id
            ) l
            cross join lateral (
              select nullif(greatest(
                       coalesce(l.mexido, '-infinity'::timestamptz),
                       coalesce((select max(ev.created_at) from public.crm_lead_events ev where ev.conta_id = c.id), '-infinity'::timestamptz),
                       coalesce((select max(t.updated_at) from public.crm_activities t where t.conta_id = c.id), '-infinity'::timestamptz),
                       coalesce((select max(g.created_at) from public.crm_lead_messages g where g.conta_id = c.id), '-infinity'::timestamptz)
                     ), '-infinity'::timestamptz) as ultima
            ) a
        ) e
    )
  );
end;
$$;

create or replace function public.produto_admin_monitor_conta(_conta uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  _mes timestamptz := date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
begin
  if not public.produto_dono() then
    raise exception 'Só a administração.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'gerado_em', now(),
    'funil', (
      select coalesce(jsonb_agg(jsonb_build_object('etapa', f.stage, 'negocios', f.n, 'valor', f.v) order by f.n desc), '[]'::jsonb)
        from (select x.stage, count(*) as n, coalesce(sum(coalesce(x.monthly_value, 0) + coalesce(x.one_off_value, 0)), 0) as v
                from public.crm_leads x
               where x.conta_id = _conta and x.archived_at is null
                 and (x.stage not in ('ganho', 'perdido') or x.closed_at >= _mes)
               group by x.stage) f
    ),
    'pessoas', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'nome', m.nome, 'papel', m.papel, 'cargo', m.cargo, 'estado', m.estado,
               'ultimo_acesso', (select u.last_sign_in_at from auth.users u where u.id = m.user_id),
               'abertos', (select count(*) from public.crm_leads x where x.conta_id = _conta and x.owner_id = m.user_id and x.archived_at is null and x.stage not in ('ganho', 'perdido')),
               'ganhos_mes', (select count(*) from public.crm_leads x where x.conta_id = _conta and x.owner_id = m.user_id and x.stage = 'ganho' and x.closed_at >= _mes),
               'movimentos_7d', (select count(*) from public.crm_lead_events ev where ev.conta_id = _conta and ev.created_by = m.user_id and ev.created_at > now() - interval '7 days'),
               'tarefas_atrasadas', (select count(*) from public.crm_activities t where t.conta_id = _conta and t.owner_id = m.user_id and t.done_at is null and t.due_at < now()),
               'ultimo_movimento', (select max(ev.created_at) from public.crm_lead_events ev where ev.conta_id = _conta and ev.created_by = m.user_id)
             ) order by m.estado, m.nome), '[]'::jsonb)
        from public.produto_membros m where m.conta_id = _conta and m.estado <> 'removido'
    ),
    'movimentos', (
      select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'quando', v.created_at, 'tipo', v.kind, 'de', v.from_stage, 'para', v.to_stage, 'quem', v.quem) order by v.created_at desc), '[]'::jsonb)
        from (select ev.id, ev.created_at, ev.kind, ev.from_stage, ev.to_stage,
                     (select m.nome from public.produto_membros m where m.conta_id = _conta and m.user_id = ev.created_by limit 1) as quem
                from public.crm_lead_events ev where ev.conta_id = _conta
               order by ev.created_at desc limit 40) v
    )
  );
end;
$$;

revoke all on function public.produto_admin_monitor() from public, anon;
revoke all on function public.produto_admin_monitor_conta(uuid) from public, anon;
grant execute on function public.produto_admin_monitor() to authenticated, service_role;
grant execute on function public.produto_admin_monitor_conta(uuid) to authenticated, service_role;
