-- Duas travas injustas na escolha de midia do conteudo:
--   1. Conteudo APAGADO (arquivado) segurava a arte para sempre: o indice
--      unico e a guarda "ja vinculada a outro conteudo" contavam posts
--      arquivados. Apagou o card, a arte tem que voltar a ficar livre.
--   2. Arte DISPONIBILIZADA ao cliente (client_shared) era recusada porque
--      nunca tem decisao do cliente (client_decided_at). Pela regra da casa,
--      disponibilizada = aprovada.
--
-- Forward-only e idempotente.

-- ─────────── 1) Indice unico vale so para conteudos vivos ───────────
DROP INDEX IF EXISTS public.editorial_posts_primary_file_unique_idx;
CREATE UNIQUE INDEX editorial_posts_primary_file_unique_idx
  ON public.editorial_posts(primary_file_id)
  WHERE primary_file_id IS NOT NULL AND archived_at IS NULL;

-- ─────────── 2) Guardas da funcao de salvar ───────────
DO $patch$
DECLARE
  original_definition text;
  patched_definition text;
  old_linked text;
  new_linked text;
  old_decided text;
  new_decided text;
  changed boolean := false;
BEGIN
  SELECT pg_get_functiondef(p.oid)
  INTO original_definition
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'save_editorial_post_unlocked';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION 'save_editorial_post_unlocked nao encontrada; nada a aplicar';
  END IF;

  patched_definition := original_definition;

  old_linked := $a$      AND post.id IS DISTINCT FROM _post_id
  ) OR EXISTS ($a$;
  new_linked := $b$      AND post.id IS DISTINCT FROM _post_id
      AND post.archived_at IS NULL
  ) OR EXISTS ($b$;

  IF position(new_linked IN patched_definition) > 0 THEN
    RAISE NOTICE 'guarda de vinculo ja ignora conteudos apagados; nada a fazer';
  ELSIF position(old_linked IN patched_definition) > 0 THEN
    patched_definition := replace(patched_definition, old_linked, new_linked);
    changed := true;
  ELSE
    RAISE NOTICE 'guarda de vinculo nao encontrada nesta versao; seguindo';
  END IF;

  old_decided := $c$    OR _primary_file.client_decided_at IS NULL THEN$c$;
  new_decided := $d$    OR (
      _primary_file.client_decided_at IS NULL
      AND _primary_file.visibility <> 'client_shared'
    ) THEN$d$;

  IF position(new_decided IN patched_definition) > 0 THEN
    RAISE NOTICE 'arte disponibilizada ja aceita como aprovada; nada a fazer';
  ELSIF position(old_decided IN patched_definition) > 0 THEN
    patched_definition := replace(patched_definition, old_decided, new_decided);
    changed := true;
  ELSE
    RAISE NOTICE 'guarda de decisao do cliente nao encontrada nesta versao; seguindo';
  END IF;

  IF changed THEN
    EXECUTE patched_definition;
    RAISE NOTICE 'reuso de arte de conteudo apagado e arte disponibilizada liberados';
  END IF;
END
$patch$;

REVOKE ALL ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  TO service_role;
