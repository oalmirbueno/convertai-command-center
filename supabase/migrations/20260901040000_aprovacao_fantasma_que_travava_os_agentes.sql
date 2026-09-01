-- ═══════════════════════════════════════════════════════════════════════
-- A APROVACAO FANTASMA QUE PARALISOU OS AGENTES.
--
-- Treze vinculos estavam com approval_required = true e NENHUM tinha
-- registro de aprovacao — nem pendente, nem decidido. A tela dizia
-- "esperando decisao sua" e o painel de aprovacoes estava vazio: uma
-- pergunta sem lugar onde ser respondida.
--
-- A causa esta em uma linha de operator_report_event:
--
--     approval_required = _approval_required or approval_required
--
-- Um OU que so sabe LIGAR. Uma vez verdadeira, a flag nunca mais volta —
-- e a funcao jamais cria a linha em operator_approvals que permitiria
-- decidir. O agente marca "preciso de aprovacao", ninguem consegue
-- aprovar, e o trabalho para ali para sempre.
--
-- Era isso o "ainda esta pedindo aprovacao demais" e o "os agentes nao
-- estao fazendo nada": a mesma linha, vista de dois angulos.
--
-- POR QUE NAO CRIO A APROVACAO QUE FALTA. Seria o conserto obvio, e esta
-- errado: action_kind e um vocabulario fechado de acoes concretas
-- (publicar, gastar, enviar_contrato, alterar_orcamento...). Nao existe
-- "aprovacao generica". O booleano do report_event nunca diz QUAL acao o
-- agente quer fazer, entao eu teria de escolher uma — inventando a
-- natureza do pedido e pondo na frente do dono uma decisao que ninguem
-- formulou. Pedido de aprovacao se abre por operator_request_approval,
-- que exige dizer o que se quer fazer.
--
-- Tres correcoes:
--
--  A) A flag deixa de ser estado proprio e passa a ESPELHAR a realidade:
--     verdadeira enquanto existir aprovacao pendente, falsa quando nao
--     existir. Estado duplicado sempre diverge; derivado nao tem como.
--
--  B) Sinalizar aprovacao sem abrir o pedido passa a deixar RASTRO na
--     trilha, em vez de travar o trabalho em silencio. O defeito fica
--     visivel para quem cuida dos agentes, e o trabalho segue.
--
--  C) Os treze presos sao soltos, com registro do motivo. Some a trava,
--     nao a historia.
--
-- Nao altera tarefas, conteudo, nem status de trabalho. Nenhuma aprovacao
-- real e criada, decidida ou apagada. Rollback: restaurar a funcao e
-- reaplicar a flag a partir da trilha.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── A + B) A flag espelha a aprovacao; o desvio deixa rastro ───────────
--
-- Patch cirurgico na definicao VIVA: a funcao tem centenas de linhas de
-- regras acumuladas (memoria do cliente, notificacao, movimento do card,
-- auditoria) e reescreve-la para mudar um ponto seria arriscar o resto.
do $patch$
declare
  _def text;
  _oid oid;

  _alvo constant text := $a$      approval_required = _approval_required or approval_required,$a$;
  _novo constant text := $n$      -- A flag ESPELHA a aprovacao, e nao o contrario. Antes isto era
      -- "_approval_required or approval_required": um OU que so sabia
      -- ligar, e prendia o vinculo numa pergunta que nunca existiu.
      approval_required = exists (
        select 1 from public.operator_approvals a
         where a.task_link_id = _link.id and a.status = 'pendente'
      ),$n$;

  _ancora constant text := $a$  _tarefa := coalesce(_kanban_task_id, _link.kanban_task_id, _link.painel_task_id);$a$;
  _bloco constant text := $n$  -- SINALIZAR APROVACAO SEM ABRIR O PEDIDO agora deixa rastro.
  --
  -- O booleano nao diz QUAL acao o agente quer fazer, e action_kind e um
  -- vocabulario fechado: nao da para abrir o pedido por ele sem inventar a
  -- natureza da coisa. Entao o trabalho SEGUE e o desvio fica registrado,
  -- em vez de travar em silencio como travou treze vinculos.
  if _approval_required and _link.id is not null
     and not exists (
       select 1 from public.operator_approvals a
        where a.task_link_id = _link.id and a.status = 'pendente'
     ) then
    insert into public.operator_audit_log
      (actor, operator_id, task_link_id, kanban_task_id, action, evidence, run_key)
    values (
      'sistema', _op.id, _link.id, coalesce(_kanban_task_id, _link.kanban_task_id),
      'agente sinalizou aprovacao sem abrir o pedido',
      'O agente ' || _op.slug || ' passou _approval_required=true em report_event, '
        || 'mas nao ha aprovacao pendente para este vinculo. Pedido de aprovacao se '
        || 'abre por operator_request_approval, dizendo QUAL acao se quer fazer. '
        || 'O trabalho seguiu; nada ficou travado.',
      _run_key
    );
  end if;

  _tarefa := coalesce(_kanban_task_id, _link.kanban_task_id, _link.painel_task_id);$n$;
begin
  select p.oid into _oid from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'operator_report_event';
  if _oid is null then
    raise exception 'patch_alvo_ausente: operator_report_event nao existe';
  end if;

  _def := pg_get_functiondef(_oid);
  if position(_alvo in _def) = 0 then
    raise exception 'patch_ancora_nao_encontrada: o OU grudento da flag mudou de forma';
  end if;
  if position(_ancora in _def) = 0 then
    raise exception 'patch_ancora_nao_encontrada: o ponto de insercao do bloco mudou';
  end if;

  _def := replace(_def, _alvo, _novo);
  _def := replace(_def, _ancora, _bloco);
  execute _def;
end $patch$;

-- ─── C) Soltar os presos, deixando o motivo na trilha ───────────────────
insert into public.operator_audit_log
  (actor, operator_id, task_link_id, kanban_task_id, action, evidence)
select 'sistema', l.operator_id, l.id, l.kanban_task_id,
       'trava de aprovacao fantasma removida',
       'approval_required estava true sem NENHUMA aprovacao registrada para o '
       || 'vinculo. A tela pedia decisao e o painel de aprovacoes estava vazio: '
       || 'nao havia o que aprovar. Causa: o OU grudento em operator_report_event, '
       || 'corrigido nesta migracao. O status do trabalho (' || coalesce(l.status, 'sem status')
       || ') nao foi tocado.'
  from public.operator_task_links l
 where l.approval_required = true
   and not exists (
     select 1 from public.operator_approvals a where a.task_link_id = l.id
   );

update public.operator_task_links l
   set approval_required = false
 where l.approval_required = true
   and not exists (
     select 1 from public.operator_approvals a where a.task_link_id = l.id
   );
