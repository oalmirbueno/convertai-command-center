-- Alçada automática: o agente age sozinho dentro de uma faixa pré-aprovada.
--
-- Decisão do Almir em 04/11/2026: os agentes não devem parar a cada ação
-- para pedir aprovação. O dono define UMA vez, por cliente (ou para todos),
-- o que o agente pode fazer sozinho e até quanto. Dentro da faixa, o pedido
-- de aprovação já nasce "aprovado" e vira ordem aberta na hora; fora dela,
-- segue o fluxo de sempre (pendente, um humano decide).
--
-- O que NUNCA entra na alçada (continua com o dono): gastar (saldo, pagar
-- dívida), alterar financeiro, contatar cliente, proposta, contrato,
-- permissões, exportar ou excluir dados, mudar estratégia, trocar
-- responsável, promover autonomia. Isso é garantido pelo CHECK da tabela:
-- não existe linha de alçada para essas ações.
--
-- Nada muda para quem já está no fluxo: sem linha de alçada ativa, o
-- operator_request_approval se comporta exatamente como antes.

-- 1) A faixa pré-aprovada ---------------------------------------------------
create table public.operator_alcadas (
  id uuid primary key default gen_random_uuid(),
  -- null = vale para todos os clientes; uma linha do cliente sempre vence
  -- a geral, inclusive quando está desligada (é assim que se tira um
  -- cliente da alçada sem mexer nos outros).
  client_id uuid references public.profiles(id) on delete cascade,
  -- null = qualquer agente ativo.
  operator_slug text,
  action_kind text not null
    check (action_kind in ('publicar', 'agendar', 'ativar_campanha', 'alterar_orcamento')),
  ativo boolean not null default true,
  -- Custo máximo de UMA ação (R$). null = sem limite por ação.
  valor_max_por_acao numeric check (valor_max_por_acao is null or valor_max_por_acao >= 0),
  -- Soma máxima no mês, por cliente, do que a alçada aprovou sozinha (R$).
  -- null = sem teto mensal da alçada.
  teto_mensal numeric check (teto_mensal is null or teto_mensal >= 0),
  -- Quanto o agente pode SUBIR (orçamento ou limite de gasto) sem perguntar,
  -- em % sobre o valor atual. Vem no payload como aumento_pct.
  aumento_max_pct numeric check (aumento_max_pct is null or aumento_max_pct >= 0),
  -- Exige que o payload aponte o plano/calendário já aprovado (plano_ref).
  exige_plano_aprovado boolean not null default false,
  nota text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index operator_alcadas_unica
  on public.operator_alcadas (
    coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(operator_slug, ''),
    action_kind
  );

alter table public.operator_alcadas enable row level security;

create policy admin_gerencia_alcadas on public.operator_alcadas
  for all to authenticated
  using (public.has_role((select auth.uid()), 'admin'::public.app_role))
  with check (public.has_role((select auth.uid()), 'admin'::public.app_role));

revoke all on public.operator_alcadas from anon;

-- A aprovação lembra qual alçada a aprovou (null = humano ou pendente).
alter table public.operator_approvals
  add column alcada_id uuid references public.operator_alcadas(id) on delete set null;

create index operator_approvals_alcada_mes
  on public.operator_approvals (client_id, created_at)
  where alcada_id is not null;

-- 2) A faixa cabe? ------------------------------------------------------------
-- Função interna: decide se um pedido cabe na alçada. Devolve
-- {cabe, alcada_id, motivo}. Só o próprio operator_request_approval chama.
create or replace function public.operator_alcada_avaliar(
  _operator_slug text,
  _client_id uuid,
  _action_kind text,
  _custo numeric,
  _reversivel boolean,
  _payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _a public.operator_alcadas%rowtype;
  _aumento numeric;
  _usado numeric;
  _inicio_mes timestamptz;
begin
  if _action_kind not in ('publicar', 'agendar', 'ativar_campanha', 'alterar_orcamento') then
    return jsonb_build_object('cabe', false, 'motivo', 'acao_fora_da_alcada');
  end if;
  if _client_id is null then
    return jsonb_build_object('cabe', false, 'motivo', 'sem_cliente: a alçada é por cliente; diga client_id no payload ou use um vínculo de tarefa de projeto');
  end if;
  if coalesce(_reversivel, true) is false then
    return jsonb_build_object('cabe', false, 'motivo', 'irreversivel: ação que não se desfaz fica com o dono');
  end if;

  -- A linha mais específica vence: cliente+agente, cliente, agente, geral.
  select * into _a from public.operator_alcadas
    where action_kind = _action_kind
      and (client_id is null or client_id = _client_id)
      and (operator_slug is null or operator_slug = lower(trim(_operator_slug)))
    order by (client_id is null), (operator_slug is null)
    limit 1;
  if not found then
    return jsonb_build_object('cabe', false, 'motivo', 'sem_alcada');
  end if;
  if not _a.ativo then
    return jsonb_build_object('cabe', false, 'alcada_id', _a.id, 'motivo', 'alcada_desligada');
  end if;

  -- Ação com dinheiro tem que dizer quanto custa.
  if _action_kind in ('ativar_campanha', 'alterar_orcamento') and _custo is null then
    return jsonb_build_object('cabe', false, 'alcada_id', _a.id, 'motivo', 'sem_custo: informe custo_previsto (0 para pausar ou redistribuir)');
  end if;
  if _custo is not null and _custo < 0 then
    return jsonb_build_object('cabe', false, 'alcada_id', _a.id, 'motivo', 'custo_invalido');
  end if;
  if _a.valor_max_por_acao is not null and coalesce(_custo, 0) > _a.valor_max_por_acao then
    return jsonb_build_object('cabe', false, 'alcada_id', _a.id,
      'motivo', 'acima_do_valor_por_acao: ' || _custo || ' > ' || _a.valor_max_por_acao);
  end if;

  if _a.aumento_max_pct is not null then
    begin
      _aumento := coalesce(nullif(_payload->>'aumento_pct', '')::numeric, 0);
    exception when others then
      return jsonb_build_object('cabe', false, 'alcada_id', _a.id, 'motivo', 'aumento_pct_invalido');
    end;
    if _aumento > _a.aumento_max_pct then
      return jsonb_build_object('cabe', false, 'alcada_id', _a.id,
        'motivo', 'acima_do_aumento: ' || _aumento || '% > ' || _a.aumento_max_pct || '%');
    end if;
  end if;

  if _a.exige_plano_aprovado and nullif(trim(coalesce(_payload->>'plano_ref', '')), '') is null then
    return jsonb_build_object('cabe', false, 'alcada_id', _a.id,
      'motivo', 'sem_plano: diga em plano_ref qual plano ou calendário aprovado esta ação cumpre');
  end if;

  if _a.teto_mensal is not null then
    -- Serializa por cliente: dois pedidos simultâneos não estouram o teto.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('operator_alcada:' || _client_id::text));
    _inicio_mes := (date_trunc('month', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
    select coalesce(sum(coalesce(custo_previsto, 0)), 0) into _usado
      from public.operator_approvals
      where alcada_id is not null
        and client_id = _client_id
        and status = 'aprovado'
        and created_at >= _inicio_mes;
    if _usado + coalesce(_custo, 0) > _a.teto_mensal then
      return jsonb_build_object('cabe', false, 'alcada_id', _a.id,
        'motivo', 'teto_mensal: já usado ' || _usado || ' de ' || _a.teto_mensal);
    end if;
  end if;

  return jsonb_build_object('cabe', true, 'alcada_id', _a.id, 'motivo', 'dentro_da_alcada');
end;
$$;

revoke all on function public.operator_alcada_avaliar(text, uuid, text, numeric, boolean, jsonb)
  from public, anon, authenticated;

-- 3) O pedido de aprovação passa pela alçada -------------------------------
-- Mesma assinatura e mesmo contrato de antes. A única diferença: quando o
-- pedido cabe na alçada ativa, ele nasce "aprovado" (decided_by null,
-- alcada_id preenchido) e a resposta manda executar agora e provar com
-- operator_ordem_executada.
create or replace function public.operator_request_approval(
  _operator_slug text,
  _link_id uuid,
  _action_kind text,
  _o_que text,
  _por_que text,
  _payload jsonb,
  _dados_usados text default null,
  _destino text default null,
  _impacto text default null,
  _risco text default null,
  _custo_previsto numeric default null,
  _prazo date default null,
  _reversivel boolean default true,
  _evidencia text default null,
  _valid_until timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _op public.internal_operators%rowtype;
  _link public.operator_task_links%rowtype;
  _aprov public.operator_approvals%rowtype;
  _versao integer;
  _cliente uuid;
  _cliente_payload uuid;
  _avaliacao jsonb := jsonb_build_object('cabe', false, 'motivo', 'sem_alcada');
begin
  select * into _op from public.internal_operators
    where slug = lower(trim(_operator_slug));
  if not found then
    raise exception 'operator_not_found: % nao existe na hierarquia', _operator_slug;
  end if;
  if _op.status <> 'active' then
    raise exception 'operator_paused: % esta pausado e nao pede aprovacao ate ser reativado', _op.slug;
  end if;

  select * into _link from public.operator_task_links where id = _link_id;
  if not found then
    raise exception 'link_not_found: vinculo % nao existe', _link_id;
  end if;

  -- Sem O QUE e POR QUE nao ha o que aprovar. Pedido vazio e o selo
  -- generico de volta, so que em tabela nova.
  if nullif(trim(_o_que), '') is null or nullif(trim(_por_que), '') is null then
    raise exception 'explicacao_obrigatoria: aprovacao sem "o que" e "por que" nao entra na fila';
  end if;

  -- Cliente: o da tarefa vinculada; se a tarefa nao tem projeto, o que o
  -- payload disser. Se os dois existem e discordam, nao ha alcada.
  select p.client_id into _cliente
    from public.tasks t join public.projects p on p.id = t.project_id
    where t.id = _link.kanban_task_id;
  begin
    _cliente_payload := nullif(_payload->>'client_id', '')::uuid;
  exception when others then
    _cliente_payload := null;
  end;
  if _cliente is not null and _cliente_payload is not null and _cliente <> _cliente_payload then
    _avaliacao := jsonb_build_object('cabe', false, 'motivo', 'cliente_divergente: o client_id do payload nao e o cliente da tarefa');
  else
    _cliente := coalesce(_cliente, _cliente_payload);
    _avaliacao := public.operator_alcada_avaliar(
      _op.slug, _cliente, _action_kind, _custo_previsto, _reversivel, coalesce(_payload, '{}'::jsonb));
  end if;

  -- A versao cresce por vinculo+acao: o pedido refeito depois de
  -- "alteracoes_pedidas" nasce como v2, e o historico das versoes fica.
  select coalesce(max(payload_version), 0) + 1 into _versao
    from public.operator_approvals
    where task_link_id = _link.id and action_kind = _action_kind;

  if (_avaliacao->>'cabe')::boolean then
    insert into public.operator_approvals
      (operator_id, task_link_id, kanban_task_id, action_kind, o_que, por_que,
       dados_usados, destino, impacto, risco, custo_previsto, prazo, reversivel,
       payload, payload_version, evidencia, valid_until,
       status, decided_at, decision_note, client_id, alcada_id)
    values
      (_op.id, _link.id, _link.kanban_task_id, _action_kind, trim(_o_que), trim(_por_que),
       _dados_usados, _destino, _impacto, _risco, _custo_previsto, _prazo,
       coalesce(_reversivel, true), coalesce(_payload, '{}'::jsonb), _versao,
       _evidencia, coalesce(_valid_until, now() + interval '48 hours'),
       'aprovado', now(), 'alçada automática', _cliente,
       (_avaliacao->>'alcada_id')::uuid)
    returning * into _aprov;

    insert into public.operator_audit_log
      (actor, operator_id, task_link_id, kanban_task_id, action, approval_required)
    values ('mcp:' || _op.slug, _op.id, _link.id, _link.kanban_task_id,
            'aprovado pela alcada: ' || _action_kind || ' v' || _versao, false);

    return jsonb_build_object(
      'ok', true, 'approval_id', _aprov.id, 'payload_version', _versao,
      'status', 'aprovado', 'aprovado_por', 'alcada', 'alcada_id', _aprov.alcada_id,
      'valid_until', _aprov.valid_until,
      'regra', 'dentro da alcada: execute AGORA exatamente este payload e prove com operator_ordem_executada (evidencia obrigatoria). Use este approval_id como aprovacao_id no navegador.'
    );
  end if;

  insert into public.operator_approvals
    (operator_id, task_link_id, kanban_task_id, action_kind, o_que, por_que,
     dados_usados, destino, impacto, risco, custo_previsto, prazo, reversivel,
     payload, payload_version, evidencia, valid_until)
  values
    (_op.id, _link.id, _link.kanban_task_id, _action_kind, trim(_o_que), trim(_por_que),
     _dados_usados, _destino, _impacto, _risco, _custo_previsto, _prazo,
     coalesce(_reversivel, true), coalesce(_payload, '{}'::jsonb), _versao,
     _evidencia, _valid_until)
  returning * into _aprov;

  update public.operator_task_links
    set approval_required = true, updated_at = now()
    where id = _link.id;

  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action, approval_required)
  values ('mcp:' || _op.slug, _op.id, _link.id, _link.kanban_task_id,
          'pediu aprovacao: ' || _action_kind || ' v' || _versao, true);

  insert into public.notifications (user_id, message, notification_type, link)
  select ur.user_id,
    _op.display_name || ' pede aprovacao para ' || replace(_action_kind, '_', ' ')
      || ': ' || left(trim(_o_que), 140),
    'aprovacao_necessaria',
    '/execucao?aprovacao=' || _aprov.id
  from public.user_roles ur where ur.role = 'admin';

  return jsonb_build_object(
    'ok', true, 'approval_id', _aprov.id, 'payload_version', _versao,
    'status', 'pendente',
    'fora_da_alcada', _avaliacao->>'motivo',
    'regra', 'nada e executado ate um humano aprovar; e o executado tem que ser ESTE payload'
  );
end;
$$;

revoke all on function public.operator_request_approval(
  text, uuid, text, text, text, jsonb, text, text, text, text,
  numeric, date, boolean, text, timestamptz
) from anon, authenticated;

-- 4) O dono define a faixa ----------------------------------------------------
create or replace function public.operator_alcada_definir(
  _action_kind text,
  _client_id uuid default null,
  _operator_slug text default null,
  _ativo boolean default true,
  _valor_max_por_acao numeric default null,
  _teto_mensal numeric default null,
  _aumento_max_pct numeric default null,
  _exige_plano_aprovado boolean default false,
  _nota text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  _id uuid;
  _slug text := nullif(lower(trim(coalesce(_operator_slug, ''))), '');
begin
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'apenas_admin: definir alçada é decisão do dono';
  end if;

  update public.operator_alcadas
    set ativo = coalesce(_ativo, true),
        valor_max_por_acao = _valor_max_por_acao,
        teto_mensal = _teto_mensal,
        aumento_max_pct = _aumento_max_pct,
        exige_plano_aprovado = coalesce(_exige_plano_aprovado, false),
        nota = nullif(trim(_nota), ''),
        updated_at = now()
    where action_kind = _action_kind
      and client_id is not distinct from _client_id
      and operator_slug is not distinct from _slug
    returning id into _id;

  if _id is null then
    insert into public.operator_alcadas
      (client_id, operator_slug, action_kind, ativo, valor_max_por_acao, teto_mensal,
       aumento_max_pct, exige_plano_aprovado, nota, created_by)
    values
      (_client_id, _slug, _action_kind, coalesce(_ativo, true), _valor_max_por_acao, _teto_mensal,
       _aumento_max_pct, coalesce(_exige_plano_aprovado, false), nullif(trim(_nota), ''), auth.uid())
    returning id into _id;
  end if;

  return jsonb_build_object('ok', true, 'alcada_id', _id);
end;
$$;

revoke all on function public.operator_alcada_definir(text, uuid, text, boolean, numeric, numeric, numeric, boolean, text)
  from public, anon;
grant execute on function public.operator_alcada_definir(text, uuid, text, boolean, numeric, numeric, numeric, boolean, text)
  to authenticated;

-- 5) O que a alçada fez -----------------------------------------------------
-- Resumo para o dono: o que foi aprovado sozinho, se já foi feito e a prova.
create or replace function public.operator_alcada_resumo(_desde timestamptz default now() - interval '24 hours')
returns table (
  approval_id uuid, criada_em timestamptz, agente text, client_id uuid, cliente text,
  action_kind text, o_que text, custo_previsto numeric, executada_em timestamptz, evidencia text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.has_role(auth.uid(), 'admin'::public.app_role) then
    raise exception 'apenas_admin: o resumo da alçada é do dono';
  end if;
  return query
    select a.id, a.created_at, o.display_name, a.client_id,
           coalesce(nullif(p.company_name, ''), p.full_name),
           a.action_kind, a.o_que, a.custo_previsto, a.executed_at, a.execution_evidence
      from public.operator_approvals a
      left join public.internal_operators o on o.id = a.operator_id
      left join public.profiles p on p.id = a.client_id
     where a.alcada_id is not null and a.created_at >= _desde
     order by a.created_at;
end;
$$;

revoke all on function public.operator_alcada_resumo(timestamptz) from public, anon;
grant execute on function public.operator_alcada_resumo(timestamptz) to authenticated, service_role;

-- Uma notificação por dia, às 20h de Brasília, com o que a alçada fez.
-- Sem ação no dia, não avisa nada.
create or replace function public.operator_alcada_avisar_dia()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  _feitas int;
  _abertas int;
  _custo numeric;
  _linhas text;
begin
  select count(*) filter (where executada_em is not null),
         count(*) filter (where executada_em is null),
         coalesce(sum(custo_previsto) filter (where executada_em is not null), 0),
         string_agg(
           case when executada_em is not null then '✓ ' else '… ' end
             || coalesce(cliente, 'sem cliente') || ': ' || left(o_que, 80),
           E'\n' order by criada_em)
    into _feitas, _abertas, _custo, _linhas
    from public.operator_alcada_resumo(now() - interval '24 hours');

  if coalesce(_feitas, 0) + coalesce(_abertas, 0) = 0 then
    return;
  end if;

  insert into public.notifications (user_id, message, notification_type, link)
  select ur.user_id,
    left('Hoje os agentes fizeram ' || _feitas || ' ação(ões) sozinhos dentro da alçada'
      || case when _custo > 0 then ' (R$ ' || to_char(_custo, 'FM999G999D00') || ')' else '' end
      || case when _abertas > 0 then ', e ' || _abertas || ' ainda sem prova' else '' end
      || E'.\n' || coalesce(_linhas, ''), 2000),
    'alcada_resumo_do_dia',
    '/execucao?alcada=hoje'
  from public.user_roles ur where ur.role = 'admin';
end;
$$;

revoke all on function public.operator_alcada_avisar_dia() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'operator-alcada-resumo-do-dia';
    perform cron.schedule(
      'operator-alcada-resumo-do-dia',
      '0 23 * * *',
      $cron$select public.operator_alcada_avisar_dia();$cron$
    );
  end if;
end
$$;

-- 6) Faixa inicial sugerida (vale para todos os clientes) -------------------
-- Revisar antes de aplicar. Cada linha pode ser trocada por cliente com
-- operator_alcada_definir, ou desligada com _ativo => false.
insert into public.operator_alcadas
  (client_id, operator_slug, action_kind, ativo, valor_max_por_acao, teto_mensal,
   aumento_max_pct, exige_plano_aprovado, nota)
values
  -- Pausar anúncio que queima verba, redistribuir dentro do teto (custo 0)
  -- e subir orçamento ou limite de gasto até 20%. O cliente recarrega R$ 120
  -- no início do mês, então o teto padrão é esse; por cliente, troque com
  -- operator_alcada_definir.
  (null, null, 'alterar_orcamento', true, 120, 120, 20, false,
   'Padrão 04/11: pausar, redistribuir e subir até 20% (máx. R$ 120 no mês por cliente, a recarga inicial).'),
  -- Ativar campanha montada a partir de plano aprovado.
  (null, null, 'ativar_campanha', true, 120, 120, null, true,
   'Padrão 04/11: só campanha de plano aprovado (plano_ref), dentro dos R$ 120 do mês por cliente.'),
  -- Publicar e agendar o que já está no plano ou calendário aprovado.
  (null, null, 'publicar', true, 0, null, null, true,
   'Padrão 04/11: só o que está no calendário ou plano aprovado (plano_ref), sem custo.'),
  (null, null, 'agendar', true, 0, null, null, true,
   'Padrão 04/11: só o que está no calendário ou plano aprovado (plano_ref), sem custo.');
