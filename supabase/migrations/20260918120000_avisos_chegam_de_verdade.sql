-- Avisos que chegam de verdade.
--
-- Caso Verzelo (16/09 18:07): a cliente aprovou uma arte, o painel gravou o
-- aviso no sino dos tres administradores... e ninguem viu. O sino e o unico
-- canal que existia, e ele so avisa quem esta com o painel aberto. Auditoria
-- dos ultimos 30 dias: todas as 30 decisoes de cliente geraram aviso no sino;
-- nenhuma gerou e-mail. E o pedido de cliente (client_requests) avisava UM
-- administrador sorteado (get_admin_user_id ... LIMIT 1), que pode ser o robo.
--
-- 1) avisar_equipe(): um aviso para cada administrador e gestor humano.
-- 2) Decisao de cliente (aprovou / pediu ajuste) e pedido de cliente viram
--    aviso pelo BANCO, no mesmo instante do fato, sem depender do navegador
--    do cliente. O texto e identico ao que a tela ja gravava: o gatilho de
--    deduplicacao (10 min) descarta a copia da tela.
-- 3) Aviso importante vira E-MAIL para o administrador humano, pelo mesmo
--    caminho do lembrete de cobranca (send-transactional-email com o segredo
--    do cofre). Assincrono (pg_net): falha no e-mail nunca segura o aviso.

CREATE TABLE IF NOT EXISTS public.notification_email_log (
  notification_id uuid PRIMARY KEY REFERENCES public.notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  request_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_email_log FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS notification_email_log_user_hora_idx ON public.notification_email_log (user_id, created_at DESC);

-- Tipos que merecem sair do painel. Os demais (entrega no ar, heartbeat de
-- agente, cobranca que ja tem e-mail proprio) ficam so no sino.
CREATE OR REPLACE FUNCTION public.notificacao_merece_email(_tipo text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _tipo IN ('approval', 'request', 'aprovacao_necessaria', 'central_review_pendente', 'central_review_decidida', 'central_review_enviada', 'responsavel_designado');
$$;

-- 1) Um aviso para cada pessoa da equipe que decide (admin e gestor), sem robo.
CREATE OR REPLACE FUNCTION public.avisar_equipe(_message text, _type text, _link text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _n integer := 0;
BEGIN
  INSERT INTO public.notifications (user_id, message, notification_type, link)
  SELECT DISTINCT ur.user_id, left(_message, 500), _type, _link
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
   WHERE ur.role IN ('admin', 'manager')
     AND p.deleted_at IS NULL
     AND COALESCE(p.email, '') NOT ILIKE 'n8n@%';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.avisar_equipe(text, text, text) FROM PUBLIC, anon, authenticated;

-- 2a) Decisao do cliente sobre um material.
CREATE OR REPLACE FUNCTION public.file_approval_avisa_equipe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _cliente text; _arquivo text;
BEGIN
  IF NEW.actor_id IS DISTINCT FROM NEW.client_id THEN RETURN NEW; END IF;
  IF NEW.to_status NOT IN ('approved', 'changes_requested') THEN RETURN NEW; END IF;
  SELECT COALESCE(NULLIF(p.company_name, ''), p.full_name, 'Cliente') INTO _cliente FROM public.profiles p WHERE p.id = NEW.client_id;
  SELECT f.file_name INTO _arquivo FROM public.files f WHERE f.id = NEW.file_id;
  IF NEW.to_status = 'approved' THEN
    PERFORM public.avisar_equipe(
      'Aprovação recebida: ' || _cliente || ' aprovou "' || COALESCE(_arquivo, 'material') || '". Pronto para agendar na Agenda.',
      'approval', '/calendario');
  ELSE
    PERFORM public.avisar_equipe(
      'Ajustes solicitados: ' || _cliente || ' pediu mudanças em "' || COALESCE(_arquivo, 'material') || '".',
      'approval', '/aprovacoes');
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS file_approval_avisa_equipe_trg ON public.file_approval_events;
CREATE TRIGGER file_approval_avisa_equipe_trg
  AFTER INSERT ON public.file_approval_events
  FOR EACH ROW EXECUTE FUNCTION public.file_approval_avisa_equipe();

-- 2b) Pedido novo do cliente.
CREATE OR REPLACE FUNCTION public.client_request_avisa_equipe()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _cliente text;
BEGIN
  SELECT COALESCE(NULLIF(p.company_name, ''), p.full_name, 'Cliente') INTO _cliente FROM public.profiles p WHERE p.id = NEW.client_id;
  PERFORM public.avisar_equipe('Novo pedido de ' || _cliente || ': ' || COALESCE(NEW.title, ''), 'request', '/pedidos');
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS client_request_avisa_equipe_trg ON public.client_requests;
CREATE TRIGGER client_request_avisa_equipe_trg
  AFTER INSERT ON public.client_requests
  FOR EACH ROW EXECUTE FUNCTION public.client_request_avisa_equipe();

-- 3) Aviso importante para administrador humano vira e-mail.
CREATE OR REPLACE FUNCTION public.notificacao_por_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _email text; _nome text; _segredo text; _base text; _req bigint; _link text; _na_hora integer;
BEGIN
  IF NOT public.notificacao_merece_email(NEW.notification_type) THEN RETURN NEW; END IF;
  SELECT p.email, COALESCE(NULLIF(p.full_name, ''), 'equipe') INTO _email, _nome
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role IN ('admin', 'manager')
   WHERE p.id = NEW.user_id AND p.deleted_at IS NULL
   LIMIT 1;
  IF _email IS NULL OR _email ILIKE 'n8n@%' THEN RETURN NEW; END IF;

  -- Freio: no maximo 20 e-mails por pessoa por hora. Enxurrada de aviso
  -- ensina a ignorar e-mail, que e o oposto do que se quer aqui.
  SELECT count(*) INTO _na_hora FROM public.notification_email_log l
   WHERE l.user_id = NEW.user_id AND l.created_at > now() - interval '1 hour';
  IF _na_hora >= 20 THEN RETURN NEW; END IF;

  SELECT decrypted_secret INTO _segredo FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  IF _segredo IS NULL THEN RETURN NEW; END IF;
  _base := 'https://jjjtkowvxemvituvywvf.supabase.co';
  _link := CASE WHEN NEW.link IS NULL OR NEW.link = '' THEN 'https://aceleriq.online'
                WHEN NEW.link LIKE 'http%' THEN NEW.link
                ELSE 'https://aceleriq.online' || NEW.link END;

  BEGIN
    SELECT net.http_post(
      url := _base || '/functions/v1/send-transactional-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', _segredo),
      body := jsonb_build_object(
        'templateName', 'aviso-do-painel',
        'recipientEmail', _email,
        'idempotencyKey', 'notificacao-' || NEW.id::text,
        'templateData', jsonb_build_object(
          'name', _nome,
          'message', NEW.message,
          'kind', NEW.notification_type,
          'link', _link,
          'when', to_char(NEW.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')
        )
      )
    ) INTO _req;
    INSERT INTO public.notification_email_log (notification_id, user_id, request_id) VALUES (NEW.id, NEW.user_id, _req)
    ON CONFLICT (notification_id) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'notificacao_por_email falhou (%): %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS notificacao_por_email_trg ON public.notifications;
CREATE TRIGGER notificacao_por_email_trg
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notificacao_por_email();
