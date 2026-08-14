-- Corrige o bloqueio do seletor de midia ao montar conteudo novo:
--   "Esta arte ja foi enviada para aprovacao e esta travada"
--
-- A guarda de copia barrava QUALQUER arquivo travado, inclusive a arte que
-- apenas entrou em revisao e ainda nem foi aprovada. Regra nova:
--   - Arte em revisao (travada, ainda NAO aprovada): pode ser anexada. A
--     aprovacao dela continua acontecendo no fluxo normal (revisao interna +
--     cliente quando marcado) e aprovar/publicar o post continua exigindo o
--     duplo gate.
--   - Arte APROVADA: mantem a regra de hoje (reuso liberado em post novo pela
--     20260812120000; trocar a arte de post ja aprovado continua exigindo
--     revisao).
--
-- Forward-only, aditiva e idempotente: reescreve a funcao a partir da
-- definicao vigente no banco.

DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
  old_guard text;
  new_guard text;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO original_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'save_editorial_post_unlocked';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION 'save_editorial_post_unlocked nao encontrada; nada a aplicar';
  END IF;

  new_guard := $b$      WHERE NOT COALESCE(
        public.file_is_editable(requested.file_id),
        false
      )
      AND COALESCE(public.editorial_file_is_publishable(requested.file_id, _client_id, _project_id), false)
      AND NOT ($b$;

  IF position(new_guard IN original_definition) > 0 THEN
    RAISE NOTICE 'anexo de arte em revisao pendente ja liberado; nada a fazer';
    RETURN;
  END IF;

  old_guard := $a$      WHERE NOT COALESCE(
        public.file_is_editable(requested.file_id),
        false
      )
      AND NOT ($a$;

  IF position(old_guard IN original_definition) = 0 THEN
    RAISE EXCEPTION 'guarda de copia (variante 20260812) nao encontrada; rode antes a migration 20260812120000';
  END IF;

  patched_definition := replace(original_definition, old_guard, new_guard);

  IF patched_definition = original_definition THEN
    RAISE EXCEPTION 'nenhuma alteracao produzida; nada foi aplicado';
  END IF;

  EXECUTE patched_definition;
  RAISE NOTICE 'arte em revisao pendente liberada para montar conteudo';
END
$patch$;

REVOKE ALL ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  TO service_role;
