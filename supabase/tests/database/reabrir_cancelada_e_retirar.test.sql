-- Reabertura de publicação cancelada: comportamento, não só texto.
-- O banco descartável já tem as migrations. Tudo rola de volta no fim.
--
-- Posts do teste (cada um com o próprio arquivo):
--   P1 (d1, tarefa e1): Para Si, Instagram cancelado de propósito.
--   B  (d2): revisão de P1 sem publicação. C (d5): revisão de B (B2).
--   P2 (d3, e2) → R2 (d4): revisão normal do Estúdio (B1).
--   P3 (d6, e3): arte aprovada pelo cliente (save aprovado, RPC, B3).
--   C ganha o Facebook antes; um save tenta trocar a conta dele para o
--   Instagram cancelado em A (troca de conta).
--   Q1 (d7, e4) → Q2 (d8, aprovada): troca de conta pelo save aprovado.
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

-- Ids que o teste descobre no caminho (post, publicação e chave interna).
-- Gravados como dono; quem age (authenticated) só lê.
CREATE TEMP TABLE reabrir_ids (
  rotulo text PRIMARY KEY,
  id uuid NOT NULL
);
GRANT SELECT ON pg_temp.reabrir_ids TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.id_de(_rotulo text) RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT id FROM pg_temp.reabrir_ids WHERE rotulo = _rotulo
$$;

-- Guarda o post do arquivo e, de cada conta, a publicação e a chave dela.
CREATE OR REPLACE FUNCTION pg_temp.guardar_post(_rotulo text, _file uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pg_temp.reabrir_ids (rotulo, id)
  SELECT _rotulo, post.id FROM public.editorial_posts AS post WHERE post.primary_file_id = _file
  ON CONFLICT (rotulo) DO UPDATE SET id = EXCLUDED.id;
  INSERT INTO pg_temp.reabrir_ids (rotulo, id)
  SELECT _rotulo || '_key', internal.idempotency_key
  FROM public.editorial_post_internal AS internal
  WHERE internal.post_id = pg_temp.id_de(_rotulo)
  ON CONFLICT (rotulo) DO UPDATE SET id = EXCLUDED.id;
  INSERT INTO pg_temp.reabrir_ids (rotulo, id)
  SELECT _rotulo || CASE pub.external_account_id
      WHEN '97000000-0000-0000-0000-0000000000c1'::uuid THEN '_c1'
      ELSE '_c2' END,
    pub.id
  FROM public.editorial_publications AS pub
  WHERE pub.post_id = pg_temp.id_de(_rotulo)
  ON CONFLICT (rotulo) DO UPDATE SET id = EXCLUDED.id;
  INSERT INTO pg_temp.reabrir_ids (rotulo, id)
  SELECT _rotulo || CASE pub.external_account_id
      WHEN '97000000-0000-0000-0000-0000000000c1'::uuid THEN '_c1_key'
      ELSE '_c2_key' END,
    internal.idempotency_key
  FROM public.editorial_publications AS pub
  JOIN public.editorial_publication_internal AS internal ON internal.publication_id = pub.id
  WHERE pub.post_id = pg_temp.id_de(_rotulo)
  ON CONFLICT (rotulo) DO UPDATE SET id = EXCLUDED.id;
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
VALUES
  ('97000000-0000-0000-0000-0000000000e1', '97000000-0000-0000-0000-0000000000b1', 'Peça cancelada', 'backlog', 'medium', '97000000-0000-0000-0000-000000000003', 'portal'),
  ('97000000-0000-0000-0000-0000000000e2', '97000000-0000-0000-0000-0000000000b1', 'Peça com revisão normal', 'backlog', 'medium', '97000000-0000-0000-0000-000000000003', 'portal'),
  ('97000000-0000-0000-0000-0000000000e3', '97000000-0000-0000-0000-0000000000b1', 'Peça aprovada', 'backlog', 'medium', '97000000-0000-0000-0000-000000000003', 'portal'),
  ('97000000-0000-0000-0000-0000000000e4', '97000000-0000-0000-0000-0000000000b1', 'Peça com troca de conta', 'backlog', 'medium', '97000000-0000-0000-0000-000000000003', 'portal');

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
SELECT
  fixture.id,
  '97000000-0000-0000-0000-0000000000b1',
  '97000000-0000-0000-0000-00000000000a',
  '97000000-0000-0000-0000-000000000003',
  fixture.nome,
  'files://97000000-0000-0000-0000-00000000000a/' || fixture.id || '/1/' || fixture.nome,
  'image/png',
  'entregas',
  'ready',
  'files',
  '97000000-0000-0000-0000-00000000000a/' || fixture.id || '/1/' || fixture.nome,
  'internal',
  'not_requested',
  'none',
  NULL
FROM (VALUES
  ('97000000-0000-0000-0000-0000000000d1'::uuid, 'parasi.png'),
  ('97000000-0000-0000-0000-0000000000d2'::uuid, 'parasi-revisao.png'),
  ('97000000-0000-0000-0000-0000000000d3'::uuid, 'peca-normal.png'),
  ('97000000-0000-0000-0000-0000000000d4'::uuid, 'peca-normal-revisao.png'),
  ('97000000-0000-0000-0000-0000000000d5'::uuid, 'parasi-revisao-2.png'),
  ('97000000-0000-0000-0000-0000000000d6'::uuid, 'parasi-aprovada.png'),
  ('97000000-0000-0000-0000-0000000000d7'::uuid, 'troca-de-conta.png'),
  ('97000000-0000-0000-0000-0000000000d8'::uuid, 'troca-de-conta-aprovada.png')
) AS fixture(id, nome);

INSERT INTO storage.objects (bucket_id, name)
SELECT 'files', file_row.storage_path
FROM public.files AS file_row
WHERE file_row.project_id = '97000000-0000-0000-0000-0000000000b1';

-- ---------------------------------------------------------------------------
-- 1. Para Si: cancelada de propósito não volta sem marca de admin/gestor.
-- ---------------------------------------------------------------------------
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

RESET ROLE;
SELECT pg_temp.guardar_post('P1', '97000000-0000-0000-0000-0000000000d1');
SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $sql$
    SELECT public.transition_editorial_publication(
      pg_temp.id_de('P1_c1'),
      'cancel',
      (SELECT version FROM public.editorial_publications WHERE id = pg_temp.id_de('P1_c1')),
      NULL, NULL, NULL, NULL, NULL,
      'cancelada de proposito'
    )
  $sql$,
  'admin cancela o Instagram de propósito'
);

SELECT throws_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'id', pg_temp.id_de('P1'),
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
    ), (SELECT version FROM public.editorial_posts WHERE id = pg_temp.id_de('P1')))
  $sql$,
  'P0001',
  'cancelled publication stays cancelled until an admin or manager reopens it',
  'salvar sem a marca recusa a conta cancelada'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000003');

-- A marca vai onde o banco lê: _plan->>'reabrir_cancelada', em cada publicação.
SELECT throws_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'id', pg_temp.id_de('P1'),
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d1',
      'idempotency_key', '97000000-0000-0000-0000-000000000101',
      'mutation_id', '97000000-0000-0000-0000-000000000203',
      'title', 'Para Si',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(jsonb_build_object(
        'external_account_id', '97000000-0000-0000-0000-0000000000c1',
        'caption', 'instagram designer',
        'scheduled_at', now() + interval '4 days',
        'scheduled_timezone', 'America/Sao_Paulo',
        'idempotency_key', '97000000-0000-0000-0000-000000000304',
        'reabrir_cancelada', true
      ))
    ), (SELECT version FROM public.editorial_posts WHERE id = pg_temp.id_de('P1')))
  $sql$,
  'P0001',
  'cancelled publication stays cancelled until an admin or manager reopens it',
  'designer com a marca na publicação também é recusado'
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
      'revision_of_post_id', pg_temp.id_de('P1'),
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

-- ---------------------------------------------------------------------------
-- 2. B2: cadeia A → B → C. C não ganha a conta cancelada em A sem marca.
-- ---------------------------------------------------------------------------
SELECT lives_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d2',
      'task_id', '97000000-0000-0000-0000-0000000000e1',
      'idempotency_key', '97000000-0000-0000-0000-000000000103',
      'mutation_id', '97000000-0000-0000-0000-000000000205',
      'revision_of_post_id', pg_temp.id_de('P1'),
      'title', 'Para Si revisão B',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array()
    ), NULL)
  $sql$,
  'a revisão B nasce sem publicação'
);

RESET ROLE;
SELECT pg_temp.guardar_post('B', '97000000-0000-0000-0000-0000000000d2');

SELECT is(
  public.editorial_conta_cancelada_por_pessoa(NULL, pg_temp.id_de('B'), '97000000-0000-0000-0000-0000000000c1'),
  true,
  'a trava sobe a cadeia: B não tem a conta, A tem a cancelada de propósito'
);
SELECT is(
  public.editorial_conta_cancelada_por_pessoa(NULL, pg_temp.id_de('B'), '97000000-0000-0000-0000-0000000000c2'),
  false,
  'a outra conta da cadeia não trava (Facebook segue planejado em A)'
);

-- Cadeia longa: a busca com teto 1 lê só B; A fica de fora. Sem decidir a
-- conta, ela conta como travada (falha fechada), mesmo a livre.
SELECT is(
  public.editorial_conta_cancelada_na_cadeia(NULL, pg_temp.id_de('B'), '97000000-0000-0000-0000-0000000000c2', 1),
  true,
  'cadeia longa: busca que bate no teto sem decidir a conta trava (falha fechada)'
);
SELECT is(
  public.editorial_conta_cancelada_na_cadeia(NULL, pg_temp.id_de('B'), '97000000-0000-0000-0000-0000000000c1', 1),
  true,
  'cadeia longa: a cancelada além do teto não some da trava'
);
SELECT is(
  public.editorial_conta_cancelada_na_cadeia(NULL, pg_temp.id_de('B'), '97000000-0000-0000-0000-0000000000c2', 2),
  false,
  'cadeia longa: com a busca completa, a conta livre não trava'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.editorial_conta_cancelada_na_cadeia(uuid,uuid,uuid,integer)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.editorial_conta_cancelada_na_cadeia(uuid,uuid,uuid,integer)', 'EXECUTE'),
  'a busca com teto não é chamável por fora'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000003');

SELECT throws_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d5',
      'task_id', '97000000-0000-0000-0000-0000000000e1',
      'idempotency_key', '97000000-0000-0000-0000-000000000104',
      'mutation_id', '97000000-0000-0000-0000-000000000206',
      'revision_of_post_id', pg_temp.id_de('B'),
      'title', 'Para Si revisão C',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(jsonb_build_object(
        'external_account_id', '97000000-0000-0000-0000-0000000000c1',
        'caption', 'revisao C',
        'scheduled_timezone', 'America/Sao_Paulo',
        'idempotency_key', '97000000-0000-0000-0000-000000000306'
      ))
    ), NULL)
  $sql$,
  'P0001',
  'cancelled publication stays cancelled until an admin or manager reopens it',
  'B2: a revisão C (de B, de A) não cria a conta cancelada em A pelo Estúdio'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT throws_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d5',
      'task_id', '97000000-0000-0000-0000-0000000000e1',
      'idempotency_key', '97000000-0000-0000-0000-000000000105',
      'mutation_id', '97000000-0000-0000-0000-000000000207',
      'revision_of_post_id', pg_temp.id_de('B'),
      'title', 'Para Si revisão C',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(jsonb_build_object(
        'external_account_id', '97000000-0000-0000-0000-0000000000c1',
        'caption', 'revisao C',
        'scheduled_timezone', 'America/Sao_Paulo',
        'idempotency_key', '97000000-0000-0000-0000-000000000307'
      ))
    ), NULL)
  $sql$,
  'P0001',
  'cancelled publication stays cancelled until an admin or manager reopens it',
  'B2: nem admin cria em C sem a marca'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000003');

SELECT lives_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d5',
      'task_id', '97000000-0000-0000-0000-0000000000e1',
      'idempotency_key', '97000000-0000-0000-0000-000000000106',
      'mutation_id', '97000000-0000-0000-0000-000000000208',
      'revision_of_post_id', pg_temp.id_de('B'),
      'title', 'Para Si revisão C',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(jsonb_build_object(
        'external_account_id', '97000000-0000-0000-0000-0000000000c2',
        'caption', 'revisao C facebook',
        'scheduled_timezone', 'America/Sao_Paulo',
        'idempotency_key', '97000000-0000-0000-0000-000000000313'
      ))
    ), NULL)
  $sql$,
  'a revisão C nasce só com o Facebook planejado'
);

RESET ROLE;
SELECT pg_temp.guardar_post('C', '97000000-0000-0000-0000-0000000000d5');

SELECT is(
  public.editorial_conta_cancelada_na_cadeia(pg_temp.id_de('C'), NULL, '97000000-0000-0000-0000-0000000000c2', 1),
  false,
  'cadeia longa: conta decidida dentro do teto segue a linha achada'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000003');

-- Troca de conta: o id do Facebook de C com a conta Instagram, sem marca.
SELECT throws_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'id', pg_temp.id_de('C'),
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d5',
      'task_id', '97000000-0000-0000-0000-0000000000e1',
      'idempotency_key', pg_temp.id_de('C_key'),
      'mutation_id', '97000000-0000-0000-0000-000000000215',
      'title', 'Para Si revisão C',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(jsonb_build_object(
        'id', pg_temp.id_de('C_c2'),
        'external_account_id', '97000000-0000-0000-0000-0000000000c1',
        'caption', 'troca para o instagram',
        'scheduled_timezone', 'America/Sao_Paulo',
        'idempotency_key', pg_temp.id_de('C_c2_key')
      ))
    ), (SELECT version FROM public.editorial_posts WHERE id = pg_temp.id_de('C')))
  $sql$,
  'P0001',
  'cancelled publication stays cancelled until an admin or manager reopens it',
  'troca de conta: designer não leva a publicação para a conta cancelada em A'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT throws_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'id', pg_temp.id_de('C'),
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d5',
      'task_id', '97000000-0000-0000-0000-0000000000e1',
      'idempotency_key', pg_temp.id_de('C_key'),
      'mutation_id', '97000000-0000-0000-0000-000000000216',
      'title', 'Para Si revisão C',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(jsonb_build_object(
        'id', pg_temp.id_de('C_c2'),
        'external_account_id', '97000000-0000-0000-0000-0000000000c1',
        'caption', 'troca para o instagram',
        'scheduled_timezone', 'America/Sao_Paulo',
        'idempotency_key', pg_temp.id_de('C_c2_key')
      ))
    ), (SELECT version FROM public.editorial_posts WHERE id = pg_temp.id_de('C')))
  $sql$,
  'P0001',
  'cancelled publication stays cancelled until an admin or manager reopens it',
  'troca de conta: nem admin troca sem a marca'
);

RESET ROLE;

SELECT is(
  (SELECT external_account_id::text || ' ' || status
    FROM public.editorial_publications WHERE id = pg_temp.id_de('C_c2')),
  '97000000-0000-0000-0000-0000000000c2 planned',
  'troca de conta: a publicação de C segue no Facebook'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'id', pg_temp.id_de('C'),
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d5',
      'task_id', '97000000-0000-0000-0000-0000000000e1',
      'idempotency_key', pg_temp.id_de('C_key'),
      'mutation_id', '97000000-0000-0000-0000-000000000217',
      'title', 'Para Si revisão C',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(
        jsonb_build_object(
          'id', pg_temp.id_de('C_c2'),
          'external_account_id', '97000000-0000-0000-0000-0000000000c2',
          'caption', 'revisao C facebook',
          'scheduled_timezone', 'America/Sao_Paulo',
          'idempotency_key', pg_temp.id_de('C_c2_key')
        ),
        jsonb_build_object(
          'external_account_id', '97000000-0000-0000-0000-0000000000c1',
          'caption', 'revisao C',
          'scheduled_timezone', 'America/Sao_Paulo',
          'idempotency_key', '97000000-0000-0000-0000-000000000308',
          'reabrir_cancelada', true
        )
      )
    ), (SELECT version FROM public.editorial_posts WHERE id = pg_temp.id_de('C')))
  $sql$,
  'B2: admin com a marca na publicação traz a conta de volta em C'
);

RESET ROLE;
SELECT pg_temp.guardar_post('C', '97000000-0000-0000-0000-0000000000d5');

SELECT is(
  (SELECT status FROM public.editorial_publications WHERE id = pg_temp.id_de('C_c1')),
  'planned',
  'B2: a conta volta em C só pela marca do admin'
);

-- ---------------------------------------------------------------------------
-- 3. B1: revisão normal do Estúdio (designer, sem marca) segue funcionando.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000003');

SELECT lives_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d3',
      'task_id', '97000000-0000-0000-0000-0000000000e2',
      'idempotency_key', '97000000-0000-0000-0000-000000000107',
      'mutation_id', '97000000-0000-0000-0000-000000000209',
      'title', 'Peça normal',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(jsonb_build_object(
        'external_account_id', '97000000-0000-0000-0000-0000000000c1',
        'caption', 'peca normal',
        'scheduled_timezone', 'America/Sao_Paulo',
        'idempotency_key', '97000000-0000-0000-0000-000000000309'
      ))
    ), NULL)
  $sql$,
  'Estúdio entrega a peça com o Instagram planejado'
);

RESET ROLE;
SELECT pg_temp.guardar_post('P2', '97000000-0000-0000-0000-0000000000d3');
SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000003');

-- O que agenda-da-entrega.ts faz antes de nascer a revisão.
SELECT lives_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'id', pg_temp.id_de('P2'),
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d3',
      'task_id', '97000000-0000-0000-0000-0000000000e2',
      'idempotency_key', '97000000-0000-0000-0000-000000000107',
      'mutation_id', '97000000-0000-0000-0000-000000000210',
      'title', 'Peça normal',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array()
    ), (SELECT version FROM public.editorial_posts WHERE id = pg_temp.id_de('P2')))
  $sql$,
  'Estúdio limpa o plano do post anterior antes da revisão'
);

RESET ROLE;

SELECT is(
  (SELECT event.metadata->>'reason'
    FROM public.editorial_events AS event
    WHERE event.publication_id = pg_temp.id_de('P2_c1')
      AND event.event_type = 'publication_cancelled'
    ORDER BY event.created_at DESC
    LIMIT 1),
  'removed_from_plan',
  'a limpeza cancela com motivo removed_from_plan'
);
SELECT is(
  public.editorial_conta_cancelada_por_pessoa(NULL, pg_temp.id_de('P2'), '97000000-0000-0000-0000-0000000000c1'),
  false,
  'removed_from_plan não conta como cancelamento de pessoa'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000003');

SELECT lives_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d4',
      'task_id', '97000000-0000-0000-0000-0000000000e2',
      'idempotency_key', '97000000-0000-0000-0000-000000000108',
      'mutation_id', '97000000-0000-0000-0000-000000000211',
      'revision_of_post_id', pg_temp.id_de('P2'),
      'title', 'Peça normal revisão',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(jsonb_build_object(
        'external_account_id', '97000000-0000-0000-0000-0000000000c1',
        'caption', 'peca normal revisao',
        'scheduled_timezone', 'America/Sao_Paulo',
        'idempotency_key', '97000000-0000-0000-0000-000000000310'
      ))
    ), NULL)
  $sql$,
  'B1: a revisão normal cria a publicação na mesma conta, sem marca'
);

RESET ROLE;
SELECT pg_temp.guardar_post('R2', '97000000-0000-0000-0000-0000000000d4');

SELECT is(
  (SELECT status FROM public.editorial_publications WHERE id = pg_temp.id_de('R2_c1')),
  'planned',
  'B1: a revisão tem o Instagram planejado'
);

-- ---------------------------------------------------------------------------
-- 4. Reabrir pela transição (P1).
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $sql$
    SELECT public.transition_editorial_publication(
      pg_temp.id_de('P1_c1'),
      'reopen',
      (SELECT version FROM public.editorial_publications WHERE id = pg_temp.id_de('P1_c1'))
    )
  $sql$,
  'admin reabre a cancelada'
);

RESET ROLE;

SELECT is(
  (SELECT scheduled_at IS NULL FROM public.editorial_publications WHERE id = pg_temp.id_de('P1_c1')),
  true,
  'reopen de cancelada zera a data'
);

SELECT is(
  (SELECT included_in_approval_snapshot FROM public.editorial_publication_internal
    WHERE publication_id = pg_temp.id_de('P1_c1')),
  false,
  'reopen de cancelada não religa o selo, então o robô não agenda sozinho'
);

SELECT is(
  (SELECT approval_fingerprint = public.editorial_compute_approval_fingerprint(post_id)
    FROM public.editorial_post_internal
    WHERE post_id = pg_temp.id_de('P1')),
  true,
  'desfazer/reopen recalcula a impressão digital das outras contas'
);

SELECT is(
  (SELECT included_in_approval_snapshot FROM public.editorial_publication_internal
    WHERE publication_id = pg_temp.id_de('P1_c2')),
  true,
  'a outra conta do mesmo post continua com o selo'
);

UPDATE public.editorial_publications
SET status = 'failed'
WHERE id = pg_temp.id_de('P1_c2');

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $sql$
    SELECT public.transition_editorial_publication(
      pg_temp.id_de('P1_c2'),
      'reopen',
      (SELECT version FROM public.editorial_publications WHERE id = pg_temp.id_de('P1_c2'))
    )
  $sql$,
  'reabrir uma falha'
);

RESET ROLE;

SELECT is(
  (SELECT scheduled_at IS NOT NULL FROM public.editorial_publications WHERE id = pg_temp.id_de('P1_c2')),
  true,
  'Tentar de novo: reopen de falha não zera scheduled_at'
);

-- ---------------------------------------------------------------------------
-- 5. Arte aprovada (P3): RPC da Agenda, outra conta agenda e save aprovado (B3).
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000003');
SELECT lives_ok(
  $sql$ SELECT public.request_file_agency_review('97000000-0000-0000-0000-0000000000d6') $sql$,
  'designer pede a revisão da agência'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');
SELECT lives_ok(
  $sql$ SELECT public.review_file_agency('97000000-0000-0000-0000-0000000000d6', 'approved', NULL) $sql$,
  'admin aprova na agência'
);
SELECT lives_ok(
  $sql$ SELECT public.release_file_to_client('97000000-0000-0000-0000-0000000000d6', 'approval') $sql$,
  'admin libera para o cliente'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-00000000000a');
SELECT lives_ok(
  $sql$ SELECT public.decide_file_approval('97000000-0000-0000-0000-0000000000d6', 1, 'approved', NULL) $sql$,
  'cliente aprova a arte'
);

RESET ROLE;
SELECT is(
  public.editorial_file_is_publishable_media(
    '97000000-0000-0000-0000-0000000000d6',
    '97000000-0000-0000-0000-00000000000a',
    '97000000-0000-0000-0000-0000000000b1'
  ),
  true,
  'a arte aprovada pode ser publicada'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d6',
      'task_id', '97000000-0000-0000-0000-0000000000e3',
      'idempotency_key', '97000000-0000-0000-0000-000000000109',
      'mutation_id', '97000000-0000-0000-0000-000000000212',
      'title', 'Para Si aprovada',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(
        jsonb_build_object(
          'external_account_id', '97000000-0000-0000-0000-0000000000c1',
          'scheduled_at', now() + interval '2 days',
          'scheduled_timezone', 'America/Sao_Paulo',
          'idempotency_key', '97000000-0000-0000-0000-000000000311'
        ),
        jsonb_build_object(
          'external_account_id', '97000000-0000-0000-0000-0000000000c2',
          'scheduled_at', now() + interval '3 days',
          'scheduled_timezone', 'America/Sao_Paulo',
          'idempotency_key', '97000000-0000-0000-0000-000000000312'
        )
      )
    ), NULL)
  $sql$,
  'admin agenda a arte aprovada nas duas contas (save aprovado)'
);

RESET ROLE;
SELECT pg_temp.guardar_post('P3', '97000000-0000-0000-0000-0000000000d6');

SELECT is(
  (SELECT count(*)::integer FROM public.editorial_publications
    WHERE post_id = pg_temp.id_de('P3') AND status = 'scheduled'),
  2,
  'as duas contas do post aprovado ficam agendadas'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $sql$
    SELECT public.transition_editorial_publication(
      pg_temp.id_de('P3_c1'),
      'cancel',
      (SELECT version FROM public.editorial_publications WHERE id = pg_temp.id_de('P3_c1')),
      NULL, NULL, NULL, NULL, NULL,
      'cancelada de proposito'
    )
  $sql$,
  'admin cancela o Instagram aprovado de propósito'
);

-- B3 negativo: designer com a marca, pelo save aprovado.
SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000003');

SELECT throws_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'id', pg_temp.id_de('P3'),
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d6',
      'task_id', '97000000-0000-0000-0000-0000000000e3',
      'idempotency_key', pg_temp.id_de('P3_key'),
      'mutation_id', '97000000-0000-0000-0000-000000000213',
      'title', 'Para Si aprovada',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(
        jsonb_build_object(
          'id', pg_temp.id_de('P3_c1'),
          'external_account_id', '97000000-0000-0000-0000-0000000000c1',
          'scheduled_at', now() + interval '4 days',
          'scheduled_timezone', 'America/Sao_Paulo',
          'idempotency_key', pg_temp.id_de('P3_c1_key'),
          'reabrir_cancelada', true
        ),
        jsonb_build_object(
          'id', pg_temp.id_de('P3_c2'),
          'external_account_id', '97000000-0000-0000-0000-0000000000c2',
          'scheduled_at', now() + interval '3 days',
          'scheduled_timezone', 'America/Sao_Paulo',
          'idempotency_key', pg_temp.id_de('P3_c2_key')
        )
      )
    ), (SELECT version FROM public.editorial_posts WHERE id = pg_temp.id_de('P3')))
  $sql$,
  'P0001',
  'cancelled publication stays cancelled until an admin or manager reopens it',
  'B3: designer com a marca é recusado no save aprovado'
);

-- RPC da Agenda: designer recusado, data no passado recusada, data nova ok.
SELECT throws_ok(
  $sql$
    SELECT public.reagendar_publicacao_cancelada(
      pg_temp.id_de('P3_c1'),
      (SELECT version FROM public.editorial_posts WHERE id = pg_temp.id_de('P3')),
      now() + interval '5 days',
      'America/Sao_Paulo'
    )
  $sql$,
  'P0001',
  'only an assigned manager or admin can reopen a cancelled publication',
  'RPC: designer não reagenda a cancelada'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT throws_ok(
  $sql$
    SELECT public.reagendar_publicacao_cancelada(
      pg_temp.id_de('P3_c1'),
      (SELECT version FROM public.editorial_posts WHERE id = pg_temp.id_de('P3')),
      now() - interval '1 day',
      'America/Sao_Paulo'
    )
  $sql$,
  'P0001',
  'scheduled time cannot be in the past',
  'RPC: data no passado é recusada'
);

SELECT lives_ok(
  $sql$
    SELECT public.reagendar_publicacao_cancelada(
      pg_temp.id_de('P3_c1'),
      (SELECT version FROM public.editorial_posts WHERE id = pg_temp.id_de('P3')),
      now() + interval '5 days',
      'America/Sao_Paulo'
    )
  $sql$,
  'RPC: admin reagenda a cancelada com data nova'
);

RESET ROLE;

SELECT is(
  (SELECT status || ' ' || (scheduled_at = now() + interval '5 days')::text
    FROM public.editorial_publications WHERE id = pg_temp.id_de('P3_c1')),
  'scheduled true',
  'RPC: a cancelada volta agendada na data nova'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $sql$
    SELECT public.transition_editorial_publication(
      pg_temp.id_de('P3_c2'),
      'schedule',
      (SELECT version FROM public.editorial_publications WHERE id = pg_temp.id_de('P3_c2')),
      now() + interval '8 days',
      'America/Sao_Paulo'
    )
  $sql$,
  'a outra conta do post reagenda de verdade depois do reopen'
);

RESET ROLE;

SELECT is(
  (SELECT status || ' ' || (scheduled_at = now() + interval '8 days')::text
    FROM public.editorial_publications WHERE id = pg_temp.id_de('P3_c2')),
  'scheduled true',
  'a outra conta ficou agendada na data nova'
);

-- B3 positivo: admin com a marca, pelo save aprovado.
SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $sql$
    SELECT public.transition_editorial_publication(
      pg_temp.id_de('P3_c1'),
      'cancel',
      (SELECT version FROM public.editorial_publications WHERE id = pg_temp.id_de('P3_c1')),
      NULL, NULL, NULL, NULL, NULL,
      'cancelada de novo'
    )
  $sql$,
  'admin cancela o Instagram aprovado de novo'
);

SELECT lives_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'id', pg_temp.id_de('P3'),
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d6',
      'task_id', '97000000-0000-0000-0000-0000000000e3',
      'idempotency_key', pg_temp.id_de('P3_key'),
      'mutation_id', '97000000-0000-0000-0000-000000000214',
      'title', 'Para Si aprovada',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(
        jsonb_build_object(
          'id', pg_temp.id_de('P3_c1'),
          'external_account_id', '97000000-0000-0000-0000-0000000000c1',
          'scheduled_at', now() + interval '7 days',
          'scheduled_timezone', 'America/Sao_Paulo',
          'idempotency_key', pg_temp.id_de('P3_c1_key'),
          'reabrir_cancelada', true
        ),
        jsonb_build_object(
          'id', pg_temp.id_de('P3_c2'),
          'external_account_id', '97000000-0000-0000-0000-0000000000c2',
          'scheduled_at', now() + interval '8 days',
          'scheduled_timezone', 'America/Sao_Paulo',
          'idempotency_key', pg_temp.id_de('P3_c2_key')
        )
      )
    ), (SELECT version FROM public.editorial_posts WHERE id = pg_temp.id_de('P3')))
  $sql$,
  'B3: admin com a marca reabre pelo save aprovado'
);

RESET ROLE;

SELECT is(
  (SELECT status || ' ' || (scheduled_at = now() + interval '7 days')::text
    FROM public.editorial_publications WHERE id = pg_temp.id_de('P3_c1')),
  'scheduled true',
  'B3: a marca chegou à trava e a conta voltou agendada'
);

-- ---------------------------------------------------------------------------
-- 6. Troca de conta pelo save aprovado: Q1 (Instagram cancelado de propósito)
--    → Q2 (arte aprovada, só Facebook). O id do Facebook com a conta
--    Instagram, sem marca, é recusado.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d7',
      'task_id', '97000000-0000-0000-0000-0000000000e4',
      'idempotency_key', '97000000-0000-0000-0000-000000000110',
      'mutation_id', '97000000-0000-0000-0000-000000000218',
      'title', 'Troca de conta',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(
        jsonb_build_object(
          'external_account_id', '97000000-0000-0000-0000-0000000000c1',
          'caption', 'instagram',
          'scheduled_timezone', 'America/Sao_Paulo',
          'idempotency_key', '97000000-0000-0000-0000-000000000314'
        ),
        jsonb_build_object(
          'external_account_id', '97000000-0000-0000-0000-0000000000c2',
          'caption', 'facebook',
          'scheduled_timezone', 'America/Sao_Paulo',
          'idempotency_key', '97000000-0000-0000-0000-000000000315'
        )
      )
    ), NULL)
  $sql$,
  'Q1 nasce com Instagram e Facebook'
);

RESET ROLE;
SELECT pg_temp.guardar_post('Q1', '97000000-0000-0000-0000-0000000000d7');
SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $sql$
    SELECT public.transition_editorial_publication(
      pg_temp.id_de('Q1_c1'),
      'cancel',
      (SELECT version FROM public.editorial_publications WHERE id = pg_temp.id_de('Q1_c1')),
      NULL, NULL, NULL, NULL, NULL,
      'cancelada de proposito'
    )
  $sql$,
  'admin cancela o Instagram de Q1 de propósito'
);

-- O que agenda-da-entrega.ts faz antes de nascer a revisão.
SELECT lives_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'id', pg_temp.id_de('Q1'),
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d7',
      'task_id', '97000000-0000-0000-0000-0000000000e4',
      'idempotency_key', pg_temp.id_de('Q1_key'),
      'mutation_id', '97000000-0000-0000-0000-000000000219',
      'title', 'Troca de conta',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array()
    ), (SELECT version FROM public.editorial_posts WHERE id = pg_temp.id_de('Q1')))
  $sql$,
  'Q1 limpa o plano antes da revisão'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000003');
SELECT lives_ok(
  $sql$ SELECT public.request_file_agency_review('97000000-0000-0000-0000-0000000000d8') $sql$,
  'Q2: designer pede a revisão da agência'
);
SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');
SELECT lives_ok(
  $sql$ SELECT public.review_file_agency('97000000-0000-0000-0000-0000000000d8', 'approved', NULL) $sql$,
  'Q2: admin aprova na agência'
);
SELECT lives_ok(
  $sql$ SELECT public.release_file_to_client('97000000-0000-0000-0000-0000000000d8', 'approval') $sql$,
  'Q2: admin libera para o cliente'
);
SELECT pg_temp.act_as('97000000-0000-0000-0000-00000000000a');
SELECT lives_ok(
  $sql$ SELECT public.decide_file_approval('97000000-0000-0000-0000-0000000000d8', 1, 'approved', NULL) $sql$,
  'Q2: cliente aprova a arte'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT lives_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d8',
      'task_id', '97000000-0000-0000-0000-0000000000e4',
      'idempotency_key', '97000000-0000-0000-0000-000000000111',
      'mutation_id', '97000000-0000-0000-0000-000000000220',
      'revision_of_post_id', pg_temp.id_de('Q1'),
      'title', 'Troca de conta aprovada',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(jsonb_build_object(
        'external_account_id', '97000000-0000-0000-0000-0000000000c2',
        'scheduled_at', now() + interval '3 days',
        'scheduled_timezone', 'America/Sao_Paulo',
        'idempotency_key', '97000000-0000-0000-0000-000000000316'
      ))
    ), NULL)
  $sql$,
  'Q2 (arte aprovada, revisão de Q1) nasce só com o Facebook'
);

RESET ROLE;
SELECT pg_temp.guardar_post('Q2', '97000000-0000-0000-0000-0000000000d8');

SELECT is(
  public.editorial_conta_cancelada_por_pessoa(pg_temp.id_de('Q2'), NULL, '97000000-0000-0000-0000-0000000000c1'),
  true,
  'Q2: o Instagram cancelado em Q1 segue travado pela cadeia'
);

SELECT pg_temp.act_as('97000000-0000-0000-0000-000000000001');

SELECT throws_ok(
  $sql$
    SELECT public.save_editorial_post(jsonb_build_object(
      'id', pg_temp.id_de('Q2'),
      'client_id', '97000000-0000-0000-0000-00000000000a',
      'project_id', '97000000-0000-0000-0000-0000000000b1',
      'primary_file_id', '97000000-0000-0000-0000-0000000000d8',
      'task_id', '97000000-0000-0000-0000-0000000000e4',
      'idempotency_key', pg_temp.id_de('Q2_key'),
      'mutation_id', '97000000-0000-0000-0000-000000000221',
      'title', 'Troca de conta aprovada',
      'content_type', 'static',
      'production_status', 'ready',
      'publications', jsonb_build_array(jsonb_build_object(
        'id', pg_temp.id_de('Q2_c2'),
        'external_account_id', '97000000-0000-0000-0000-0000000000c1',
        'scheduled_at', now() + interval '3 days',
        'scheduled_timezone', 'America/Sao_Paulo',
        'idempotency_key', pg_temp.id_de('Q2_c2_key')
      ))
    ), (SELECT version FROM public.editorial_posts WHERE id = pg_temp.id_de('Q2')))
  $sql$,
  'P0001',
  'cancelled publication stays cancelled until an admin or manager reopens it',
  'troca de conta (save aprovado): nem admin troca sem a marca'
);

RESET ROLE;

SELECT is(
  (SELECT external_account_id::text FROM public.editorial_publications WHERE id = pg_temp.id_de('Q2_c2')),
  '97000000-0000-0000-0000-0000000000c2',
  'troca de conta (save aprovado): a publicação de Q2 segue no Facebook'
);

SELECT ok(
  pg_get_functiondef('public.save_editorial_post_unlocked(jsonb,integer)'::regprocedure)
    LIKE '%_existing_publication.external_account_id IS DISTINCT FROM _account.id%editorial_conta_cancelada_por_pessoa(_post_id, _revision_of_post_id, _account.id)%UPDATE public.editorial_publications%'
  AND pg_get_functiondef('public.save_approved_editorial_post_unlocked(jsonb,integer)'::regprocedure)
    LIKE '%_existing_publication.external_account_id IS DISTINCT FROM _account.id%editorial_conta_cancelada_por_pessoa(_post_id, _revision_of_post_id, _account.id)%UPDATE public.editorial_publications%',
  'os dois saves conferem a conta de destino antes da troca'
);

SELECT ok(
  pg_get_functiondef('public.mesa_entrega_acompanha_aprovacao()'::regprocedure)
    LIKE '%IF _t.id IS NULL THEN%approval_withdrawn%sent_for_approval_file_id = NULL%',
  'retirar da aprovação solta o Workspace mesmo sem trabalho do Estúdio'
);

SELECT * FROM finish();
ROLLBACK;
