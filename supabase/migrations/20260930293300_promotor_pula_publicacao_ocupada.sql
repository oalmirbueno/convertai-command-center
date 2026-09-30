-- Frente PERF-banco (30/09/2026), achado B06: o promotor da Agenda para de
-- entrar em deadlock com o agendador da Mesa.
--
-- O que aconteceu em 29/09 18:32:01: o cron 11 (editorial_ciclo_publicacao ->
-- editorial_promover_planejados) e o cron 78 (mesa_agendar_aprovados) rodam
-- no mesmo segundo. O promotor já segurava a trava global da Agenda
-- (editorial_lock_task_sync, pega pelo gatilho de status da publicação na
-- volta anterior do laço) e foi inserir o pedido de entrega de uma publicação
-- que o agendador da Mesa acabara de inserir (e ainda não tinha confirmado).
-- O agendador, por sua vez, esperava a trava global. Deadlock. A falha foi
-- engolida pelo EXCEPTION WHEN OTHERS e ficou só no jsonb de retorno, que o
-- pg_cron descarta: a execução apareceu como 'succeeded'.
--
-- A correção, só em editorial_promover_planejados, no estilo de remendo das
-- migrations 20260927020000 (troca de texto com guarda):
--   1) Antes de cada publicação, o promotor pega a trava global
--      (editorial_lock_task_sync). É idempotente: da segunda volta em diante
--      ela já está com ele. Assim a ordem fica igual à de save_editorial_post
--      (trava global -> publicação -> pedido de entrega).
--   2) Primeira coisa dentro do bloco: trava a publicação com
--      FOR UPDATE SKIP LOCKED. Se outra transação estiver mexendo nela (o
--      pedido de entrega do agendador trava a publicação pela chave
--      estrangeira), o promotor pula e ela fica para o minuto seguinte, que é
--      o que já acontecia depois do erro. O promotor nunca espera por uma
--      publicação, e o ciclo some. O cursor do FOR não ganha FOR UPDATE, para
--      não travar as linhas da frente.
--   3) Toda falha que cair no EXCEPTION vai também para o log do Postgres
--      (RAISE WARNING), além do retorno: nenhum erro engolido.
--
-- O que NÃO muda: mesa_agendar_aprovados (pular lá marcaria processado_em e
-- perderia a captura), a trava global, os gatilhos, os filtros, a janela de
-- 6 h, o insert ON CONFLICT DO NOTHING, o selo de aprovação, a transição
-- oficial e as chaves do retorno ('promovidos', 'nao_promovidos', 'falhas',
-- 'em'). A versão que vai para a transição continua a lida no laço.
--
-- Idempotente (não faz nada se já tiver o SKIP LOCKED) e falha alto se o
-- texto esperado não estiver lá. Não aplicar direto: o dono aplica na
-- integração (SQL Editor).

DO $patch$
DECLARE
  _fonte text;
  _laco text := '  loop
    begin
      -- A transicao recusa horario no passado.';
  _laco_novo text := '  loop
    -- Frente PERF-banco (B06): trava global antes da publicacao, na mesma
    -- ordem de save_editorial_post. Da segunda volta em diante ja esta com
    -- este promotor (a trava vale ate o fim da transacao).
    perform public.editorial_lock_task_sync();
    begin
      -- Publicacao ocupada por outra transacao (por exemplo, o agendador da
      -- Mesa inserindo o pedido de entrega dela) fica para o minuto seguinte:
      -- o promotor nunca espera por uma publicacao, e nao ha deadlock.
      perform 1
        from public.editorial_publications
       where id = _pub.id
         and status = ''planned''
         for update skip locked;
      if not found then
        continue;
      end if;

      -- A transicao recusa horario no passado.';
  _falha text := '      _ignorados := _ignorados + 1;
';
  _falha_nova text := '      _ignorados := _ignorados + 1;
      -- Frente PERF-banco (B06): a falha tambem vai para o log do Postgres,
      -- porque o pg_cron descarta o retorno.
      raise warning ''editorial_promover_planejados: publicacao % nao promovida: %'', _pub.id, sqlerrm;
';
BEGIN
  SELECT pg_get_functiondef('public.editorial_promover_planejados(interval)'::regprocedure) INTO _fonte;
  IF position('for update skip locked' IN _fonte) > 0 THEN
    RETURN; -- já aplicado
  END IF;
  IF position(_laco IN _fonte) = 0 OR position(_falha IN _fonte) = 0 THEN
    RAISE EXCEPTION 'patch editorial_promover_planejados (B06): alvo nao encontrado';
  END IF;
  EXECUTE replace(replace(_fonte, _laco, _laco_novo), _falha, _falha_nova);
END
$patch$;

-- Conferência depois de aplicar (só leitura):
-- select position('for update skip locked' in pg_get_functiondef('public.editorial_promover_planejados(interval)'::regprocedure)) > 0 as pula_ocupada,
--        position('raise warning' in pg_get_functiondef('public.editorial_promover_planejados(interval)'::regprocedure)) > 0 as falha_no_log;
-- select status, return_message from cron.job_run_details where jobid = 11 order by start_time desc limit 5;
--
-- Teste de concorrência (manual, SQL Editor, duas abas, numa cópia ou com uma
-- publicação de teste 'planned' que o promotor pegaria):
--   aba 1: begin; select 1 from public.editorial_publications where id = '<id>' for update;
--   aba 2: select public.editorial_promover_planejados();  -- volta na hora, sem esperar e sem falha para <id>
--   aba 1: rollback;
--   aba 2: select public.editorial_promover_planejados();  -- agora promove <id>
