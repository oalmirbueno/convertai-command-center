-- Ultimo cadeado da arte presa: a guarda "ja vinculada a outro conteudo"
-- tambem contava PUBLICACOES de conteudos APAGADOS (arquivados). Publicacao
-- de conteudo apagado deixa de prender a arte; publicacao viva continua.

DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
  old_guard text;
  new_guard text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO original_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'save_editorial_post_unlocked';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION 'save_editorial_post_unlocked nao encontrada; nada a aplicar';
  END IF;

  new_guard := $b$      AND publication.status <> 'cancelled'
      AND EXISTS (
        SELECT 1 FROM public.editorial_posts AS owner_post
        WHERE owner_post.id = publication.post_id
          AND owner_post.archived_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'approved editorial media is already linked to another content';$b$;

  IF position(new_guard IN original_definition) > 0 THEN
    RAISE NOTICE 'publicacao de conteudo apagado ja libera a arte; nada a fazer';
    RETURN;
  END IF;

  old_guard := $a$      AND publication.status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'approved editorial media is already linked to another content';$a$;

  IF position(old_guard IN original_definition) = 0 THEN
    RAISE EXCEPTION 'guarda de publicacao nao encontrada nesta versao; nada foi alterado';
  END IF;

  patched_definition := replace(original_definition, old_guard, new_guard);

  IF patched_definition = original_definition THEN
    RAISE EXCEPTION 'nenhuma alteracao produzida; nada aplicado';
  END IF;

  EXECUTE patched_definition;
  RAISE NOTICE 'arte presa em publicacao de conteudo apagado liberada';
END
$patch$;

REVOKE ALL ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  TO service_role;
