-- Ritual seg/qua/sex: aprovado que vence sem envio e o dia sem lote (10/11/2026).
--
-- O que aconteceu: o lote do Hermes de 02/11 (9 clientes, validade de 7 dias) ficou parado. O da SKC foi
-- aprovado em 07/11 e venceu em 09/11 sem envio; os outros 8 venceram sem decisão. Ninguém foi avisado.
-- E a fila do agente seguia oferecendo o aprovado vencido em "aprovados_para_enviar": um texto de uma
-- semana atrás podia ir ao cliente depois de o ritual seguinte já ter saído.
--
-- O que muda:
--   1. central_review_fila_para_agente: aprovado vencido sai de "aprovados_para_enviar" e aparece em
--      "vencidos_sem_envio", com a ordem de NÃO enviar e preparar o ritual atual;
--   2. app_private.ritual_vigiar_envio(): de hora em hora (pg_cron), avisa os admins no sino, no máximo
--      uma vez por dia e por assunto:
--        - ritual aprovado há mais de 3 horas e ainda não enviado;
--        - ritual esperando decisão que vence nas próximas 24 horas;
--        - segunda, quarta ou sexta depois das 11h sem nenhum ritual do dia preparado ou publicado.
--
-- Não envia nada a cliente: só lê e avisa a equipe.

CREATE OR REPLACE FUNCTION public.central_review_fila_para_agente(_operator_slug text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _esperando jsonb;
  _aprovados jsonb;
  _rascunhos jsonb;
  _enviados jsonb;
  _vencidos jsonb;
BEGIN
  PERFORM app_private.agente_assume_admin(_operator_slug);

  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) INTO _esperando FROM (
    SELECT a.id AS approval_id, a.client_id, COALESCE(NULLIF(p.company_name, ''), p.full_name) AS cliente,
           a.report_id, a.payload->'report'->>'title' AS titulo,
           a.payload->'report'->'metrics'->>'ritual_type' AS ritual,
           a.payload->'report'->>'summary' AS mensagem, a.payload->'report'->>'next_steps' AS proximo_passo,
           a.payload->'destination' AS destino, a.status, a.payload_version, a.payload_hash,
           a.valid_until, a.created_at, a.decision_note
      FROM public.operator_approvals a LEFT JOIN public.profiles p ON p.id = a.client_id
     WHERE a.origin = 'central' AND a.status IN ('pendente', 'adiado') AND a.executed_at IS NULL
       AND a.invalidated_at IS NULL AND (a.valid_until IS NULL OR a.valid_until > now())
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.decided_at DESC), '[]'::jsonb) INTO _aprovados FROM (
    SELECT a.id AS approval_id, a.client_id, COALESCE(NULLIF(p.company_name, ''), p.full_name) AS cliente,
           a.report_id, a.payload->'report'->>'title' AS titulo,
           a.payload->'report'->'metrics'->>'ritual_type' AS ritual,
           a.payload->'report'->>'summary' AS mensagem, a.payload->'report'->>'next_steps' AS proximo_passo,
           a.payload->'destination' AS destino, a.decided_at, a.decision_note, a.valid_until
      FROM public.operator_approvals a LEFT JOIN public.profiles p ON p.id = a.client_id
     WHERE a.origin = 'central' AND a.status = 'aprovado' AND a.executed_at IS NULL AND a.invalidated_at IS NULL
       AND (a.valid_until IS NULL OR a.valid_until > now())
  ) x;

  -- Aprovado ou pendente que passou do prazo sem envio: sai da lista de envio (o texto envelheceu) e fica à vista.
  SELECT COALESCE(jsonb_agg(x ORDER BY x.valid_until DESC), '[]'::jsonb) INTO _vencidos FROM (
    SELECT a.id AS approval_id, a.client_id, COALESCE(NULLIF(p.company_name, ''), p.full_name) AS cliente,
           a.report_id, a.payload->'report'->>'title' AS titulo,
           a.payload->'report'->'metrics'->>'ritual_type' AS ritual,
           a.status, a.decided_at, a.valid_until
      FROM public.operator_approvals a LEFT JOIN public.profiles p ON p.id = a.client_id
     WHERE a.origin = 'central' AND a.status IN ('aprovado', 'pendente', 'adiado') AND a.executed_at IS NULL
       AND a.invalidated_at IS NULL AND a.valid_until IS NOT NULL AND a.valid_until <= now()
       AND a.valid_until > now() - interval '21 days'
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb) INTO _rascunhos FROM (
    SELECT r.id AS report_id, r.client_id, COALESCE(NULLIF(p.company_name, ''), p.full_name) AS cliente,
           r.title AS titulo, r.metrics->>'ritual_type' AS ritual, r.summary AS mensagem, r.next_steps AS proximo_passo,
           r.review_version, r.created_at
      FROM public.reports r LEFT JOIN public.profiles p ON p.id = r.client_id
     WHERE r.status = 'draft' AND r.created_at > now() - interval '30 days'
       AND NOT EXISTS (
         SELECT 1 FROM public.operator_approvals a
          WHERE a.origin = 'central' AND a.report_id = r.id AND a.invalidated_at IS NULL
            AND a.executed_at IS NULL AND a.status IN ('pendente', 'adiado', 'aprovado'))
     ORDER BY r.created_at DESC LIMIT 50
  ) x;

  SELECT COALESCE(jsonb_agg(x ORDER BY x.executed_at DESC), '[]'::jsonb) INTO _enviados FROM (
    SELECT a.id AS approval_id, COALESCE(NULLIF(p.company_name, ''), p.full_name) AS cliente,
           a.payload->'report'->>'title' AS titulo, a.executed_at, a.execution_evidence
      FROM public.operator_approvals a LEFT JOIN public.profiles p ON p.id = a.client_id
     WHERE a.origin = 'central' AND a.executed_at IS NOT NULL
     ORDER BY a.executed_at DESC LIMIT 20
  ) x;

  RETURN jsonb_build_object(
    'esperando_decisao', _esperando,
    'aprovados_para_enviar', _aprovados,
    'rascunhos_sem_pedido', _rascunhos,
    'enviados_recentes', _enviados,
    'vencidos_sem_envio', _vencidos,
    'como_agir', jsonb_build_array(
      'rascunhos_sem_pedido: revise o texto (aceleriq_create_report_draft cria ou ajusta) e prepare com aceleriq_central_review_preparar informando o destino.',
      'esperando_decisao: leve ao dono no WhatsApp; quando ele responder, registre com aceleriq_central_review_decidir (aprovado, rejeitado, alteracoes_pedidas) citando a mensagem dele como evidencia.',
      'aprovados_para_enviar: envie ao destino congelado e registre com aceleriq_central_review_marcar_enviado, com a evidencia do envio. Sem esse registro o painel considera nao enviado. Envie no mesmo dia da aprovacao: depois do valid_until o pedido sai desta lista.',
      'vencidos_sem_envio: NAO envie. O texto passou do prazo; avise o dono e prepare o ritual atual do cliente com aceleriq_central_review_preparar.'
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.central_review_fila_para_agente(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.central_review_fila_para_agente(text) TO service_role;

CREATE OR REPLACE FUNCTION app_private.ritual_vigiar_envio()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _agora_sp timestamp := now() AT TIME ZONE 'America/Sao_Paulo';
  _hoje date := _agora_sp::date;
  _inicio_do_dia timestamptz := (_hoje::timestamp AT TIME ZONE 'America/Sao_Paulo');
  _dia integer := EXTRACT(ISODOW FROM _hoje)::integer;
  _tipo text := CASE _dia WHEN 1 THEN 'rota_semana' WHEN 3 THEN 'meio_semana' WHEN 5 THEN 'prova_movimento' END;
  _chave text := CASE _dia WHEN 1 THEN 'segunda' WHEN 3 THEN 'quarta' WHEN 5 THEN 'sexta' END;
  _nome text := CASE _dia WHEN 1 THEN 'segunda (Rota da semana)' WHEN 3 THEN 'quarta (Meio da semana)' WHEN 5 THEN 'sexta (Prova de movimento)' END;
  _n integer;
  _nomes text;
  _avisos integer := 0;
BEGIN
  -- 1) Aprovado e não enviado.
  SELECT count(*), string_agg(DISTINCT COALESCE(NULLIF(p.company_name, ''), p.full_name, 'cliente'), ', ')
    INTO _n, _nomes
    FROM public.operator_approvals a LEFT JOIN public.profiles p ON p.id = a.client_id
   WHERE a.origin = 'central' AND a.status = 'aprovado' AND a.executed_at IS NULL AND a.invalidated_at IS NULL
     AND a.decided_at < now() - interval '3 hours'
     AND (a.valid_until IS NULL OR a.valid_until > now());
  IF _n > 0 AND NOT EXISTS (SELECT 1 FROM public.notifications n
                             WHERE n.notification_type = 'ritual_aprovado_sem_envio' AND n.created_at >= _inicio_do_dia) THEN
    INSERT INTO public.notifications (user_id, message, notification_type, link)
    SELECT DISTINCT ur.user_id,
           'Ritual aprovado e ainda não enviado: ' || left(_nomes, 160) || '. Envie e registre antes de vencer.',
           'ritual_aprovado_sem_envio', '/ciclo/revisao'
      FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'admin' AND p.deleted_at IS NULL AND COALESCE(p.email, '') NOT ILIKE 'n8n@%';
    _avisos := _avisos + 1;
  END IF;

  -- 2) Esperando decisão e vencendo em 24 horas.
  SELECT count(*) INTO _n
    FROM public.operator_approvals a
   WHERE a.origin = 'central' AND a.status IN ('pendente', 'adiado') AND a.executed_at IS NULL AND a.invalidated_at IS NULL
     AND a.valid_until > now() AND a.valid_until <= now() + interval '24 hours';
  IF _n > 0 AND NOT EXISTS (SELECT 1 FROM public.notifications n
                             WHERE n.notification_type = 'ritual_vence_sem_decisao' AND n.created_at >= _inicio_do_dia) THEN
    INSERT INTO public.notifications (user_id, message, notification_type, link)
    SELECT DISTINCT ur.user_id,
           _n || CASE WHEN _n = 1 THEN ' ritual espera' ELSE ' rituais esperam' END || ' a sua decisão e vence em menos de 24 horas.',
           'ritual_vence_sem_decisao', '/ciclo/revisao'
      FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'admin' AND p.deleted_at IS NULL AND COALESCE(p.email, '') NOT ILIKE 'n8n@%';
    _avisos := _avisos + 1;
  END IF;

  -- 3) Dia de ritual, passou das 11h e nada foi preparado nem publicado hoje.
  IF _tipo IS NOT NULL AND _agora_sp::time >= time '11:00'
     AND NOT EXISTS (SELECT 1 FROM public.reports r
                      WHERE r.metrics->>'ritual_type' = _tipo AND r.created_at >= _inicio_do_dia)
     AND NOT EXISTS (SELECT 1 FROM public.cycle_rituals c
                      WHERE c.ritual_key = _chave AND c.week_start = (_hoje - (_dia - 1)))
     AND NOT EXISTS (SELECT 1 FROM public.notifications n
                      WHERE n.notification_type = 'ritual_sem_lote' AND n.created_at >= _inicio_do_dia) THEN
    INSERT INTO public.notifications (user_id, message, notification_type, link)
    SELECT DISTINCT ur.user_id,
           'O ritual de ' || _nome || ' ainda não foi preparado hoje para nenhum cliente.',
           'ritual_sem_lote', '/ciclo/revisao'
      FROM public.user_roles ur JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'admin' AND p.deleted_at IS NULL AND COALESCE(p.email, '') NOT ILIKE 'n8n@%';
    _avisos := _avisos + 1;
  END IF;

  RETURN jsonb_build_object('avisos', _avisos, 'dia', _hoje);
END;
$$;
REVOKE ALL ON FUNCTION app_private.ritual_vigiar_envio() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'ritual-vigiar-envio';
    PERFORM cron.schedule('ritual-vigiar-envio', '23 * * * *', $cron$SELECT app_private.ritual_vigiar_envio();$cron$);
  END IF;
END
$$;
