-- ═══════════════════════════════════════════════════════════════════════
-- QUANDO O AGENTE TERMINA, A EXECUCAO FECHA E O KANBAN ANDA.
--
-- Dois defeitos que se somavam para deixar o painel confuso:
--
-- 1) FALSO INCIDENTE. O mapa de eventos era:
--        when 'done' then 'done' ... else 'progress'
--    `review` e `awaiting_input` caiam no else e viravam `progress` — ou
--    seja, "ainda executando". Quinze minutos depois o expirador matava
--    como "timeout: sem heartbeat dentro do prazo".
--    Os 14 incidentes de 29/08 sao todos isso: os agentes TERMINARAM e
--    ficaram esperando um humano. O painel gritava falha onde houve
--    trabalho feito — e ruido assim esconde a falha de verdade.
--
-- 2) KANBAN PARADO. `operator_report_event` nunca tocava em tarefas, por
--    uma regra antiga de nao mexer no trabalho de gente. O efeito pratico
--    foi um monte de tarefa "pendente" enquanto o agente ja tinha
--    trabalhado nela.
--    Agora o Kanban ANDA — mas so ate `review`. Concluir de verdade
--    continua sendo ato humano: agente nenhum marca trabalho como
--    aprovado, e `assigned_to` continua intocado.
--
-- Nao altera titulos, prazos, responsaveis humanos, financeiro nem
-- conteudo de cliente. Rollback: restaurar as duas funcoes anteriores e
-- o CHECK de operator_runs.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1) Esperar humano nao e executar ───────────────────────────────────
--
-- `review` e `awaiting_input` passam a ser estados TERMINAIS do run: o
-- agente acabou a parte dele. Sem isso, todo trabalho que termina esperando
-- uma decisao vira timeout — o alarme mais barulhento e menos util que
-- existe, porque avisa de algo que deu certo.
alter table public.operator_runs
  drop constraint if exists operator_runs_status_check;
alter table public.operator_runs
  add constraint operator_runs_status_check
  check (status in ('started','progress','done','failed','blocked','timeout',
                    'review','awaiting_input'));

-- ─── 2) O reparo dos 14 falsos incidentes ───────────────────────────────
--
-- Só os que tem vinculo em `review`/`awaiting_input`: sao provadamente
-- trabalho concluido que virou timeout por causa do mapa. Timeout de
-- verdade (vinculo em in_progress) fica como esta — apagar isso seria
-- reescrever historia.
update public.operator_runs r
   set status = l.status,
       error = null
  from public.operator_task_links l
 where l.id = r.task_link_id
   and r.status = 'timeout'
   and r.error = 'timeout: sem heartbeat dentro do prazo'
   and l.status in ('review', 'awaiting_input');

-- ─── 3) O evento fecha o run certo E move o card ────────────────────────
create or replace function public.operator_status_do_run(_event text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case _event
    when 'heartbeat' then 'progress'
    when 'started' then 'started'
    when 'progress' then 'progress'
    when 'done' then 'done'
    when 'failed' then 'failed'
    when 'blocked' then 'blocked'
    -- Os dois que faltavam. Terminais: o agente acabou e a bola esta com
    -- uma pessoa.
    when 'review' then 'review'
    when 'awaiting_input' then 'awaiting_input'
    else 'progress'
  end
$$;

/**
 * Para onde o card do Kanban vai quando o agente reporta.
 *
 * A regra em uma frase: o agente empurra o card ATE a revisao, e nunca
 * alem. Marcar como aprovado/concluido e ato de gente — se o agente
 * pudesse fechar, "concluido" deixaria de significar "alguem conferiu".
 *
 * `null` significa NAO MEXER: bloqueio e espera nao movem o card, porque
 * o trabalho continua sendo daquela coluna.
 */
create or replace function public.operator_status_do_card(
  _event text, _status_atual text, _tem_evidencia boolean
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    -- Comecou a trabalhar: tira da fila, poe em andamento.
    when _event = 'started' and _status_atual in ('backlog','todo') then 'doing'
    -- Entregou com prova, ou pediu revisao: vai para revisao humana.
    when _event = 'review' then
      case when _status_atual in ('backlog','todo','doing') then 'review' else null end
    when _event = 'done' and _tem_evidencia then
      case when _status_atual in ('backlog','todo','doing') then 'review' else null end
    -- done SEM evidencia ja e rebaixado a review no vinculo; o card
    -- acompanha, mas nunca passa de review.
    when _event = 'done' and not _tem_evidencia then
      case when _status_atual in ('backlog','todo','doing') then 'review' else null end
    else null
  end
$$;

-- ─── 4) Patch cirurgico em operator_report_event ────────────────────────
--
-- Patch textual sobre a definicao VIVA, e nao um create-or-replace do
-- corpo inteiro: a funcao tem quase 300 linhas de regras acumuladas
-- (idempotencia, notificacao seletiva, memoria de projeto, limpeza de
-- credencial na evidencia) e reescreve-la para mudar dois pontos seria
-- convidar uma regressao em tudo o que nao mudou.
--
-- Se as ancoras nao existirem, a migration ABORTA. Fingir que corrigiu e
-- pior que falhar.
do $patch$
declare
  _def text;
  _oid oid;
  _mapa constant text := $a$    case _event
      when 'heartbeat' then 'progress'
      when 'started' then 'started'
      when 'progress' then 'progress'
      when 'done' then 'done'
      when 'failed' then 'failed'
      when 'blocked' then 'blocked'
      else 'progress'
    end,$a$;
  _mapa_novo constant text := $n$    public.operator_status_do_run(_event),$n$;
  _antes_do_return constant text := $a$  return jsonb_build_object(
    'ok', true,
    'operator', _op.slug,$a$;
  _kanban constant text := $n$  -- ─── O CARD ANDA JUNTO ───────────────────────────────────────────
  --
  -- Ate aqui o agente trabalhava e a tarefa ficava parada onde estava:
  -- dezenas de "pendentes" que ja tinham sido tocadas. O card agora
  -- acompanha o trabalho — ate a revisao, nunca alem.
  --
  -- `assigned_to` NAO e tocado: mover a coluna e dizer em que pe esta o
  -- trabalho; dizer de quem ele e continua sendo decisao humana.
  if _tarefa is not null then
    declare
      _status_card text;
      _card_novo text;
    begin
      select t.status into _status_card from public.tasks t where t.id = _tarefa;
      _card_novo := public.operator_status_do_card(
        _event, _status_card, _evidence is not null and btrim(_evidence) <> ''
      );
      if _card_novo is not null and _card_novo is distinct from _status_card then
        update public.tasks set status = _card_novo where id = _tarefa;
        insert into public.operator_audit_log
          (actor, operator_id, task_link_id, kanban_task_id, action, old_status, new_status)
        values ('mcp:' || _op.slug, _op.id, _link.id, _tarefa,
                'card movido pelo trabalho do agente', _status_card, _card_novo);
      end if;
    exception when others then
      -- Mover o card NAO pode derrubar o relato. O trabalho aconteceu; se
      -- o Kanban recusar (guard editorial, por exemplo), isso vira nota na
      -- trilha e o evento segue.
      insert into public.operator_audit_log
        (actor, operator_id, task_link_id, kanban_task_id, action)
      values ('mcp:' || _op.slug, _op.id, _link.id, _tarefa,
              'card NAO moveu: ' || left(sqlerrm, 200));
    end;
  end if;

$n$;
begin
  select p.oid into _oid from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'operator_report_event';
  if _oid is null then
    raise exception 'patch_alvo_ausente: operator_report_event nao existe';
  end if;

  _def := pg_get_functiondef(_oid);

  if position(_mapa in _def) = 0 then
    raise exception 'patch_ancora_nao_encontrada: o mapa de eventos de operator_report_event mudou de forma; revise antes de aplicar';
  end if;
  if position(_antes_do_return in _def) = 0 then
    raise exception 'patch_ancora_nao_encontrada: o retorno de operator_report_event mudou de forma; revise antes de aplicar';
  end if;

  _def := replace(_def, _mapa, _mapa_novo);
  _def := replace(_def, _antes_do_return, _kanban || _antes_do_return);
  execute _def;
end $patch$;
