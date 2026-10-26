-- Horário comercial do Ego (26/10/2026, MCP 2.21.0): pedido do dono — "os agentes usam o Ego das 9h às 18h;
-- fora disso trabalham na nuvem e deixam preparado; quando abre o horário, já vão pro Ego e executam".
--
-- O MCP (aceleriq_navegador_do_pc) aceita o pedido fora da janela como agendado: estado continua 'aprovada'
-- (a autorização já foi dada) e a hora fica em executar_a_partir_de (próxima abertura: 9h do próximo dia útil,
-- America/Sao_Paulo). A pegada do worker não entrega pedido antes dessa hora, e a ordem passa a ser a
-- prioridade (1 alta, 2 normal, 3 baixa) e depois a hora em que pode rodar. O corte de "24 h aprovada e
-- esquecida" passa a contar da hora agendada (pedido de sexta à noite não morre antes de segunda às 9h).
--
-- Aditiva e idempotente: duas colunas novas com padrão, a função de pegar recriada com a mesma assinatura.
-- Nada é apagado. Tarefas antigas ficam com executar_a_partir_de nulo e prioridade 2 (mesma ordem de antes).

ALTER TABLE public.agente_computador_tarefas ADD COLUMN IF NOT EXISTS executar_a_partir_de timestamptz;
ALTER TABLE public.agente_computador_tarefas ADD COLUMN IF NOT EXISTS prioridade smallint NOT NULL DEFAULT 2;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agente_computador_tarefas_prioridade_check') THEN
    ALTER TABLE public.agente_computador_tarefas
      ADD CONSTRAINT agente_computador_tarefas_prioridade_check CHECK (prioridade BETWEEN 1 AND 3);
  END IF;
END $$;

COMMENT ON COLUMN public.agente_computador_tarefas.executar_a_partir_de IS
  'Horário comercial do Ego: pedido aceito fora da janela só é entregue ao worker a partir desta hora (nulo = já).';
COMMENT ON COLUMN public.agente_computador_tarefas.prioridade IS
  'Ordem na fila quando a janela abre: 1 alta, 2 normal, 3 baixa.';

CREATE INDEX IF NOT EXISTS agente_computador_tarefas_fila_idx
  ON public.agente_computador_tarefas (prioridade, executar_a_partir_de, aprovado_em)
  WHERE estado = 'aprovada';

CREATE OR REPLACE FUNCTION public.computador_tarefa_pegar(_token uuid, _executor text, _casos text[], _versao text DEFAULT NULL, _provedores text[] DEFAULT NULL)
RETURNS SETOF public.agente_computador_tarefas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _r public.agente_computador_tarefas;
  -- Worker antigo (sem a lista) só fala com a Anthropic.
  _prov text[] := COALESCE(_provedores, ARRAY['anthropic']::text[]);
BEGIN
  IF _token IS NULL OR _executor IS NULL OR char_length(_executor) NOT BETWEEN 1 AND 80 THEN
    RETURN;
  END IF;

  INSERT INTO public.computador_executores (nome, visto_em, versao, casos, provedores)
  VALUES (_executor, now(), left(_versao, 40), COALESCE(_casos, '{}'::text[]), COALESCE(_provedores, '{}'::text[]))
  ON CONFLICT (nome) DO UPDATE
    SET visto_em = now(),
        versao = COALESCE(left(EXCLUDED.versao, 40), public.computador_executores.versao),
        casos = EXCLUDED.casos,
        provedores = CASE WHEN _provedores IS NULL THEN public.computador_executores.provedores ELSE EXCLUDED.provedores END;

  -- Trava vencida (worker caiu no meio): falha com motivo, sem repetir sozinha.
  UPDATE public.agente_computador_tarefas
     SET estado = 'falhou', motivo = 'O navegador do agente parou no meio (máquina desligada?). Peça de novo.',
         trava_token = NULL, trava_ate = NULL, terminado_em = now(), atualizado_em = now()
   WHERE estado = 'executando' AND caso IS NOT NULL AND trava_ate < now();

  -- Aprovada e esquecida por mais de 24 h (contadas da hora agendada, quando há) sai da fila.
  UPDATE public.agente_computador_tarefas
     SET estado = 'cancelada', motivo = 'Ficou aprovada mais de um dia sem executor ligado. Peça de novo.',
         terminado_em = now(), atualizado_em = now()
   WHERE estado = 'aprovada' AND caso IS NOT NULL
     AND COALESCE(executar_a_partir_de, aprovado_em) < now() - interval '24 hours';

  SELECT t.* INTO _r
    FROM public.agente_computador_tarefas AS t
   WHERE t.estado = 'aprovada'
     AND t.caso IS NOT NULL
     AND t.caso = ANY (COALESCE(_casos, '{}'::text[]))
     AND t.aprovado_por IS NOT NULL
     AND t.aprovado_em IS NOT NULL
     -- Horário comercial do Ego: agendado só a partir da hora.
     AND (t.executar_a_partir_de IS NULL OR t.executar_a_partir_de <= now())
     -- Tarefa com modelo só vai para o worker que tem a chave daquele provedor.
     AND (t.modelo_id IS NULL OR split_part(t.modelo_id, ':', 1) = ANY (_prov))
   ORDER BY t.prioridade, COALESCE(t.executar_a_partir_de, t.aprovado_em), t.aprovado_em
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.agente_computador_tarefas
     SET estado = 'executando', executor = _executor, trava_token = _token,
         trava_ate = now() + interval '10 minutes', iniciado_em = now(), atualizado_em = now()
   WHERE id = _r.id
  RETURNING * INTO _r;
  RETURN NEXT _r;
END;
$$;

REVOKE ALL ON FUNCTION public.computador_tarefa_pegar(uuid, text, text[], text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.computador_tarefa_pegar(uuid, text, text[], text, text[]) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Conferência (só leitura):
-- select column_name, data_type, column_default from information_schema.columns
--  where table_name = 'agente_computador_tarefas' and column_name in ('executar_a_partir_de', 'prioridade');
-- select id, estado, prioridade, executar_a_partir_de from public.agente_computador_tarefas
--  where caso = 'pc_ego' and estado = 'aprovada' order by prioridade, executar_a_partir_de;
