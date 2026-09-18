-- Reenvio do primeiro acesso lê tudo por UMA RPC privada (2026-09-18).
--
-- Regra da casa (client-credential-security.test.ts): a função pública
-- client-first-access nunca lê public.profiles direto. O reenvio pedido pela
-- própria pessoa precisa de perfil, papel, token vigente e freio de 10 min;
-- tudo isso sai daqui, em uma leitura só, para a função apenas decidir e
-- mandar o e-mail.

CREATE OR REPLACE FUNCTION public.first_access_resend_lookup_service(p_email text)
 RETURNS TABLE(profile_id uuid, full_name text, company_name text, token text, token_status text, expires_at timestamp with time zone, used_at timestamp with time zone, recently_sent boolean)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p.id,
         p.full_name,
         p.company_name,
         CASE WHEN p.first_access_used_at IS NULL THEN p.first_access_token ELSE NULL END,
         t.status,
         t.expires_at,
         p.first_access_used_at,
         EXISTS (
           SELECT 1 FROM public.email_send_log AS l
            WHERE lower(l.recipient_email) = lower(p_email)
              AND l.template_name = 'client-welcome'
              AND l.created_at > now() - interval '10 minutes'
         )
    FROM public.profiles AS p
    JOIN public.user_roles AS r ON r.user_id = p.id AND r.role = 'client'::public.app_role
    LEFT JOIN app_private.first_access_tokens AS t ON t.profile_id = p.id
   WHERE p_email IS NOT NULL AND lower(p.email) = lower(p_email)
   LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.first_access_resend_lookup_service(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.first_access_resend_lookup_service(text) TO service_role;
