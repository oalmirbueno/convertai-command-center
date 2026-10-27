-- Meta pelo usuário do sistema da BM Aceleriq (27/10/2026).
--
-- Problema: a conexão de cada cliente vem do login (OAuth de usuário) e a Meta
-- corta o acesso aos dados 90 dias depois do último login
-- (data_access_expires_at; a Mirante vence em 04/11/2026). O token de usuário
-- do sistema da BM 888502683024626, gerado com validade "Nunca", não tem esse
-- prazo, e o token de página obtido com ele também não vence.
--
-- O que esta migration faz (idempotente, pode rodar de novo):
--   1. oauth_grants ganha a coluna origem ('oauth_usuario' | 'usuario_do_sistema').
--      Tudo o que já existe fica 'oauth_usuario'. provider continua 'meta'.
--   2. Guarda o token do usuário do sistema no Vault (uma linha só, nunca volta
--      para o navegador) e o histórico de cada troca, para desfazer.
--   3. aplicar: para cada conta casada, cria a concessão nova (status active,
--      access_token_expires_at e data_access_expires_at NULOS), uma sessão e um
--      candidato sintéticos (as FKs da fundação exigem), grava o token de página
--      no Vault e repõe external_account_grants para a concessão nova. A conexão
--      pública fica 'connected' com expires_at e data_access_expires_at nulos:
--      o publicador (autopublish_assert_dispatch), o agendador e as métricas já
--      tratam prazo nulo como válido.
--      A concessão antiga fica 'superseded' SEM apagar os segredos dela, para o
--      desfazer funcionar; a limpeza do histórico revoga esses segredos quando
--      o prazo da Meta da concessão antiga passa.
--   4. desfazer: devolve a conta à concessão antiga (se ela ainda vale) e
--      revoga a nova.
-- Nada aqui lê token para log ou resposta: só a service_role executa, e o
-- token do usuário do sistema só sai pela função de leitura usada pela função
-- de borda meta-usuario-do-sistema.
BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Origem da concessão
-- ---------------------------------------------------------------------------
ALTER TABLE social_private.oauth_grants
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'oauth_usuario';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'social_oauth_grants_origem_check'
      AND conrelid = 'social_private.oauth_grants'::regclass
  ) THEN
    ALTER TABLE social_private.oauth_grants
      ADD CONSTRAINT social_oauth_grants_origem_check
      CHECK (origem IN ('oauth_usuario', 'usuario_do_sistema'));
  END IF;
END
$$;

-- Concessão do usuário do sistema não tem prazo: o check garante que ninguém
-- grave uma com prazo por engano (o robô de vencimento a derrubaria).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conname = 'social_oauth_grants_usuario_do_sistema_sem_prazo'
      AND conrelid = 'social_private.oauth_grants'::regclass
  ) THEN
    ALTER TABLE social_private.oauth_grants
      ADD CONSTRAINT social_oauth_grants_usuario_do_sistema_sem_prazo
      CHECK (
        origem <> 'usuario_do_sistema'
        OR (access_token_expires_at IS NULL AND data_access_expires_at IS NULL)
      );
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 2. Token do usuário do sistema (uma linha) e histórico das trocas
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS social_private.meta_usuario_do_sistema (
  id boolean PRIMARY KEY DEFAULT true,
  token_secret_id uuid NOT NULL,
  meta_user_id text NOT NULL,
  app_id text NOT NULL,
  business_id text,
  escopos text[] NOT NULL DEFAULT '{}'::text[],
  token_expira_em timestamptz,
  acesso_aos_dados_expira_em timestamptz,
  guardado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  guardado_em timestamptz NOT NULL DEFAULT now(),
  conferido_em timestamptz,
  CONSTRAINT meta_usuario_do_sistema_uma_linha CHECK (id),
  CONSTRAINT meta_usuario_do_sistema_ids CHECK (
    meta_user_id ~ '^[0-9]{1,64}$' AND app_id ~ '^[0-9]{1,64}$'
    AND (business_id IS NULL OR business_id ~ '^[0-9]{1,64}$')
  )
);

CREATE TABLE IF NOT EXISTS social_private.meta_usuario_do_sistema_trocas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id uuid NOT NULL,
  external_account_id uuid NOT NULL,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform text NOT NULL,
  provider_resource_id text NOT NULL,
  concessao_anterior_id uuid,
  concessao_anterior_status text,
  candidato_anterior_id uuid,
  segredo_anterior_id uuid,
  conexao_anterior jsonb,
  concessao_nova_id uuid NOT NULL,
  candidato_novo_id uuid NOT NULL,
  aplicado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  aplicado_em timestamptz NOT NULL DEFAULT now(),
  desfeito_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  desfeito_em timestamptz,
  historico_limpo_em timestamptz,
  CONSTRAINT meta_usuario_do_sistema_trocas_platform_check
    CHECK (platform IN ('facebook', 'instagram'))
);

CREATE INDEX IF NOT EXISTS meta_usuario_do_sistema_trocas_lote_idx
  ON social_private.meta_usuario_do_sistema_trocas(lote_id);
CREATE INDEX IF NOT EXISTS meta_usuario_do_sistema_trocas_conta_idx
  ON social_private.meta_usuario_do_sistema_trocas(external_account_id, aplicado_em DESC);

ALTER TABLE social_private.meta_usuario_do_sistema ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_private.meta_usuario_do_sistema_trocas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON social_private.meta_usuario_do_sistema
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON social_private.meta_usuario_do_sistema_trocas
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Guardar o token (só pela função de borda, depois do debug_token)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meta_usuario_do_sistema_guardar(
  _actor_id uuid,
  _token text,
  _meta_user_id text,
  _app_id text,
  _business_id text,
  _escopos text[],
  _token_expira_em timestamptz,
  _acesso_aos_dados_expira_em timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _atual social_private.meta_usuario_do_sistema%ROWTYPE;
  _secret_id uuid;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'meta system user: admin only' USING ERRCODE = '42501';
  END IF;
  IF _token IS NULL OR length(_token) < 32 OR length(_token) > 8192
    OR _token ~ '\s' THEN
    RAISE EXCEPTION 'meta system user: token invalid' USING ERRCODE = '22023';
  END IF;
  IF _meta_user_id IS NULL OR _meta_user_id !~ '^[0-9]{1,64}$'
    OR _app_id IS NULL OR _app_id !~ '^[0-9]{1,64}$'
    OR (_business_id IS NOT NULL AND _business_id !~ '^[0-9]{1,64}$') THEN
    RAISE EXCEPTION 'meta system user: ids invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM social_private.lock_meta_oauth_lifecycle();

  SELECT * INTO _atual FROM social_private.meta_usuario_do_sistema WHERE id FOR UPDATE;
  IF FOUND THEN
    PERFORM vault.update_secret(_atual.token_secret_id, _token);
    _secret_id := _atual.token_secret_id;
  ELSE
    SELECT vault.create_secret(
      _token,
      'meta-system-user-token-' || gen_random_uuid()::text,
      'Token do usuário do sistema da BM Aceleriq (Meta)',
      NULL
    ) INTO _secret_id;
  END IF;

  INSERT INTO social_private.meta_usuario_do_sistema (
    id, token_secret_id, meta_user_id, app_id, business_id, escopos,
    token_expira_em, acesso_aos_dados_expira_em, guardado_por, guardado_em, conferido_em
  ) VALUES (
    true, _secret_id, _meta_user_id, _app_id, _business_id,
    COALESCE(_escopos, '{}'::text[]), _token_expira_em, _acesso_aos_dados_expira_em,
    _actor_id, now(), now()
  )
  ON CONFLICT (id) DO UPDATE SET
    token_secret_id = EXCLUDED.token_secret_id,
    meta_user_id = EXCLUDED.meta_user_id,
    app_id = EXCLUDED.app_id,
    business_id = EXCLUDED.business_id,
    escopos = EXCLUDED.escopos,
    token_expira_em = EXCLUDED.token_expira_em,
    acesso_aos_dados_expira_em = EXCLUDED.acesso_aos_dados_expira_em,
    guardado_por = EXCLUDED.guardado_por,
    guardado_em = now(),
    conferido_em = now();

  RETURN jsonb_build_object('ok', true, 'guardado_em', now());
END
$function$;

-- Lido só pela função de borda (service_role). Nunca vai para o navegador.
CREATE OR REPLACE FUNCTION public.meta_usuario_do_sistema_token()
RETURNS TABLE (access_token text, meta_user_id text, app_id text, business_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT secret_row.decrypted_secret, cfg.meta_user_id, cfg.app_id, cfg.business_id
  FROM social_private.meta_usuario_do_sistema AS cfg
  JOIN vault.decrypted_secrets AS secret_row ON secret_row.id = cfg.token_secret_id
  WHERE cfg.id
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.meta_usuario_do_sistema_marcar_conferido(_escopos text[])
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $function$
  UPDATE social_private.meta_usuario_do_sistema
  SET conferido_em = now(), escopos = COALESCE(_escopos, escopos)
  WHERE id;
$function$;

-- Estado sem segredo: o que a tela mostra.
CREATE OR REPLACE FUNCTION public.meta_usuario_do_sistema_estado()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT jsonb_build_object(
    'guardado', EXISTS (SELECT 1 FROM social_private.meta_usuario_do_sistema WHERE id),
    'meta_user_id', (SELECT meta_user_id FROM social_private.meta_usuario_do_sistema WHERE id),
    'app_id', (SELECT app_id FROM social_private.meta_usuario_do_sistema WHERE id),
    'business_id', (SELECT business_id FROM social_private.meta_usuario_do_sistema WHERE id),
    'escopos', COALESCE((SELECT to_jsonb(escopos) FROM social_private.meta_usuario_do_sistema WHERE id), '[]'::jsonb),
    'token_expira_em', (SELECT token_expira_em FROM social_private.meta_usuario_do_sistema WHERE id),
    'acesso_aos_dados_expira_em', (SELECT acesso_aos_dados_expira_em FROM social_private.meta_usuario_do_sistema WHERE id),
    'guardado_em', (SELECT guardado_em FROM social_private.meta_usuario_do_sistema WHERE id),
    'conferido_em', (SELECT conferido_em FROM social_private.meta_usuario_do_sistema WHERE id),
    'lotes', COALESCE((
      SELECT jsonb_agg(lote ORDER BY lote->>'aplicado_em' DESC)
      FROM (
        SELECT jsonb_build_object(
          'lote_id', troca.lote_id,
          'aplicado_em', min(troca.aplicado_em),
          'contas', count(*),
          'ativas', count(*) FILTER (WHERE troca.desfeito_em IS NULL),
          'desfeitas', count(*) FILTER (WHERE troca.desfeito_em IS NOT NULL)
        ) AS lote
        FROM social_private.meta_usuario_do_sistema_trocas AS troca
        GROUP BY troca.lote_id
        ORDER BY min(troca.aplicado_em) DESC
        LIMIT 20
      ) AS lotes
    ), '[]'::jsonb)
  );
$function$;

-- Contas que podem ser casadas: perfis do Instagram e páginas do Facebook
-- ativos, com a concessão em uso e o prazo da conexão (sem nenhum token).
CREATE OR REPLACE FUNCTION public.meta_usuario_do_sistema_contas()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'external_account_id', account.id,
    'client_id', account.client_id,
    'cliente', COALESCE(NULLIF(btrim(owner_profile.company_name), ''), owner_profile.full_name),
    'platform', account.platform,
    'external_id', account.external_id,
    'handle', account.handle,
    'display_name', account.display_name,
    'connection_status', connection.connection_status,
    'expires_at', connection.expires_at,
    'data_access_expires_at', connection.data_access_expires_at,
    'concessao', CASE WHEN grant_row.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', grant_row.id,
      'origem', grant_row.origem,
      'status', grant_row.status,
      'access_token_expires_at', grant_row.access_token_expires_at,
      'data_access_expires_at', grant_row.data_access_expires_at
    ) END,
    'tem_projeto', EXISTS (
      SELECT 1 FROM public.projects AS project
      WHERE project.client_id = account.client_id AND project.deleted_at IS NULL
    )
  ) ORDER BY owner_profile.full_name, account.platform, account.id), '[]'::jsonb)
  FROM public.external_accounts AS account
  LEFT JOIN public.profiles AS owner_profile ON owner_profile.id = account.client_id
  LEFT JOIN public.external_account_connections AS connection
    ON connection.external_account_id = account.id
  LEFT JOIN social_private.external_account_grants AS mapping
    ON mapping.external_account_id = account.id AND mapping.revoked_at IS NULL
  LEFT JOIN social_private.oauth_grants AS grant_row ON grant_row.id = mapping.grant_id
  WHERE account.platform IN ('facebook', 'instagram')
    AND account.status = 'active'
    AND owner_profile.deleted_at IS NULL;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Aplicar
-- ---------------------------------------------------------------------------
-- _contas: [{ external_account_id, page_id, instagram_user_id, display_name,
--             handle, page_access_token }]. O token de página entra aqui e vai
-- direto para o Vault; a resposta não traz token.
CREATE OR REPLACE FUNCTION public.meta_usuario_do_sistema_aplicar(
  _actor_id uuid,
  _contas jsonb,
  _graph_version text,
  _escopos text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _cfg social_private.meta_usuario_do_sistema%ROWTYPE;
  _master text;
  _lote_id uuid := gen_random_uuid();
  _item jsonb;
  _account public.external_accounts%ROWTYPE;
  _connection public.external_account_connections%ROWTYPE;
  _had_connection boolean;
  _mapping social_private.external_account_grants%ROWTYPE;
  _had_mapping boolean;
  _old_grant social_private.oauth_grants%ROWTYPE;
  _grant_por_cliente jsonb := '{}'::jsonb;
  _sessao_por_cliente jsonb := '{}'::jsonb;
  _grant_id uuid;
  _session_id uuid;
  _project_id uuid;
  _candidate_id uuid;
  _generation integer;
  _user_secret_id uuid;
  _resource_secret_id uuid;
  _page_id text;
  _ig_id text;
  _page_token text;
  _display_name text;
  _handle text;
  _resultado jsonb := '[]'::jsonb;
  _antigas uuid[] := '{}'::uuid[];
  _antiga uuid;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'meta system user: admin only' USING ERRCODE = '42501';
  END IF;
  IF _graph_version IS NULL OR _graph_version !~ '^v[0-9]+\.[0-9]+$' THEN
    RAISE EXCEPTION 'meta system user: graph version invalid' USING ERRCODE = '22023';
  END IF;
  IF _contas IS NULL OR jsonb_typeof(_contas) <> 'array'
    OR jsonb_array_length(_contas) = 0 OR jsonb_array_length(_contas) > 200 THEN
    RAISE EXCEPTION 'meta system user: accounts payload invalid' USING ERRCODE = '22023';
  END IF;
  -- Mesmas permissões que o login exige (social_meta_oauth_store_resources).
  IF NOT COALESCE(_escopos, '{}'::text[]) @> ARRAY[
    'pages_show_list', 'pages_read_engagement', 'pages_manage_posts',
    'instagram_basic', 'instagram_content_publish'
  ]::text[] THEN
    RAISE EXCEPTION 'meta system user: required scopes are missing' USING ERRCODE = '22023';
  END IF;

  PERFORM social_private.lock_meta_oauth_lifecycle();

  SELECT * INTO _cfg FROM social_private.meta_usuario_do_sistema WHERE id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'meta system user: token not stored' USING ERRCODE = '55000';
  END IF;
  SELECT decrypted_secret INTO _master FROM vault.decrypted_secrets WHERE id = _cfg.token_secret_id;
  IF _master IS NULL OR length(_master) < 32 THEN
    RAISE EXCEPTION 'meta system user: token not stored' USING ERRCODE = '55000';
  END IF;

  FOR _item IN SELECT value FROM jsonb_array_elements(_contas) LOOP
    _account := NULL;
    IF jsonb_typeof(_item) <> 'object'
      OR COALESCE(_item->>'external_account_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      _resultado := _resultado || jsonb_build_array(jsonb_build_object('aplicado', false, 'motivo', 'item_invalido'));
      CONTINUE;
    END IF;

    _page_id := NULLIF(btrim(_item->>'page_id'), '');
    _ig_id := NULLIF(btrim(_item->>'instagram_user_id'), '');
    _page_token := NULLIF(_item->>'page_access_token', '');
    _display_name := left(NULLIF(btrim(_item->>'display_name'), ''), 200);
    _handle := left(NULLIF(btrim(_item->>'handle'), ''), 180);

    SELECT * INTO _account FROM public.external_accounts
    WHERE id = (_item->>'external_account_id')::uuid
    FOR UPDATE;

    IF NOT FOUND OR _account.status <> 'active'
      OR _account.platform NOT IN ('facebook', 'instagram') THEN
      _resultado := _resultado || jsonb_build_array(jsonb_build_object(
        'external_account_id', _item->>'external_account_id', 'aplicado', false, 'motivo', 'conta_indisponivel'));
      CONTINUE;
    END IF;

    -- A conta precisa ser exatamente o recurso que o token enxerga.
    IF _page_id IS NULL OR _page_id !~ '^[0-9]{1,64}$'
      OR _page_token IS NULL OR length(_page_token) < 16 OR length(_page_token) > 8192
      OR (_account.platform = 'facebook' AND _account.external_id IS DISTINCT FROM _page_id)
      OR (_account.platform = 'instagram' AND (_ig_id IS NULL OR _account.external_id IS DISTINCT FROM _ig_id)) THEN
      _resultado := _resultado || jsonb_build_array(jsonb_build_object(
        'external_account_id', _account.id, 'aplicado', false, 'motivo', 'nao_casa'));
      CONTINUE;
    END IF;

    -- O mesmo recurso ligado a outra conta (outro cliente) faria a guarda de
    -- escopo derrubar o lote inteiro: pula com motivo.
    IF EXISTS (
      SELECT 1 FROM social_private.external_account_grants AS other
      WHERE other.provider = 'meta'
        AND other.platform = _account.platform
        AND other.provider_resource_id = _account.external_id
        AND other.revoked_at IS NULL
        AND other.external_account_id <> _account.id
    ) THEN
      _resultado := _resultado || jsonb_build_array(jsonb_build_object(
        'external_account_id', _account.id, 'aplicado', false, 'motivo', 'ligada_a_outra_conta'));
      CONTINUE;
    END IF;

    SELECT * INTO _mapping FROM social_private.external_account_grants
    WHERE external_account_id = _account.id
    FOR UPDATE;
    _had_mapping := FOUND;

    IF _had_mapping AND _mapping.revoked_at IS NULL THEN
      SELECT * INTO _old_grant FROM social_private.oauth_grants WHERE id = _mapping.grant_id FOR UPDATE;
      IF FOUND AND _old_grant.origem = 'usuario_do_sistema' AND _old_grant.status = 'active' THEN
        _resultado := _resultado || jsonb_build_array(jsonb_build_object(
          'external_account_id', _account.id, 'aplicado', false, 'motivo', 'ja_no_usuario_do_sistema'));
        CONTINUE;
      END IF;
    ELSE
      _old_grant := NULL;
    END IF;

    -- Projeto: o mesmo a que a conta já está ligada; senão, o mais antigo do cliente.
    SELECT link.project_id INTO _project_id
    FROM public.project_external_accounts AS link
    JOIN public.projects AS project ON project.id = link.project_id AND project.deleted_at IS NULL
    WHERE link.external_account_id = _account.id AND link.client_id = _account.client_id
    ORDER BY project.created_at
    LIMIT 1;
    IF _project_id IS NULL THEN
      SELECT project.id INTO _project_id FROM public.projects AS project
      WHERE project.client_id = _account.client_id AND project.deleted_at IS NULL
      ORDER BY project.created_at
      LIMIT 1;
    END IF;
    IF _project_id IS NULL THEN
      _resultado := _resultado || jsonb_build_array(jsonb_build_object(
        'external_account_id', _account.id, 'aplicado', false, 'motivo', 'sem_projeto'));
      CONTINUE;
    END IF;

    -- Uma concessão (e uma cópia do token no Vault) por cliente neste lote:
    -- desconectar uma conta revoga só a cópia daquele cliente.
    _grant_id := NULLIF(_grant_por_cliente->>(_account.client_id::text), '')::uuid;
    IF _grant_id IS NULL THEN
      _grant_id := gen_random_uuid();
      SELECT COALESCE(max(grant_row.generation), 0) + 1 INTO _generation
      FROM social_private.oauth_grants AS grant_row
      WHERE grant_row.client_id = _account.client_id
        AND grant_row.provider = 'meta'
        AND grant_row.provider_subject = _cfg.meta_user_id;
      SELECT vault.create_secret(
        _master,
        'meta-system-user-' || _grant_id::text,
        'Token do usuário do sistema (cópia do cliente ' || _account.client_id::text || ')',
        NULL
      ) INTO _user_secret_id;
      INSERT INTO social_private.oauth_grants (
        id, client_id, provider, provider_subject, user_access_token_secret_id,
        granted_scopes, declined_scopes, access_token_expires_at, data_access_expires_at,
        graph_version, status, generation, origem
      ) VALUES (
        _grant_id, _account.client_id, 'meta', _cfg.meta_user_id, _user_secret_id,
        COALESCE(_escopos, '{}'::text[]), '{}'::text[], NULL, NULL,
        _graph_version, 'active', _generation, 'usuario_do_sistema'
      );
      _grant_por_cliente := _grant_por_cliente || jsonb_build_object(_account.client_id::text, _grant_id);
    END IF;

    _session_id := NULLIF(_sessao_por_cliente->>(_account.client_id::text || ':' || _project_id::text), '')::uuid;
    IF _session_id IS NULL THEN
      -- Sessão sintética, já fechada e limpa: o robô de sessões não toca nela.
      INSERT INTO social_private.oauth_sessions (
        actor_id, client_id, project_id, provider, state_hash, redirect_uri,
        status, expires_at, consumed_at, resources_stored_at, completed_at, cleaned_at
      ) VALUES (
        _actor_id, _account.client_id, _project_id, 'meta',
        encode(extensions.gen_random_bytes(32), 'hex'), 'usuario-do-sistema',
        'completed', now() + interval '10 minutes', now(), now(), now(), now()
      ) RETURNING id INTO _session_id;
      _sessao_por_cliente := _sessao_por_cliente
        || jsonb_build_object(_account.client_id::text || ':' || _project_id::text, _session_id);
    END IF;

    _candidate_id := gen_random_uuid();
    SELECT vault.create_secret(
      _page_token,
      'meta-system-resource-' || _candidate_id::text,
      'Token de página (usuário do sistema) para ' || _account.platform || ':' || _account.external_id,
      NULL
    ) INTO _resource_secret_id;

    INSERT INTO social_private.oauth_resource_candidates (
      id, oauth_session_id, grant_id, client_id, project_id, platform, resource_type,
      provider_resource_id, display_name, handle, page_id, instagram_user_id,
      resource_access_token_secret_id, metadata, selected_at, selected_external_account_id
    ) VALUES (
      _candidate_id, _session_id, _grant_id, _account.client_id, _project_id, _account.platform,
      CASE WHEN _account.platform = 'instagram' THEN 'instagram_business_account' ELSE 'page' END,
      _account.external_id,
      COALESCE(_display_name, _account.display_name, _account.external_id),
      CASE
        WHEN _handle IS NULL THEN _account.handle
        WHEN left(_handle, 1) = '@' THEN _handle
        ELSE left('@' || _handle, 180)
      END,
      _page_id,
      CASE WHEN _account.platform = 'instagram' THEN _ig_id ELSE NULL END,
      _resource_secret_id,
      jsonb_build_object('origem', 'usuario_do_sistema', 'lote_id', _lote_id),
      now(), _account.id
    );

    SELECT * INTO _connection FROM public.external_account_connections
    WHERE external_account_id = _account.id
    FOR UPDATE;
    _had_connection := FOUND;

    INSERT INTO social_private.meta_usuario_do_sistema_trocas (
      lote_id, external_account_id, client_id, platform, provider_resource_id,
      concessao_anterior_id, concessao_anterior_status, candidato_anterior_id, segredo_anterior_id,
      conexao_anterior, concessao_nova_id, candidato_novo_id, aplicado_por
    ) VALUES (
      _lote_id, _account.id, _account.client_id, _account.platform, _account.external_id,
      CASE WHEN _had_mapping AND _mapping.revoked_at IS NULL THEN _mapping.grant_id END,
      CASE WHEN _had_mapping AND _mapping.revoked_at IS NULL THEN _old_grant.status END,
      CASE WHEN _had_mapping AND _mapping.revoked_at IS NULL THEN _mapping.candidate_id END,
      CASE WHEN _had_mapping AND _mapping.revoked_at IS NULL THEN _mapping.resource_access_token_secret_id END,
      CASE WHEN _had_connection THEN jsonb_build_object(
        'connection_status', _connection.connection_status,
        'automation_enabled', _connection.automation_enabled,
        'scopes', to_jsonb(_connection.scopes),
        'expires_at', _connection.expires_at,
        'data_access_expires_at', _connection.data_access_expires_at
      ) END,
      _grant_id, _candidate_id, _actor_id
    );

    INSERT INTO social_private.external_account_grants (
      external_account_id, client_id, grant_id, candidate_id, provider, platform,
      provider_resource_id, resource_access_token_secret_id, connected_at, connected_by,
      revoked_at, revoked_by
    ) VALUES (
      _account.id, _account.client_id, _grant_id, _candidate_id, 'meta', _account.platform,
      _account.external_id, _resource_secret_id, now(), _actor_id, NULL, NULL
    )
    ON CONFLICT (external_account_id) DO UPDATE SET
      client_id = EXCLUDED.client_id,
      grant_id = EXCLUDED.grant_id,
      candidate_id = EXCLUDED.candidate_id,
      platform = EXCLUDED.platform,
      provider_resource_id = EXCLUDED.provider_resource_id,
      resource_access_token_secret_id = EXCLUDED.resource_access_token_secret_id,
      connected_at = now(),
      connected_by = EXCLUDED.connected_by,
      revoked_at = NULL,
      revoked_by = NULL;

    -- Prazo nulo = não vence (o publicador e o agendador já leem assim).
    INSERT INTO public.external_account_connections AS conexao (
      external_account_id, client_id, provider, connection_status, automation_enabled,
      scopes, expires_at, data_access_expires_at, connected_at, connected_by,
      disconnected_at, disconnected_by, last_verified_at, last_error_code, updated_at
    ) VALUES (
      _account.id, _account.client_id, 'meta', 'connected', false,
      COALESCE(_escopos, '{}'::text[]), NULL, NULL, now(), _actor_id,
      NULL, NULL, now(), NULL, now()
    )
    ON CONFLICT (external_account_id) DO UPDATE SET
      connection_status = 'connected',
      -- A automação continua como estava (só vale com 'connected').
      automation_enabled = CASE
        WHEN conexao.connection_status = 'connected'
          THEN conexao.automation_enabled
        ELSE false
      END,
      scopes = EXCLUDED.scopes,
      expires_at = NULL,
      data_access_expires_at = NULL,
      disconnected_at = NULL,
      disconnected_by = NULL,
      last_verified_at = now(),
      last_error_code = NULL,
      updated_at = now();

    IF _had_mapping AND _mapping.revoked_at IS NULL THEN
      _antigas := _antigas || _mapping.grant_id;
    END IF;

    _resultado := _resultado || jsonb_build_array(jsonb_build_object(
      'external_account_id', _account.id, 'aplicado', true, 'motivo', NULL));
  END LOOP;

  -- Concessão antiga que não serve mais nenhuma conta vira 'superseded', como
  -- o painel já faz, mas os segredos ficam para o desfazer. A limpeza do
  -- histórico revoga quando o prazo da Meta dela passar.
  FOREACH _antiga IN ARRAY _antigas LOOP
    UPDATE social_private.oauth_grants AS grant_row
    SET status = 'superseded', updated_at = now()
    WHERE grant_row.id = _antiga
      AND grant_row.status = 'active'
      AND grant_row.origem = 'oauth_usuario'
      AND NOT EXISTS (
        SELECT 1 FROM social_private.external_account_grants AS mapping
        WHERE mapping.grant_id = grant_row.id AND mapping.revoked_at IS NULL
      );
  END LOOP;

  RETURN jsonb_build_object(
    'lote_id', _lote_id,
    'aplicadas', (SELECT count(*) FROM jsonb_array_elements(_resultado) AS r WHERE (r->>'aplicado')::boolean),
    'contas', _resultado
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 5. Desfazer (por lote ou por conta)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meta_usuario_do_sistema_desfazer(
  _actor_id uuid,
  _lote_id uuid,
  _external_account_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _troca social_private.meta_usuario_do_sistema_trocas%ROWTYPE;
  _mapping social_private.external_account_grants%ROWTYPE;
  _old_grant social_private.oauth_grants%ROWTYPE;
  _new_candidate social_private.oauth_resource_candidates%ROWTYPE;
  _resultado jsonb := '[]'::jsonb;
  _novas uuid[] := '{}'::uuid[];
  _nova uuid;
BEGIN
  IF _actor_id IS NULL OR NOT public.has_role(_actor_id, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'meta system user: admin only' USING ERRCODE = '42501';
  END IF;
  IF _lote_id IS NULL AND COALESCE(cardinality(_external_account_ids), 0) = 0 THEN
    RAISE EXCEPTION 'meta system user: nothing to undo' USING ERRCODE = '22023';
  END IF;

  PERFORM social_private.lock_meta_oauth_lifecycle();

  FOR _troca IN
    SELECT * FROM social_private.meta_usuario_do_sistema_trocas AS troca
    WHERE troca.desfeito_em IS NULL
      AND (_lote_id IS NULL OR troca.lote_id = _lote_id)
      AND (COALESCE(cardinality(_external_account_ids), 0) = 0
        OR troca.external_account_id = ANY(_external_account_ids))
    ORDER BY troca.aplicado_em DESC
    FOR UPDATE
  LOOP
    SELECT * INTO _mapping FROM social_private.external_account_grants
    WHERE external_account_id = _troca.external_account_id
    FOR UPDATE;

    -- Só desfaz o que ainda está como esta troca deixou.
    IF NOT FOUND OR _mapping.revoked_at IS NOT NULL
      OR _mapping.grant_id IS DISTINCT FROM _troca.concessao_nova_id
      OR _mapping.candidate_id IS DISTINCT FROM _troca.candidato_novo_id THEN
      _resultado := _resultado || jsonb_build_array(jsonb_build_object(
        'external_account_id', _troca.external_account_id, 'desfeito', false, 'motivo', 'mudou_depois'));
      CONTINUE;
    END IF;

    IF _troca.concessao_anterior_id IS NOT NULL THEN
      SELECT * INTO _old_grant FROM social_private.oauth_grants
      WHERE id = _troca.concessao_anterior_id
      FOR UPDATE;
      IF NOT FOUND OR _troca.historico_limpo_em IS NOT NULL
        OR _old_grant.status NOT IN ('active', 'superseded')
        OR (_old_grant.access_token_expires_at IS NOT NULL AND _old_grant.access_token_expires_at <= now())
        OR (_old_grant.data_access_expires_at IS NOT NULL AND _old_grant.data_access_expires_at <= now())
        OR NOT EXISTS (
          SELECT 1 FROM social_private.oauth_resource_candidates AS candidate
          WHERE candidate.id = _troca.candidato_anterior_id AND candidate.discarded_at IS NULL
        ) THEN
        _resultado := _resultado || jsonb_build_array(jsonb_build_object(
          'external_account_id', _troca.external_account_id, 'desfeito', false, 'motivo', 'concessao_antiga_vencida'));
        CONTINUE;
      END IF;

      UPDATE social_private.external_account_grants SET
        grant_id = _troca.concessao_anterior_id,
        candidate_id = _troca.candidato_anterior_id,
        resource_access_token_secret_id = _troca.segredo_anterior_id,
        connected_at = now(),
        connected_by = _actor_id
      WHERE external_account_id = _troca.external_account_id;

      UPDATE social_private.oauth_grants
      SET status = 'active', updated_at = now()
      WHERE id = _troca.concessao_anterior_id AND status = 'superseded';

      UPDATE public.external_account_connections SET
        connection_status = 'connected',
        automation_enabled = COALESCE((_troca.conexao_anterior->>'automation_enabled')::boolean, false)
          AND COALESCE(_troca.conexao_anterior->>'connection_status', '') = 'connected',
        scopes = CASE
          WHEN jsonb_typeof(_troca.conexao_anterior->'scopes') = 'array'
            THEN ARRAY(SELECT jsonb_array_elements_text(_troca.conexao_anterior->'scopes'))
          ELSE _old_grant.granted_scopes
        END,
        expires_at = CASE
          WHEN _troca.conexao_anterior ? 'expires_at'
            THEN (_troca.conexao_anterior->>'expires_at')::timestamptz
          ELSE _old_grant.data_access_expires_at
        END,
        data_access_expires_at = _old_grant.data_access_expires_at,
        last_verified_at = now(),
        last_error_code = NULL,
        updated_at = now()
      WHERE external_account_id = _troca.external_account_id;
    ELSE
      -- Não havia conexão antes: desfazer é desconectar.
      UPDATE social_private.external_account_grants
      SET revoked_at = now(), revoked_by = _actor_id
      WHERE external_account_id = _troca.external_account_id;
      UPDATE public.external_account_connections SET
        connection_status = 'revoked',
        automation_enabled = false,
        disconnected_at = now(),
        disconnected_by = _actor_id,
        last_verified_at = now(),
        updated_at = now()
      WHERE external_account_id = _troca.external_account_id;
    END IF;

    SELECT * INTO _new_candidate FROM social_private.oauth_resource_candidates
    WHERE id = _troca.candidato_novo_id
    FOR UPDATE;
    IF FOUND THEN
      PERFORM social_private.revoke_meta_secret(
        _new_candidate.resource_access_token_secret_id,
        'Undo Meta system user resource token'
      );
      UPDATE social_private.oauth_resource_candidates
      SET discarded_at = COALESCE(discarded_at, now())
      WHERE id = _new_candidate.id;
    END IF;

    UPDATE social_private.meta_usuario_do_sistema_trocas
    SET desfeito_em = now(), desfeito_por = _actor_id
    WHERE id = _troca.id;

    _novas := _novas || _troca.concessao_nova_id;
    _resultado := _resultado || jsonb_build_array(jsonb_build_object(
      'external_account_id', _troca.external_account_id, 'desfeito', true, 'motivo', NULL));
  END LOOP;

  -- A concessão nova que ficou sem conta é revogada (só a cópia do cliente).
  FOREACH _nova IN ARRAY _novas LOOP
    PERFORM social_private.cleanup_meta_grant(_nova, 'revoked', 'Undo Meta system user grant');
  END LOOP;

  RETURN jsonb_build_object(
    'desfeitas', (SELECT count(*) FROM jsonb_array_elements(_resultado) AS r WHERE (r->>'desfeito')::boolean),
    'contas', _resultado
  );
END
$function$;

-- ---------------------------------------------------------------------------
-- 6. Limpeza do histórico: segredo antigo não fica vivo depois do prazo
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION social_private.meta_usuario_do_sistema_limpar_historico()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  _troca record;
  _limpas integer := 0;
BEGIN
  PERFORM social_private.lock_meta_oauth_lifecycle();

  FOR _troca IN
    SELECT troca.id, troca.concessao_anterior_id, troca.candidato_anterior_id, troca.segredo_anterior_id
    FROM social_private.meta_usuario_do_sistema_trocas AS troca
    JOIN social_private.oauth_grants AS grant_row ON grant_row.id = troca.concessao_anterior_id
    WHERE troca.desfeito_em IS NULL
      AND troca.historico_limpo_em IS NULL
      AND (
        grant_row.status NOT IN ('active', 'superseded')
        OR (grant_row.access_token_expires_at IS NOT NULL AND grant_row.access_token_expires_at <= now())
        OR (grant_row.data_access_expires_at IS NOT NULL AND grant_row.data_access_expires_at <= now())
      )
    ORDER BY troca.aplicado_em
    LIMIT 500
    FOR UPDATE OF troca SKIP LOCKED
  LOOP
    -- O segredo antigo só é revogado se nenhuma conta voltou a usá-lo.
    IF NOT EXISTS (
      SELECT 1 FROM social_private.external_account_grants AS mapping
      WHERE mapping.resource_access_token_secret_id = _troca.segredo_anterior_id
        AND mapping.revoked_at IS NULL
    ) THEN
      PERFORM social_private.revoke_meta_secret(_troca.segredo_anterior_id, 'Expired Meta resource token (history)');
      UPDATE social_private.oauth_resource_candidates
      SET discarded_at = COALESCE(discarded_at, now())
      WHERE id = _troca.candidato_anterior_id;
    END IF;

    -- Concessão antiga que nós marcamos como substituída: revoga o resto
    -- (cleanup_meta_grant não faz nada se ela ainda serve alguma conta).
    IF EXISTS (
      SELECT 1 FROM social_private.oauth_grants
      WHERE id = _troca.concessao_anterior_id AND status = 'superseded'
    ) THEN
      PERFORM social_private.cleanup_meta_grant(
        _troca.concessao_anterior_id, 'superseded', 'Superseded Meta grant (history)');
    END IF;

    UPDATE social_private.meta_usuario_do_sistema_trocas
    SET historico_limpo_em = now()
    WHERE id = _troca.id;
    _limpas := _limpas + 1;
  END LOOP;

  RETURN _limpas;
END
$function$;

-- ---------------------------------------------------------------------------
-- 7. Permissões: só a service_role (a função de borda confere o admin antes)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.meta_usuario_do_sistema_guardar(uuid, text, text, text, text, text[], timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_usuario_do_sistema_guardar(uuid, text, text, text, text, text[], timestamptz, timestamptz)
  TO service_role;
REVOKE ALL ON FUNCTION public.meta_usuario_do_sistema_token() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_usuario_do_sistema_token() TO service_role;
REVOKE ALL ON FUNCTION public.meta_usuario_do_sistema_marcar_conferido(text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_usuario_do_sistema_marcar_conferido(text[]) TO service_role;
REVOKE ALL ON FUNCTION public.meta_usuario_do_sistema_estado() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_usuario_do_sistema_estado() TO service_role;
REVOKE ALL ON FUNCTION public.meta_usuario_do_sistema_contas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_usuario_do_sistema_contas() TO service_role;
REVOKE ALL ON FUNCTION public.meta_usuario_do_sistema_aplicar(uuid, jsonb, text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_usuario_do_sistema_aplicar(uuid, jsonb, text, text[]) TO service_role;
REVOKE ALL ON FUNCTION public.meta_usuario_do_sistema_desfazer(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.meta_usuario_do_sistema_desfazer(uuid, uuid, uuid[]) TO service_role;
REVOKE ALL ON FUNCTION social_private.meta_usuario_do_sistema_limpar_historico()
  FROM PUBLIC, anon, authenticated, service_role;

-- Limpeza do histórico de hora em hora (só revoga segredo antigo já vencido).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'meta-usuario-do-sistema-historico';
    PERFORM cron.schedule(
      'meta-usuario-do-sistema-historico',
      '41 * * * *',
      $cron$SELECT social_private.meta_usuario_do_sistema_limpar_historico();$cron$
    );
  END IF;
END
$$;

COMMIT;

-- Conferência (só leitura, depois de aplicar):
-- select origem, status, count(*) from social_private.oauth_grants group by 1, 2 order by 1, 2;
-- select public.meta_usuario_do_sistema_estado();  -- como service_role, sem segredo
-- select jobname, schedule from cron.job where jobname = 'meta-usuario-do-sistema-historico';
