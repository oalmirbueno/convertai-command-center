-- MCP: envio de MP4 à pauta e pedido de revisão humana da agência pela chave presa a projeto/operador.
-- Dados 100% sintéticos; tudo dentro de BEGIN/ROLLBACK. Nenhuma chave, usuário ou vídeo real.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT * FROM no_plan();

ALTER TABLE public.profiles DISABLE TRIGGER USER;
ALTER TABLE public.tasks DISABLE TRIGGER USER;

-- Executa _setup e _call numa subtransação e DESFAZ tudo; devolve 'ok' ou a mensagem de erro de _call.
CREATE OR REPLACE FUNCTION pg_temp.tentar(_setup text, _call text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE _m text;
BEGIN
  BEGIN
    IF _setup IS NOT NULL THEN EXECUTE _setup; END IF;
    BEGIN
      EXECUTE _call;
      _m := 'ok';
    EXCEPTION WHEN OTHERS THEN _m := SQLERRM;
    END;
    RAISE EXCEPTION 'desfaz:%', _m;
  EXCEPTION WHEN OTHERS THEN
    RETURN regexp_replace(SQLERRM, '^desfaz:', '');
  END;
END
$$;

-- ─── Fixtures ────────────────────────────────────────────────────────────────
-- a..01 admin | a..02 perfil dedicado do agente | a..03 humano da equipe (design) | a..0a/0b clientes
INSERT INTO auth.users (id, email) VALUES
  ('a7000000-0000-4000-8000-000000000001', 'video-admin@test.local'),
  ('a7000000-0000-4000-8000-000000000002', 'video-agente@test.local'),
  ('a7000000-0000-4000-8000-000000000003', 'video-humano@test.local'),
  ('a7000000-0000-4000-8000-00000000000a', 'video-cliente-a@test.local'),
  ('a7000000-0000-4000-8000-00000000000b', 'video-cliente-b@test.local');
DELETE FROM public.user_roles WHERE user_id IN (
  'a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('a7000000-0000-4000-8000-000000000001', 'admin'),
  ('a7000000-0000-4000-8000-000000000002', 'design'),
  ('a7000000-0000-4000-8000-000000000003', 'design')
ON CONFLICT DO NOTHING;
INSERT INTO public.user_roles (user_id, role) VALUES
  ('a7000000-0000-4000-8000-00000000000a', 'client'),
  ('a7000000-0000-4000-8000-00000000000b', 'client')
ON CONFLICT DO NOTHING;
INSERT INTO public.team_client_assignments (user_id, client_id) VALUES
  ('a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-00000000000a'),
  ('a7000000-0000-4000-8000-000000000003', 'a7000000-0000-4000-8000-00000000000a');

INSERT INTO public.projects (id, client_id, name, project_type, status, progress, start_date, deadline, billing_mode) VALUES
  ('b7000000-0000-4000-8000-0000000000a1', 'a7000000-0000-4000-8000-00000000000a', 'Video A1', 'recurring', 'active', 0, current_date, current_date + 30, 'included'),
  ('b7000000-0000-4000-8000-0000000000a2', 'a7000000-0000-4000-8000-00000000000a', 'Video A2', 'recurring', 'active', 0, current_date, current_date + 30, 'included'),
  ('b7000000-0000-4000-8000-0000000000b1', 'a7000000-0000-4000-8000-00000000000b', 'Video B1', 'recurring', 'active', 0, current_date, current_date + 30, 'included');

INSERT INTO public.tasks (id, project_id, title, status, priority, source) VALUES
  ('c7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-0000000000a1', 'Reel sintético 1', 'todo', 'medium', 'portal'),
  ('c7000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-0000000000a2', 'Reel de outro projeto', 'todo', 'medium', 'portal'),
  ('c7000000-0000-4000-8000-000000000003', 'b7000000-0000-4000-8000-0000000000a1', 'Reel concluído', 'done', 'medium', 'portal'),
  ('c7000000-0000-4000-8000-000000000004', 'b7000000-0000-4000-8000-0000000000b1', 'Reel do cliente B', 'todo', 'medium', 'portal');

INSERT INTO public.internal_operators (slug, display_name, role, scope, hermes_profile_ref) VALUES
  ('corte', 'Corte (sintético)', 'Edição de vídeo', 'Cortes', 'hermes:pgtap-corte'),
  ('pgtap-outro', 'Outro (sintético)', 'Outro', 'Outro', 'hermes:pgtap-outro')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.api_keys (id, name, key_hash, key_preview, scopes, origin, audience, created_by) VALUES
  ('d7000000-0000-4000-8000-000000000001', 'pgTAP projeto escrita', 'pgtap-video-1', 'pgtap-v1', ARRAY['mcp:project'], NULL, 'mcp', 'a7000000-0000-4000-8000-000000000001'),
  ('d7000000-0000-4000-8000-000000000002', 'pgTAP projeto leitura', 'pgtap-video-2', 'pgtap-v2', ARRAY['mcp:project'], NULL, 'mcp', 'a7000000-0000-4000-8000-000000000001'),
  ('d7000000-0000-4000-8000-000000000003', 'pgTAP outro projeto', 'pgtap-video-3', 'pgtap-v3', ARRAY['mcp:project'], NULL, 'mcp', 'a7000000-0000-4000-8000-000000000001'),
  ('d7000000-0000-4000-8000-000000000004', 'pgTAP legado', 'pgtap-video-4', 'pgtap-v4', ARRAY['files:write'], NULL, 'mcp', 'a7000000-0000-4000-8000-000000000001');

INSERT INTO public.mcp_project_grants (api_key_id, project_id, client_id, operator_slug, allow_video_upload, created_by) VALUES
  ('d7000000-0000-4000-8000-000000000001', 'b7000000-0000-4000-8000-0000000000a1', 'a7000000-0000-4000-8000-00000000000a', 'corte', true, 'a7000000-0000-4000-8000-000000000001'),
  ('d7000000-0000-4000-8000-000000000002', 'b7000000-0000-4000-8000-0000000000a1', 'a7000000-0000-4000-8000-00000000000a', 'corte', false, 'a7000000-0000-4000-8000-000000000001'),
  ('d7000000-0000-4000-8000-000000000003', 'b7000000-0000-4000-8000-0000000000a2', 'a7000000-0000-4000-8000-00000000000a', 'corte', true, 'a7000000-0000-4000-8000-000000000001');

-- Anexo humano pré-existente na mesma tarefa: nunca pode ser reenviado nem alterado.
INSERT INTO public.files (id, client_id, project_id, uploaded_by, file_name, file_url, storage_bucket, storage_path, status, file_type, folder)
VALUES ('f7000000-0000-4000-8000-0000000000aa', 'a7000000-0000-4000-8000-00000000000a', 'b7000000-0000-4000-8000-0000000000a1',
        'a7000000-0000-4000-8000-000000000003', 'humano.mp4', 'mcp-files://a7000000-0000-4000-8000-00000000000a/humano/humano.mp4',
        'mcp-files', 'a7000000-0000-4000-8000-00000000000a/humano/humano.mp4', 'ready', 'video', 'materiais');
INSERT INTO public.task_attachments (task_id, file_name, file_url, file_type, uploaded_by)
VALUES ('c7000000-0000-4000-8000-000000000001', 'humano.mp4', 'mcp-files://a7000000-0000-4000-8000-00000000000a/humano/humano.mp4',
        'video/mp4', 'a7000000-0000-4000-8000-000000000003');

-- ─── Estrutura e privilégios ─────────────────────────────────────────────────
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_constraint WHERE conrelid = 'public.mcp_project_grants'::regclass AND pg_get_constraintdef(oid) ILIKE '%allow_video_upload = false%'
), 'opt-in liberado só pelo CHECK; padrão continua false');
SELECT is((SELECT column_default FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'mcp_project_grants' AND column_name = 'allow_video_upload'), 'false', 'padrão false');
SELECT ok(pg_temp.tentar(NULL, $$UPDATE public.mcp_project_grants SET allow_video_upload = true WHERE api_key_id = 'd7000000-0000-4000-8000-000000000002'$$) <> 'ok',
  'opt-in é imutável depois de criado');

SELECT is(has_function_privilege('authenticated', 'public.mcp_project_video_prepare(uuid,uuid,bigint,text,text)', 'EXECUTE'), false, 'authenticated não prepara');
SELECT is(has_function_privilege('anon', 'public.mcp_project_video_request_review(uuid,uuid,text)', 'EXECUTE'), false, 'anon não pede revisão');
SELECT is(has_function_privilege('service_role', 'public.mcp_project_video_finalize(uuid,uuid,text,bigint,text,boolean,uuid,text)', 'EXECUTE'), true, 'service_role finaliza pela RPC');
SELECT is(has_function_privilege('service_role', 'public.mcp_project_video_contexto(uuid)', 'EXECUTE'), false, 'conferência interna não exposta');
SELECT is(has_table_privilege('service_role', 'public.mcp_project_video_uploads', 'INSERT'), false, 'service_role não grava sessão direto');
SELECT is(has_table_privilege('service_role', 'public.mcp_project_video_uploads', 'UPDATE'), false, 'service_role não altera sessão direto');
SELECT is(has_table_privilege('authenticated', 'public.mcp_operator_author_profiles', 'SELECT'), false, 'vínculo de autoria invisível para authenticated');
SELECT is(has_table_privilege('service_role', 'public.mcp_operator_author_profiles', 'INSERT'), false, 'service_role não cria vínculo de autoria');

-- ─── Vínculo de autoria: só perfil dedicado, não-admin, configurado por admin ──
SELECT ok(pg_temp.tentar(NULL, $$INSERT INTO public.mcp_operator_author_profiles (operator_slug, profile_id, configured_by)
  VALUES ('corte', 'a7000000-0000-4000-8000-000000000001', 'a7000000-0000-4000-8000-000000000003')$$) <> 'ok', 'admin nunca é autor');
SELECT ok(pg_temp.tentar(NULL, $$INSERT INTO public.mcp_operator_author_profiles (operator_slug, profile_id, configured_by)
  VALUES ('corte', 'a7000000-0000-4000-8000-00000000000a', 'a7000000-0000-4000-8000-000000000001')$$) <> 'ok', 'perfil do cliente nunca é autor');
SELECT ok(pg_temp.tentar(NULL, $$INSERT INTO public.mcp_operator_author_profiles (operator_slug, profile_id, configured_by)
  VALUES ('corte', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000003')$$) <> 'ok', 'quem não é admin não configura');
SELECT ok(pg_temp.tentar(NULL, $$INSERT INTO public.mcp_operator_author_profiles (operator_slug, profile_id, configured_by)
  VALUES ('corte', '00000000-0000-4000-8000-0000000000ff', 'a7000000-0000-4000-8000-000000000001')$$) <> 'ok', 'UUID inventado não é autor');

-- ─── Sem vínculo de autoria: fechado ─────────────────────────────────────────
SELECT is(pg_temp.tentar(NULL, $$SELECT public.mcp_project_video_prepare('d7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 2048, repeat('a', 64), 'pgtap-idem-0001')$$),
  'mcp_video:autoria', 'sem vínculo de autoria o envio fica fechado');

UPDATE auth.users
   SET raw_app_meta_data = jsonb_build_object('aceleriq_mcp_author_operator', 'corte'),
       banned_until = now() + interval '1 day'
 WHERE id = 'a7000000-0000-4000-8000-000000000002';
INSERT INTO public.mcp_agent_author_attestations (operator_slug, profile_id, declaracao, attested_by)
VALUES ('corte', 'a7000000-0000-4000-8000-000000000002', 'perfil-exclusivo-do-agente:sem-uso-humano:sem-outra-funcao',
        'a7000000-0000-4000-8000-000000000001');

INSERT INTO public.mcp_operator_author_profiles (operator_slug, profile_id, configured_by)
VALUES ('corte', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000001');
SELECT ok(pg_temp.tentar(NULL, $$INSERT INTO public.mcp_operator_author_profiles (operator_slug, profile_id, configured_by)
  VALUES ('pgtap-outro', 'a7000000-0000-4000-8000-000000000002', 'a7000000-0000-4000-8000-000000000001')$$) <> 'ok', 'perfil dedicado serve a um operador só');
SELECT ok(pg_temp.tentar(NULL, $$DELETE FROM public.mcp_operator_author_profiles$$) <> 'ok', 'vínculo não é apagado');

-- ─── Autorização negativa no preparo ─────────────────────────────────────────
SELECT is(pg_temp.tentar(NULL, $$SELECT public.mcp_project_video_prepare('d7000000-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-000000000001', 2048, repeat('a', 64), 'pgtap-idem-0002')$$),
  'mcp_video:negado', 'concessão sem opt-in não escreve');
SELECT is(pg_temp.tentar(NULL, $$SELECT public.mcp_project_video_prepare('d7000000-0000-4000-8000-000000000004', 'c7000000-0000-4000-8000-000000000001', 2048, repeat('a', 64), 'pgtap-idem-0003')$$),
  'mcp_video:negado', 'chave legada não usa a rota');
SELECT is(pg_temp.tentar(NULL, $$SELECT public.mcp_project_video_prepare('d7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000002', 2048, repeat('a', 64), 'pgtap-idem-0004')$$),
  'mcp_video:tarefa', 'tarefa de outro projeto do mesmo cliente é negada');
SELECT is(pg_temp.tentar(NULL, $$SELECT public.mcp_project_video_prepare('d7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000004', 2048, repeat('a', 64), 'pgtap-idem-0005')$$),
  'mcp_video:tarefa', 'tarefa de outro cliente é negada');
SELECT is(pg_temp.tentar(NULL, $$SELECT public.mcp_project_video_prepare('d7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000003', 2048, repeat('a', 64), 'pgtap-idem-0006')$$),
  'mcp_video:tarefa', 'tarefa concluída é negada');
SELECT is(pg_temp.tentar(NULL, $$SELECT public.mcp_project_video_prepare('d7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 999999999, repeat('a', 64), 'pgtap-idem-0007')$$),
  'mcp_video:entrada', 'tamanho acima do teto é negado');
SELECT is(pg_temp.tentar('DELETE FROM public.team_client_assignments WHERE user_id = ''a7000000-0000-4000-8000-000000000002''',
  $$SELECT public.mcp_project_video_prepare('d7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 2048, repeat('a', 64), 'pgtap-idem-0008')$$),
  'mcp_video:autoria', 'perfil dedicado sem carteira do cliente é negado');
-- user_roles tem UNIQUE (user_id): um papel por usuário. Promover é trocar o papel, não somar outro.
SELECT is(pg_temp.tentar('UPDATE public.user_roles SET role = ''admin'' WHERE user_id = ''a7000000-0000-4000-8000-000000000002''',
  $$SELECT public.mcp_project_video_prepare('d7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 2048, repeat('a', 64), 'pgtap-idem-0009')$$),
  'mcp_video:autoria', 'perfil que ganhou admin deixa de ser autor (sem escalar privilégio)');

-- ─── Preparo e idempotência ──────────────────────────────────────────────────
CREATE TEMP TABLE s1 AS
SELECT * FROM public.mcp_project_video_prepare('d7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 2048, repeat('a', 64), 'pgtap-idem-s1');
SELECT is((SELECT status FROM s1), 'prepared', 'sessão preparada');
SELECT is((SELECT storage_path FROM s1), 'a7000000-0000-4000-8000-00000000000a/mcp-project-video/' || (SELECT upload_id FROM s1)::text || '.mp4',
  'caminho gerado no servidor, sob o cliente da concessão, chave única');
SELECT is((SELECT upload_id FROM public.mcp_project_video_prepare('d7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 2048, repeat('a', 64), 'pgtap-idem-s1')),
  (SELECT upload_id FROM s1), 'repetição devolve a mesma sessão');
SELECT is((SELECT count(*)::int FROM public.mcp_project_video_uploads WHERE idempotency_key = 'pgtap-idem-s1'), 1, 'nenhuma sessão duplicada');
SELECT is(pg_temp.tentar(NULL, $$SELECT public.mcp_project_video_prepare('d7000000-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-000000000001', 2048, repeat('b', 64), 'pgtap-idem-s1')$$),
  'mcp_video:conflito', 'mesma idempotency_key com outro sha256 é conflito');
SELECT ok(NOT EXISTS (
  SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mcp_project_video_uploads' AND column_name ILIKE '%url%'
), 'sessão não tem coluna de URL');

-- Outra credencial (outro projeto) não enxerga a sessão.
SELECT is(pg_temp.tentar(NULL, format($$SELECT public.mcp_project_video_open('d7000000-0000-4000-8000-000000000003', %L, 'pgtap-idem-s1')$$, (SELECT upload_id FROM s1))),
  'mcp_video:nao_encontrado', 'chave de outro projeto não abre a sessão');

-- ─── Finalização ─────────────────────────────────────────────────────────────
SELECT is(pg_temp.tentar(NULL, format($$SELECT public.mcp_project_video_finalize('d7000000-0000-4000-8000-000000000001', %L, 'pgtap-idem-s1', 2048, repeat('a', 64), true, 'e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002')$$, (SELECT upload_id FROM s1))),
  'mcp_video:objeto', 'sem objeto no Storage não finaliza');

INSERT INTO storage.objects (id, bucket_id, name, version, metadata)
SELECT 'e7000000-0000-4000-8000-000000000001', 'mcp-files', storage_path, 'e7000000-0000-4000-8000-000000000002', '{"size": 2048, "mimetype": "video/mp4"}'::jsonb FROM s1;

SELECT is((SELECT object_bytes FROM public.mcp_project_video_open('d7000000-0000-4000-8000-000000000001', (SELECT upload_id FROM s1), 'pgtap-idem-s1')),
  2048::bigint, 'open devolve o tamanho registrado pelo Storage');
SELECT is(pg_temp.tentar(NULL, format($$SELECT public.mcp_project_video_finalize('d7000000-0000-4000-8000-000000000001', %L, 'pgtap-idem-s1', 2048, repeat('c', 64), true, 'e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002')$$, (SELECT upload_id FROM s1))),
  'mcp_video:objeto', 'sha256 divergente não finaliza');
SELECT is(pg_temp.tentar(NULL, format($$SELECT public.mcp_project_video_finalize('d7000000-0000-4000-8000-000000000001', %L, 'pgtap-idem-s1', 2048, repeat('a', 64), false, 'e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002')$$, (SELECT upload_id FROM s1))),
  'mcp_video:objeto', 'cabeçalho não-MP4 não finaliza');
SELECT is(pg_temp.tentar(
  format($$UPDATE storage.objects SET metadata = '{"size": 2048, "mimetype": "video/quicktime"}' WHERE bucket_id = 'mcp-files' AND name = %L$$, (SELECT storage_path FROM s1)),
  format($$SELECT public.mcp_project_video_finalize('d7000000-0000-4000-8000-000000000001', %L, 'pgtap-idem-s1', 2048, repeat('a', 64), true, 'e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002')$$, (SELECT upload_id FROM s1))),
  'mcp_video:objeto', 'MIME diferente de video/mp4 não finaliza');

-- Tarefa movida, estado/responsável alterado, revogação, operador inativo e projeto arquivado negam a finalização.
SELECT is(pg_temp.tentar('UPDATE public.tasks SET project_id = ''b7000000-0000-4000-8000-0000000000a2'' WHERE id = ''c7000000-0000-4000-8000-000000000001''',
  format($$SELECT public.mcp_project_video_finalize('d7000000-0000-4000-8000-000000000001', %L, 'pgtap-idem-s1', 2048, repeat('a', 64), true, 'e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002')$$, (SELECT upload_id FROM s1))),
  'mcp_video:tarefa', 'tarefa movida para outro projeto nega');
SELECT is(pg_temp.tentar('UPDATE public.tasks SET status = ''done'' WHERE id = ''c7000000-0000-4000-8000-000000000001''',
  format($$SELECT public.mcp_project_video_finalize('d7000000-0000-4000-8000-000000000001', %L, 'pgtap-idem-s1', 2048, repeat('a', 64), true, 'e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002')$$, (SELECT upload_id FROM s1))),
  'mcp_video:tarefa', 'estado da tarefa alterado nega');
SELECT is(pg_temp.tentar('UPDATE public.tasks SET assigned_to = ''a7000000-0000-4000-8000-000000000003'' WHERE id = ''c7000000-0000-4000-8000-000000000001''',
  format($$SELECT public.mcp_project_video_finalize('d7000000-0000-4000-8000-000000000001', %L, 'pgtap-idem-s1', 2048, repeat('a', 64), true, 'e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002')$$, (SELECT upload_id FROM s1))),
  'mcp_video:tarefa', 'responsável da tarefa alterado nega');
SELECT is(pg_temp.tentar('UPDATE public.mcp_project_grants SET revoked_at = now() WHERE api_key_id = ''d7000000-0000-4000-8000-000000000001''',
  format($$SELECT public.mcp_project_video_finalize('d7000000-0000-4000-8000-000000000001', %L, 'pgtap-idem-s1', 2048, repeat('a', 64), true, 'e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002')$$, (SELECT upload_id FROM s1))),
  'mcp_video:negado', 'concessão revogada nega');
SELECT is(pg_temp.tentar('UPDATE public.api_keys SET is_active = false WHERE id = ''d7000000-0000-4000-8000-000000000001''',
  format($$SELECT public.mcp_project_video_finalize('d7000000-0000-4000-8000-000000000001', %L, 'pgtap-idem-s1', 2048, repeat('a', 64), true, 'e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002')$$, (SELECT upload_id FROM s1))),
  'mcp_video:negado', 'chave desativada nega');
SELECT is(pg_temp.tentar('UPDATE public.internal_operators SET status = ''inactive'' WHERE slug = ''corte''',
  format($$SELECT public.mcp_project_video_finalize('d7000000-0000-4000-8000-000000000001', %L, 'pgtap-idem-s1', 2048, repeat('a', 64), true, 'e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002')$$, (SELECT upload_id FROM s1))),
  'mcp_video:negado', 'operador inativo nega');
SELECT is(pg_temp.tentar('UPDATE public.projects SET status = ''archived'' WHERE id = ''b7000000-0000-4000-8000-0000000000a1''',
  format($$SELECT public.mcp_project_video_finalize('d7000000-0000-4000-8000-000000000001', %L, 'pgtap-idem-s1', 2048, repeat('a', 64), true, 'e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002')$$, (SELECT upload_id FROM s1))),
  'mcp_video:negado', 'projeto arquivado nega');
SELECT is(pg_temp.tentar('UPDATE public.mcp_operator_author_profiles SET revoked_at = now() WHERE operator_slug = ''corte''',
  format($$SELECT public.mcp_project_video_finalize('d7000000-0000-4000-8000-000000000001', %L, 'pgtap-idem-s1', 2048, repeat('a', 64), true, 'e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002')$$, (SELECT upload_id FROM s1))),
  'mcp_video:autoria', 'autoria revogada nega');

CREATE TEMP TABLE f1 AS
SELECT * FROM public.mcp_project_video_finalize('d7000000-0000-4000-8000-000000000001', (SELECT upload_id FROM s1), 'pgtap-idem-s1', 2048, repeat('a', 64), true, 'e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002');
SELECT is((SELECT reused FROM f1), false, 'primeira finalização cria');
SELECT results_eq(
  format($$SELECT client_id, project_id, uploaded_by, storage_bucket::text, storage_path::text, file_url::text, visibility::text,
                  agency_approval_status::text, approval_status::text, status::text, source::text
           FROM public.files WHERE id = %L$$, (SELECT file_id FROM f1)),
  format($$VALUES ('a7000000-0000-4000-8000-00000000000a'::uuid, 'b7000000-0000-4000-8000-0000000000a1'::uuid, 'a7000000-0000-4000-8000-000000000002'::uuid,
                   'mcp-files'::text, %L::text, %L::text, 'internal'::text, 'not_requested'::text, 'none'::text, 'ready'::text, 'mcp:project-video'::text)$$,
         (SELECT storage_path FROM s1), 'mcp-files://' || (SELECT storage_path FROM s1)),
  'files: projeto/cliente da concessão, autoria do perfil dedicado, interno e sem revisão');
SELECT results_eq(
  format($$SELECT task_id, uploaded_by, file_url::text FROM public.task_attachments WHERE id = %L$$, (SELECT attachment_id FROM f1)),
  format($$VALUES ('c7000000-0000-4000-8000-000000000001'::uuid, 'a7000000-0000-4000-8000-000000000002'::uuid, %L::text)$$, 'mcp-files://' || (SELECT storage_path FROM s1)),
  'anexo na tarefa aponta para o mesmo objeto do registro canônico');

CREATE TEMP TABLE f1b AS
SELECT * FROM public.mcp_project_video_finalize('d7000000-0000-4000-8000-000000000001', (SELECT upload_id FROM s1), 'pgtap-idem-s1', 2048, repeat('a', 64), true, 'e7000000-0000-4000-8000-000000000001', 'e7000000-0000-4000-8000-000000000002');
SELECT is((SELECT (file_id, attachment_id, reused)::text FROM f1b), (SELECT (file_id, attachment_id, true)::text FROM f1), 'retry devolve o mesmo, sem duplicar');
SELECT is((SELECT count(*)::int FROM public.files WHERE storage_path = (SELECT storage_path FROM s1)), 1, 'um registro canônico');
SELECT is((SELECT count(*)::int FROM public.task_attachments WHERE file_url = 'mcp-files://' || (SELECT storage_path FROM s1)), 1, 'um anexo');

-- Revogada a concessão, nem retry de finalização nem pedido de revisão passam.
SELECT is(pg_temp.tentar('UPDATE public.mcp_project_grants SET revoked_at = now() WHERE api_key_id = ''d7000000-0000-4000-8000-000000000001''',
  format($$SELECT public.mcp_project_video_request_review('d7000000-0000-4000-8000-000000000001', %L, 'pgtap-idem-s1')$$, (SELECT upload_id FROM s1))),
  'mcp_video:negado', 'revogada: pedido de revisão negado');
SELECT is(pg_temp.tentar('UPDATE public.tasks SET status = ''review'' WHERE id = ''c7000000-0000-4000-8000-000000000001''',
  format($$SELECT public.mcp_project_video_request_review('d7000000-0000-4000-8000-000000000001', %L, 'pgtap-idem-s1')$$, (SELECT upload_id FROM s1))),
  'mcp_video:tarefa', 'tarefa alterada depois da finalização: pedido negado');

-- ─── Pedido de revisão da agência ────────────────────────────────────────────
-- O pedido legado agrupa filhos da raiz. A rota restrita deve recusar o grupo inteiro.
-- A guarda legada só lê a raiz quando o ator pode vê-la. O SET da função
-- fornece o ator sintético somente durante o INSERT, com o gatilho ativo.
CREATE FUNCTION pg_temp.fixture_filho_entre_projetos() RETURNS void
LANGUAGE sql
SET "request.jwt.claim.sub" = 'a7000000-0000-4000-8000-000000000003'
AS $$
  INSERT INTO public.files (id, client_id, project_id, parent_file_id, uploaded_by,
    file_name, file_url, storage_bucket, storage_path, status, file_type, folder)
  SELECT 'f7000000-0000-4000-8000-0000000000ab', 'a7000000-0000-4000-8000-00000000000a',
    'b7000000-0000-4000-8000-0000000000a2', file_id, 'a7000000-0000-4000-8000-000000000003',
    'filho.mp4', 'mcp-files://a7000000-0000-4000-8000-00000000000a/humano/filho.mp4',
    'mcp-files', 'a7000000-0000-4000-8000-00000000000a/humano/filho.mp4', 'ready', 'video', 'materiais'
  FROM f1;
$$;
-- CI_CORTE_CONCURRENCY_SETUP_END
SELECT pg_temp.fixture_filho_entre_projetos();
SELECT is(pg_temp.tentar(NULL,
  format($$SELECT public.mcp_project_video_request_review('d7000000-0000-4000-8000-000000000001', %L, 'pgtap-idem-s1')$$, (SELECT upload_id FROM s1))),
  'mcp_video:estado', 'filho de outro projeto do mesmo cliente impede o pedido de revisão');
SELECT is((SELECT count(*) FROM public.files
  WHERE id IN ((SELECT file_id FROM f1), 'f7000000-0000-4000-8000-0000000000ab')
    AND agency_approval_status = 'not_requested' AND approval_status = 'none' AND visibility = 'internal'),
  2::bigint, 'a recusa preserva a etapa de revisão dos dois arquivos');
SELECT is((SELECT count(*) FROM public.file_approval_events
  WHERE file_id IN ((SELECT file_id FROM f1), 'f7000000-0000-4000-8000-0000000000ab')),
  0::bigint, 'a recusa não grava eventos de revisão');
SELECT is((SELECT status FROM public.mcp_project_video_uploads WHERE id = (SELECT upload_id FROM s1)),
  'finalized', 'a sessão continua finalizada após recusar a revisão do grupo');
DELETE FROM public.files WHERE id = 'f7000000-0000-4000-8000-0000000000ab';

CREATE TEMP TABLE antes AS SELECT
  (SELECT count(*) FROM public.notifications) AS avisos,
  (SELECT count(*) FROM public.file_approval_events) AS eventos,
  current_setting('request.jwt.claim.sub', true) AS sub;

CREATE TEMP TABLE r1 AS
SELECT * FROM public.mcp_project_video_request_review('d7000000-0000-4000-8000-000000000001', (SELECT upload_id FROM s1), 'pgtap-idem-s1');
SELECT is((SELECT agency_approval_status FROM r1), 'pending', 'revisão da agência pedida');
SELECT is((SELECT (agency_approval_status, approval_status, locked_at IS NULL, visibility)::text FROM public.files WHERE id = (SELECT file_id FROM f1)),
  '(pending,none,t,internal)', 'nada aprovado, liberado ou travado');
SELECT results_eq(
  format($$SELECT event_type::text, actor_id, to_status::text FROM public.file_approval_events WHERE file_id = %L$$, (SELECT file_id FROM f1)),
  $$VALUES ('agency_review_requested'::text, 'a7000000-0000-4000-8000-000000000002'::uuid, 'pending'::text)$$,
  'histórico: um evento de pedido, ator = perfil dedicado');
SELECT is((SELECT count(*) FROM public.file_approval_events) - (SELECT eventos FROM antes), 1::bigint, 'só o arquivo alvo entrou no histórico');
SELECT is((SELECT (agency_approval_status, approval_status)::text FROM public.files WHERE id = 'f7000000-0000-4000-8000-0000000000aa'),
  '(not_requested,none)', 'anexo humano da mesma tarefa não foi reenviado');
SELECT is((SELECT count(*) FROM public.notifications), (SELECT avisos FROM antes), 'nenhum aviso gerado');
SELECT is(coalesce(current_setting('request.jwt.claim.sub', true), ''), coalesce((SELECT sub FROM antes), ''), 'auth.uid() restaurado depois da chamada');

CREATE TEMP TABLE r2 AS
SELECT * FROM public.mcp_project_video_request_review('d7000000-0000-4000-8000-000000000001', (SELECT upload_id FROM s1), 'pgtap-idem-s1');
SELECT is((SELECT reused FROM r2), true, 'retry do pedido não duplica');
SELECT is((SELECT count(*)::int FROM public.file_approval_events WHERE file_id = (SELECT file_id FROM f1)), 1, 'um único evento');

-- O Corte não decide a revisão nem libera a peça. O cliente só lê depois da liberação humana.
SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000002', true);
SELECT ok(pg_temp.tentar(NULL, format($$SELECT public.review_file_agency(%L, 'approved')$$,
  (SELECT file_id FROM f1))) <> 'ok', 'Corte não aprova na agência');
SELECT ok(pg_temp.tentar(NULL, format($$SELECT public.release_file_to_client(%L, 'approval')$$,
  (SELECT file_id FROM f1))) <> 'ok', 'Corte não libera ao cliente');
SELECT is(pg_temp.tentar(NULL, format($$SELECT public.admin_release_file_now(%L, 'approval')$$,
  (SELECT file_id FROM f1))), 'somente admin ou manager pode liberar ao cliente',
  'Corte não pode usar a liberação administrativa');

SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-00000000000a', true);
SELECT is(public.can_read_file((SELECT file_id FROM f1)), false, 'cliente não lê antes da aprovação da agência');
SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
SELECT ok(pg_temp.tentar(NULL, format($$SELECT public.release_file_to_client(%L, 'approval')$$,
  (SELECT file_id FROM f1))) <> 'ok', 'admin não libera pela rota regular enquanto a agência ainda não aprovou');
SELECT is((public.review_file_agency((SELECT file_id FROM f1), 'approved')).agency_approval_status::text,
  'approved', 'supervisor registra aprovação da agência');
SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-00000000000a', true);
SELECT is(public.can_read_file((SELECT file_id FROM f1)), false, 'aprovação interna ainda não libera ao cliente');
SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-000000000001', true);
SELECT is((public.release_file_to_client((SELECT file_id FROM f1), 'approval')).visibility::text,
  'approval', 'supervisor libera para decisão do cliente');
SELECT set_config('request.jwt.claim.sub', 'a7000000-0000-4000-8000-00000000000a', true);
SELECT is(public.can_read_file((SELECT file_id FROM f1)), true, 'cliente lê depois da liberação');

-- Sessão: só avança e nunca é apagada.
SELECT ok(pg_temp.tentar(NULL, format($$UPDATE public.mcp_project_video_uploads SET status = 'prepared', file_id = NULL, attachment_id = NULL, finalized_at = NULL, review_requested_at = NULL WHERE id = %L$$, (SELECT upload_id FROM s1))) <> 'ok',
  'sessão não volta de estado');
SELECT ok(pg_temp.tentar(NULL, format($$DELETE FROM public.mcp_project_video_uploads WHERE id = %L$$, (SELECT upload_id FROM s1))) <> 'ok', 'sessão não é apagada');

SELECT * FROM finish();
ROLLBACK;
