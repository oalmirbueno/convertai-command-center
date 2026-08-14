-- A trava da arte mora em save_approved_editorial_post_unlocked (fluxo de
-- arte aprovada), nao na funcao geral. Patch certeiro com o texto real da
-- producao: conteudo APAGADO (post ou publicacao dele) deixa de prender a
-- arte, e arte disponibilizada (client_shared) dispensa decisao do cliente.

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
  SELECT pg_get_functiondef(p.oid) INTO original_definition
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'save_approved_editorial_post_unlocked';

  IF original_definition IS NULL THEN
    RAISE EXCEPTION 'save_approved_editorial_post_unlocked nao encontrada';
  END IF;

  patched_definition := original_definition;

  old_linked := $a$  IF EXISTS (
    SELECT 1
    FROM public.editorial_posts AS post
    WHERE post.primary_file_id = _primary_file_id
      AND post.id IS DISTINCT FROM _post_id
  ) OR EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    WHERE publication.file_id = _primary_file_id
      AND publication.post_id IS DISTINCT FROM _post_id
      AND publication.status <> 'cancelled'
  ) THEN$a$;
  new_linked := $b$  IF EXISTS (
    SELECT 1
    FROM public.editorial_posts AS post
    WHERE post.primary_file_id = _primary_file_id
      AND post.id IS DISTINCT FROM _post_id
      AND post.archived_at IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    WHERE publication.file_id = _primary_file_id
      AND publication.post_id IS DISTINCT FROM _post_id
      AND publication.status <> 'cancelled'
      AND EXISTS (
        SELECT 1 FROM public.editorial_posts AS owner_post
        WHERE owner_post.id = publication.post_id
          AND owner_post.archived_at IS NULL
      )
  ) THEN$b$;

  IF position(new_linked IN patched_definition) > 0 THEN
    RAISE NOTICE 'vinculo ja ignora conteudo apagado; nada a fazer';
  ELSIF position(old_linked IN patched_definition) > 0 THEN
    patched_definition := replace(patched_definition, old_linked, new_linked);
    changed := true;
  ELSE
    RAISE EXCEPTION 'guarda de vinculo nao encontrada; me mande o trecho';
  END IF;

  old_decided := $c$ _primary_file.client_decided_at IS NULL THEN$c$;
  new_decided := $d$ (
      _primary_file.client_decided_at IS NULL
      AND _primary_file.visibility <> 'client_shared'
    ) THEN$d$;

  IF position(new_decided IN patched_definition) > 0 THEN
    RAISE NOTICE 'arte disponibilizada ja aceita; nada a fazer';
  ELSIF position(old_decided IN patched_definition) > 0 THEN
    patched_definition := replace(patched_definition, old_decided, new_decided);
    changed := true;
  ELSE
    RAISE NOTICE 'guarda de decisao do cliente nao encontrada nesta funcao; seguindo';
  END IF;

  IF changed THEN
    EXECUTE patched_definition;
    RAISE NOTICE 'arte de conteudo apagado liberada no fluxo de arte aprovada';
  END IF;
END
$patch$;
