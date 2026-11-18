-- Lembrete de aprovação: e-mail e WhatsApp nunca no mesmo dia para o mesmo cliente (10/11/2026).
-- O WhatsApp pula o cliente que já recebeu o e-mail de lembrete hoje; o e-mail de lembrete pula o cliente que já
-- tem lembrete de WhatsApp de hoje. O e-mail de "peça nova" não muda.

CREATE OR REPLACE FUNCTION app_private.lembrete_candidatos()
RETURNS TABLE(client_id uuid, cliente text, itens jsonb, grupo text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
       AND COALESCE(f.approval_requested_at, f.created_at) > now() - interval '30 days'
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
$$;
REVOKE ALL ON FUNCTION app_private.lembrete_candidatos() FROM PUBLIC, anon, authenticated;

-- O e-mail: acrescenta a condição no ramo "lembrete" da função que já existe, sem reescrever o resto.
DO $do$
DECLARE
  _def text := pg_get_functiondef('public.aprovacao_email_tick()'::regprocedure);
  _antes text := 'AND _c.lembretes_feitos < 3 THEN';
  _depois text := 'AND _c.lembretes_feitos < 3' || E'\n'
    || '       AND NOT EXISTS (SELECT 1 FROM public.mensagem_automatica ma' || E'\n'
    || '                        WHERE ma.client_id = _c.user_id AND ma.tipo = ''lembrete_aprovacao'' AND ma.status = ''aprovado''' || E'\n'
    || '                          AND ma.dia = (now() AT TIME ZONE ''America/Sao_Paulo'')::date) THEN';
BEGIN
  IF position('ma.tipo = ''lembrete_aprovacao''' IN _def) > 0 THEN RETURN; END IF;
  IF position(_antes IN _def) = 0 THEN RAISE EXCEPTION 'aprovacao_email_tick mudou: ramo do lembrete não encontrado'; END IF;
  EXECUTE replace(_def, _antes, _depois);
END
$do$;
