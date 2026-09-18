-- O acesso do cliente ao portal tambem chega por e-mail.
--
-- Terra & Flor (17/09): entrou 13:24, aprovou tres artes 19:26-19:28. Os
-- quatro avisos foram para o sino dos administradores e ninguem viu. O
-- e-mail (migration anterior) cobre a aprovacao; o dono quer saber tambem
-- quando o cliente ENTRA, porque e o momento de estar por perto. O aviso de
-- acesso e do tipo 'system' com texto fixo ("Cliente acessou o portal: ...",
-- gravado por src/contexts/AuthContext.tsx); passa a contar como importante.
-- O freio de 20 e-mails por hora por pessoa continua valendo.

CREATE OR REPLACE FUNCTION public.notificacao_por_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _email text; _nome text; _segredo text; _portao text; _base text; _req bigint; _link text; _na_hora integer;
BEGIN
  IF NOT (public.notificacao_merece_email(NEW.notification_type)
          OR (NEW.notification_type = 'system' AND NEW.message LIKE 'Cliente acessou o portal:%')) THEN
    RETURN NEW;
  END IF;
  SELECT p.email, COALESCE(NULLIF(p.full_name, ''), 'equipe') INTO _email, _nome
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id = p.id AND ur.role IN ('admin', 'manager')
   WHERE p.id = NEW.user_id AND p.deleted_at IS NULL
   LIMIT 1;
  IF _email IS NULL OR _email ILIKE 'n8n@%' THEN RETURN NEW; END IF;

  SELECT count(*) INTO _na_hora FROM public.notification_email_log l
   WHERE l.user_id = NEW.user_id AND l.created_at > now() - interval '1 hour';
  IF _na_hora >= 20 THEN RETURN NEW; END IF;

  SELECT decrypted_secret INTO _segredo FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  SELECT decrypted_secret INTO _portao FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1;
  IF _segredo IS NULL OR _portao IS NULL THEN RETURN NEW; END IF;
  _base := 'https://jjjtkowvxemvituvywvf.supabase.co';
  _link := CASE WHEN NEW.link IS NULL OR NEW.link = '' THEN 'https://aceleriq.online'
                WHEN NEW.link LIKE 'http%' THEN NEW.link
                ELSE 'https://aceleriq.online' || NEW.link END;

  BEGIN
    SELECT net.http_post(
      url := _base || '/functions/v1/send-transactional-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || _portao, 'x-cron-secret', _segredo),
      body := jsonb_build_object(
        'templateName', 'aviso-do-painel',
        'recipientEmail', _email,
        'idempotencyKey', 'notificacao-' || NEW.id::text,
        'templateData', jsonb_build_object(
          'name', _nome,
          'message', NEW.message,
          'kind', CASE WHEN NEW.notification_type = 'system' THEN 'acesso' ELSE NEW.notification_type END,
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
