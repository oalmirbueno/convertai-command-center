-- Reabertura de publicação cancelada: comportamento, não só texto.
-- O banco descartável já tem as migrations. Tudo rola de volta no fim.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT * FROM no_plan();

ALTER TABLE public.profiles DISABLE TRIGGER USER;
ALTER TABLE public.projects DISABLE TRIGGER USER;
ALTER TABLE public.tasks DISABLE TRIGGER USER;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text,
    true
  );
  EXECUTE 'SET LOCAL ROLE authenticated';
END
$$;

INSERT INTO auth.users (id, email)
VALUES
  ('97000000-0000-0000-0000-000000000001', 'reabrir-admin@test.local'),
  ('97000000-0000-0000-0000-000000000003', 'reabrir-design@test.local'),
  ('97000000-0000-0000-0000-00000000000a', 'reabrir-cliente@test.local');

UPDATE public.profiles AS profile
SET full_name = fixture.full_name, plan_status = 'active', onboarding_done = true, sync_status = 'synced', client_type = 'recurring'
FROM (VALUES
  ('97000000-0000-0000-0000-000000000001'::uuid, 'Reabrir Admin'),
  ('97000000-0000-0000-0000-000000000003'::uuid, 'Reabrir Design'),
  ('97000000-0000-0000-0000-00000000000a'::uuid, 'Reabrir Cliente')
) AS fixture(id, full_name)
WHERE profile.id = fixture.id;

DELETE FROM public.user_roles
WHERE user_id IN (
  '97000000-0000-0000-0000-000000000001',
  '97000000-0000-0000-0000-000000000003',
  '97000000-0000-0000-0000-00000000000a'
);

INSERT INTO public.user_roles (user_id, role)
VALUES
  ('97000000-0000-0000-0000-000000000001', 'admin'),
  ('97000000-0000-0000-0000-000000000003', 'design'),
  ('97000000-0000-0000-0000-00000000000a', 'client');

INSERT INTO public.team_client_assignments (user_id, client_id)
VALUES ('97000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-00000000000a');

INSERT INTO public.projects (id, client_id, name, project_type, status, progress, start_date, deadline, billing_mode)
VALUES (
  '97000000-0000-0000-0000-0000000000b1',
  '97000000-0000-0000-0000-00000000000a',
  'Para Si fixture',
  'recurring',
  'active',
  0,
  current_date,
  current_date + 30,
  'included'
);

INSERT INTO public.tasks (id, project_id, title, status, priority, assigned_to, source)
VALUES (
  '97000000-0000-0000-0000-0000000000e1',
  '97000000-0000-0000-0000-0000000000b1',
  'Peça cancelada',
  'backlog',
  'medium',
  '97000000-0000-0000-0000-000000000003',
  'portal'
);

INSERT INTO public.external_accounts (id, client_id, platform, display_name, handle, created_by)
VALUES
  ('97000000-0000-0000-0000-0000000000c1', '97000000-0000-0000-0000-00000000000a', 'instagram', 'Para Si', '@parasi', '97000000-0000-0000-0000-000000000001'),
  ('97000000-0000-0000-0000-0000000000c2', '97000000-0000-0000-0000-00000000000a', 'facebook', 'Para Si Página', 'parasi', '97000000-0000-0000-0000-000000000001');

INSERT INTO public.project_external_accounts (client_id, project_id, external_account_id, created_by)
VALUES
  ('97000000-0000-0000-0000-00000000000a', '97000000-0000-0000-0000-0000000000b1', '97000000-0000-0000-0000-0000000000c1', '97000000-0000-0000-0000-000000000001'),
  ('97000000-0000-0000-0000-00000000000a', '97000000-0000-0000-0000-0000000000b1', '97000000-0000-0000-0000-0000000000c2', '97000000-0000-0000-0000-000000000001');

INSERT INTO public.files (
  id, project_id, client_id, uploaded_by, file_name, file_url, file_type, folder, status,
  storage_bucket, storage_path, visibility, agency_approval_status, approval_status, locked_at
)
VALUES
(
  '97000000-0000-0000-0000-0000000000d1',
  '97000000-0000-0000-0000-0000000000b1',
  '97000000-0000-0000-0000-00000000000a',
  '97000000-0000-0000-0000-000000000003',
  'parasi.png',
  'files://97000000-0000-0000-0000-00000000000a/97000000-0000-0000-0000-0000000000d1/1/parasi.png',
  'image/png',
  'entregas',
  'ready',
  'files',
  '97000000-0000-0000-0000-00000000000a/97000000-0000-0000-0000-0000000000d1/1/parasi.png',
  'internal',
  'not_requested',
  'none',
  NULL
),
(
  '97000000-0000-0000-0000-0000000000d2',
  '97000000-0000-0000-0000-0000000000b1',
  '97000000-0000-0000-0000-00000000000a',
  '97000000-0000-0000-0000-000000000003',
  'parasi-revisao.png',
  'files://97000000-0000-0000-0000-00000000000a/97000000-0000-0000-0000-0000000000d2/1/parasi-revisao.png',
  'image/png',
  'entregas',
  'ready',
  'files',
  '97000000-0000-0000-0000-00000000000a/97000000-0000-0000-0000-0000000000d2/1/parasi-revisao.png',
  'internal',
  'not_requested',
  'none',
  NULL
);

INSERT INTO storage.objects (bucket_id, name)
VALUES
  ('files', '97000000-0000-0000-0000-00000000000a/97000000-0000-0000-0000-0000000000d1/1/parasi.png'),
  ('files', '97000000-0000-0000-0000-00000000000a/97000000-0000-0000-0000-0000000000d2/1/parasi-revisao.png');

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d1',
      'task_id', '97000000-0000-0000-0000-0000000000e1',
      'idempotency_key', '97000000-0000-0000-0000-000000000101',
      'mutation_id', '97000000-0000-0000-0000-000000000201',
      'title', 'Para Si',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(
        jsonb_build_object(
          'external_account_id', '97000000-0000-0000-0000-0000000000c1',
          'caption', 'instagram',
          'scheduled_at', now() + interval '2 days',
          'scheduled_timezone', 'America/Sao_Paulo',
          'idempotency_key', '97000000-0000-0000-0000-000000000301'
        ),
        jsonb_build_object(
          'external_account_id', '97000000-0000-0000-0000-0000000000c2',
          'caption', 'facebook',
          'scheduled_at', now() + interval '3 days',
          'scheduled_timezone', 'America/Sao_Paulo',
          'idempotency_key', '97000000-0000-0000-0000-000000000302'
        )
      )
    ), NULL)
  $sql$,
  'admin cria o post com Instagram e Facebook'
);

SELECT lives_ok(
  $sql$
    SELECT public.transition_editorial_publication(
      (SELECT id FROM public.editorial_publications
        WHERE external_account_id = '97000000-0000-0000-0000-0000000000c1'
          AND status = 'planned'
        LIMIT 1),
      'cancel',
      1,
      NULL, NULL, NULL, NULL, NULL,
      'cancelada de proposito'
    )
  $sql$,
  'admin cancela o Instagram de propósito'
);

SELECT throws_ok(
  format(
    $sql$
      SELECT public.save_editorial_post(jsonb_build_object(
        'id', %L,
        'client_id', '97000000-0000-0000-0000-00000000000a',
        'project_id', '97000000-0000-0000-0000-0000000000b1',
        'primary_file_id', '97000000-0000-0000-0000-0000000000d1',
        'idempotency_key', '97000000-0000-0000-0000-000000000101',
        'mutation_id', '97000000-0000-0000-0000-000000000202',
        'title', 'Para Si',
        'content_type', 'static',
        'production_status', 'ready',
        'publications', jsonb_build_array(jsonb_build_object(
          'external_account_id', '97000000-0000-0000-0000-0000000000c1',
          'caption', 'instagram de novo',
          'scheduled_at', now() + interval '4 days',
          'scheduled_timezone', 'America/Sao_Paulo',
          'idempotency_key', '97000000-0000-0000-0000-000000000303'
        ))
      ), %s)
    $sql$,
    (SELECT post_id::text FROM public.editorial_publications WHERE external_account_id = '97000000-0000-0000-0000-0000000000c1' LIMIT 1),
    (SELECT p.version::text FROM public.editorial_posts p JOIN public.editorial_publications pub ON pub.post_id = p.id WHERE pub.external_account_id = '97000000-0000-0000-0000-0000000000c1' LIMIT 1)
  ),
  'P0001',
  'cancelled publication stays cancelled until an admin or manager reopens it',
  'salvar sem a marca recusa a conta cancelada'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000003');

SELECT throws_ok(
  format(
    $sql$
      SELECT public.save_editorial_post(jsonb_build_object(
        'id', %L,
        'client_id', '97000000-0000-0000-0000-00000000000a',
        'project_id', '97000000-0000-0000-0000-0000000000b1',
        'primary_file_id', '97000000-0000-0000-0000-0000000000d1',
        'idempotency_key', '97000000-0000-0000-0000-000000000101',
        'mutation_id', '97000000-0000-0000-0000-000000000203',
        'title', 'Para Si',
        'content_type', 'static',
        'production_status', 'ready',
        'reabrir_cancelada', true,
        'publications', jsonb_build_array(jsonb_build_object(
          'external_account_id', '97000000-0000-0000-0000-0000000000c1',
          'caption', 'instagram designer',
          'scheduled_at', now() + interval '4 days',
          'scheduled_timezone', 'America/Sao_Paulo',
          'idempotency_key', '97000000-0000-0000-0000-000000000304'
        ))
      ), %s)
    $sql$,
    (SELECT post_id::text FROM public.editorial_publications WHERE external_account_id = '97000000-0000-0000-0000-0000000000c1' LIMIT 1),
    (SELECT p.version::text FROM public.editorial_posts p JOIN public.editorial_publications pub ON pub.post_id = p.id WHERE pub.external_account_id = '97000000-0000-0000-0000-0000000000c1' LIMIT 1)
  ),
  'P0001',
  'cancelled publication stays cancelled until an admin or manager reopens it',
  'designer com a marca também é recusado'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT throws_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d2',
      'task_id', '97000000-0000-0000-0000-0000000000e1',
      'idempotency_key', '97000000-0000-0000-0000-000000000102',
      'mutation_id', '97000000-0000-0000-0000-000000000204',
      'revision_of_post_id', (SELECT post_id FROM public.editorial_publications WHERE external_account_id = '97000000-0000-0000-0000-0000000000c1' AND status = 'cancelled' LIMIT 1),
      'title', 'Para Si revisão',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(jsonb_build_object(
        'external_account_id', '97000000-0000-0000-0000-0000000000c1',
        'caption', 'revisao',
        'scheduled_at', now() + interval '5 days',
        'scheduled_timezone', 'America/Sao_Paulo',
        'idempotency_key', '97000000-0000-0000-0000-000000000305'
      ))
    ), NULL)
  $sql$,
  'P0001',
  'cancelled publication stays cancelled until an admin or manager reopens it',
  'revisão do Estúdio não cria publicação nova na conta cancelada'
);

SELECT lives_ok(
  $sql$
    SELECT public.transition_editorial_publication(
      (SELECT id FROM public.editorial_publications WHERE external_account_id = '97000000-0000-0000-0000-0000000000c1' AND status = 'cancelled' LIMIT 1),
      'reopen',
      (SELECT version FROM public.editorial_publications WHERE external_account_id = '97000000-0000-0000-0000-0000000000c1' AND status = 'cancelled' LIMIT 1)
    )
  $sql$,
  'admin reabre a cancelada'
);

RESET ROLE;

SELECT is(
  (SELECT scheduled_at IS NULL FROM public.editorial_publications WHERE external_account_id = '97000000-0000-0000-0000-0000000000c1'),
  true,
  'reopen de cancelada zera a data'
);

SELECT is(
  (SELECT included_in_approval_snapshot FROM public.editorial_publication_internal i
    JOIN public.editorial_publications p ON p.id = i.publication_id
    WHERE p.external_account_id = '97000000-0000-0000-0000-0000000000c1'),
  false,
  'reopen de cancelada não religa o selo, então o robô não agenda sozinho'
);

SELECT is(
  (SELECT i.approval_fingerprint = public.editorial_compute_approval_fingerprint(i.post_id)
    FROM public.editorial_post_internal i
    JOIN public.editorial_publications p ON p.post_id = i.post_id
    WHERE p.external_account_id = '97000000-0000-0000-0000-0000000000c1'),
  true,
  'desfazer/reopen recalcula a impressão digital das outras contas'
);

SELECT is(
  (SELECT included_in_approval_snapshot FROM public.editorial_publication_internal i
    JOIN public.editorial_publications p ON p.id = i.publication_id
    WHERE p.external_account_id = '97000000-0000-0000-0000-0000000000c2'),
  true,
  'a outra conta do mesmo post continua com o selo'
);

UPDATE public.editorial_publications
SET status = 'failed'
WHERE external_account_id = '97000000-0000-0000-0000-0000000000c2';

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $sql$
    SELECT public.transition_editorial_publication(
      (SELECT id FROM public.editorial_publications WHERE external_account_id = '97000000-0000-0000-0000-0000000000c2'),
      'reopen',
      (SELECT version FROM public.editorial_publications WHERE external_account_id = '97000000-0000-0000-0000-0000000000c2')
    )
  $sql$,
  'reabrir uma falha'
);

RESET ROLE;

SELECT is(
  (SELECT scheduled_at IS NOT NULL FROM public.editorial_publications WHERE external_account_id = '97000000-0000-0000-0000-0000000000c2'),
  true,
  'Tentar de novo: reopen de falha não zera scheduled_at'
);

SELECT ok(
  pg_get_functiondef('public.mesa_entrega_acompanha_aprovacao()'::regprocedure)
    LIKE '%IF _t.id IS NULL THEN%approval_withdrawn%sent_for_approval_file_id = NULL%',
  'retirar da aprovação solta o Workspace mesmo sem trabalho do Estúdio'
);

SELECT * FROM finish();
ROLLBACK;
