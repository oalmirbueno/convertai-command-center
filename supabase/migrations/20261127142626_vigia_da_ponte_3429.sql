-- Vigia da ponte do WhatsApp da equipe (3429). Pedido do Almir em 27/11/2026: "faça o vigia me avisar quando a ponte cair".
-- O aviso NÃO pode sair pelo próprio 3429 (é ele que caiu). Sai pelo sino do painel e por e-mail aos admins humanos.
-- Fonte do estado: automacao_saude.ponte_3429, gravada a cada minuto pelo coletor do VPS (Central de Automações).
-- Também avisa quando o coletor para de mandar (servidor inteiro sem resposta) e quando tudo volta.

CREATE OR REPLACE FUNCTION public.notificacao_merece_email(_tipo text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT _tipo IN ('approval', 'request', 'aprovacao_necessaria', 'central_review_pendente', 'central_review_decidida', 'central_review_enviada', 'responsavel_designado', 'agendamento_atrasado', 'teste', 'acesso_pedido', 'perfis_resumo', 'perfis_alerta', 'automacao_alerta');
$function$;

CREATE TABLE IF NOT EXISTS app_private.vigia_ponte_estado (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  caiu_em timestamptz,
  motivo text,
  avisado_em timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_private.vigia_ponte_estado (id) VALUES (true) ON CONFLICT DO NOTHING;
REVOKE ALL ON app_private.vigia_ponte_estado FROM PUBLIC, anon, authenticated;

-- Regra pura (testável): devolve o motivo da queda ou null se está tudo bem.
CREATE OR REPLACE FUNCTION app_private.vigia_ponte_motivo(_estado text, _detalhe text, _coletado_em timestamptz, _ultima_coleta timestamptz, _agora timestamptz)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN _ultima_coleta IS NULL OR _ultima_coleta < _agora - interval '10 minutes'
      THEN 'o servidor parou de mandar notícias há mais de 10 minutos (pode ter caído ou reiniciado)'
    WHEN _estado = 'falha' AND _coletado_em >= _agora - interval '10 minutes'
      THEN coalesce(nullif(_detalhe, ''), 'parada')
    ELSE NULL
  END;
$function$;

CREATE OR REPLACE FUNCTION app_private.vigia_ponte_tick()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _agora timestamptz := now();
  _s record;
  _ultima timestamptz;
  _motivo text;
  _e app_private.vigia_ponte_estado%ROWTYPE;
  _msg text;
  _hora text;
BEGIN
  SELECT estado, detalhe, coletado_em INTO _s FROM public.automacao_saude WHERE chave = 'ponte_3429';
  SELECT max(recebido_em) INTO _ultima FROM public.automacao_coletas;
  _motivo := app_private.vigia_ponte_motivo(_s.estado, _s.detalhe, _s.coletado_em, _ultima, _agora);
  SELECT * INTO _e FROM app_private.vigia_ponte_estado WHERE id FOR UPDATE;

  IF _motivo IS NOT NULL THEN
    IF _e.caiu_em IS NULL THEN
      UPDATE app_private.vigia_ponte_estado SET caiu_em = _agora, motivo = _motivo, atualizado_em = _agora WHERE id;
      RETURN 'caiu';
    END IF;
    -- 4 minutos de tolerância: a ponte se religa sozinha em 30 s; só avisa se não voltar.
    IF _e.avisado_em IS NULL AND _agora - _e.caiu_em >= interval '4 minutes' THEN
      _hora := to_char(_e.caiu_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI');
      _msg := 'A ponte do WhatsApp da equipe (3429) caiu às ' || _hora || ': ' || _motivo
        || '. Enquanto ela estiver fora, não saem avisos de post no ar, lembretes de aprovação nem mensagens da semana nos grupos.';
      INSERT INTO public.notifications (user_id, message, notification_type, link)
      SELECT p.id, _msg, 'automacao_alerta', '/automacoes'
        FROM public.profiles p JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'admin'
       WHERE p.deleted_at IS NULL AND coalesce(p.email, '') NOT ILIKE 'n8n@%';
      UPDATE app_private.vigia_ponte_estado SET avisado_em = _agora, motivo = _motivo, atualizado_em = _agora WHERE id;
      RETURN 'avisado';
    END IF;
    RETURN 'fora';
  END IF;

  IF _e.caiu_em IS NOT NULL THEN
    IF _e.avisado_em IS NOT NULL THEN
      _msg := 'A ponte do WhatsApp da equipe (3429) voltou às ' || to_char(_agora AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI')
        || '. Ficou fora desde ' || to_char(_e.caiu_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI')
        || '. Confira na Central de Automações se algum aviso ficou para trás.';
      INSERT INTO public.notifications (user_id, message, notification_type, link)
      SELECT p.id, _msg, 'automacao_alerta', '/automacoes'
        FROM public.profiles p JOIN public.user_roles r ON r.user_id = p.id AND r.role = 'admin'
       WHERE p.deleted_at IS NULL AND coalesce(p.email, '') NOT ILIKE 'n8n@%';
    END IF;
    UPDATE app_private.vigia_ponte_estado SET caiu_em = NULL, avisado_em = NULL, motivo = NULL, atualizado_em = _agora WHERE id;
    RETURN 'voltou';
  END IF;
  RETURN 'ok';
END;
$function$;
REVOKE ALL ON FUNCTION app_private.vigia_ponte_tick() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_private.vigia_ponte_motivo(text, text, timestamptz, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;

SELECT cron.unschedule('vigia-ponte-3429') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vigia-ponte-3429');
SELECT cron.schedule('vigia-ponte-3429', '*/2 * * * *', $$SELECT app_private.vigia_ponte_tick()$$);
