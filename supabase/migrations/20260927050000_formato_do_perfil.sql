-- MF-01 (27/09/2026, frente MF da Mesa Foto): formato do perfil do cliente.
--
-- Pedido do dono: "quando qualquer cliente quiser só fotos no perfil a gente
-- faz só fotos por ali, ou alternar a gente usa as duas mesas, mas de forma
-- inteligente que entenda e não confusão".
--
-- 1) mesa_cliente_config.formato_do_perfil: 'fotos' | 'artes' | 'alternar'
--    (NULL = 'artes', o que sempre foi). O agente do Mês lê ao gravar o plano
--    (cada item ganha a mesa certa: Mesa Foto ou Estúdio) e o planejador
--    recebe o formato no contexto.
-- 2) mesa_config_formato_do_perfil(_client_id, _formato): só admin ou gestor
--    com acesso ao cliente (mesma regra de mesa_config_salvar), sem
--    sobrescrever os outros ajustes da linha.
--
-- Nada muda de RLS: a tabela segue lida pela equipe com acesso ao cliente
-- (is_staff + can_access_client) e escrita só por RPC SECURITY DEFINER.
-- Idempotente: pode rodar mais de uma vez.

ALTER TABLE public.mesa_cliente_config ADD COLUMN IF NOT EXISTS formato_do_perfil text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mesa_cliente_config_formato_do_perfil_check') THEN
    ALTER TABLE public.mesa_cliente_config
      ADD CONSTRAINT mesa_cliente_config_formato_do_perfil_check
      CHECK (formato_do_perfil IS NULL OR formato_do_perfil IN ('fotos', 'artes', 'alternar'));
  END IF;
END $$;

COMMENT ON COLUMN public.mesa_cliente_config.formato_do_perfil IS
  'Formato do perfil do cliente: fotos (todo post é de fotos, Mesa Foto), artes (Estúdio) ou alternar (o plano do mês mistura). NULL = artes.';

CREATE OR REPLACE FUNCTION public.mesa_config_formato_do_perfil(_client_id uuid, _formato text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _uid uuid := auth.uid();
  _valor text := NULLIF(btrim(COALESCE(_formato, '')), '');
BEGIN
  IF _uid IS NULL
    OR NOT (public.has_role(_uid, 'admin'::public.app_role) OR public.has_role(_uid, 'manager'::public.app_role))
    OR NOT public.can_access_client(_client_id) THEN
    RAISE EXCEPTION 'só admin ou gestor com acesso ao cliente muda este ajuste' USING ERRCODE = '42501';
  END IF;
  IF _valor IS NOT NULL AND _valor NOT IN ('fotos', 'artes', 'alternar') THEN
    RAISE EXCEPTION 'formato do perfil inválido (fotos, artes ou alternar)' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.mesa_cliente_config (client_id, formato_do_perfil, atualizado_em, atualizado_por)
  VALUES (_client_id, _valor, now(), _uid)
  ON CONFLICT (client_id) DO UPDATE SET formato_do_perfil = EXCLUDED.formato_do_perfil, atualizado_em = now(), atualizado_por = _uid;
  RETURN jsonb_build_object('client_id', _client_id, 'formato_do_perfil', COALESCE(_valor, 'artes'));
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_config_formato_do_perfil(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_config_formato_do_perfil(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.mesa_config_formato_do_perfil(uuid, text) IS
  'Frente MF (27/09): grava o formato do perfil do cliente (fotos, artes ou alternar). Admin ou gestor com acesso ao cliente; não mexe nos outros ajustes.';

-- Conferência (só leitura), depois de aplicar:
-- SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_schema = 'public' AND table_name = 'mesa_cliente_config' AND column_name = 'formato_do_perfil';
-- SELECT conname FROM pg_constraint WHERE conname = 'mesa_cliente_config_formato_do_perfil_check';
-- SELECT p.proname, p.prosecdef, pg_get_function_identity_arguments(p.oid)
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--  WHERE n.nspname = 'public' AND p.proname = 'mesa_config_formato_do_perfil';
-- SELECT has_function_privilege('anon', 'public.mesa_config_formato_do_perfil(uuid, text)', 'EXECUTE') AS anon_executa; -- false
