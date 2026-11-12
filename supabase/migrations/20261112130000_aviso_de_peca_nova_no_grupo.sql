-- Aviso na hora no grupo do cliente quando a peça entra em aprovação (pedido do Almir em 12/11/2026).
-- Antes só saía o lembrete de peça parada há mais de 48 h, então peça nova não chegava ao cliente.
-- Agora: peça que ainda não foi avisada no grupo vira mensagem em poucos minutos (dia útil, 9h às 18h),
-- no mesmo modelo que o dono aprovou, com o link direto da peça nova. O lembrete diário continua, mas não
-- sai no mesmo dia em que o cliente já recebeu mensagem de aprovação. Peças com mais de 30 dias ficam de fora.

CREATE OR REPLACE FUNCTION app_private.aprovacao_novas_candidatos()
 RETURNS TABLE(client_id uuid, cliente text, itens jsonb, grupo text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH pend AS (
    SELECT f.client_id, f.id,
           CASE WHEN length(regexp_replace(f.file_name, '\.(png|jpe?g|webp|pdf|mp4)$', '', 'i')) > 70
                THEN btrim(left(regexp_replace(f.file_name, '\.(png|jpe?g|webp|pdf|mp4)$', '', 'i'), 67)) || '…'
                ELSE regexp_replace(f.file_name, '\.(png|jpe?g|webp|pdf|mp4)$', '', 'i') END AS titulo,
           COALESCE(f.approval_requested_at, f.created_at) AS desde,
           NOT EXISTS (SELECT 1 FROM public.mensagem_automatica m
                        WHERE m.client_id = f.client_id AND m.tipo = 'lembrete_aprovacao'
                          AND (m.executed_at IS NOT NULL OR (m.status = 'aprovado' AND m.valid_until > now()))
                          AND m.itens @> jsonb_build_array(jsonb_build_object('file_id', f.id))) AS nova
      FROM public.files f
     WHERE f.approval_status = 'pending'
       AND f.visibility = 'approval'
       AND f.requires_approval = true
       AND f.status = 'ready'
       AND f.archived_at IS NULL
       AND f.parent_file_id IS NULL
       AND COALESCE(f.approval_requested_at, f.created_at) > now() - interval '30 days'
  )
  SELECT pend.client_id,
         COALESCE(NULLIF(btrim(p.company_name), ''), p.full_name),
         jsonb_agg(jsonb_build_object('file_id', pend.id, 'titulo', pend.titulo, 'desde', pend.desde,
                                      'dias', floor(extract(epoch FROM (now() - pend.desde)) / 86400)::int)
                   ORDER BY pend.nova DESC, pend.desde DESC),
         app_private.grupo_whatsapp_do_cliente(pend.client_id)
    FROM pend
    JOIN public.profiles p ON p.id = pend.client_id
   WHERE p.deleted_at IS NULL
     AND COALESCE(p.plan_status, '') NOT IN ('inactive', 'standby')
     AND NOT COALESCE(public.is_staff(p.id), false)
   GROUP BY pend.client_id, p.company_name, p.full_name
  HAVING bool_or(pend.nova)
     -- espera 3 minutos depois da última peça nova, para um lote virar uma mensagem só
     AND max(pend.desde) FILTER (WHERE pend.nova) <= now() - interval '3 minutes';
$function$;
REVOKE ALL ON FUNCTION app_private.aprovacao_novas_candidatos() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.aprovacao_aviso_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _modelo public.mensagem_modelo%ROWTYPE;
  _c record;
  _chave text;
  _texto text;
  _destino jsonb;
  _payload jsonb;
  _avisos integer := 0;
  _sem_grupo integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('mensagens-automaticas-tick', 0));
  IF NOT app_private.mensagens_janela_aberta(now()) THEN
    RETURN jsonb_build_object('janela', 'fechada');
  END IF;
  SELECT * INTO _modelo FROM public.mensagem_modelo WHERE tipo = 'lembrete_aprovacao';
  IF NOT FOUND OR _modelo.aprovado_texto IS NULL THEN
    RETURN jsonb_build_object('janela', 'aberta', 'modelo', 'sem_aprovacao');
  END IF;

  FOR _c IN SELECT * FROM app_private.aprovacao_novas_candidatos() LOOP
    IF _c.grupo IS NULL THEN _sem_grupo := _sem_grupo + 1; CONTINUE; END IF;
    -- uma mensagem viva por cliente; e no máximo uma a cada 30 minutos no mesmo grupo
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.mensagem_automatica m
                           WHERE m.client_id = _c.client_id AND m.tipo = 'lembrete_aprovacao'
                             AND ((m.status = 'aprovado' AND m.executed_at IS NULL AND m.valid_until > now())
                                  OR m.executed_at > now() - interval '30 minutes'));
    _chave := 'nova:' || _c.client_id::text || ':' || to_char(now() AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24MI');
    _texto := app_private.lembrete_texto(_modelo.aprovado_texto, _c.cliente, _c.itens);
    _destino := jsonb_build_object('channel', 'whatsapp', 'recipient', _c.grupo);
    _payload := jsonb_build_object('tipo', 'lembrete_aprovacao', 'client_id', _c.client_id, 'chave', _chave,
                                   'itens', _c.itens, 'mensagem', _texto, 'destino', _destino);
    INSERT INTO public.mensagem_automatica (tipo, client_id, chave, dia, itens, mensagem, destino, payload, payload_hash,
                                            status, aprovado_via, decided_by, decided_at, decision_note, valid_until)
    VALUES ('lembrete_aprovacao', _c.client_id, _chave, _hoje, _c.itens, _texto, _destino, _payload,
            app_private.mensagem_automatica_hash(_payload), 'aprovado', 'modelo', _modelo.aprovado_por, now(),
            'Peça nova em aprovação; modelo aprovado pelo dono em ' || to_char(_modelo.aprovado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
            app_private.mensagens_fim_da_janela(_hoje))
    ON CONFLICT (chave) DO NOTHING;
    IF FOUND THEN _avisos := _avisos + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('janela', 'aberta', 'avisos', _avisos, 'sem_grupo', _sem_grupo);
END $function$;
REVOKE ALL ON FUNCTION public.aprovacao_aviso_tick() FROM PUBLIC, anon, authenticated;

-- Lembrete diário: igual ao de antes, mais uma regra: não sai se o cliente já recebeu mensagem de aprovação hoje.
CREATE OR REPLACE FUNCTION public.mensagens_automaticas_tick()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  _conf jsonb;
  _modelo public.mensagem_modelo%ROWTYPE;
  _c record;
  _chave text;
  _texto text;
  _destino jsonb;
  _payload jsonb;
  _regua boolean;
  _status text;
  _lembretes integer := 0;
  _sem_grupo integer := 0;
  _cobrancas integer := 0;
  _cobrancas_pendentes integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('mensagens-automaticas-tick', 0));
  _conf := app_private.mensagens_automaticas_conferir();
  IF NOT app_private.mensagens_janela_aberta(now()) THEN
    RETURN _conf || jsonb_build_object('janela', 'fechada');
  END IF;

  -- Lembretes: só com o modelo aprovado pelo dono. Nascem aprovados (pelo modelo) e vão para a fila do Hermes.
  SELECT * INTO _modelo FROM public.mensagem_modelo WHERE tipo = 'lembrete_aprovacao';
  IF FOUND AND _modelo.aprovado_texto IS NOT NULL THEN
    FOR _c IN SELECT * FROM app_private.lembrete_candidatos() LOOP
      IF _c.grupo IS NULL THEN _sem_grupo := _sem_grupo + 1; CONTINUE; END IF;
      _chave := 'lembrete:' || _c.client_id::text || ':' || _hoje::text;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.mensagem_automatica WHERE chave = _chave);
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.mensagem_automatica m
                             WHERE m.client_id = _c.client_id AND m.tipo = 'lembrete_aprovacao' AND m.dia = _hoje
                               AND (m.executed_at IS NOT NULL OR (m.status = 'aprovado' AND m.valid_until > now())));
      _texto := app_private.lembrete_texto(_modelo.aprovado_texto, _c.cliente, _c.itens);
      _destino := jsonb_build_object('channel', 'whatsapp', 'recipient', _c.grupo);
      _payload := jsonb_build_object('tipo', 'lembrete_aprovacao', 'client_id', _c.client_id, 'chave', _chave,
                                     'itens', _c.itens, 'mensagem', _texto, 'destino', _destino);
      INSERT INTO public.mensagem_automatica (tipo, client_id, chave, dia, itens, mensagem, destino, payload, payload_hash,
                                              status, aprovado_via, decided_by, decided_at, decision_note, valid_until)
      VALUES ('lembrete_aprovacao', _c.client_id, _chave, _hoje, _c.itens, _texto, _destino, _payload,
              app_private.mensagem_automatica_hash(_payload), 'aprovado', 'modelo', _modelo.aprovado_por, now(),
              'Modelo aprovado pelo dono em ' || to_char(_modelo.aprovado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
              app_private.mensagens_fim_da_janela(_hoje))
      ON CONFLICT (chave) DO NOTHING;
      IF FOUND THEN _lembretes := _lembretes + 1; END IF;
    END LOOP;
  END IF;

  -- Cobranças: pendentes para o dono, ou aprovadas se a régua de TODAS as cobranças da mensagem foi aprovada.
  FOR _c IN SELECT * FROM app_private.cobranca_candidatos(_hoje) LOOP
    _chave := 'cobranca:' || _c.client_id::text || ':' || _hoje::text;
    CONTINUE WHEN EXISTS (SELECT 1 FROM public.mensagem_automatica WHERE chave = _chave);
    SELECT mm.texto INTO _texto FROM public.mensagem_modelo mm WHERE mm.tipo = ('cobranca_d' || _c.etapa::text);
    _texto := app_private.cobranca_texto(_texto, _c.cliente, _c.itens);
    _destino := jsonb_build_object('channel', 'whatsapp', 'recipient', _c.grupo);
    _payload := jsonb_build_object('tipo', 'cobranca', 'client_id', _c.client_id, 'chave', _chave, 'etapa', _c.etapa,
                                   'itens', _c.itens, 'mensagem', _texto, 'destino', _destino);
    _regua := _c.grupo IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(_c.itens) i
       WHERE NOT EXISTS (SELECT 1 FROM public.cobranca_regua_aprovada r
                          WHERE r.billing_id = (i->>'billing_id')::uuid AND r.revogada_em IS NULL));
    _status := CASE WHEN _regua THEN 'aprovado' ELSE 'pendente' END;
    INSERT INTO public.mensagem_automatica (tipo, client_id, chave, dia, etapa, itens, mensagem, destino, payload, payload_hash,
                                            status, aprovado_via, decided_by, decided_at, decision_note, valid_until)
    VALUES ('cobranca', _c.client_id, _chave, _hoje, _c.etapa, _c.itens, _texto, _destino, _payload,
            app_private.mensagem_automatica_hash(_payload), _status,
            CASE WHEN _regua THEN 'regua' END,
            CASE WHEN _regua THEN (SELECT r.aprovado_por FROM public.cobranca_regua_aprovada r
                                    WHERE r.billing_id = (_c.itens->0->>'billing_id')::uuid) END,
            CASE WHEN _regua THEN now() END,
            CASE WHEN _regua THEN 'Régua da cobrança aprovada pelo dono' END,
            app_private.mensagens_fim_da_janela(_hoje + 3))
    ON CONFLICT (chave) DO NOTHING;
    IF FOUND THEN
      _cobrancas := _cobrancas + 1;
      IF NOT _regua THEN _cobrancas_pendentes := _cobrancas_pendentes + 1; END IF;
    END IF;
  END LOOP;

  -- Um aviso por dia no sino do dono quando há cobrança nova esperando (não vira e-mail).
  IF _cobrancas_pendentes > 0 AND NOT EXISTS (
       SELECT 1 FROM public.notifications n
        WHERE n.notification_type = 'cobranca_para_aprovar'
          AND n.created_at >= (_hoje::timestamp AT TIME ZONE 'America/Sao_Paulo')) THEN
    INSERT INTO public.notifications (user_id, message, notification_type, link)
    SELECT DISTINCT ur.user_id,
           'Cobrança pronta para você aprovar: ' || _cobrancas_pendentes
             || CASE WHEN _cobrancas_pendentes = 1 THEN ' cliente.' ELSE ' clientes.' END,
           'cobranca_para_aprovar', '/central/mensagens#cobrancas'
      FROM public.user_roles ur
      JOIN public.profiles p ON p.id = ur.user_id
     WHERE ur.role = 'admin' AND p.deleted_at IS NULL AND COALESCE(p.email, '') NOT ILIKE 'n8n@%';
  END IF;

  RETURN _conf || jsonb_build_object('janela', 'aberta', 'lembretes', _lembretes, 'lembretes_sem_grupo', _sem_grupo,
                                     'cobrancas', _cobrancas, 'cobrancas_para_o_dono', _cobrancas_pendentes);
END $function$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'aprovacao-aviso-whatsapp';
    PERFORM cron.schedule('aprovacao-aviso-whatsapp', '*/2 * * * *', $cron$SELECT public.aprovacao_aviso_tick();$cron$);
  END IF;
END
$$;
