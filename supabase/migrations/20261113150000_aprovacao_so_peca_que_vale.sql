-- 13/11/2026: o lembrete de aprovação ficou "burro" ao incluir peça antiga (Vivídeo só com vídeos de junho,
-- Stop com o Dia das Crianças). Agora só entra na mensagem a peça que ainda vale cobrar:
--   1. não está abandonada (esperando há mais de 60 dias);
--   2. o post dela no calendário não foi arquivado;
--   3. o Jev não julgou que ela venceu (data, evento ou promoção que já passou), função aprovacao-validade,
--      julgada de novo a cada dia;
-- e só peça que entrou nos últimos 7 dias dispara o aviso de peça nova (as mais velhas só vão no lembrete diário).

CREATE TABLE IF NOT EXISTS app_private.aprovacao_validade (
  file_id uuid PRIMARY KEY REFERENCES public.files(id) ON DELETE CASCADE,
  vencida_prob numeric NOT NULL CHECK (vencida_prob >= 0 AND vencida_prob <= 1),
  julgado_para date NOT NULL,
  julgado_em timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON app_private.aprovacao_validade FROM PUBLIC, anon, authenticated;

-- Peça pendente que ainda vale cobrar do cliente (regras fixas + julgamento do Jev já gravado).
CREATE OR REPLACE FUNCTION app_private.aprovacao_peca_vale(_file_id uuid, _desde timestamptz, _com_jev boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT _desde > now() - interval '60 days'
     AND NOT (EXISTS (SELECT 1 FROM public.editorial_posts e WHERE e.primary_file_id = _file_id AND e.archived_at IS NOT NULL)
              AND NOT EXISTS (SELECT 1 FROM public.editorial_posts e WHERE e.primary_file_id = _file_id AND e.archived_at IS NULL))
     AND (NOT _com_jev OR NOT EXISTS (SELECT 1 FROM app_private.aprovacao_validade v
                                       WHERE v.file_id = _file_id AND v.vencida_prob >= 0.6));
$function$;

-- Fila do Jev: peças pendentes ainda sem julgamento de hoje.
CREATE OR REPLACE FUNCTION public.aprovacao_validade_fila(_limite int DEFAULT 36)
 RETURNS TABLE(file_id uuid, titulo text, legenda text, entrou_em date, hoje date)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _hoje date := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SO_SERVIDOR';
  END IF;
  RETURN QUERY
  SELECT f.id, regexp_replace(f.file_name, '\.(png|jpe?g|webp|pdf|mp4)$', '', 'i'),
         left(COALESCE(NULLIF(btrim(f.caption), ''), f.description, ''), 700),
         (COALESCE(f.approval_requested_at, f.created_at) AT TIME ZONE 'America/Sao_Paulo')::date, _hoje
    FROM public.files f
    JOIN public.profiles p ON p.id = f.client_id
   WHERE f.approval_status = 'pending' AND f.visibility = 'approval' AND f.requires_approval = true
     AND f.status = 'ready' AND f.archived_at IS NULL AND f.parent_file_id IS NULL
     AND p.deleted_at IS NULL AND COALESCE(p.plan_status, '') NOT IN ('inactive', 'standby')
     AND NOT COALESCE(public.is_staff(p.id), false)
     AND app_private.aprovacao_peca_vale(f.id, COALESCE(f.approval_requested_at, f.created_at), false)
     AND NOT EXISTS (SELECT 1 FROM app_private.aprovacao_validade v WHERE v.file_id = f.id AND v.julgado_para >= _hoje)
   ORDER BY COALESCE(f.approval_requested_at, f.created_at) DESC
   LIMIT GREATEST(1, LEAST(_limite, 100));
END;
$function$;

CREATE OR REPLACE FUNCTION public.aprovacao_validade_gravar(_itens jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE _n integer;
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SO_SERVIDOR';
  END IF;
  INSERT INTO app_private.aprovacao_validade (file_id, vencida_prob, julgado_para, julgado_em)
  SELECT (i->>'file_id')::uuid, LEAST(1, GREATEST(0, (i->>'vencida_prob')::numeric)), (i->>'julgado_para')::date, now()
    FROM jsonb_array_elements(COALESCE(_itens, '[]'::jsonb)) i
   WHERE EXISTS (SELECT 1 FROM public.files f WHERE f.id = (i->>'file_id')::uuid)
  ON CONFLICT (file_id) DO UPDATE
     SET vencida_prob = EXCLUDED.vencida_prob, julgado_para = EXCLUDED.julgado_para, julgado_em = now();
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$;

REVOKE ALL ON FUNCTION app_private.aprovacao_peca_vale(uuid, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aprovacao_validade_fila(int) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aprovacao_validade_gravar(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aprovacao_validade_fila(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.aprovacao_validade_gravar(jsonb) TO service_role;

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
           COALESCE(f.approval_requested_at, f.created_at) > now() - interval '7 days'
           AND (EXISTS (SELECT 1 FROM app_private.aprovacao_validade v WHERE v.file_id = f.id)
                OR COALESCE(f.approval_requested_at, f.created_at) < now() - interval '20 minutes')
           AND NOT EXISTS (SELECT 1 FROM public.mensagem_automatica m
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
       AND app_private.aprovacao_peca_vale(f.id, COALESCE(f.approval_requested_at, f.created_at))
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
     AND max(pend.desde) FILTER (WHERE pend.nova) <= now() - interval '3 minutes';
$function$;

CREATE OR REPLACE FUNCTION app_private.lembrete_candidatos()
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
           COALESCE(f.approval_requested_at, f.created_at) AS desde
      FROM public.files f
     WHERE f.approval_status = 'pending'
       AND f.visibility = 'approval'
       AND f.requires_approval = true
       AND f.status = 'ready'
       AND f.archived_at IS NULL
       AND f.parent_file_id IS NULL
       AND COALESCE(f.approval_requested_at, f.created_at) <= now() - interval '48 hours'
       AND app_private.aprovacao_peca_vale(f.id, COALESCE(f.approval_requested_at, f.created_at))
  )
  SELECT pend.client_id,
         COALESCE(NULLIF(btrim(p.company_name), ''), p.full_name),
         jsonb_agg(jsonb_build_object('file_id', pend.id, 'titulo', pend.titulo, 'desde', pend.desde,
                                      'dias', floor(extract(epoch FROM (now() - pend.desde)) / 86400)::int)
                   ORDER BY pend.desde),
         app_private.grupo_whatsapp_do_cliente(pend.client_id)
    FROM pend
    JOIN public.profiles p ON p.id = pend.client_id
   WHERE p.deleted_at IS NULL
     AND COALESCE(p.plan_status, '') NOT IN ('inactive', 'standby')
     AND NOT COALESCE(public.is_staff(p.id), false)
     AND NOT EXISTS (SELECT 1 FROM public.aprovacao_email_log l
                      WHERE l.user_id = p.id AND l.tipo = 'lembrete'
                        AND (l.created_at AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date)
   GROUP BY pend.client_id, p.company_name, p.full_name;
$function$;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'aprovacao-validade';
SELECT cron.schedule('aprovacao-validade', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/aprovacao-validade',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
$cron$);
