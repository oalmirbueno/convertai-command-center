-- ============================================================================
-- Aceleriq OS - task workstreams and bidirectional editorial synchronization
-- Fixtures are isolated by the surrounding transaction and always rolled back.
-- ============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT * FROM no_plan();

CREATE OR REPLACE FUNCTION pg_temp.public_has_execute(_fn regprocedure)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM pg_proc AS procedure_row
    CROSS JOIN LATERAL aclexplode(
      COALESCE(
        procedure_row.proacl,
        acldefault('f', procedure_row.proowner)
      )
    ) AS acl
    WHERE procedure_row.oid = _fn::oid
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  )
$$;

-- ---------------------------------------------------------------------------
-- 1. Structural contract.
-- ---------------------------------------------------------------------------
SELECT ok(
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tasks'
      AND column_name = 'workstream'
      AND data_type = 'text'
      AND is_nullable = 'NO'
      AND column_default = '''general''::text'
  ),
  'tasks.workstream is required and defaults to general'
);

SELECT ok(
  EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.tasks'::regclass
      AND conname = 'tasks_workstream_check'
      AND contype = 'c'
      AND convalidated
      AND pg_get_constraintdef(oid) LIKE '%workstream%'
  ),
  'tasks_workstream_check is present and validated'
);

SELECT ok(
  (
    SELECT
      count(*) = 15
      AND bool_and(
        NOT pg_temp.public_has_execute(
          procedure_row.oid::regprocedure
        )
        AND NOT has_function_privilege(
          'anon',
          procedure_row.oid,
          'EXECUTE'
        )
        AND NOT has_function_privilege(
          'authenticated',
          procedure_row.oid,
          'EXECUTE'
        )
        AND NOT has_function_privilege(
          'service_role',
          procedure_row.oid,
          'EXECUTE'
        )
      )
    FROM (
      VALUES
        ('public.editorial_current_post_id_for_task(uuid)'),
        ('public.editorial_production_status_for_task(text)'),
        ('public.editorial_task_status_for_post(uuid)'),
        ('public.editorial_sync_task_for_post(uuid)'),
        ('public.editorial_sync_task_from_post_trigger()'),
        ('public.editorial_sync_task_from_link_trigger()'),
        ('public.editorial_sync_task_from_publication_trigger()'),
        ('public.editorial_task_link_guard()'),
        ('public.editorial_prevent_premature_task_completion()'),
        ('public.editorial_sync_post_from_task_trigger()'),
        ('public.editorial_lock_task_sync()'),
        ('public.editorial_lock_task_sync_trigger()'),
        ('public.save_editorial_post_unlocked(jsonb,integer)'),
        (
          'public.transition_editorial_publication_unlocked(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)'
        ),
        ('public.archive_editorial_post_unlocked(uuid,integer)')
    ) AS expected(signature)
    JOIN pg_proc AS procedure_row
      ON procedure_row.oid = to_regprocedure(expected.signature)
  ),
  'editorial synchronization helpers and unlocked RPCs are private'
);

SELECT ok(
  (
    SELECT
      count(*) = 13
      AND bool_and(
        trigger_row.tgenabled = 'O'
        AND NOT trigger_row.tgisinternal
        AND trigger_row.tgfoid =
          to_regprocedure(expected.function_signature)
      )
    FROM (
      VALUES
        (
          'public.editorial_posts',
          'editorial_posts_sync_task_trg',
          'public.editorial_sync_task_from_post_trigger()'
        ),
        (
          'public.editorial_post_internal',
          'editorial_post_internal_task_link_guard_trg',
          'public.editorial_task_link_guard()'
        ),
        (
          'public.editorial_post_internal',
          'editorial_post_internal_sync_task_trg',
          'public.editorial_sync_task_from_link_trigger()'
        ),
        (
          'public.editorial_publications',
          'editorial_publications_sync_task_trg',
          'public.editorial_sync_task_from_publication_trigger()'
        ),
        (
          'public.tasks',
          'tasks_editorial_completion_guard_trg',
          'public.editorial_prevent_premature_task_completion()'
        ),
        (
          'public.tasks',
          'tasks_sync_editorial_post_trg',
          'public.editorial_sync_post_from_task_trigger()'
        ),
        (
          'public.editorial_posts',
          'editorial_posts_sync_lock_insert_trg',
          'public.editorial_lock_task_sync_trigger()'
        ),
        (
          'public.editorial_posts',
          'editorial_posts_sync_lock_update_trg',
          'public.editorial_lock_task_sync_trigger()'
        ),
        (
          'public.editorial_post_internal',
          'editorial_post_internal_sync_lock_insert_trg',
          'public.editorial_lock_task_sync_trigger()'
        ),
        (
          'public.editorial_post_internal',
          'editorial_post_internal_sync_lock_update_trg',
          'public.editorial_lock_task_sync_trigger()'
        ),
        (
          'public.editorial_publications',
          'editorial_publications_sync_lock_insert_trg',
          'public.editorial_lock_task_sync_trigger()'
        ),
        (
          'public.editorial_publications',
          'editorial_publications_sync_lock_update_trg',
          'public.editorial_lock_task_sync_trigger()'
        ),
        (
          'public.tasks',
          'tasks_editorial_sync_lock_update_trg',
          'public.editorial_lock_task_sync_trigger()'
        )
    ) AS expected(relation_name, trigger_name, function_signature)
    JOIN pg_trigger AS trigger_row
      ON trigger_row.tgrelid = to_regclass(expected.relation_name)
      AND trigger_row.tgname = expected.trigger_name
  ),
  'all synchronization and lock triggers are enabled and correctly bound'
);

-- ---------------------------------------------------------------------------
-- 2. Minimal isolated fixtures.
-- ---------------------------------------------------------------------------
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  (
    '9a100000-0000-0000-0000-000000000001',
    'editorial-sync-admin@test.local',
    '{"full_name":"Editorial Sync Admin","role":"admin"}'::jsonb
  ),
  (
    '9a100000-0000-0000-0000-00000000000a',
    'editorial-sync-client@test.local',
    '{"full_name":"Editorial Sync Client","role":"client"}'::jsonb
  );

SELECT set_config(
  'request.jwt.claim.sub',
  '9a100000-0000-0000-0000-000000000001',
  true
);
SELECT set_config(
  'request.jwt.claims',
  json_build_object(
    'sub',
    '9a100000-0000-0000-0000-000000000001',
    'role',
    'authenticated'
  )::text,
  true
);

INSERT INTO public.projects (
  id,
  client_id,
  name,
  project_type,
  status,
  progress,
  start_date,
  deadline
)
VALUES (
  '9a200000-0000-0000-0000-00000000000a',
  '9a100000-0000-0000-0000-00000000000a',
  'Editorial synchronization fixture',
  'recurring',
  'active',
  0,
  current_date,
  current_date + 30
);

INSERT INTO public.tasks (
  id,
  project_id,
  title,
  status,
  priority,
  source,
  workstream
)
VALUES
  (
    '9a300000-0000-0000-0000-000000000001',
    '9a200000-0000-0000-0000-00000000000a',
    'Primary synchronization chain',
    'backlog',
    'medium',
    'portal',
    'design'
  ),
  (
    '9a300000-0000-0000-0000-000000000002',
    '9a200000-0000-0000-0000-00000000000a',
    'Revision chain',
    'backlog',
    'medium',
    'portal',
    DEFAULT
  ),
  (
    '9a300000-0000-0000-0000-000000000003',
    '9a200000-0000-0000-0000-00000000000a',
    'Client request chain',
    'backlog',
    'medium',
    'client_request:fixture',
    DEFAULT
  );

SELECT is(
  (
    SELECT workstream
    FROM public.tasks
    WHERE id = '9a300000-0000-0000-0000-000000000002'
  ),
  'general',
  'new tasks use the general workstream by default'
);

SELECT throws_ok(
  $sql$
    UPDATE public.tasks
    SET workstream = 'sales'
    WHERE id = '9a300000-0000-0000-0000-000000000002'
  $sql$,
  '23514',
  NULL,
  'tasks_workstream_check rejects unknown workstreams'
);

INSERT INTO public.external_accounts (
  id,
  client_id,
  platform,
  display_name,
  handle
)
VALUES (
  '9a400000-0000-0000-0000-000000000001',
  '9a100000-0000-0000-0000-00000000000a',
  'instagram',
  'Editorial Sync Instagram',
  '@editorial-sync'
);

INSERT INTO public.project_external_accounts (
  client_id,
  project_id,
  external_account_id
)
VALUES (
  '9a100000-0000-0000-0000-00000000000a',
  '9a200000-0000-0000-0000-00000000000a',
  '9a400000-0000-0000-0000-000000000001'
);

INSERT INTO public.files (
  id,
  project_id,
  client_id,
  uploaded_by,
  file_name,
  file_url,
  file_type,
  folder,
  status,
  storage_bucket,
  storage_path
)
VALUES (
  '9a500000-0000-0000-0000-000000000001',
  '9a200000-0000-0000-0000-00000000000a',
  '9a100000-0000-0000-0000-00000000000a',
  '9a100000-0000-0000-0000-000000000001',
  'editorial-sync.png',
  'files://9a100000-0000-0000-0000-00000000000a/9a500000-0000-0000-0000-000000000001/1/editorial-sync.png',
  'image/png',
  'criativos',
  'ready',
  'files',
  '9a100000-0000-0000-0000-00000000000a/9a500000-0000-0000-0000-000000000001/1/editorial-sync.png'
);

INSERT INTO public.editorial_posts (
  id,
  client_id,
  project_id,
  title,
  content_type,
  production_status
)
VALUES (
  '9a600000-0000-0000-0000-000000000001',
  '9a100000-0000-0000-0000-00000000000a',
  '9a200000-0000-0000-0000-00000000000a',
  'Primary synchronized post',
  'static',
  'draft'
);

INSERT INTO public.editorial_post_internal (
  post_id,
  client_id,
  task_id,
  idempotency_key,
  request_fingerprint,
  created_by,
  updated_by
)
VALUES (
  '9a600000-0000-0000-0000-000000000001',
  '9a100000-0000-0000-0000-00000000000a',
  '9a300000-0000-0000-0000-000000000001',
  '9a800000-0000-0000-0000-000000000001',
  repeat('1', 64),
  '9a100000-0000-0000-0000-000000000001',
  '9a100000-0000-0000-0000-000000000001'
);

-- ---------------------------------------------------------------------------
-- 3. Bidirectional lifecycle.
-- ---------------------------------------------------------------------------
UPDATE public.tasks
SET status = 'doing'
WHERE id = '9a300000-0000-0000-0000-000000000001';

SELECT is(
  (
    SELECT production_status
    FROM public.editorial_posts
    WHERE id = '9a600000-0000-0000-0000-000000000001'
  ),
  'production',
  'task backlog to doing moves the linked post from draft to production'
);

UPDATE public.editorial_posts
SET production_status = 'ready'
WHERE id = '9a600000-0000-0000-0000-000000000001';

SELECT is(
  (
    SELECT status
    FROM public.tasks
    WHERE id = '9a300000-0000-0000-0000-000000000001'
  ),
  'review',
  'a ready post moves its linked task to review'
);

INSERT INTO public.editorial_publications (
  id,
  post_id,
  client_id,
  project_id,
  external_account_id,
  file_id,
  platform,
  status
)
VALUES (
  '9a700000-0000-0000-0000-000000000001',
  '9a600000-0000-0000-0000-000000000001',
  '9a100000-0000-0000-0000-00000000000a',
  '9a200000-0000-0000-0000-00000000000a',
  '9a400000-0000-0000-0000-000000000001',
  '9a500000-0000-0000-0000-000000000001',
  'instagram',
  'planned'
);

SELECT throws_like(
  $sql$
    UPDATE public.tasks
    SET status = 'done'
    WHERE id = '9a300000-0000-0000-0000-000000000001'
  $sql$,
  '%precisa estar publicado antes de concluir%',
  'a linked task cannot be completed before publication'
);

UPDATE public.editorial_publications
SET
  status = 'scheduled',
  scheduled_at = now() + interval '1 day'
WHERE id = '9a700000-0000-0000-0000-000000000001';

SELECT throws_like(
  $sql$
    UPDATE public.tasks
    SET status = 'doing'
    WHERE id = '9a300000-0000-0000-0000-000000000001'
  $sql$,
  '%Publicações agendadas ou finalizadas não podem voltar de etapa%',
  'a scheduled publication prevents a Kanban rollback'
);

UPDATE public.editorial_publications
SET
  status = 'published',
  published_at = now(),
  permalink = 'https://example.test/editorial-sync'
WHERE id = '9a700000-0000-0000-0000-000000000001';

SELECT is(
  (
    SELECT status
    FROM public.tasks
    WHERE id = '9a300000-0000-0000-0000-000000000001'
  ),
  'done',
  'publishing the last active plan completes the linked task'
);

SELECT throws_like(
  $sql$
    UPDATE public.tasks
    SET status = 'doing'
    WHERE id = '9a300000-0000-0000-0000-000000000001'
  $sql$,
  '%publicada não pode voltar de etapa%',
  'a published editorial task cannot return through the Kanban'
);

-- ---------------------------------------------------------------------------
-- 4. Link and revision invariants.
-- ---------------------------------------------------------------------------
INSERT INTO public.editorial_posts (
  id,
  client_id,
  project_id,
  title,
  content_type
)
VALUES
  (
    '9a600000-0000-0000-0000-000000000002',
    '9a100000-0000-0000-0000-00000000000a',
    '9a200000-0000-0000-0000-00000000000a',
    'Client request post',
    'static'
  ),
  (
    '9a600000-0000-0000-0000-000000000101',
    '9a100000-0000-0000-0000-00000000000a',
    '9a200000-0000-0000-0000-00000000000a',
    'Revision root',
    'static'
  );

SELECT throws_like(
  $sql$
    INSERT INTO public.editorial_post_internal (
      post_id,
      client_id,
      task_id,
      idempotency_key,
      request_fingerprint,
      created_by,
      updated_by
    )
    VALUES (
      '9a600000-0000-0000-0000-000000000002',
      '9a100000-0000-0000-0000-00000000000a',
      '9a300000-0000-0000-0000-000000000003',
      '9a800000-0000-0000-0000-000000000002',
      repeat('2', 64),
      '9a100000-0000-0000-0000-000000000001',
      '9a100000-0000-0000-0000-000000000001'
    )
  $sql$,
  '%originadas de pedidos não podem ser vinculadas%',
  'client-request tasks cannot be linked to editorial posts'
);

INSERT INTO public.editorial_post_internal (
  post_id,
  client_id,
  task_id,
  idempotency_key,
  request_fingerprint,
  created_by,
  updated_by
)
VALUES (
  '9a600000-0000-0000-0000-000000000101',
  '9a100000-0000-0000-0000-00000000000a',
  '9a300000-0000-0000-0000-000000000002',
  '9a800000-0000-0000-0000-000000000101',
  repeat('a', 64),
  '9a100000-0000-0000-0000-000000000001',
  '9a100000-0000-0000-0000-000000000001'
);

INSERT INTO public.editorial_posts (
  id,
  client_id,
  project_id,
  title,
  content_type
)
VALUES (
  '9a600000-0000-0000-0000-000000000102',
  '9a100000-0000-0000-0000-00000000000a',
  '9a200000-0000-0000-0000-00000000000a',
  'Invalid second root',
  'static'
);

SELECT throws_like(
  $sql$
    INSERT INTO public.editorial_post_internal (
      post_id,
      client_id,
      task_id,
      idempotency_key,
      request_fingerprint,
      created_by,
      updated_by
    )
    VALUES (
      '9a600000-0000-0000-0000-000000000102',
      '9a100000-0000-0000-0000-00000000000a',
      '9a300000-0000-0000-0000-000000000002',
      '9a800000-0000-0000-0000-000000000102',
      repeat('b', 64),
      '9a100000-0000-0000-0000-000000000001',
      '9a100000-0000-0000-0000-000000000001'
    )
  $sql$,
  '%já possui um conteúdo editorial ativo%',
  'a task cannot start a second active editorial root'
);

INSERT INTO public.editorial_posts (
  id,
  client_id,
  project_id,
  title,
  content_type
)
VALUES (
  '9a600000-0000-0000-0000-000000000099',
  '9a100000-0000-0000-0000-00000000000a',
  '9a200000-0000-0000-0000-00000000000a',
  'Current revision',
  'static'
);

SELECT lives_ok(
  $sql$
    INSERT INTO public.editorial_post_internal (
      post_id,
      client_id,
      task_id,
      revision_of_post_id,
      idempotency_key,
      request_fingerprint,
      created_by,
      updated_by
    )
    VALUES (
      '9a600000-0000-0000-0000-000000000099',
      '9a100000-0000-0000-0000-00000000000a',
      '9a300000-0000-0000-0000-000000000002',
      '9a600000-0000-0000-0000-000000000101',
      '9a800000-0000-0000-0000-000000000099',
      repeat('c', 64),
      '9a100000-0000-0000-0000-000000000001',
      '9a100000-0000-0000-0000-000000000001'
    )
  $sql$,
  'a revision can continue the current editorial chain'
);

SELECT is(
  public.editorial_current_post_id_for_task(
    '9a300000-0000-0000-0000-000000000002'
  ),
  '9a600000-0000-0000-0000-000000000099'::uuid,
  'the current revision follows the causal chain, not UUID order'
);

INSERT INTO public.editorial_posts (
  id,
  client_id,
  project_id,
  title,
  content_type
)
VALUES (
  '9a600000-0000-0000-0000-000000000104',
  '9a100000-0000-0000-0000-00000000000a',
  '9a200000-0000-0000-0000-00000000000a',
  'Invalid sibling revision',
  'static'
);

SELECT throws_like(
  $sql$
    INSERT INTO public.editorial_post_internal (
      post_id,
      client_id,
      task_id,
      revision_of_post_id,
      idempotency_key,
      request_fingerprint,
      created_by,
      updated_by
    )
    VALUES (
      '9a600000-0000-0000-0000-000000000104',
      '9a100000-0000-0000-0000-00000000000a',
      '9a300000-0000-0000-0000-000000000002',
      '9a600000-0000-0000-0000-000000000101',
      '9a800000-0000-0000-0000-000000000104',
      repeat('d', 64),
      '9a100000-0000-0000-0000-000000000001',
      '9a100000-0000-0000-0000-000000000001'
    )
  $sql$,
  '%revisão de origem não é mais a revisão atual%',
  'a stale root cannot create a sibling revision'
);

SELECT * FROM finish();

ROLLBACK;
