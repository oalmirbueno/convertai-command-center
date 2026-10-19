-- 19/10/2026 (dono, com o print do cartão "Verzelo: conjunto contínuo travado por acesso à
-- Meta": "ter uma área que destrava tudo por ali; eu respondo e já resolvo ali mesmo, sem ir
-- para outro lugar, qualquer ação"). Destravar uma execução no próprio cartão: responder,
-- pode seguir, concluir ou encerrar.
--
-- 51 das 65 execuções travadas dos últimos 3 dias não têm tarefa (vínculo). Sem vínculo, a
-- resposta não tinha por onde chegar ao agente. Aqui o vínculo nasce na hora, com a chave da
-- execução (o próximo relato com essa chave cai nele): a resposta entra na fila do agente e no
-- diário, e a decisão passa pela mesma mão humana de sempre (operator_human_action). A
-- execução fecha, marcada como destravada, e sai de "Bloqueada".
--
-- Só admin: vínculo sem tarefa só passa em require_rpc_link_staff para admin.
CREATE OR REPLACE FUNCTION public.operator_destravar_execucao(_run_id uuid, _acao text, _texto text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _run public.operator_runs%rowtype;
  _link public.operator_task_links%rowtype;
  _link_id uuid;
  _quem text;
  _texto_limpo text := nullif(btrim(coalesce(_texto, '')), '');
  _status text;
  _nota text;
  _entrada text;
  _corpo text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not_allowed: só o admin destrava execução pelo painel' USING ERRCODE = '42501';
  END IF;
  IF _acao IS NULL OR _acao NOT IN ('responder', 'pode_seguir', 'concluir', 'encerrar') THEN
    RAISE EXCEPTION 'acao_invalida: %', _acao;
  END IF;
  IF _acao = 'responder' AND _texto_limpo IS NULL THEN
    RAISE EXCEPTION 'resposta_vazia: escreva a resposta ao agente';
  END IF;
  IF length(coalesce(_texto_limpo, '')) > 4000 THEN
    RAISE EXCEPTION 'resposta_longa: até 4000 caracteres';
  END IF;

  SELECT * INTO _run FROM public.operator_runs WHERE id = _run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'execucao_nao_encontrada';
  END IF;

  SELECT coalesce(p.full_name, 'equipe') INTO _quem FROM public.profiles p WHERE p.id = auth.uid();
  _quem := coalesce(_quem, 'equipe');

  _link_id := _run.task_link_id;
  IF _link_id IS NULL THEN
    INSERT INTO public.operator_task_links
      (operator_id, agent_run_id, execution_source, status, last_action, next_step, block_reason)
    VALUES (
      _run.operator_id, _run.run_key, 'painel', 'blocked',
      left(coalesce(nullif(_run.detail->>'title', ''), nullif(_run.detail->>'action', ''), 'Execução sem tarefa'), 500),
      left(nullif(_run.detail->>'next_step', ''), 500),
      left(coalesce(nullif(_run.error, ''), 'Esperando a equipe'), 500))
    RETURNING id INTO _link_id;
    UPDATE public.operator_runs SET task_link_id = _link_id WHERE id = _run.id;
  END IF;

  _status := CASE WHEN _acao IN ('concluir', 'encerrar') THEN 'done' ELSE 'queued' END;
  _nota := CASE _acao
    WHEN 'responder' THEN left('Resposta de ' || _quem || ': ' || _texto_limpo, 900)
    WHEN 'pode_seguir' THEN _quem || ' liberou: pode seguir com o melhor julgamento.'
    WHEN 'concluir' THEN 'Concluída por ' || _quem || '.'
    ELSE 'Encerrada por ' || _quem || ': não continuar.'
  END;
  SELECT * INTO _link FROM public.operator_human_action(_link_id, _status, _nota, true);

  _entrada := CASE _acao WHEN 'responder' THEN 'resposta_insumo' WHEN 'pode_seguir' THEN 'instrucao' ELSE 'decisao' END;
  _corpo := CASE _acao
    WHEN 'responder' THEN _texto_limpo
    WHEN 'pode_seguir' THEN coalesce(_texto_limpo, 'Pode seguir. Use o seu melhor julgamento: se for conferência, divergência ou prova faltando, peça ao revisor e siga com o que ele decidir. Volte com o resultado pronto, com a prova.')
    WHEN 'concluir' THEN coalesce(_texto_limpo, 'Concluída. Pode fechar.')
    ELSE coalesce(_texto_limpo, 'Encerrada: não continuar.')
  END;
  INSERT INTO public.operator_participations
    (task_link_id, kanban_task_id, author_kind, author_id, entry_type, title, body, attachments)
  VALUES (
    _link_id, _link.kanban_task_id, 'humano', auth.uid(), _entrada,
    CASE _acao WHEN 'responder' THEN 'Resposta do dono' WHEN 'pode_seguir' THEN 'Pode seguir' ELSE NULL END,
    _corpo, '[]'::jsonb);

  UPDATE public.operator_runs SET
    status = 'done',
    finished_at = now(),
    detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('destravado',
      jsonb_build_object('acao', _acao, 'por', _quem, 'em', now(), 'texto', _texto_limpo))
  WHERE id = _run.id;

  RETURN jsonb_build_object('ok', true, 'acao', _acao, 'link_id', _link_id, 'link_status', _link.status, 'run_status', 'done');
END;
$function$;

REVOKE ALL ON FUNCTION public.operator_destravar_execucao(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.operator_destravar_execucao(uuid, text, text) TO authenticated;
