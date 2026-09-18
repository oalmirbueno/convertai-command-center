-- Primeiro acesso sem beco sem saída (2026-09-18).
--
-- Caso Rd Ar: o link de primeiro acesso saiu por e-mail e pelo grupo, o
-- cliente abriu e a tela ficou preta. Ninguém conseguia dizer se a página
-- chegou a rodar, porque a validação do link não deixava rastro. Duas peças:
--
-- 1. validate_first_access_token carimba last_validated_at: prova de que o
--    link foi aberto e a página chegou a falar com o servidor. Não conta como
--    tentativa (attempts continua reservado ao uso da senha).
-- 2. first_access_state_service: leitura do estado do link para a função de
--    reenvio, que agora manda o MESMO link de novo enquanto ele vale, em vez
--    de gerar outro e matar o anterior.

ALTER TABLE app_private.first_access_tokens
  ADD COLUMN IF NOT EXISTS last_validated_at timestamptz;

CREATE OR REPLACE FUNCTION public.validate_first_access_token(p_token_hash_hex text)
 RETURNS TABLE(profile_id uuid, email text, status text, expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_token_hash_hex IS NULL OR p_token_hash_hex !~ '^[0-9a-f]{64}$' THEN RETURN; END IF;
  UPDATE app_private.first_access_tokens AS t
     SET last_validated_at = now()
   WHERE t.token_hash = pg_catalog.decode(p_token_hash_hex, 'hex');
  RETURN QUERY SELECT t.profile_id, p.email, t.status, t.expires_at FROM app_private.first_access_tokens AS t JOIN public.profiles AS p ON p.id = t.profile_id
  WHERE t.token_hash = pg_catalog.decode(p_token_hash_hex, 'hex') AND t.status IN ('available', 'used') AND t.expires_at > now() AND (t.status = 'used' OR t.attempts < 10);
END
$function$;

CREATE OR REPLACE FUNCTION public.first_access_state_service(p_profile_id uuid)
 RETURNS TABLE(status text, expires_at timestamp with time zone, last_validated_at timestamp with time zone, used_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT t.status, t.expires_at, t.last_validated_at, t.used_at
    FROM app_private.first_access_tokens AS t
   WHERE t.profile_id = p_profile_id
$function$;

REVOKE ALL ON FUNCTION public.first_access_state_service(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.first_access_state_service(uuid) TO service_role;
