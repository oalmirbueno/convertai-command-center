-- 27/11/2026: Agenda e publicador respeitam profiles.modo_aprovacao_do_cliente
-- = 'dispensada', sem forjar aprovação do cliente. Entidades sintéticas; tudo
-- rola de volta no fim. Nenhuma chamada externa (o tick não é executado).
--
-- Cliente D (dispensada) e cliente P (portal), cada um com projeto, Instagram
-- ligado e arquivos liberados para aprovação no MESMO estado:
--   agency approved, visibility approval, approval_status pending,
--   requires_approval true, sem decisão e sem trava.
--   fD  peça do D (cria, agenda, revoga, cancela, retira)   fP  peça do P (mesmo estado)
--   fDr peça do D recusada pelo cliente            fDa peça do D arquivada
--   fDi peça do D ainda na revisão da agência      fP2 peça do P sem plano (withdraw)
-- E no estado interno normal da agência (aprovada, sem pedir o cliente):
--   fDv vídeo do D (cria, primeiro selo, agenda)   fPv vídeo do P (mesmo estado)
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT * FROM no_plan();

ALTER TABLE public.profiles DISABLE TRIGGER USER;
ALTER TABLE public.projects DISABLE TRIGGER USER;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END
$$;

CREATE OR REPLACE FUNCTION pg_temp.tentar(_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE _sql;
  RETURN 'aceito';
EXCEPTION WHEN OTHERS THEN
  RETURN 'recusado: ' || SQLERRM;
END
$$;

CREATE TEMP TABLE dispensa_ids (rotulo text PRIMARY KEY, id uuid NOT NULL);
GRANT SELECT ON pg_temp.dispensa_ids TO authenticated;

CREATE OR REPLACE FUNCTION pg_temp.id_de(_rotulo text) RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT id FROM pg_temp.dispensa_ids WHERE rotulo = _rotulo $$;

CREATE OR REPLACE FUNCTION pg_temp.guardar_post(_rotulo text, _file uuid) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO pg_temp.dispensa_ids (rotulo, id)
  SELECT _rotulo, post.id FROM public.editorial_posts AS post WHERE post.primary_file_id = _file
  ON CONFLICT (rotulo) DO UPDATE SET id = EXCLUDED.id;
  INSERT INTO pg_temp.dispensa_ids (rotulo, id)
  SELECT _rotulo || '_key', internal.idempotency_key FROM public.editorial_post_internal AS internal
  WHERE internal.post_id = pg_temp.id_de(_rotulo)
  ON CONFLICT (rotulo) DO UPDATE SET id = EXCLUDED.id;
  INSERT INTO pg_temp.dispensa_ids (rotulo, id)
  SELECT _rotulo || '_pub', pub.id FROM public.editorial_publications AS pub
  WHERE pub.post_id = pg_temp.id_de(_rotulo) AND pub.status <> 'cancelled'
  ON CONFLICT (rotulo) DO UPDATE SET id = EXCLUDED.id;
END
$$;

-- Ids: 98...01 admin, 98...03 design, 98...0d cliente D, 98...0e cliente P.
INSERT INTO auth.users (id, email) VALUES
  ('98000000-0000-0000-0000-000000000001', 'dispensa-admin@test.local'),
  ('98000000-0000-0000-0000-000000000003', 'dispensa-design@test.local'),
  ('98000000-0000-0000-0000-00000000000d', 'dispensa-cliente-d@test.local'),
  ('98000000-0000-0000-0000-00000000000e', 'dispensa-cliente-p@test.local');

UPDATE public.profiles AS profile
SET full_name = fixture.full_name, plan_status = 'active', onboarding_done = true, sync_status = 'synced', client_type = 'recurring'
FROM (VALUES
  ('98000000-0000-0000-0000-000000000001'::uuid, 'Dispensa Admin'),
  ('98000000-0000-0000-0000-000000000003'::uuid, 'Dispensa Design'),
  ('98000000-0000-0000-0000-00000000000d'::uuid, 'Cliente Dispensada'),
  ('98000000-0000-0000-0000-00000000000e'::uuid, 'Cliente Portal')
) AS fixture(id, full_name)
WHERE profile.id = fixture.id;

-- A regra do cadastro: a única diferença entre D e P.
UPDATE public.profiles SET modo_aprovacao_do_cliente = 'dispensada' WHERE id = '98000000-0000-0000-0000-00000000000d';
UPDATE public.profiles SET modo_aprovacao_do_cliente = 'portal' WHERE id = '98000000-0000-0000-0000-00000000000e';

DELETE FROM public.user_roles WHERE user_id IN (
  '98000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000003',
  '98000000-0000-0000-0000-00000000000d', '98000000-0000-0000-0000-00000000000e'
);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('98000000-0000-0000-0000-000000000001', 'admin'),
  ('98000000-0000-0000-0000-000000000003', 'design'),
  ('98000000-0000-0000-0000-00000000000d', 'client'),
  ('98000000-0000-0000-0000-00000000000e', 'client');

INSERT INTO public.team_client_assignments (user_id, client_id) VALUES
  ('98000000-0000-0000-0000-000000000003', '98000000-0000-0000-0000-00000000000d'),
  ('98000000-0000-0000-0000-000000000003', '98000000-0000-0000-0000-00000000000e');

INSERT INTO public.projects (id, client_id, name, project_type, status, progress, start_date, deadline, billing_mode) VALUES
  ('98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-00000000000d', 'Projeto D', 'recurring', 'active', 0, current_date, current_date + 30, 'included'),
  ('98000000-0000-0000-0000-0000000000b2', '98000000-0000-0000-0000-00000000000e', 'Projeto P', 'recurring', 'active', 0, current_date, current_date + 30, 'included');

INSERT INTO public.external_accounts (id, client_id, platform, display_name, handle, created_by) VALUES
  ('98000000-0000-0000-0000-0000000000c1', '98000000-0000-0000-0000-00000000000d', 'instagram', 'D', '@d', '98000000-0000-0000-0000-000000000001'),
  ('98000000-0000-0000-0000-0000000000c2', '98000000-0000-0000-0000-00000000000e', 'instagram', 'P', '@p', '98000000-0000-0000-0000-000000000001');

INSERT INTO public.project_external_accounts (client_id, project_id, external_account_id, created_by) VALUES
  ('98000000-0000-0000-0000-00000000000d', '98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-0000000000c1', '98000000-0000-0000-0000-000000000001'),
  ('98000000-0000-0000-0000-00000000000e', '98000000-0000-0000-0000-0000000000b2', '98000000-0000-0000-0000-0000000000c2', '98000000-0000-0000-0000-000000000001');

INSERT INTO public.files (
  id, project_id, client_id, uploaded_by, file_name, file_url, file_type, folder, status,
  storage_bucket, storage_path, visibility, agency_approval_status, approval_status, locked_at
)
SELECT fixture.id, fixture.projeto, fixture.cliente, '98000000-0000-0000-0000-000000000003', fixture.nome,
  'files://' || fixture.cliente || '/' || fixture.id || '/1/' || fixture.nome, 'image/png', 'entregas', 'ready',
  'files', fixture.cliente || '/' || fixture.id || '/1/' || fixture.nome, 'internal', 'not_requested', 'none', NULL
FROM (VALUES
  ('98000000-0000-0000-0000-0000000000d1'::uuid, '98000000-0000-0000-0000-0000000000b1'::uuid, '98000000-0000-0000-0000-00000000000d'::uuid, 'reel-d.png'),
  ('98000000-0000-0000-0000-0000000000d2'::uuid, '98000000-0000-0000-0000-0000000000b1'::uuid, '98000000-0000-0000-0000-00000000000d'::uuid, 'recusada-d.png'),
  ('98000000-0000-0000-0000-0000000000d3'::uuid, '98000000-0000-0000-0000-0000000000b1'::uuid, '98000000-0000-0000-0000-00000000000d'::uuid, 'arquivada-d.png'),
  ('98000000-0000-0000-0000-0000000000d4'::uuid, '98000000-0000-0000-0000-0000000000b1'::uuid, '98000000-0000-0000-0000-00000000000d'::uuid, 'agencia-d.png'),
  ('98000000-0000-0000-0000-0000000000e1'::uuid, '98000000-0000-0000-0000-0000000000b2'::uuid, '98000000-0000-0000-0000-00000000000e'::uuid, 'reel-p.png'),
  ('98000000-0000-0000-0000-0000000000e2'::uuid, '98000000-0000-0000-0000-0000000000b2'::uuid, '98000000-0000-0000-0000-00000000000e'::uuid, 'sem-plano-p.png')
) AS fixture(id, projeto, cliente, nome);

-- Os dois vídeos (reel de arquivo único) que ficam no estado interno.
INSERT INTO public.files (
  id, project_id, client_id, uploaded_by, file_name, file_url, file_type, mime_type, extension, folder, status,
  storage_bucket, storage_path, visibility, agency_approval_status, approval_status, locked_at
)
SELECT fixture.id, fixture.projeto, fixture.cliente, '98000000-0000-0000-0000-000000000003', fixture.nome,
  'files://' || fixture.cliente || '/' || fixture.id || '/1/' || fixture.nome, 'video', 'video/mp4', 'mp4', 'entregas', 'ready',
  'files', fixture.cliente || '/' || fixture.id || '/1/' || fixture.nome, 'internal', 'not_requested', 'none', NULL
FROM (VALUES
  ('98000000-0000-0000-0000-0000000000d5'::uuid, '98000000-0000-0000-0000-0000000000b1'::uuid, '98000000-0000-0000-0000-00000000000d'::uuid, 'reel-d.mp4'),
  ('98000000-0000-0000-0000-0000000000e3'::uuid, '98000000-0000-0000-0000-0000000000b2'::uuid, '98000000-0000-0000-0000-00000000000e'::uuid, 'reel-p.mp4')
) AS fixture(id, projeto, cliente, nome);

INSERT INTO storage.objects (bucket_id, name)
SELECT 'files', file_row.storage_path FROM public.files AS file_row
WHERE file_row.project_id IN ('98000000-0000-0000-0000-0000000000b1', '98000000-0000-0000-0000-0000000000b2');

-- Fluxo normal: designer pede a revisão, admin aprova na agência e libera ao cliente.
SELECT pg_temp.act_as('98000000-0000-0000-0000-000000000003');
SELECT lives_ok($sql$
  SELECT public.request_file_agency_review(f) FROM unnest(ARRAY[
    '98000000-0000-0000-0000-0000000000d1', '98000000-0000-0000-0000-0000000000d2', '98000000-0000-0000-0000-0000000000d3',
    '98000000-0000-0000-0000-0000000000d4', '98000000-0000-0000-0000-0000000000e1', '98000000-0000-0000-0000-0000000000e2',
    '98000000-0000-0000-0000-0000000000d5', '98000000-0000-0000-0000-0000000000e3'
  ]::uuid[]) AS f
$sql$, 'designer pede a revisão da agência das oito peças');

SELECT pg_temp.act_as('98000000-0000-0000-0000-000000000001');
SELECT lives_ok($sql$
  SELECT public.review_file_agency(f, 'approved', NULL)
  FROM unnest(ARRAY[
    '98000000-0000-0000-0000-0000000000d1', '98000000-0000-0000-0000-0000000000d2', '98000000-0000-0000-0000-0000000000d3',
    '98000000-0000-0000-0000-0000000000e1', '98000000-0000-0000-0000-0000000000e2',
    '98000000-0000-0000-0000-0000000000d5', '98000000-0000-0000-0000-0000000000e3'
  ]::uuid[]) AS f
$sql$, 'admin aprova na agência (fDi fica na agência; fDv e fPv ficam internas)');
SELECT lives_ok($sql$
  SELECT public.release_file_to_client(f, 'approval')
  FROM unnest(ARRAY[
    '98000000-0000-0000-0000-0000000000d1', '98000000-0000-0000-0000-0000000000d2', '98000000-0000-0000-0000-0000000000d3',
    '98000000-0000-0000-0000-0000000000e1', '98000000-0000-0000-0000-0000000000e2'
  ]::uuid[]) AS f
$sql$, 'admin libera ao cliente para aprovação');

SELECT pg_temp.act_as('98000000-0000-0000-0000-00000000000d');
SELECT lives_ok($sql$
  SELECT public.decide_file_approval('98000000-0000-0000-0000-0000000000d2', 1, 'rejected', 'pedido de ajuste do cliente')
$sql$, 'o cliente D pede ajuste em fDr');

RESET ROLE;
UPDATE public.files SET archived_at = now() WHERE id = '98000000-0000-0000-0000-0000000000d3';

-- ---------------------------------------------------------------------------
-- 1. Predicado: só a regra exata, só o estado liberado, só o próprio escopo.
-- ---------------------------------------------------------------------------
SELECT is(
  (SELECT row(visibility, approval_status, agency_approval_status, requires_approval, client_decided_at IS NULL, locked_at IS NULL)::text
     FROM public.files WHERE id = '98000000-0000-0000-0000-0000000000d1'),
  (SELECT row(visibility, approval_status, agency_approval_status, requires_approval, client_decided_at IS NULL, locked_at IS NULL)::text
     FROM public.files WHERE id = '98000000-0000-0000-0000-0000000000e1'),
  'fD e fP estão no mesmo estado de arquivo'
);
SELECT is(public.editorial_file_client_approval_waived('98000000-0000-0000-0000-0000000000d1', '98000000-0000-0000-0000-00000000000d', '98000000-0000-0000-0000-0000000000b1'), true, 'dispensada: fD vale');
SELECT is(public.editorial_file_is_publishable_media('98000000-0000-0000-0000-0000000000d1', '98000000-0000-0000-0000-00000000000d', '98000000-0000-0000-0000-0000000000b1'), true, 'dispensada: fD é mídia publicável');
SELECT is(public.editorial_file_client_approval_waived('98000000-0000-0000-0000-0000000000e1', '98000000-0000-0000-0000-00000000000e', '98000000-0000-0000-0000-0000000000b2'), false, 'portal: fP não vale');
SELECT is(public.editorial_file_is_publishable('98000000-0000-0000-0000-0000000000e1', '98000000-0000-0000-0000-00000000000e', '98000000-0000-0000-0000-0000000000b2'), false, 'portal: fP não é publicável (política atual)');
SELECT is(public.editorial_file_client_approval_waived('98000000-0000-0000-0000-0000000000d1', '98000000-0000-0000-0000-00000000000e', '98000000-0000-0000-0000-0000000000b2'), false, 'arquivo de outro cliente/projeto não vale');
SELECT is(public.editorial_file_client_approval_waived('98000000-0000-0000-0000-0000000000d1', '98000000-0000-0000-0000-00000000000d', '98000000-0000-0000-0000-0000000000b2'), false, 'arquivo de outro projeto não vale');
SELECT is(public.editorial_file_is_publishable('98000000-0000-0000-0000-0000000000d2', '98000000-0000-0000-0000-00000000000d', '98000000-0000-0000-0000-0000000000b1'), false, 'pedido de ajuste do cliente recusa');
SELECT is(public.editorial_file_is_publishable('98000000-0000-0000-0000-0000000000d3', '98000000-0000-0000-0000-00000000000d', '98000000-0000-0000-0000-0000000000b1'), false, 'arquivado recusa');
SELECT is(public.editorial_file_is_publishable('98000000-0000-0000-0000-0000000000d4', '98000000-0000-0000-0000-00000000000d', '98000000-0000-0000-0000-0000000000b1'), false, 'sem aprovação interna (agência pendente) recusa');
SELECT is(public.file_is_editable('98000000-0000-0000-0000-0000000000d1'), false, 'sem trava, fD já não é editável (files_secure_guard)');

-- Estado interno normal da agência: aprovada, ainda sem pedir o cliente.
SELECT is(
  (SELECT row(visibility, approval_status, agency_approval_status, requires_approval, client_decided_at IS NULL, locked_at IS NULL)::text
     FROM public.files WHERE id = '98000000-0000-0000-0000-0000000000d5'),
  row('internal', 'none', 'approved', false, true, true)::text,
  'fDv está no estado interno aprovado pela agência'
);
SELECT is(
  (SELECT row(visibility, approval_status, agency_approval_status, requires_approval)::text FROM public.files WHERE id = '98000000-0000-0000-0000-0000000000d5'),
  (SELECT row(visibility, approval_status, agency_approval_status, requires_approval)::text FROM public.files WHERE id = '98000000-0000-0000-0000-0000000000e3'),
  'fDv e fPv estão no mesmo estado de arquivo'
);
SELECT is(public.editorial_file_is_publishable_media('98000000-0000-0000-0000-0000000000d5', '98000000-0000-0000-0000-00000000000d', '98000000-0000-0000-0000-0000000000b1'), true, 'dispensada: vídeo interno aprovado pela agência é mídia publicável');
SELECT is(public.editorial_file_is_publishable_media('98000000-0000-0000-0000-0000000000e3', '98000000-0000-0000-0000-00000000000e', '98000000-0000-0000-0000-0000000000b2'), false, 'portal: vídeo interno aprovado pela agência não é publicável');
SELECT is(public.file_is_editable('98000000-0000-0000-0000-0000000000d5'), false, 'interno aprovado pela agência já não é editável (files_secure_guard)');

-- ---------------------------------------------------------------------------
-- 2. Dispensada: cria o post, cria a publicação sem data e agenda.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('98000000-0000-0000-0000-000000000001');
SELECT lives_ok($sql$
  SELECT public.save_editorial_post(jsonb_build_object(
    'client_id', '98000000-0000-0000-0000-00000000000d', 'project_id', '98000000-0000-0000-0000-0000000000b1',
    'primary_file_id', '98000000-0000-0000-0000-0000000000d1',
    'idempotency_key', '98000000-0000-0000-0000-000000000101', 'mutation_id', '98000000-0000-0000-0000-000000000201',
    'title', 'reel-d.png', 'content_type', 'static', 'production_status', 'ready',
    'publications', '[]'::jsonb
  ), NULL)
$sql$, 'dispensada: o save aprovado adota a peça (selo de aprovação gravado)');

RESET ROLE;
SELECT pg_temp.guardar_post('D', '98000000-0000-0000-0000-0000000000d1');
SELECT isnt((SELECT approval_fingerprint FROM public.editorial_post_internal WHERE post_id = pg_temp.id_de('D')), NULL, 'post D tem o selo');

SELECT pg_temp.act_as('98000000-0000-0000-0000-000000000001');
SELECT lives_ok($sql$
  SELECT public.save_editorial_post(jsonb_build_object(
    'id', pg_temp.id_de('D'),
    'client_id', '98000000-0000-0000-0000-00000000000d', 'project_id', '98000000-0000-0000-0000-0000000000b1',
    'primary_file_id', '98000000-0000-0000-0000-0000000000d1',
    'idempotency_key', pg_temp.id_de('D_key'), 'mutation_id', '98000000-0000-0000-0000-000000000202',
    'title', 'reel-d.png', 'content_type', 'static', 'production_status', 'ready',
    'publications', jsonb_build_array(jsonb_build_object(
      'external_account_id', '98000000-0000-0000-0000-0000000000c1',
      'idempotency_key', '98000000-0000-0000-0000-000000000301'
    ))
  ), (SELECT version FROM public.editorial_posts WHERE id = pg_temp.id_de('D')))
$sql$, 'dispensada: cria a publicação planejada sem data (caminho da tool)');

RESET ROLE;
SELECT pg_temp.guardar_post('D', '98000000-0000-0000-0000-0000000000d1');
SELECT is((SELECT status FROM public.editorial_publications WHERE id = pg_temp.id_de('D_pub')), 'planned', 'publicação D nasce planejada');
SELECT is(
  (SELECT count(*)::int FROM public.editorial_events
    WHERE publication_id = pg_temp.id_de('D_pub') AND event_type = 'client_approval_waived'
      AND metadata->>'origem' = 'profiles.modo_aprovacao_do_cliente' AND metadata->>'modo' = 'dispensada'
      AND to_status = 'planned'),
  1, 'a dispensa fica registrada na criação da publicação'
);

SELECT pg_temp.act_as('98000000-0000-0000-0000-000000000001');
SELECT lives_ok($sql$
  SELECT public.transition_editorial_publication(
    pg_temp.id_de('D_pub'), 'schedule',
    (SELECT version FROM public.editorial_publications WHERE id = pg_temp.id_de('D_pub')),
    now() + interval '2 days', 'America/Sao_Paulo')
$sql$, 'dispensada: agenda pela transição oficial');

RESET ROLE;
SELECT is((SELECT status FROM public.editorial_publications WHERE id = pg_temp.id_de('D_pub')), 'scheduled', 'publicação D agendada');
SELECT is(
  (SELECT count(*)::int FROM public.editorial_events
    WHERE publication_id = pg_temp.id_de('D_pub') AND event_type = 'client_approval_waived' AND to_status = 'scheduled'),
  1, 'a dispensa fica registrada no agendamento'
);
SELECT is(
  (SELECT row(approval_status, client_decided_at IS NULL, client_decided_by IS NULL, locked_at IS NULL)::text
     FROM public.files WHERE id = '98000000-0000-0000-0000-0000000000d1'),
  row('pending', true, true, true)::text,
  'nenhuma aprovação ou decisão do cliente foi forjada'
);
SELECT is(
  (SELECT count(*)::int FROM public.file_approval_events
    WHERE file_id = '98000000-0000-0000-0000-0000000000d1' AND event_type LIKE 'client_%'),
  0, 'sem evento de decisão do cliente'
);

-- Selo obsoleto recusa o reagendamento; restaurado, volta a aceitar.
UPDATE public.editorial_post_internal SET approval_fingerprint = repeat('0', 64) WHERE post_id = pg_temp.id_de('D');
SELECT pg_temp.act_as('98000000-0000-0000-0000-000000000001');
SELECT throws_ok($sql$
  SELECT public.transition_editorial_publication(
    pg_temp.id_de('D_pub'), 'schedule',
    (SELECT version FROM public.editorial_publications WHERE id = pg_temp.id_de('D_pub')),
    now() + interval '3 days', 'America/Sao_Paulo')
$sql$, 'P0001', 'publication requires ready content and approved immutable files', 'fingerprint obsoleto recusa');
RESET ROLE;
UPDATE public.editorial_post_internal SET approval_fingerprint = public.editorial_compute_approval_fingerprint(post_id) WHERE post_id = pg_temp.id_de('D');

-- Retirar da aprovação com publicação viva pela dispensa: recusa.
SELECT pg_temp.act_as('98000000-0000-0000-0000-000000000001');
SELECT throws_ok($sql$ SELECT public.withdraw_file_client_approval('98000000-0000-0000-0000-0000000000d1') $sql$,
  'P0001', 'esta peca tem publicacao viva pela aprovacao dispensada do cadastro; cancele a publicacao na Agenda antes de retirar',
  'withdraw não reabre a peça debaixo do plano dispensado');
SELECT lives_ok($sql$ SELECT public.withdraw_file_client_approval('98000000-0000-0000-0000-0000000000e2') $sql$,
  'portal sem plano: withdraw segue igual');

-- ---------------------------------------------------------------------------
-- 2b. Vídeo interno do D: cria, perde o selo, o save canônico grava o primeiro
--     selo pela dispensa; selo divergente segue recusado; agenda.
-- ---------------------------------------------------------------------------
SELECT pg_temp.act_as('98000000-0000-0000-0000-000000000001');
SELECT lives_ok($sql$
  SELECT public.save_editorial_post(jsonb_build_object(
    'client_id', '98000000-0000-0000-0000-00000000000d', 'project_id', '98000000-0000-0000-0000-0000000000b1',
    'primary_file_id', '98000000-0000-0000-0000-0000000000d5',
    'idempotency_key', '98000000-0000-0000-0000-000000000121', 'mutation_id', '98000000-0000-0000-0000-000000000221',
    'title', 'reel-d.mp4', 'content_type', 'video', 'production_status', 'ready',
    'publications', '[]'::jsonb
  ), NULL)
$sql$, 'dispensada (interno): o save aprovado adota o vídeo');

RESET ROLE;
SELECT pg_temp.guardar_post('V', '98000000-0000-0000-0000-0000000000d5');
SELECT is((SELECT content_type FROM public.editorial_posts WHERE id = pg_temp.id_de('V')), 'video', 'post V nasce como vídeo');
-- Post pronto que nunca teve selo (o caso dos posts antigos).
UPDATE public.editorial_post_internal SET approval_fingerprint = NULL WHERE post_id = pg_temp.id_de('V');

SELECT pg_temp.act_as('98000000-0000-0000-0000-000000000001');
SELECT lives_ok($sql$
  SELECT public.save_editorial_post(jsonb_build_object(
    'id', pg_temp.id_de('V'),
    'client_id', '98000000-0000-0000-0000-00000000000d', 'project_id', '98000000-0000-0000-0000-0000000000b1',
    'primary_file_id', '98000000-0000-0000-0000-0000000000d5',
    'idempotency_key', pg_temp.id_de('V_key'), 'mutation_id', '98000000-0000-0000-0000-000000000222',
    'title', 'reel-d.mp4', 'content_type', 'video', 'production_status', 'ready',
    'publications', jsonb_build_array(jsonb_build_object(
      'external_account_id', '98000000-0000-0000-0000-0000000000c1',
      'idempotency_key', '98000000-0000-0000-0000-000000000321'
    ))
  ), (SELECT version FROM public.editorial_posts WHERE id = pg_temp.id_de('V')))
$sql$, 'dispensada (interno): sem selo, o save canônico cria a publicação e grava o primeiro selo');

RESET ROLE;
SELECT pg_temp.guardar_post('V', '98000000-0000-0000-0000-0000000000d5');
SELECT is(
  (SELECT approval_fingerprint FROM public.editorial_post_internal WHERE post_id = pg_temp.id_de('V')),
  (SELECT public.editorial_compute_approval_fingerprint(pg_temp.id_de('V'))),
  'primeiro selo gravado e canônico'
);
SELECT is(
  (SELECT count(*)::int FROM public.editorial_events
    WHERE publication_id = pg_temp.id_de('V_pub') AND event_type = 'client_approval_waived'
      AND metadata->>'file_visibility' = 'internal' AND metadata->>'file_id' = '98000000-0000-0000-0000-0000000000d5'),
  1, 'a dispensa do vídeo interno fica registrada na publicação'
);

-- Selo presente e divergente: o mesmo save recusa.
UPDATE public.editorial_post_internal SET approval_fingerprint = repeat('0', 64) WHERE post_id = pg_temp.id_de('V');
SELECT pg_temp.act_as('98000000-0000-0000-0000-000000000001');
SELECT throws_ok($sql$
  SELECT public.save_editorial_post(jsonb_build_object(
    'id', pg_temp.id_de('V'),
    'client_id', '98000000-0000-0000-0000-00000000000d', 'project_id', '98000000-0000-0000-0000-0000000000b1',
    'primary_file_id', '98000000-0000-0000-0000-0000000000d5',
    'idempotency_key', pg_temp.id_de('V_key'), 'mutation_id', '98000000-0000-0000-0000-000000000223',
    'title', 'reel-d.mp4', 'content_type', 'video', 'production_status', 'ready',
    'publications', jsonb_build_array(jsonb_build_object(
      'id', pg_temp.id_de('V_pub'),
      'external_account_id', '98000000-0000-0000-0000-0000000000c1',
      'idempotency_key', '98000000-0000-0000-0000-000000000321'
    ))
  ), (SELECT version FROM public.editorial_posts WHERE id = pg_temp.id_de('V')))
$sql$, 'P0001', 'approved editorial copy is immutable; create a revision', 'selo presente e divergente segue recusado');
-- Versão antiga: recusa antes de tudo.
RESET ROLE;
UPDATE public.editorial_post_internal SET approval_fingerprint = public.editorial_compute_approval_fingerprint(post_id) WHERE post_id = pg_temp.id_de('V');
SELECT pg_temp.act_as('98000000-0000-0000-0000-000000000001');
SELECT throws_ok($sql$
  SELECT public.save_editorial_post(jsonb_build_object(
    'id', pg_temp.id_de('V'),
    'client_id', '98000000-0000-0000-0000-00000000000d', 'project_id', '98000000-0000-0000-0000-0000000000b1',
    'primary_file_id', '98000000-0000-0000-0000-0000000000d5',
    'idempotency_key', pg_temp.id_de('V_key'), 'mutation_id', '98000000-0000-0000-0000-000000000224',
    'publications', '[]'::jsonb
  ), (SELECT version - 1 FROM public.editorial_posts WHERE id = pg_temp.id_de('V')))
$sql$, 'P0001', 'editorial post changed; refresh before saving', 'versão esperada segue conferida');

SELECT lives_ok($sql$
  SELECT public.transition_editorial_publication(
    pg_temp.id_de('V_pub'), 'schedule',
    (SELECT version FROM public.editorial_publications WHERE id = pg_temp.id_de('V_pub')),
    now() + interval '2 days', 'America/Sao_Paulo')
$sql$, 'dispensada (interno): agenda o vídeo pela transição oficial');

RESET ROLE;
SELECT is(
  (SELECT row(visibility, approval_status, requires_approval, client_decided_at IS NULL, locked_at IS NULL)::text
     FROM public.files WHERE id = '98000000-0000-0000-0000-0000000000d5'),
  row('internal', 'none', false, true, true)::text,
  'o vídeo não foi liberado ao cliente nem aprovado em nome dele'
);
SELECT is(
  (SELECT count(*)::int FROM public.file_approval_events
    WHERE file_id = '98000000-0000-0000-0000-0000000000d5'
      AND (event_type LIKE 'client_%' OR event_type LIKE 'released_%')),
  0, 'sem pedido nem decisão do cliente no vídeo'
);

-- ---------------------------------------------------------------------------
-- 3. Portal nas mesmas condições: recusa criar e agendar.
-- ---------------------------------------------------------------------------
-- O caminho comum pode aceitar um rascunho; o que importa é que nada fica
-- agendado nem dispensado. pg_temp.tentar devolve 'aceito' ou o motivo.
SELECT ok(pg_temp.tentar($sql$
  SELECT public.save_editorial_post(jsonb_build_object(
    'client_id', '98000000-0000-0000-0000-00000000000e', 'project_id', '98000000-0000-0000-0000-0000000000b2',
    'primary_file_id', '98000000-0000-0000-0000-0000000000e1',
    'idempotency_key', '98000000-0000-0000-0000-000000000111', 'mutation_id', '98000000-0000-0000-0000-000000000211',
    'title', 'reel-p.png', 'content_type', 'static', 'production_status', 'ready',
    'publications', jsonb_build_array(jsonb_build_object(
      'external_account_id', '98000000-0000-0000-0000-0000000000c2',
      'scheduled_at', now() + interval '2 days', 'scheduled_timezone', 'America/Sao_Paulo',
      'idempotency_key', '98000000-0000-0000-0000-000000000311'
    ))
  ), NULL)
$sql$) IS NOT NULL, 'portal: o mesmo pedido de agendar a peça pendente foi tentado');
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.editorial_publications pub JOIN public.editorial_posts po ON po.id = pub.post_id
    WHERE po.primary_file_id = '98000000-0000-0000-0000-0000000000e1' AND pub.status = 'planned'
  ) OR pg_temp.tentar($sql$
    SELECT public.transition_editorial_publication(pub.id, 'schedule', pub.version, now() + interval '2 days', 'America/Sao_Paulo')
    FROM public.editorial_publications pub JOIN public.editorial_posts po ON po.id = pub.post_id
    WHERE po.primary_file_id = '98000000-0000-0000-0000-0000000000e1' AND pub.status = 'planned'
  $sql$) LIKE 'recusado:%publication requires ready content and approved immutable files%',
  'portal: se existir rascunho, agendar pela transição é recusado'
);

RESET ROLE;
SELECT is(
  (SELECT count(*)::int FROM public.editorial_publications pub JOIN public.editorial_posts po ON po.id = pub.post_id
    WHERE po.primary_file_id = '98000000-0000-0000-0000-0000000000e1' AND pub.status = 'scheduled'),
  0, 'portal: nenhuma publicação agendada'
);
SELECT is(
  (SELECT count(*)::int FROM public.editorial_events WHERE client_id = '98000000-0000-0000-0000-00000000000e' AND event_type = 'client_approval_waived'),
  0, 'portal: nenhuma dispensa registrada'
);

-- ---------------------------------------------------------------------------
-- 4. Revogação: o agendamento e o envio conferem a regra de novo.
-- ---------------------------------------------------------------------------
UPDATE public.profiles SET modo_aprovacao_do_cliente = 'portal' WHERE id = '98000000-0000-0000-0000-00000000000d';
SELECT is(public.editorial_file_is_publishable_media('98000000-0000-0000-0000-0000000000d1', '98000000-0000-0000-0000-00000000000d', '98000000-0000-0000-0000-0000000000b1'),
  false, 'revogada: o portão de mídia do dispatch (autopublish_assert_dispatch) fecha');
SELECT ok(
  position('editorial_file_is_publishable_media(_root' IN pg_get_functiondef('social_private.autopublish_assert_dispatch(uuid,boolean)'::regprocedure)) > 0,
  'o dispatch continua conferindo o portão de mídia antes do envio'
);
SELECT pg_temp.act_as('98000000-0000-0000-0000-000000000001');
SELECT throws_ok($sql$
  SELECT public.transition_editorial_publication(
    pg_temp.id_de('D_pub'), 'schedule',
    (SELECT version FROM public.editorial_publications WHERE id = pg_temp.id_de('D_pub')),
    now() + interval '4 days', 'America/Sao_Paulo')
$sql$, 'P0001', 'publication requires ready content and approved immutable files', 'revogada: reagendar recusa');

RESET ROLE;
SELECT is(public.editorial_file_client_approval_waived('98000000-0000-0000-0000-0000000000d1', '98000000-0000-0000-0000-00000000000d', '98000000-0000-0000-0000-0000000000b1'),
  false, 'só a regra exata dispensada abre');
SELECT is(public.editorial_file_is_publishable_media('98000000-0000-0000-0000-0000000000d5', '98000000-0000-0000-0000-00000000000d', '98000000-0000-0000-0000-0000000000b1'),
  false, 'revogada: o vídeo interno também fecha para agendar e enviar');

-- ---------------------------------------------------------------------------
-- 5. Revogação → cancelar → retirar: a equipe não fica presa.
-- ---------------------------------------------------------------------------
SELECT is(public.editorial_publication_waiver_covers_file(pg_temp.id_de('D_pub'), '98000000-0000-0000-0000-0000000000d1'),
  true, 'o evento da publicação cobre o mesmo arquivo (versão e sha256)');
SELECT is(public.editorial_publication_waiver_covers_file(pg_temp.id_de('D_pub'), '98000000-0000-0000-0000-0000000000e1'),
  false, 'outro arquivo não é coberto pelo evento desta publicação');
SELECT is(public.editorial_publication_waiver_covers_file(pg_temp.id_de('V_pub'), '98000000-0000-0000-0000-0000000000d1'),
  false, 'evento de outra publicação não vale');
SELECT ok(
  position('''failed''' IN pg_get_functiondef('public.withdraw_file_client_approval(uuid)'::regprocedure)) > 0,
  'withdraw também segura a publicação failed (pode tentar de novo)'
);
SELECT ok(
  position('sent_job.stage = ''done''' IN pg_get_functiondef('public.transition_editorial_publication_unlocked(uuid,text,integer,timestamptz,text,text,text,text,text,timestamptz)'::regprocedure)) > 0,
  'a baixa do que já saiu (job done) segue aceita depois da revogação'
);

SELECT pg_temp.act_as('98000000-0000-0000-0000-000000000001');
SELECT throws_ok($sql$ SELECT public.withdraw_file_client_approval('98000000-0000-0000-0000-0000000000d1') $sql$,
  'P0001', 'esta peca tem publicacao viva pela aprovacao dispensada do cadastro; cancele a publicacao na Agenda antes de retirar',
  'revogada: retirar ainda pede cancelar antes');
SELECT throws_ok($sql$
  SELECT public.transition_editorial_publication(
    pg_temp.id_de('D_pub'), 'cancel',
    (SELECT version FROM public.editorial_publications WHERE id = pg_temp.id_de('D_pub')) + 1)
$sql$, 'P0001', 'publication changed; refresh before transitioning', 'cancelar confere a versão');
SELECT lives_ok($sql$
  SELECT public.transition_editorial_publication(
    pg_temp.id_de('D_pub'), 'cancel',
    (SELECT version FROM public.editorial_publications WHERE id = pg_temp.id_de('D_pub')))
$sql$, 'revogada: o cancelamento oficial da mesma peça passa');

RESET ROLE;
SELECT is((SELECT status FROM public.editorial_publications WHERE id = pg_temp.id_de('D_pub')), 'cancelled', 'publicação D cancelada');
SELECT is(
  (SELECT approval_fingerprint FROM public.editorial_post_internal WHERE post_id = pg_temp.id_de('D')),
  (SELECT public.editorial_compute_approval_fingerprint(pg_temp.id_de('D'))),
  'o selo segue canônico depois do cancelamento'
);

SELECT pg_temp.act_as('98000000-0000-0000-0000-000000000001');
SELECT lives_ok($sql$ SELECT public.withdraw_file_client_approval('98000000-0000-0000-0000-0000000000d1') $sql$,
  'depois de cancelar, retirar da aprovação passa');
RESET ROLE;
SELECT is(
  (SELECT row(visibility, approval_status, agency_approval_status)::text FROM public.files WHERE id = '98000000-0000-0000-0000-0000000000d1'),
  row('internal', 'none', 'not_requested')::text,
  'a peça volta a rascunho interno editável'
);

SELECT * FROM finish();
ROLLBACK;
