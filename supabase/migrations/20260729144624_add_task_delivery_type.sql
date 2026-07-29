BEGIN;

-- Serialize this rollout with every existing task/editorial mutation path.
SELECT public.editorial_lock_task_sync();

ALTER TABLE public.tasks
  ADD COLUMN delivery_type text NOT NULL DEFAULT 'unspecified';

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_delivery_type_check
  CHECK (
    delivery_type IN (
      'unspecified',
      'design',
      'branding',
      'static',
      'carousel',
      'reel',
      'story',
      'video',
      'short',
      'article',
      'google_post',
      'planning',
      'copywriting',
      'website',
      'landing_page',
      'automation',
      'traffic',
      'seo',
      'document',
      'report',
      'other'
    )
  );

COMMENT ON COLUMN public.tasks.delivery_type IS
  'Tipo específico da entrega. A elegibilidade editorial é validada no banco e refletida no aplicativo.';

CREATE OR REPLACE FUNCTION public.editorial_delivery_type_is_publishable(
  _delivery_type text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT COALESCE(
    _delivery_type IN (
      'design',
      'static',
      'carousel',
      'reel',
      'story',
      'video',
      'short',
      'article',
      'google_post'
    ),
    false
  )
$$;

CREATE OR REPLACE FUNCTION public.editorial_content_type_for_delivery_type(
  _delivery_type text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE _delivery_type
    WHEN 'design' THEN 'static'
    WHEN 'static' THEN 'static'
    WHEN 'carousel' THEN 'carousel'
    WHEN 'reel' THEN 'reel'
    WHEN 'story' THEN 'story'
    WHEN 'video' THEN 'video'
    WHEN 'short' THEN 'short'
    WHEN 'article' THEN 'article'
    WHEN 'google_post' THEN 'google_post'
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.editorial_delivery_type_for_content_type(
  _content_type text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE _content_type
    WHEN 'static' THEN 'static'
    WHEN 'carousel' THEN 'carousel'
    WHEN 'reel' THEN 'reel'
    WHEN 'story' THEN 'story'
    WHEN 'video' THEN 'video'
    WHEN 'short' THEN 'short'
    WHEN 'article' THEN 'article'
    WHEN 'google_post' THEN 'google_post'
    ELSE NULL
  END
$$;

-- Safe to rerun by an operator: linked active content is authoritative, while
-- title inference only writes when exactly one high-confidence signal matches.
CREATE OR REPLACE FUNCTION public.editorial_reconcile_task_delivery_types()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _step_count integer := 0;
  _updated_count integer := 0;
BEGIN
  PERFORM public.editorial_lock_task_sync();

  WITH linked AS (
    SELECT
      task.id,
      public.editorial_delivery_type_for_content_type(post.content_type)
        AS delivery_type
    FROM public.tasks AS task
    JOIN public.editorial_posts AS post
      ON post.id = public.editorial_current_post_id_for_task(task.id)
    WHERE task.delivery_type = 'unspecified'
      AND task.deleted_at IS NULL
      AND left(COALESCE(task.source, ''), 15) <> 'client_request:'
  )
  UPDATE public.tasks AS task
  SET delivery_type = linked.delivery_type
  FROM linked
  WHERE task.id = linked.id
    AND linked.delivery_type IS NOT NULL
    AND task.delivery_type = 'unspecified';

  GET DIAGNOSTICS _step_count = ROW_COUNT;
  _updated_count := _updated_count + _step_count;

  WITH normalized AS (
    SELECT
      task.id,
      regexp_replace(
        translate(
          lower(concat_ws(' ', task.title, task.description)),
          'áàâãäéèêëíìîïóòôõöúùûüç',
          'aaaaaeeeeiiiiooooouuuuc'
        ),
        '[^a-z0-9]+',
        ' ',
        'g'
      ) AS searchable
    FROM public.tasks AS task
    WHERE task.delivery_type = 'unspecified'
      AND task.deleted_at IS NULL
      AND left(COALESCE(task.source, ''), 15) <> 'client_request:'
      AND public.editorial_current_post_id_for_task(task.id) IS NULL
  ),
  signals AS (
    SELECT normalized.id, candidate.delivery_type
    FROM normalized
    CROSS JOIN LATERAL (
      VALUES
        (
          'carousel',
          normalized.searchable ~ '\mcarrosse(l|is)\M'
        ),
        (
          'reel',
          normalized.searchable ~ '\mreels?\M'
        ),
        (
          'story',
          normalized.searchable ~ '\mstor(y|ies)\M'
        ),
        (
          'video',
          normalized.searchable ~ '\mvideos?\M'
        ),
        (
          'short',
          normalized.searchable ~ '\mshorts?\M'
        ),
        (
          'article',
          normalized.searchable ~ '\martigos?\M'
        ),
        (
          'google_post',
          normalized.searchable ~
            '\m(post|publicacao) (no |para o )?(google meu negocio|google business)\M'
        ),
        (
          'static',
          normalized.searchable ~
            '\m(post estatico|arte (para|de) (o )?(feed|instagram|facebook))\M'
        ),
        (
          'branding',
          normalized.searchable ~
            '\m(branding|brandbook|identidade visual|logotipos?|logos?)\M'
        ),
        (
          'planning',
          normalized.searchable ~
            '\m(planejamento editorial|planejamento de conteudo|plano editorial)\M'
        ),
        (
          'copywriting',
          normalized.searchable ~
            '(\mcopywriting\M|\mcopy\M|\mcopies\M|\mroteiros?\M)'
        ),
        (
          'landing_page',
          normalized.searchable ~
            '\m(landing page|pagina de captura)\M'
        ),
        (
          'website',
          normalized.searchable ~ '(\mwebsite\M|\msite\M)'
        ),
        (
          'automation',
          normalized.searchable ~ '(\mautomacao\M|\mworkflow\M)'
        ),
        (
          'traffic',
          normalized.searchable ~
            '\m(trafego pago|google ads|meta ads|campanha paga)\M'
        ),
        (
          'seo',
          normalized.searchable ~ '\mseo\M'
        ),
        (
          'document',
          normalized.searchable ~ '\m(documentos?|contratos?)\M'
        ),
        (
          'report',
          normalized.searchable ~ '\mrelatorios?\M'
        )
    ) AS candidate(delivery_type, matched)
    WHERE candidate.matched
  ),
  classified AS (
    SELECT signals.id, min(signals.delivery_type) AS delivery_type
    FROM signals
    GROUP BY signals.id
    HAVING count(*) = 1
  )
  UPDATE public.tasks AS task
  SET delivery_type = classified.delivery_type
  FROM classified
  WHERE task.id = classified.id
    AND task.delivery_type = 'unspecified';

  GET DIAGNOSTICS _step_count = ROW_COUNT;
  RETURN _updated_count + _step_count;
END
$$;

-- Preserve operational timestamps while classifying the existing base.
ALTER TABLE public.tasks DISABLE TRIGGER update_tasks_updated_at;
SELECT public.editorial_reconcile_task_delivery_types();
ALTER TABLE public.tasks ENABLE TRIGGER update_tasks_updated_at;

CREATE OR REPLACE FUNCTION public.editorial_task_delivery_type_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _post_id uuid;
  _content_type text;
  _expected_content_type text;
BEGIN
  IF NEW.delivery_type IS NOT DISTINCT FROM OLD.delivery_type THEN
    RETURN NEW;
  END IF;

  PERFORM public.editorial_lock_task_sync();
  _post_id := public.editorial_current_post_id_for_task(NEW.id);
  IF _post_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT post.content_type
  INTO _content_type
  FROM public.editorial_posts AS post
  WHERE post.id = _post_id;

  IF NEW.delivery_type = 'unspecified'
    OR NOT public.editorial_delivery_type_is_publishable(NEW.delivery_type) THEN
    RAISE EXCEPTION
      'Uma tarefa com conteúdo editorial ativo precisa manter um tipo publicável.';
  END IF;

  _expected_content_type :=
    public.editorial_content_type_for_delivery_type(NEW.delivery_type);
  IF _expected_content_type IS DISTINCT FROM _content_type THEN
    RAISE EXCEPTION
      'O tipo da tarefa não corresponde ao formato do conteúdo editorial ativo.';
  END IF;

  RETURN NEW;
END
$$;

-- Extend the existing link guard. Unspecified remains a legacy escape hatch:
-- when the post format has a canonical delivery type it is aligned on link;
-- explicit non-publishable or mismatched types are rejected instead of being
-- silently reclassified.
CREATE OR REPLACE FUNCTION public.editorial_task_link_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _aligned_delivery_type text;
  _current_post_id uuid;
  _post_content_type text;
  _source text;
  _source_task_id uuid;
  _task_delivery_type text;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.task_id IS NOT DISTINCT FROM OLD.task_id
    AND NEW.revision_of_post_id
      IS NOT DISTINCT FROM OLD.revision_of_post_id THEN
    RETURN NEW;
  END IF;

  PERFORM public.editorial_lock_task_sync();

  SELECT post.content_type
  INTO _post_content_type
  FROM public.editorial_posts AS post
  WHERE post.id = NEW.post_id;

  IF NEW.task_id IS NOT NULL THEN
    SELECT task.source, task.delivery_type
    INTO _source, _task_delivery_type
    FROM public.tasks AS task
    WHERE task.id = NEW.task_id
      AND task.deleted_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A tarefa editorial não existe ou foi excluída.';
    END IF;

    IF left(COALESCE(_source, ''), 15) = 'client_request:' THEN
      RAISE EXCEPTION
        'Tarefas originadas de pedidos não podem ser vinculadas ao editorial.';
    END IF;

    _aligned_delivery_type :=
      public.editorial_delivery_type_for_content_type(_post_content_type);

    IF _task_delivery_type = 'unspecified' THEN
      IF _aligned_delivery_type IS NOT NULL THEN
        UPDATE public.tasks
        SET delivery_type = _aligned_delivery_type
        WHERE id = NEW.task_id
          AND delivery_type = 'unspecified';
      END IF;
    ELSIF NOT public.editorial_delivery_type_is_publishable(
      _task_delivery_type
    ) THEN
      RAISE EXCEPTION
        'Somente tarefas com tipo publicável podem ser vinculadas ao editorial.';
    ELSIF public.editorial_content_type_for_delivery_type(
      _task_delivery_type
    ) IS DISTINCT FROM _post_content_type THEN
      RAISE EXCEPTION
        'O tipo da tarefa não corresponde ao formato do conteúdo editorial.';
    END IF;
  END IF;

  IF NEW.revision_of_post_id IS NOT NULL THEN
    SELECT source_internal.task_id
    INTO _source_task_id
    FROM public.editorial_post_internal AS source_internal
    WHERE source_internal.post_id = NEW.revision_of_post_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'A revisão de origem não possui estado editorial interno.';
    END IF;

    IF NEW.task_id IS DISTINCT FROM _source_task_id THEN
      RAISE EXCEPTION
        'A revisão editorial precisa manter a tarefa de origem.';
    END IF;

    IF _source_task_id IS NOT NULL
      AND public.editorial_current_post_id_for_task(_source_task_id)
        IS DISTINCT FROM NEW.revision_of_post_id THEN
      RAISE EXCEPTION
        'A revisão de origem não é mais a revisão atual.';
    END IF;
  ELSIF NEW.task_id IS NOT NULL THEN
    _current_post_id :=
      public.editorial_current_post_id_for_task(NEW.task_id);

    IF _current_post_id IS NOT NULL
      AND _current_post_id IS DISTINCT FROM NEW.post_id THEN
      RAISE EXCEPTION
        'A tarefa já possui um conteúdo editorial ativo.';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.editorial_post_delivery_type_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _aligned_delivery_type text;
  _task_delivery_type text;
  _task_id uuid;
BEGIN
  IF NEW.content_type IS NOT DISTINCT FROM OLD.content_type THEN
    RETURN NEW;
  END IF;

  PERFORM public.editorial_lock_task_sync();

  SELECT task.id, task.delivery_type
  INTO _task_id, _task_delivery_type
  FROM public.editorial_post_internal AS internal
  JOIN public.tasks AS task ON task.id = internal.task_id
  WHERE internal.post_id = NEW.id
    AND task.deleted_at IS NULL
  FOR UPDATE OF task;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  _aligned_delivery_type :=
    public.editorial_delivery_type_for_content_type(NEW.content_type);

  IF _task_delivery_type = 'unspecified' THEN
    IF _aligned_delivery_type IS NOT NULL THEN
      UPDATE public.tasks
      SET delivery_type = _aligned_delivery_type
      WHERE id = _task_id
        AND delivery_type = 'unspecified';
    END IF;
  ELSIF NOT public.editorial_delivery_type_is_publishable(
    _task_delivery_type
  ) OR public.editorial_content_type_for_delivery_type(
    _task_delivery_type
  ) IS DISTINCT FROM NEW.content_type THEN
    RAISE EXCEPTION
      'O formato editorial não corresponde ao tipo da tarefa vinculada.';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS tasks_editorial_sync_lock_update_trg
  ON public.tasks;
CREATE TRIGGER tasks_editorial_sync_lock_update_trg
BEFORE UPDATE OF status, delivery_type ON public.tasks
FOR EACH STATEMENT
EXECUTE FUNCTION public.editorial_lock_task_sync_trigger();

DROP TRIGGER IF EXISTS tasks_editorial_delivery_type_guard_trg
  ON public.tasks;
CREATE TRIGGER tasks_editorial_delivery_type_guard_trg
BEFORE UPDATE OF delivery_type ON public.tasks
FOR EACH ROW
WHEN (NEW.delivery_type IS DISTINCT FROM OLD.delivery_type)
EXECUTE FUNCTION public.editorial_task_delivery_type_guard();

DROP TRIGGER IF EXISTS editorial_posts_sync_lock_update_trg
  ON public.editorial_posts;
CREATE TRIGGER editorial_posts_sync_lock_update_trg
BEFORE UPDATE OF production_status, content_type ON public.editorial_posts
FOR EACH STATEMENT
EXECUTE FUNCTION public.editorial_lock_task_sync_trigger();

DROP TRIGGER IF EXISTS editorial_post_delivery_type_guard_trg
  ON public.editorial_posts;
CREATE TRIGGER editorial_post_delivery_type_guard_trg
AFTER UPDATE OF content_type ON public.editorial_posts
FOR EACH ROW
WHEN (NEW.content_type IS DISTINCT FROM OLD.content_type)
EXECUTE FUNCTION public.editorial_post_delivery_type_guard();

REVOKE ALL ON FUNCTION public.editorial_delivery_type_is_publishable(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_content_type_for_delivery_type(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_delivery_type_for_content_type(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_reconcile_task_delivery_types()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_task_delivery_type_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_task_link_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_post_delivery_type_guard()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
