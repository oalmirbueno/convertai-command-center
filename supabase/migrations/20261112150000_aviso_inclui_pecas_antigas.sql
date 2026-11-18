-- 12/11/2026: o dono pediu para avisar também as peças com mais de 30 dias esperando aprovação.
-- Tira o limite de 30 dias do aviso de peça nova e do lembrete diário. O resto fica igual
-- (uma mensagem por lote, 30 min entre avisos, dia útil 9h–18h, só grupos liberados).

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
