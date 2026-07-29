-- Keep the production stage of the current editorial revision synchronized
-- with its existing Kanban task. Publication remains protected by the
-- editorial double-gate and is never triggered from the Kanban.

BEGIN;

-- Keep schema installation and the one-time reconciliation isolated from
-- concurrent editorial/task writes.
LOCK TABLE
  public.tasks,
  public.editorial_posts,
  public.editorial_post_internal,
  public.editorial_publications
IN SHARE ROW EXCLUSIVE MODE;

-- Task and editorial status changes can start from either side. Acquiring one
-- transaction lock before either row family is touched gives every path the
-- same lock order and prevents duplicate roots and cross-table deadlocks.
CREATE OR REPLACE FUNCTION public.editorial_lock_task_sync()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('aceleriq.editorial-task-sync', 0)
  );
END
$$;

CREATE OR REPLACE FUNCTION public.editorial_lock_task_sync_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.editorial_lock_task_sync();
  RETURN NULL;
END
$$;

-- The existing mutation RPCs lock rows before issuing their final UPDATEs.
-- Keep their public signatures, but acquire the common lock before entering
-- the original implementation.
ALTER FUNCTION public.save_editorial_post(jsonb, integer)
  RENAME TO save_editorial_post_unlocked;

CREATE OR REPLACE FUNCTION public.save_editorial_post(
  p_payload jsonb,
  p_expected_version integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.editorial_lock_task_sync();
  RETURN public.save_editorial_post_unlocked(
    p_payload,
    p_expected_version
  );
END
$$;

ALTER FUNCTION public.transition_editorial_publication(
  uuid,
  text,
  integer,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) RENAME TO transition_editorial_publication_unlocked;

CREATE OR REPLACE FUNCTION public.transition_editorial_publication(
  p_publication_id uuid,
  p_action text,
  p_expected_version integer,
  p_scheduled_at timestamptz DEFAULT NULL,
  p_timezone text DEFAULT NULL,
  p_permalink text DEFAULT NULL,
  p_external_post_id text DEFAULT NULL,
  p_failure_code text DEFAULT NULL,
  p_failure_reason text DEFAULT NULL,
  p_published_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.editorial_lock_task_sync();
  RETURN public.transition_editorial_publication_unlocked(
    p_publication_id,
    p_action,
    p_expected_version,
    p_scheduled_at,
    p_timezone,
    p_permalink,
    p_external_post_id,
    p_failure_code,
    p_failure_reason,
    p_published_at
  );
END
$$;

ALTER FUNCTION public.archive_editorial_post(uuid, integer)
  RENAME TO archive_editorial_post_unlocked;

CREATE OR REPLACE FUNCTION public.archive_editorial_post(
  p_post_id uuid,
  p_expected_version integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.editorial_lock_task_sync();
  RETURN public.archive_editorial_post_unlocked(
    p_post_id,
    p_expected_version
  );
END
$$;

CREATE OR REPLACE FUNCTION public.editorial_current_post_id_for_task(
  _task_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT post.id
  FROM public.editorial_post_internal AS internal
  JOIN public.editorial_posts AS post
    ON post.id = internal.post_id
  WHERE internal.task_id = _task_id
    AND post.archived_at IS NULL
    AND post.production_status IN ('draft', 'production', 'ready')
    AND NOT EXISTS (
      SELECT 1
      FROM public.editorial_post_internal AS child_internal
      WHERE child_internal.revision_of_post_id = post.id
        AND child_internal.task_id = _task_id
    )
  ORDER BY post.created_at DESC, post.id DESC
  LIMIT 1
$$;

-- Older schema versions allowed more than one active chain per task. Refuse
-- to guess which leaf is canonical so operators can repair the specific task
-- before this migration is applied.
DO $$
DECLARE
  _ambiguous_task_id uuid;
  _invalid_revision_id uuid;
BEGIN
  SELECT child.post_id
  INTO _invalid_revision_id
  FROM public.editorial_post_internal AS child
  LEFT JOIN public.editorial_post_internal AS parent
    ON parent.post_id = child.revision_of_post_id
  WHERE child.revision_of_post_id IS NOT NULL
    AND parent.post_id IS NULL
  LIMIT 1;

  IF _invalid_revision_id IS NOT NULL THEN
    RAISE EXCEPTION
      'A revisão editorial % não possui estado interno de origem.',
      _invalid_revision_id
      USING HINT =
        'Repare o vínculo revision_of_post_id antes de reaplicar a migration.';
  END IF;

  SELECT child.post_id
  INTO _invalid_revision_id
  FROM public.editorial_post_internal AS child
  JOIN public.editorial_post_internal AS parent
    ON parent.post_id = child.revision_of_post_id
  WHERE child.revision_of_post_id IS NOT NULL
    AND child.task_id IS DISTINCT FROM parent.task_id
  LIMIT 1;

  IF _invalid_revision_id IS NOT NULL THEN
    RAISE EXCEPTION
      'A revisão editorial % não preserva a tarefa da origem.',
      _invalid_revision_id
      USING HINT =
        'Alinhe o task_id da cadeia antes de reaplicar a migration.';
  END IF;

  SELECT active_leaf.task_id
  INTO _ambiguous_task_id
  FROM (
    SELECT internal.task_id, post.id
    FROM public.editorial_post_internal AS internal
    JOIN public.editorial_posts AS post
      ON post.id = internal.post_id
    WHERE internal.task_id IS NOT NULL
      AND post.archived_at IS NULL
      AND post.production_status IN ('draft', 'production', 'ready')
      AND NOT EXISTS (
        SELECT 1
        FROM public.editorial_post_internal AS child_internal
        WHERE child_internal.revision_of_post_id = post.id
          AND child_internal.task_id = internal.task_id
      )
  ) AS active_leaf
  GROUP BY active_leaf.task_id
  HAVING count(*) > 1
  LIMIT 1;

  IF _ambiguous_task_id IS NOT NULL THEN
    RAISE EXCEPTION
      'A tarefa % possui mais de uma cadeia editorial ativa.',
      _ambiguous_task_id
      USING HINT =
        'Arquive ou cancele as cadeias duplicadas antes de reaplicar a migration.';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.editorial_production_status_for_task(
  _task_status text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE _task_status
    WHEN 'backlog' THEN 'draft'
    WHEN 'todo' THEN 'draft'
    WHEN 'doing' THEN 'production'
    WHEN 'review' THEN 'ready'
    WHEN 'approved' THEN 'ready'
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.editorial_task_status_for_post(
  _post_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE post.production_status
    WHEN 'draft' THEN 'backlog'
    WHEN 'production' THEN 'doing'
    WHEN 'ready' THEN
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.editorial_publications AS publication
          WHERE publication.post_id = post.id
            AND publication.status <> 'cancelled'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.editorial_publications AS publication
          WHERE publication.post_id = post.id
            AND publication.status NOT IN ('published', 'cancelled')
        )
          THEN 'done'
        ELSE 'review'
      END
    ELSE NULL
  END
  FROM public.editorial_posts AS post
  WHERE post.id = _post_id
    AND post.archived_at IS NULL
$$;

CREATE OR REPLACE FUNCTION public.editorial_sync_task_for_post(
  _post_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _task_id uuid;
  _task_status text;
BEGIN
  SELECT internal.task_id
  INTO _task_id
  FROM public.editorial_post_internal AS internal
  WHERE internal.post_id = _post_id;

  IF _task_id IS NULL
    OR public.editorial_current_post_id_for_task(_task_id)
      IS DISTINCT FROM _post_id THEN
    RETURN;
  END IF;

  _task_status := public.editorial_task_status_for_post(_post_id);
  IF _task_status IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.tasks AS task
  SET status = _task_status
  WHERE task.id = _task_id
    AND task.deleted_at IS NULL
    AND left(COALESCE(task.source, ''), 15) <> 'client_request:'
    AND task.status IS DISTINCT FROM _task_status;
END
$$;

CREATE OR REPLACE FUNCTION public.editorial_sync_task_from_post_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.editorial_sync_task_for_post(NEW.id);
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.editorial_sync_task_from_link_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.editorial_sync_task_for_post(NEW.post_id);
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.editorial_sync_task_from_publication_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.editorial_sync_task_for_post(NEW.post_id);
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.editorial_task_link_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _current_post_id uuid;
  _source_task_id uuid;
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.task_id IS NOT DISTINCT FROM OLD.task_id
    AND NEW.revision_of_post_id
      IS NOT DISTINCT FROM OLD.revision_of_post_id THEN
    RETURN NEW;
  END IF;

  IF NEW.task_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.tasks AS task
      WHERE task.id = NEW.task_id
        AND left(COALESCE(task.source, ''), 15) = 'client_request:'
    ) THEN
    RAISE EXCEPTION
      'Tarefas originadas de pedidos não podem ser vinculadas ao editorial.';
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

CREATE OR REPLACE FUNCTION public.editorial_prevent_premature_task_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _post_id uuid;
  _canonical_task_status text;
  _current_post_status text;
  _target_post_status text;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
    OR left(COALESCE(NEW.source, ''), 15) = 'client_request:' THEN
    RETURN NEW;
  END IF;

  _post_id := public.editorial_current_post_id_for_task(NEW.id);
  IF _post_id IS NULL THEN
    RETURN NEW;
  END IF;

  _canonical_task_status :=
    public.editorial_task_status_for_post(_post_id);

  IF NEW.status = 'done'
    AND _canonical_task_status IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION
      'O conteúdo vinculado precisa estar publicado antes de concluir a tarefa.';
  END IF;

  IF _canonical_task_status = 'done' AND NEW.status <> 'done' THEN
    RAISE EXCEPTION
      'Uma tarefa editorial publicada não pode voltar de etapa pelo Kanban.';
  END IF;

  _target_post_status :=
    public.editorial_production_status_for_task(NEW.status);
  IF _target_post_status IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT post.production_status
  INTO _current_post_status
  FROM public.editorial_posts AS post
  WHERE post.id = _post_id;

  IF _current_post_status IS DISTINCT FROM _target_post_status
    AND EXISTS (
      SELECT 1
      FROM public.editorial_publications AS publication
      WHERE publication.post_id = _post_id
        AND publication.status NOT IN ('planned', 'cancelled')
    ) THEN
    RAISE EXCEPTION
      'Publicações agendadas ou finalizadas não podem voltar de etapa pelo Kanban.';
  END IF;

  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.editorial_sync_post_from_task_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _post_id uuid;
  _client_id uuid;
  _from_status text;
  _to_status text;
  _post_version integer;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status
    OR left(COALESCE(NEW.source, ''), 15) = 'client_request:' THEN
    RETURN NEW;
  END IF;

  _to_status := public.editorial_production_status_for_task(NEW.status);
  IF _to_status IS NULL THEN
    RETURN NEW;
  END IF;

  _post_id := public.editorial_current_post_id_for_task(NEW.id);
  IF _post_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT post.client_id, post.production_status
  INTO _client_id, _from_status
  FROM public.editorial_posts AS post
  WHERE post.id = _post_id
  FOR UPDATE;

  IF NOT FOUND OR _from_status IS NOT DISTINCT FROM _to_status THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.editorial_publications AS publication
    WHERE publication.post_id = _post_id
      AND publication.status NOT IN ('planned', 'cancelled')
  ) THEN
    RAISE EXCEPTION
      'Publicações agendadas ou finalizadas não podem voltar de etapa pelo Kanban.';
  END IF;

  UPDATE public.editorial_posts
  SET production_status = _to_status
  WHERE id = _post_id
  RETURNING version INTO _post_version;

  INSERT INTO public.editorial_events (
    client_id,
    post_id,
    actor_id,
    event_type,
    from_status,
    to_status,
    metadata
  ) VALUES (
    _client_id,
    _post_id,
    auth.uid(),
    'production_status_synced_from_task',
    _from_status,
    _to_status,
    jsonb_build_object(
      'source', 'kanban',
      'task_id', NEW.id,
      'task_status_before', OLD.status,
      'task_status_after', NEW.status,
      'post_version', _post_version
    )
  );

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS editorial_posts_sync_lock_insert_trg
  ON public.editorial_posts;
CREATE TRIGGER editorial_posts_sync_lock_insert_trg
BEFORE INSERT ON public.editorial_posts
FOR EACH STATEMENT
EXECUTE FUNCTION public.editorial_lock_task_sync_trigger();

DROP TRIGGER IF EXISTS editorial_posts_sync_lock_update_trg
  ON public.editorial_posts;
CREATE TRIGGER editorial_posts_sync_lock_update_trg
BEFORE UPDATE OF production_status ON public.editorial_posts
FOR EACH STATEMENT
EXECUTE FUNCTION public.editorial_lock_task_sync_trigger();

DROP TRIGGER IF EXISTS editorial_post_internal_sync_lock_insert_trg
  ON public.editorial_post_internal;
CREATE TRIGGER editorial_post_internal_sync_lock_insert_trg
BEFORE INSERT ON public.editorial_post_internal
FOR EACH STATEMENT
EXECUTE FUNCTION public.editorial_lock_task_sync_trigger();

DROP TRIGGER IF EXISTS editorial_post_internal_sync_lock_update_trg
  ON public.editorial_post_internal;
CREATE TRIGGER editorial_post_internal_sync_lock_update_trg
BEFORE UPDATE OF task_id, revision_of_post_id
ON public.editorial_post_internal
FOR EACH STATEMENT
EXECUTE FUNCTION public.editorial_lock_task_sync_trigger();

DROP TRIGGER IF EXISTS editorial_publications_sync_lock_insert_trg
  ON public.editorial_publications;
CREATE TRIGGER editorial_publications_sync_lock_insert_trg
BEFORE INSERT ON public.editorial_publications
FOR EACH STATEMENT
EXECUTE FUNCTION public.editorial_lock_task_sync_trigger();

DROP TRIGGER IF EXISTS editorial_publications_sync_lock_update_trg
  ON public.editorial_publications;
CREATE TRIGGER editorial_publications_sync_lock_update_trg
BEFORE UPDATE OF status ON public.editorial_publications
FOR EACH STATEMENT
EXECUTE FUNCTION public.editorial_lock_task_sync_trigger();

DROP TRIGGER IF EXISTS tasks_editorial_sync_lock_update_trg
  ON public.tasks;
CREATE TRIGGER tasks_editorial_sync_lock_update_trg
BEFORE UPDATE OF status ON public.tasks
FOR EACH STATEMENT
EXECUTE FUNCTION public.editorial_lock_task_sync_trigger();

DROP TRIGGER IF EXISTS editorial_posts_sync_task_trg
  ON public.editorial_posts;
CREATE TRIGGER editorial_posts_sync_task_trg
AFTER UPDATE OF production_status ON public.editorial_posts
FOR EACH ROW
WHEN (NEW.production_status IS DISTINCT FROM OLD.production_status)
EXECUTE FUNCTION public.editorial_sync_task_from_post_trigger();

DROP TRIGGER IF EXISTS editorial_post_internal_sync_task_trg
  ON public.editorial_post_internal;
DROP TRIGGER IF EXISTS editorial_post_internal_task_link_guard_trg
  ON public.editorial_post_internal;
CREATE TRIGGER editorial_post_internal_task_link_guard_trg
BEFORE INSERT OR UPDATE OF task_id, revision_of_post_id
ON public.editorial_post_internal
FOR EACH ROW
EXECUTE FUNCTION public.editorial_task_link_guard();

CREATE TRIGGER editorial_post_internal_sync_task_trg
AFTER INSERT OR UPDATE OF task_id ON public.editorial_post_internal
FOR EACH ROW
EXECUTE FUNCTION public.editorial_sync_task_from_link_trigger();

DROP TRIGGER IF EXISTS editorial_publications_sync_task_trg
  ON public.editorial_publications;
CREATE TRIGGER editorial_publications_sync_task_trg
AFTER INSERT OR UPDATE OF status ON public.editorial_publications
FOR EACH ROW
EXECUTE FUNCTION public.editorial_sync_task_from_publication_trigger();

DROP TRIGGER IF EXISTS tasks_editorial_completion_guard_trg
  ON public.tasks;
CREATE TRIGGER tasks_editorial_completion_guard_trg
BEFORE UPDATE OF status ON public.tasks
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM OLD.status)
EXECUTE FUNCTION public.editorial_prevent_premature_task_completion();

DROP TRIGGER IF EXISTS tasks_sync_editorial_post_trg
  ON public.tasks;
CREATE TRIGGER tasks_sync_editorial_post_trg
AFTER UPDATE OF status ON public.tasks
FOR EACH ROW
WHEN (NEW.status IS DISTINCT FROM OLD.status)
EXECUTE FUNCTION public.editorial_sync_post_from_task_trigger();

-- Reconcile existing active links once. Later changes stay synchronized by
-- the triggers above, while client-request tasks remain untouched.
DO $$
DECLARE
  _post_id uuid;
  _task_id uuid;
BEGIN
  FOR _task_id IN
    SELECT DISTINCT internal.task_id
    FROM public.editorial_post_internal AS internal
    JOIN public.tasks AS task ON task.id = internal.task_id
    WHERE internal.task_id IS NOT NULL
      AND task.deleted_at IS NULL
      AND left(COALESCE(task.source, ''), 15) <> 'client_request:'
  LOOP
    _post_id := public.editorial_current_post_id_for_task(_task_id);
    IF _post_id IS NOT NULL THEN
      PERFORM public.editorial_sync_task_for_post(_post_id);
    END IF;
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION public.editorial_current_post_id_for_task(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_production_status_for_task(text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_task_status_for_post(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_sync_task_for_post(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_sync_task_from_post_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_sync_task_from_link_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_sync_task_from_publication_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_task_link_guard()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_prevent_premature_task_completion()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_sync_post_from_task_trigger()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_lock_task_sync()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.editorial_lock_task_sync_trigger()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_editorial_post_unlocked(jsonb, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.transition_editorial_publication_unlocked(
  uuid,
  text,
  integer,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.archive_editorial_post_unlocked(uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.save_editorial_post(jsonb, integer)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.transition_editorial_publication(
  uuid,
  text,
  integer,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.archive_editorial_post(uuid, integer)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.save_editorial_post(jsonb, integer)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_editorial_publication(
  uuid,
  text,
  integer,
  timestamptz,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_editorial_post(uuid, integer)
  TO authenticated;

COMMIT;
