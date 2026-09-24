-- Aprovação pendente chega ao cliente por e-mail (24/09/2026).
--
-- Até aqui o aviso de "conteúdo para aprovar" só ia para o sino do painel do
-- cliente; o e-mail (notificacao_por_email) só atende administrador e gestor.
-- Auditoria de 24/09: 129 e-mails "aviso-do-painel" em 8 dias, zero para
-- cliente; Rd Ar entrou no painel em 23/09 e o post de 18/09 seguia pendente.
--
-- aprovacao_email_tick(), a cada 10 min:
-- 1) NOVO: cliente com conteúdo pendente que ainda não saiu em e-mail recebe
--    um e-mail só, com todos os pendentes (espera 5 min para o lote da
--    entrega fechar; no máximo um e-mail por cliente a cada 30 min).
-- 2) LEMBRETE: conteúdo pendente há mais de 2 dias, sem e-mail nos últimos
--    2 dias, até 3 lembretes por conteúdo mais antigo.
-- Só conteúdo dos últimos 30 dias entra (pendência antiga não vira e-mail),
-- só cliente que já entrou no painel (quem nunca acessou recebe o convite de
-- primeiro acesso, não este e-mail), nunca equipe.

CREATE TABLE IF NOT EXISTS public.aprovacao_email_log (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('novo', 'lembrete')),
  qtd integer NOT NULL DEFAULT 0,
  mais_recente timestamptz,
  request_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.aprovacao_email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aprovacao_email_log FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS aprovacao_email_log_user_idx ON public.aprovacao_email_log (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.aprovacao_email_tick()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _segredo text; _portao text; _base text := 'https://jjjtkowvxemvituvywvf.supabase.co';
  _c record; _req bigint; _tipo text; _itens jsonb; _dias integer;
  _novos integer := 0; _lembretes integer := 0;
BEGIN
  SELECT decrypted_secret INTO _segredo FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1;
  SELECT decrypted_secret INTO _portao FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key' LIMIT 1;
  IF _segredo IS NULL OR _portao IS NULL THEN RETURN jsonb_build_object('erro', 'sem_segredo'); END IF;

  FOR _c IN
    WITH pend AS (
      SELECT f.client_id, f.file_name, f.created_at
        FROM public.files f
       WHERE f.approval_status = 'pending'
         AND f.visibility = 'approval'
         AND f.requires_approval = true
         AND f.status = 'ready'
         AND f.archived_at IS NULL
         AND f.parent_file_id IS NULL
         AND f.created_at > now() - interval '30 days'
    ),
    ultimo AS (
      SELECT l.user_id, max(l.created_at) AS quando, max(l.mais_recente) AS ate
        FROM public.aprovacao_email_log l GROUP BY l.user_id
    )
    SELECT p.id AS user_id, p.email, COALESCE(NULLIF(p.full_name, ''), NULLIF(p.company_name, ''), 'cliente') AS nome,
           count(*) AS total,
           min(pend.created_at) AS mais_antigo,
           max(pend.created_at) AS mais_recente,
           count(*) FILTER (WHERE u.ate IS NULL OR pend.created_at > u.ate) AS novos,
           u.quando AS ultimo_email,
           (SELECT count(*) FROM public.aprovacao_email_log l2
             WHERE l2.user_id = p.id AND l2.tipo = 'lembrete' AND l2.created_at > min(pend.created_at)) AS lembretes_feitos
      FROM pend
      JOIN public.profiles p ON p.id = pend.client_id
      LEFT JOIN ultimo u ON u.user_id = p.id
      JOIN auth.users au ON au.id = p.id AND au.last_sign_in_at IS NOT NULL
     WHERE p.deleted_at IS NULL
       AND p.email IS NOT NULL AND p.email <> '' AND p.email NOT ILIKE 'n8n@%'
       AND NOT public.is_staff(p.id)
     GROUP BY p.id, p.email, p.full_name, p.company_name, u.quando, u.ate
  LOOP
    _tipo := NULL;
    IF _c.novos > 0 AND _c.mais_recente < now() - interval '5 minutes'
       AND (_c.ultimo_email IS NULL OR _c.ultimo_email < now() - interval '30 minutes') THEN
      _tipo := 'novo';
    ELSIF _c.mais_antigo < now() - interval '2 days'
       AND (_c.ultimo_email IS NULL OR _c.ultimo_email < now() - interval '2 days')
       AND _c.lembretes_feitos < 3 THEN
      _tipo := 'lembrete';
    END IF;
    CONTINUE WHEN _tipo IS NULL;

    SELECT COALESCE(jsonb_agg(t.titulo ORDER BY t.created_at DESC), '[]'::jsonb) INTO _itens FROM (
      SELECT regexp_replace(f.file_name, '\.(png|jpe?g|webp|pdf|mp4)$', '', 'i') AS titulo, f.created_at
        FROM public.files f
       WHERE f.client_id = _c.user_id AND f.approval_status = 'pending' AND f.visibility = 'approval'
         AND f.requires_approval = true AND f.status = 'ready' AND f.archived_at IS NULL
         AND f.parent_file_id IS NULL AND f.created_at > now() - interval '30 days'
       ORDER BY f.created_at DESC LIMIT 8
    ) t;
    _dias := GREATEST(0, floor(extract(epoch FROM (now() - _c.mais_antigo)) / 86400)::int);

    BEGIN
      SELECT net.http_post(
        url := _base || '/functions/v1/send-transactional-email',
        headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || _portao, 'x-cron-secret', _segredo),
        body := jsonb_build_object(
          'templateName', 'aprovacao-pendente',
          'recipientEmail', _c.email,
          'idempotencyKey', 'aprovacao-' || _tipo || '-' || _c.user_id::text || '-' || to_char(now(), 'YYYYMMDDHH24MI'),
          'templateData', jsonb_build_object(
            'name', _c.nome,
            'total', _c.total,
            'itens', _itens,
            'lembrete', _tipo = 'lembrete',
            'dias', _dias,
            'link', 'https://aceleriq.online/aprovacoes'
          )
        ),
        timeout_milliseconds := 15000
      ) INTO _req;
      INSERT INTO public.aprovacao_email_log (user_id, tipo, qtd, mais_recente, request_id)
      VALUES (_c.user_id, _tipo, _c.total, _c.mais_recente, _req);
      IF _tipo = 'novo' THEN _novos := _novos + 1; ELSE _lembretes := _lembretes + 1; END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'aprovacao_email_tick falhou (%): %', _c.user_id, SQLERRM;
    END;
  END LOOP;
  RETURN jsonb_build_object('novos', _novos, 'lembretes', _lembretes);
END;
$$;
REVOKE ALL ON FUNCTION public.aprovacao_email_tick() FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('aprovacao-email')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'aprovacao-email');
    PERFORM cron.schedule('aprovacao-email', '3,13,23,33,43,53 * * * *', $job$SELECT public.aprovacao_email_tick();$job$);
  END IF;
END
$cron$;
