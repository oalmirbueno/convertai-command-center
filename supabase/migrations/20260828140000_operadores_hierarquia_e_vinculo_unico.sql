-- Dois defeitos meus na camada de operadores, e o reparo do que eles
-- deixaram para trás.
--
-- ─────────────────────────── DEFEITO 1 ──────────────────────────────────
--
--   operator_update: column "updated_at" of relation
--   "internal_operators" does not exist
--
-- Escrevi `updated_at = now()` dentro de operator_update sem conferir a
-- tabela. Ela tem `created_at` e `last_run_at`, e nunca teve `updated_at`.
-- Conferi o schema real antes deste conserto: as colunas são id, slug,
-- display_name, role, status, scope, permissions, hermes_profile_ref,
-- is_coordinator, created_at, last_run_at, area, parent_slug e
-- display_order.
--
-- Poderia acrescentar a coluna. NÃO acrescento, e o motivo é que a
-- informação já existe em lugar melhor: cada organize grava uma linha na
-- trilha imutável, com quem mexeu e quando. Uma coluna nova diria a mesma
-- coisa com menos precisão e passaria a ser mais uma peça para manter. A
-- mudança mínima é parar de escrever numa coluna que não existe.
--
-- ─────────────────────────── DEFEITO 2 ──────────────────────────────────
--
-- O `done` com kanban_task_id falhou por causa de `public.clients`, que eu
-- já consertei na migration 20260828030000 — o teste dele rodou antes
-- disso chegar ao banco. Mas o CONTORNO que ele usou revelou um defeito de
-- verdade, e esse continua de pé:
--
-- reportar a mesma execução por `painel_task_id` em vez de
-- `kanban_task_id` criou um SEGUNDO vínculo, porque a busca casava só pelo
-- par exato de ids. Resultado no banco: dois vínculos com o MESMO run_key,
-- o original parado em in_progress e o novo em done.
--
-- A chave de idempotência é o run_key, e é ela que tem de mandar. Agora a
-- busca tenta primeiro (operador, run_key): achou, é aquele vínculo, venha
-- o id no campo que vier. O par de ids vira o segundo critério, para o
-- primeiro relato, quando ainda não há run_key gravado.
--
-- E o vínculo achado pelo run_key APRENDE o id que faltava: quem começou
-- sem kanban_task_id e depois o recebe passa a tê-lo, em vez de manter
-- dois registros contando metade da história cada um.
--
-- ──────────────────────────── O REPARO ──────────────────────────────────
--
-- Os dois vínculos gêmeos que já existem são reconciliados: o original
-- recebe o estado final e a evidência, a run passa a apontar para ele, e o
-- duplicado sai. Não é apagar histórico: a trilha imutável guarda cada
-- evento, inclusive a criação do duplicado, e o reparo entra nela também.
-- O que sai é um registro de ESTADO que estava mentindo sobre o presente.
--
-- Rodar de novo não faz mal: o reparo só age onde há gêmeos.

-- ══════════════ 1) operator_update sem a coluna inexistente ═════════════

create or replace function public.operator_update(
  _slug text,
  _actor text,
  _display_name text default null,
  _role text default null,
  _area text default null,
  _parent_slug text default null,
  _display_order integer default null,
  _scope text default null,
  _status text default null,
  _is_coordinator boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  _op public.internal_operators%rowtype;
  _pai public.internal_operators%rowtype;
  _cursor text;
  _saltos integer := 0;
begin
  select * into _op from public.internal_operators where slug = lower(trim(_slug));
  if not found then
    raise exception 'operator_not_found: % nao existe', _slug;
  end if;

  if _status is not null and _status not in ('active', 'paused', 'retired') then
    raise exception 'invalid_status: use active, paused ou retired';
  end if;

  if _parent_slug is not null and trim(_parent_slug) <> '' then
    if lower(trim(_parent_slug)) = _op.slug then
      raise exception 'ciclo: um agente nao pode coordenar a si mesmo';
    end if;
    select * into _pai from public.internal_operators where slug = lower(trim(_parent_slug));
    if not found then
      raise exception 'parent_not_found: % nao e um operador conhecido', _parent_slug;
    end if;
    -- Sobe a cadeia do futuro chefe: se eu aparecer nela, o vinculo
    -- fecharia um laco. O teto de saltos protege contra ciclo ja gravado.
    _cursor := _pai.parent_slug;
    while _cursor is not null and _saltos < 40 loop
      if _cursor = _op.slug then
        raise exception 'ciclo: % ja responde a %, direta ou indiretamente', _parent_slug, _op.slug;
      end if;
      select parent_slug into _cursor from public.internal_operators where slug = _cursor;
      _saltos := _saltos + 1;
    end loop;
  end if;

  -- SEM updated_at: a coluna nunca existiu nesta tabela, e quem guarda o
  -- "quando mudou e por quem" e a trilha imutavel logo abaixo.
  update public.internal_operators set
    display_name   = coalesce(nullif(trim(_display_name), ''), display_name),
    role           = coalesce(nullif(trim(_role), ''), role),
    area           = coalesce(nullif(trim(_area), ''), area),
    parent_slug    = case when _parent_slug is null then parent_slug
                          when trim(_parent_slug) = '' then null
                          else lower(trim(_parent_slug)) end,
    display_order  = coalesce(_display_order, display_order),
    scope          = coalesce(nullif(trim(_scope), ''), scope),
    status         = coalesce(_status, status),
    is_coordinator = coalesce(_is_coordinator, is_coordinator)
  where id = _op.id
  returning * into _op;

  insert into public.operator_audit_log (actor, operator_id, action, old_status, new_status)
  values (_actor, _op.id, 'organograma atualizado: ' || _op.slug, null, _op.status);

  return jsonb_build_object(
    'ok', true,
    'slug', _op.slug,
    'display_name', _op.display_name,
    'role', _op.role,
    'area', _op.area,
    'parent_slug', _op.parent_slug,
    'display_order', _op.display_order,
    'status', _op.status,
    'is_coordinator', _op.is_coordinator
  );
end;
$fn$;

revoke execute on function public.operator_update(text, text, text, text, text, text, integer, text, text, boolean) from anon;
grant execute on function public.operator_update(text, text, text, text, text, text, integer, text, text, boolean) to service_role;

-- ═════════════ 2) o run_key manda na hora de achar o vinculo ════════════

create or replace function public.operator_report_event(
  _operator_slug text,
  _event text,
  _run_key text,
  _actor text,
  _kanban_task_id uuid default null,
  _painel_task_id uuid default null,
  _action text default null,
  _evidence text default null,
  _next_step text default null,
  _block_reason text default null,
  _error text default null,
  _approval_required boolean default false,
  _from_cron boolean default false,
  _attempt integer default 1,
  _timeout_seconds integer default 900,
  _detail jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  _flag boolean;
  _op public.internal_operators%rowtype;
  _link public.operator_task_links%rowtype;
  _run public.operator_runs%rowtype;
  _status_novo text;
  _status_velho text;
  _notifica boolean := false;
  _mensagem text;
  _client_id uuid;
  _titulo_tarefa text;
  _memoria_id uuid;
  _nome_cliente text;
  _pronto_cliente boolean := false;
  _tarefa uuid;
begin
  select enabled into _flag from public.feature_flags where flag_key = 'operators_layer';
  if not coalesce(_flag, false) then
    raise exception 'flag_off: a camada de operadores esta desligada (operators_layer)';
  end if;

  select * into _op from public.internal_operators
    where slug = lower(trim(_operator_slug)) and status = 'active';
  if not found then
    raise exception 'operator_not_found: % nao e um operador interno ativo', _operator_slug;
  end if;

  if _event not in ('started', 'progress', 'done', 'failed', 'blocked', 'review', 'awaiting_input', 'heartbeat') then
    raise exception 'invalid_event: %', _event;
  end if;

  if _evidence is not null and (
    _evidence ~* '(token|signature|x-amz|apikey|api_key|secret|sig)='
  ) then
    _evidence := split_part(_evidence, '?', 1) || ' [query removida: continha credencial]';
  end if;

  -- ── Achar o vinculo: PRIMEIRO pela chave de idempotencia ──────────────
  --
  -- O run_key identifica a execucao. Se ja existe vinculo deste operador
  -- com esta chave, e ELE, venha o id no campo que vier. Casar so pelo par
  -- de ids foi o que fez o mesmo trabalho virar dois vinculos quando o
  -- relato trocou kanban_task_id por painel_task_id.
  select * into _link from public.operator_task_links l
    where l.operator_id = _op.id
      and l.agent_run_id = _run_key
    order by l.created_at
    limit 1;

  if not found and (_kanban_task_id is not null or _painel_task_id is not null) then
    select * into _link from public.operator_task_links l
      where l.operator_id = _op.id
        and coalesce(l.kanban_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(_kanban_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
        and coalesce(l.painel_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
          = coalesce(_painel_task_id, '00000000-0000-0000-0000-000000000000'::uuid)
      order by l.created_at desc limit 1;
  end if;

  if _link.id is null and _event <> 'heartbeat'
     and (_kanban_task_id is not null or _painel_task_id is not null) then
    insert into public.operator_task_links
      (operator_id, agent_run_id, kanban_task_id, painel_task_id, execution_source)
    values (_op.id, _run_key, _kanban_task_id, _painel_task_id,
            case when _from_cron then 'cron' else 'mcp' end)
    returning * into _link;
  end if;

  _status_velho := _link.status;
  _status_novo := case _event
    when 'started' then 'in_progress'
    when 'progress' then 'in_progress'
    when 'done' then case when coalesce(trim(_evidence), '') = '' and coalesce(trim(_link.last_evidence), '') = ''
      then 'review' else 'done' end
    when 'failed' then 'blocked'
    when 'blocked' then 'blocked'
    when 'review' then 'review'
    when 'awaiting_input' then 'awaiting_input'
    else null
  end;

  if _link.id is not null and _status_novo is not null then
    update public.operator_task_links set
      status = _status_novo,
      agent_run_id = coalesce(_run_key, agent_run_id),
      -- O vinculo APRENDE o id que faltava, em vez de nascer um irmao.
      kanban_task_id = coalesce(kanban_task_id, _kanban_task_id),
      painel_task_id = coalesce(painel_task_id, _painel_task_id),
      last_action = coalesce(_action, last_action),
      last_evidence = coalesce(_evidence, last_evidence),
      next_step = coalesce(_next_step, next_step),
      block_reason = case when _event in ('failed', 'blocked')
        then coalesce(_block_reason, _error, block_reason) else null end,
      approval_required = _approval_required or approval_required,
      updated_at = now()
    where id = _link.id
    returning * into _link;
  end if;

  insert into public.operator_runs
    (operator_id, run_key, task_link_id, status, attempt, timeout_seconds, error, detail)
  values (
    _op.id, _run_key, _link.id,
    case _event
      when 'heartbeat' then 'progress'
      when 'started' then 'started'
      when 'progress' then 'progress'
      when 'done' then 'done'
      when 'failed' then 'failed'
      when 'blocked' then 'blocked'
      else 'progress'
    end,
    greatest(_attempt, 1), _timeout_seconds, _error, _detail
  )
  on conflict (operator_id, run_key) do update set
    status = excluded.status,
    task_link_id = coalesce(excluded.task_link_id, operator_runs.task_link_id),
    attempt = greatest(operator_runs.attempt, excluded.attempt),
    heartbeat_at = now(),
    finished_at = case when excluded.status in ('done', 'failed', 'blocked', 'timeout')
      then now() else operator_runs.finished_at end,
    error = coalesce(excluded.error, operator_runs.error),
    detail = operator_runs.detail || excluded.detail
  returning * into _run;

  update public.internal_operators set last_run_at = now() where id = _op.id;

  insert into public.operator_audit_log
    (actor, operator_id, task_link_id, kanban_task_id, action, old_status,
     new_status, evidence, from_cron, approval_required, run_key)
  values
    (_actor, _op.id, _link.id, coalesce(_kanban_task_id, _link.kanban_task_id),
     coalesce(_action, _event), _status_velho, coalesce(_status_novo, _status_velho),
     _evidence, _from_cron, _approval_required, _run_key);

  -- ── A ponte com o progresso do cliente ────────────────────────────────
  --
  -- A tarefa sai do VINCULO, e nao so do parametro: quem relatou done por
  -- painel_task_id continua chegando na tarefa certa.
  _tarefa := coalesce(_kanban_task_id, _link.kanban_task_id, _link.painel_task_id);

  if _status_novo = 'done' and _tarefa is not null then
    select pj.client_id, t.title into _client_id, _titulo_tarefa
      from public.tasks t
      join public.projects pj on pj.id = t.project_id
      where t.id = _tarefa
      limit 1;

    if _client_id is not null then
      select coalesce(nullif(trim(p.company_name), ''), p.full_name)
        into _nome_cliente
        from public.profiles p where p.id = _client_id;
      _pronto_cliente := true;

      select id into _memoria_id from public.project_memory
        where client_id = _client_id
          and source = 'operador'
          and metadata->>'run_key' = _run_key
        limit 1;

      if _memoria_id is null then
        insert into public.project_memory
          (client_id, kind, source, title, content, tags, metadata)
        values (
          _client_id,
          'entrega',
          'operador',
          coalesce(_titulo_tarefa, _action, 'Entrega concluida'),
          coalesce(_action, _titulo_tarefa, 'Entrega concluida')
            || E'\n\nEvidencia: ' || coalesce(_evidence, _link.last_evidence, '(sem link)')
            || E'\nOperador: ' || _op.display_name,
          array['operador', _op.slug],
          jsonb_build_object(
            'run_key', _run_key,
            'operator_slug', _op.slug,
            'kanban_task_id', _tarefa,
            'task_link_id', _link.id,
            'pronto_para_cliente', true,
            'client_visible', false
          )
        );
      end if;
    end if;
  end if;

  -- ── O dono sabe de tudo, menos do pulso do cron ───────────────────────
  _notifica := _event <> 'heartbeat';
  if _notifica then
    _mensagem := _op.display_name || case _event
      when 'started' then ' iniciou'
      when 'progress' then ' avancou em'
      when 'done' then case when _status_novo = 'review'
        then ' concluiu SEM evidencia (foi para revisao)' else ' concluiu' end
      when 'failed' then ' falhou em'
      when 'blocked' then ' bloqueou'
      when 'review' then ' enviou para revisao'
      when 'awaiting_input' then ' esta esperando resposta em'
      else ' atualizou'
    end || ' ' || coalesce(nullif(trim(_titulo_tarefa), ''), 'uma tarefa')
      || coalesce(' · ' || _nome_cliente, '')
      || case when _pronto_cliente then ' · PRONTO PARA O CLIENTE' else '' end
      || case when _approval_required then ' · precisa de aprovacao' else '' end;

    -- O link leva ao VINCULO e carrega a run: quem clica no aviso chega no
    -- registro exato, e nao numa lista para procurar de novo.
    insert into public.notifications (user_id, message, notification_type, link)
    select ur.user_id, _mensagem,
      case when _pronto_cliente then 'operator_pronto' else 'operator' end,
      '/execucao?vinculo=' || coalesce(_link.id::text, '')
        || coalesce('&run=' || _run.id::text, '')
    from public.user_roles ur
    where ur.role = 'admin';
  end if;

  return jsonb_build_object(
    'ok', true,
    'operator', _op.slug,
    'link_id', _link.id,
    'run_id', _run.id,
    'run_status', _run.status,
    'link_status', coalesce(_status_novo, _status_velho),
    'attempt', _run.attempt,
    'notified', _notifica,
    'kanban_task_id', _tarefa,
    'registrado_no_progresso', (_status_novo = 'done' and _client_id is not null),
    'pronto_para_cliente', _pronto_cliente
  );
end;
$fn$;

revoke execute on function public.operator_report_event(text, text, text, text, uuid, uuid, text, text, text, text, text, boolean, boolean, integer, integer, jsonb) from anon;
grant execute on function public.operator_report_event(text, text, text, text, uuid, uuid, text, text, text, text, text, boolean, boolean, integer, integer, jsonb) to service_role;

-- ═══════════════ 3) reconciliar os gemeos que ja existem ════════════════

/**
 * Junta vínculos que nasceram gêmeos pelo mesmo run_key.
 *
 * Regra: o MAIS ANTIGO é o verdadeiro — é o que operator_assign criou e o
 * que a fila conhece. Ele recebe o estado final e a evidência do irmão, as
 * runs passam a apontar para ele, e o irmão sai.
 *
 * Isto não apaga histórico: a trilha imutável guarda cada evento,
 * inclusive a criação do duplicado, e o reparo entra nela também. O que
 * sai é um registro de ESTADO que estava mentindo sobre o presente.
 */
create or replace function public.operator_reconciliar_vinculos_gemeos()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  _g record;
  _juntados integer := 0;
begin
  for _g in
    select l.operator_id, l.agent_run_id,
           min(l.created_at) as nascimento
      from public.operator_task_links l
     where l.agent_run_id is not null
     group by l.operator_id, l.agent_run_id
    having count(*) > 1
  loop
    declare
      _verdadeiro public.operator_task_links%rowtype;
      _irmao public.operator_task_links%rowtype;
    begin
      select * into _verdadeiro from public.operator_task_links
       where operator_id = _g.operator_id and agent_run_id = _g.agent_run_id
       order by created_at limit 1;

      for _irmao in
        select * from public.operator_task_links
         where operator_id = _g.operator_id and agent_run_id = _g.agent_run_id
           and id <> _verdadeiro.id
      loop
        -- O verdadeiro herda o que o irmao aprendeu: estado final,
        -- evidencia e o id de tarefa que porventura so ele tinha.
        update public.operator_task_links set
          status = case
            when _irmao.status in ('done', 'review', 'blocked', 'awaiting_input')
             and status not in ('done')
            then _irmao.status else status end,
          last_evidence = coalesce(last_evidence, _irmao.last_evidence),
          last_action = coalesce(last_action, _irmao.last_action),
          next_step = coalesce(next_step, _irmao.next_step),
          kanban_task_id = coalesce(kanban_task_id, _irmao.kanban_task_id, _irmao.painel_task_id),
          painel_task_id = coalesce(painel_task_id, _irmao.painel_task_id),
          approval_required = approval_required or _irmao.approval_required,
          updated_at = now()
        where id = _verdadeiro.id;

        -- A run e o registro da execucao e nao pode se perder: ela passa a
        -- apontar para o vinculo verdadeiro antes de o irmao sair.
        update public.operator_runs
           set task_link_id = _verdadeiro.id
         where task_link_id = _irmao.id;

        insert into public.operator_audit_log
          (actor, operator_id, task_link_id, kanban_task_id, action, old_status, new_status, run_key)
        values
          ('reparo do painel', _g.operator_id, _verdadeiro.id, _verdadeiro.kanban_task_id,
           'vinculo gemeo ' || _irmao.id::text || ' reconciliado no vinculo original',
           _irmao.status, _verdadeiro.status, _g.agent_run_id);

        delete from public.operator_task_links where id = _irmao.id;
        _juntados := _juntados + 1;
      end loop;
    end;
  end loop;

  return jsonb_build_object('gemeos_reconciliados', _juntados, 'em', now());
end;
$fn$;

revoke execute on function public.operator_reconciliar_vinculos_gemeos() from anon;
grant execute on function public.operator_reconciliar_vinculos_gemeos() to authenticated, service_role;

-- Repara o que já está no banco. Idempotente: sem gêmeos, junta zero.
select public.operator_reconciliar_vinculos_gemeos();

-- ══════════════════ 4) o organograma dos catorze ════════════════════════
--
-- A hierarquia veio do dono, nome por nome. Aplico pela MESMA função que o
-- Hermes usa, e não por UPDATE direto: assim a trava de ciclo, a validação
-- de pai e a trilha de auditoria valem também para esta carga inicial. Se
-- alguém tiver escrito um ciclo, isto falha alto em vez de gravar.
--
-- A ordem importa: cada pai é organizado antes dos filhos, para a
-- validação encontrar um pai já existente e coerente.
--
-- Idempotente: rodar de novo reaplica os mesmos valores.

do $organograma$
declare
  _linha record;
begin
  for _linha in
    select * from (values
      ('default',  'Hermes Core', 'Orquestração central',              'Core',       null,       0,   true),
      ('augusto',  'Augusto',     'Gerência Executiva',                'Operações',  'default',  10,  true),
      ('atlas',    'Atlas',       'Gestão de Operações',               'Operações',  'augusto',  20,  true),
      ('vertice',  'Vértice',     'Carteira e Prazos',                 'Operações',  'atlas',    21,  false),
      ('registro', 'Registro',    'Documentação e Evidências',         'Operações',  'atlas',    22,  false),
      ('prisma',   'Prisma',      'QA, Dados e Controle',              'Operações',  'atlas',    23,  false),
      ('helena',   'Helena',      'Marketing e Conteúdo',              'Marketing',  'augusto',  30,  false),
      ('mercurio', 'Mercúrio',    'Comercial e Aquisição',             'Comercial',  'augusto',  40,  true),
      ('radar',    'Radar',       'Inteligência de Mercado',           'Comercial',  'mercurio', 41,  false),
      ('nexo',     'Nexo',        'Finanças e Viabilidade',            'Finanças',   'augusto',  50,  false),
      ('lumen',    'Lumen',       'Métricas e Performance',            'Dados',      'augusto',  60,  false),
      ('cora',     'Cora',        'Saúde e Retenção de Clientes',      'Clientes',   'augusto',  70,  false),
      ('forge',    'Forge',       'Arquitetura e Integrações Técnicas','Tecnologia', 'default',  80,  false),
      ('ris',      'Íris',        'Auditoria e Riscos',                'Auditoria',  'default',  90,  false)
    ) as t(slug, nome, funcao, area, pai, ordem, coordena)
  loop
    -- Operador que não existe é PULADO, não criado: criar aqui, em
    -- silêncio, transformaria um slug digitado errado num agente fantasma.
    -- Cadastrar é ato explícito, por operator_register.
    if exists (select 1 from public.internal_operators where slug = _linha.slug) then
      perform public.operator_update(
        _slug          => _linha.slug,
        _actor         => 'carga inicial do organograma',
        _display_name  => _linha.nome,
        _role          => _linha.funcao,
        _area          => _linha.area,
        _parent_slug   => coalesce(_linha.pai, ''),
        _display_order => _linha.ordem,
        _scope         => null,
        _status        => 'active',
        _is_coordinator=> _linha.coordena
      );
    else
      raise notice 'operador % nao existe; nada aplicado para ele', _linha.slug;
    end if;
  end loop;
end
$organograma$;
