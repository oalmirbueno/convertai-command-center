-- Frente P (26/09/2026): Perfis do Instagram do cliente (referências e concorrentes).
-- Documento: docs/estudio/PERFIS-DO-INSTAGRAM.md. Função: supabase/functions/perfis-instagram.
--
-- Só amplia e é idempotente. RLS: equipe lê (is_staff + can_access_client);
-- só service_role escreve (a função confere o acesso de quem chama antes de
-- qualquer escrita). Apagar = arquivar (arquivado_em). Sem estas tabelas a
-- função responde "sql_pendente" e a tela mostra o aviso, sem quebrar.
--
-- NÃO LIGA o cron: o agendamento semanal está comentado no fim, com instrução.

-- ---------------------------------------------------------------------------
-- 1. Perfis
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cliente_perfis_instagram (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  papel text NOT NULL CHECK (papel IN ('referencia', 'concorrente')),
  -- sem @, minúsculo (normalizarHandle em _shared/perfis-instagram.ts)
  handle text NOT NULL CHECK (handle ~ '^[a-z0-9._]{1,30}$'),
  nome text,
  biografia text,
  seguidores integer CHECK (seguidores IS NULL OR seguidores >= 0),
  posts_total integer CHECK (posts_total IS NULL OR posts_total >= 0),
  -- id do perfil na Graph API (business_discovery devolve)
  ig_id text,
  -- foto do perfil guardada no bucket mesa (<cliente>/perfis/<perfil>/perfil.jpg)
  foto_caminho text,
  -- api: veio do business_discovery; manual: prints e links
  origem text NOT NULL DEFAULT 'manual' CHECK (origem IN ('api', 'manual')),
  -- conta cujo token fez a última captura (cliente ou agencia); nunca o token
  captura_por text CHECK (captura_por IS NULL OR captura_por IN ('cliente', 'agencia')),
  capturado_em timestamptz,
  -- monitoramento semanal (só concorrente; desligado por padrão)
  monitorar boolean NOT NULL DEFAULT false,
  proxima_rodada_em timestamptz,
  ultima_rodada_em timestamptz,
  ultimo_erro text,
  -- {padrao_visual, padrao_editorial, o_que_funciona, o_que_evitar, gerado_em, base}
  resumo jsonb CHECK (resumo IS NULL OR jsonb_typeof(resumo) = 'object'),
  -- resumoNumerico: frequência, mix, horários, mediana, fora da curva
  metricas jsonb CHECK (metricas IS NULL OR jsonb_typeof(metricas) = 'object'),
  conversa_id uuid REFERENCES public.agente_conversas(id) ON DELETE SET NULL,
  arquivado_em timestamptz,
  arquivado_por uuid,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- Um papel por @ por cliente (entre os não arquivados).
CREATE UNIQUE INDEX IF NOT EXISTS cliente_perfis_instagram_handle_uk
  ON public.cliente_perfis_instagram (client_id, handle)
  WHERE arquivado_em IS NULL;
CREATE INDEX IF NOT EXISTS cliente_perfis_instagram_cliente_idx
  ON public.cliente_perfis_instagram (client_id, papel)
  WHERE arquivado_em IS NULL;
-- A rodada do cron procura só o que está vencido e ligado.
CREATE INDEX IF NOT EXISTS cliente_perfis_instagram_rodada_idx
  ON public.cliente_perfis_instagram (proxima_rodada_em)
  WHERE monitorar AND arquivado_em IS NULL AND papel = 'concorrente';

DROP TRIGGER IF EXISTS cliente_perfis_instagram_tocar ON public.cliente_perfis_instagram;
CREATE TRIGGER cliente_perfis_instagram_tocar
BEFORE UPDATE ON public.cliente_perfis_instagram
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- 2. Posts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cliente_perfis_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil_id uuid NOT NULL REFERENCES public.cliente_perfis_instagram(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- id da mídia na Graph API; manual: 'manual:<arquivo>'; link: 'link:<código>'
  ig_media_id text NOT NULL,
  origem text NOT NULL DEFAULT 'api' CHECK (origem IN ('api', 'manual')),
  formato text NOT NULL DEFAULT 'foto' CHECK (formato IN ('reel', 'carrossel', 'foto', 'video', 'print', 'link')),
  legenda text,
  curtidas integer CHECK (curtidas IS NULL OR curtidas >= 0),
  comentarios integer CHECK (comentarios IS NULL OR comentarios >= 0),
  publicado_em timestamptz,
  permalink text,
  -- imagem guardada no bucket mesa (<cliente>/perfis/<perfil>/...); miniatura .mini.jpg ao lado
  midia_caminho text,
  -- métricas em código (_shared/perfis-instagram.ts)
  engajamento numeric CHECK (engajamento IS NULL OR engajamento >= 0),
  vezes_a_mediana numeric,
  fora_da_curva boolean NOT NULL DEFAULT false,
  -- julgamentos do Jev
  formato_editorial text,
  pilar text,
  combina numeric CHECK (combina IS NULL OR (combina >= 0 AND combina <= 10)),
  -- descrição visual curta (modelo de leitura) e quando foi lido
  leitura text,
  lido_em timestamptz,
  arquivado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cliente_perfis_posts_midia_uk UNIQUE (perfil_id, ig_media_id)
);

CREATE INDEX IF NOT EXISTS cliente_perfis_posts_perfil_idx
  ON public.cliente_perfis_posts (perfil_id, publicado_em DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS cliente_perfis_posts_cliente_idx
  ON public.cliente_perfis_posts (client_id);
CREATE INDEX IF NOT EXISTS cliente_perfis_posts_sem_leitura_idx
  ON public.cliente_perfis_posts (perfil_id)
  WHERE lido_em IS NULL AND arquivado_em IS NULL;

DROP TRIGGER IF EXISTS cliente_perfis_posts_tocar ON public.cliente_perfis_posts;
CREATE TRIGGER cliente_perfis_posts_tocar
BEFORE UPDATE ON public.cliente_perfis_posts
FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

-- ---------------------------------------------------------------------------
-- 3. Rodadas (auditoria e custo de cada captura, leitura, plano e monitoramento)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cliente_perfis_rodadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  perfil_id uuid REFERENCES public.cliente_perfis_instagram(id) ON DELETE SET NULL,
  tipo text NOT NULL CHECK (tipo IN ('captura', 'leitura', 'resumo', 'monitoramento', 'plano', 'ideias', 'comparar', 'conversa', 'estilo')),
  status text NOT NULL CHECK (status IN ('ok', 'erro', 'sem_novidade', 'teto', 'parcial')),
  novos integer NOT NULL DEFAULT 0 CHECK (novos >= 0),
  lidos integer NOT NULL DEFAULT 0 CHECK (lidos >= 0),
  fora_da_curva integer NOT NULL DEFAULT 0 CHECK (fora_da_curva >= 0),
  -- ideias de resposta: [{tema, gancho, por_que, formato, pilar, referencia}]
  ideias jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(ideias) = 'array'),
  resumo text,
  custo_usd numeric NOT NULL DEFAULT 0 CHECK (custo_usd >= 0),
  erro text,
  -- null quando foi o cron
  criado_por uuid,
  iniciada_em timestamptz NOT NULL DEFAULT now(),
  terminada_em timestamptz
);

CREATE INDEX IF NOT EXISTS cliente_perfis_rodadas_cliente_idx
  ON public.cliente_perfis_rodadas (client_id, iniciada_em DESC);
CREATE INDEX IF NOT EXISTS cliente_perfis_rodadas_perfil_idx
  ON public.cliente_perfis_rodadas (perfil_id, iniciada_em DESC)
  WHERE perfil_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. RLS: equipe lê; só service_role escreve
-- ---------------------------------------------------------------------------
ALTER TABLE public.cliente_perfis_instagram ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_perfis_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cliente_perfis_rodadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cliente_perfis_instagram_staff_read ON public.cliente_perfis_instagram;
CREATE POLICY cliente_perfis_instagram_staff_read ON public.cliente_perfis_instagram
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS cliente_perfis_posts_staff_read ON public.cliente_perfis_posts;
CREATE POLICY cliente_perfis_posts_staff_read ON public.cliente_perfis_posts
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS cliente_perfis_rodadas_staff_read ON public.cliente_perfis_rodadas;
CREATE POLICY cliente_perfis_rodadas_staff_read ON public.cliente_perfis_rodadas
  FOR SELECT TO authenticated
  USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

REVOKE ALL ON public.cliente_perfis_instagram, public.cliente_perfis_posts, public.cliente_perfis_rodadas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cliente_perfis_instagram, public.cliente_perfis_posts, public.cliente_perfis_rodadas TO authenticated;
GRANT ALL ON public.cliente_perfis_instagram, public.cliente_perfis_posts, public.cliente_perfis_rodadas TO service_role;

COMMENT ON TABLE public.cliente_perfis_instagram IS
  'Perfis do Instagram do cliente (frente P): referências de estilo/editorial e concorrentes monitorados. Captura pela Graph API (business_discovery) ou manual (prints e links). Apagar = arquivar.';
COMMENT ON TABLE public.cliente_perfis_posts IS
  'Posts capturados de cada perfil: métricas em código (engajamento, fora da curva) e julgamentos do Jev (formato editorial, pilar, combina).';
COMMENT ON TABLE public.cliente_perfis_rodadas IS
  'Auditoria e custo de cada captura, leitura, plano e rodada semanal de monitoramento dos perfis do Instagram.';

-- ---------------------------------------------------------------------------
-- 5. Token do Instagram para a captura (só service_role; nunca sai do servidor)
-- ---------------------------------------------------------------------------
-- Ordem: a conta Instagram profissional conectada do próprio cliente; se não
-- houver, a da agência (perfil com services_config.internal_company, @aceleriq
-- primeiro). Devolve até 2 linhas: a função tenta a segunda só quando a
-- primeira recusa o token (sem laço).
CREATE OR REPLACE FUNCTION public.perfis_instagram_token(_client_id uuid)
RETURNS TABLE (ig_user_id text, access_token text, origem text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    grant_row.provider_resource_id,
    secret_row.decrypted_secret,
    CASE WHEN account.client_id = _client_id THEN 'cliente' ELSE 'agencia' END
  FROM public.external_accounts AS account
  JOIN social_private.external_account_grants AS grant_row
    ON grant_row.external_account_id = account.id
   AND grant_row.revoked_at IS NULL
   AND grant_row.platform = 'instagram'
  JOIN vault.decrypted_secrets AS secret_row
    ON secret_row.id = grant_row.resource_access_token_secret_id
  LEFT JOIN public.profiles AS owner_profile
    ON owner_profile.id = account.client_id
  WHERE account.platform = 'instagram'
    AND account.status = 'active'
    AND grant_row.provider_resource_id IS NOT NULL
    AND (
      account.client_id = _client_id
      OR COALESCE((owner_profile.services_config ->> 'internal_company')::boolean, false)
    )
  ORDER BY
    (account.client_id = _client_id) DESC,
    (lower(COALESCE(account.handle, '')) IN ('@aceleriq', 'aceleriq')) DESC,
    account.updated_at DESC
  LIMIT 2;
$function$;

REVOKE ALL ON FUNCTION public.perfis_instagram_token(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.perfis_instagram_token(uuid) TO service_role;

-- Conferência (só leitura):
-- select papel, count(*) from public.cliente_perfis_instagram where arquivado_em is null group by 1;
-- select origem, count(*) from public.perfis_instagram_token('<client_id>') group by 1;  -- como service_role

-- ---------------------------------------------------------------------------
-- 6. Monitoramento semanal (NÃO LIGADO: rode só quando o dono mandar)
-- ---------------------------------------------------------------------------
-- Janela de segunda-feira, 9h17 a 14h17 (UTC, 6h17 a 11h17 em São Paulo), uma
-- chamada por hora. Cada chamada roda no máximo 4 perfis vencidos; cada perfil
-- roda no máximo 1 vez por semana (trava por proxima_rodada_em, que já anda 7
-- dias no começo da rodada, dê certo ou dê erro: sem nova tentativa imediata).
-- Usa os mesmos segredos do cofre que as outras rotinas (materiais-classificar).
--
-- DO $$
-- BEGIN
--   IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
--     PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'perfis-instagram-semanal';
--     PERFORM cron.schedule('perfis-instagram-semanal', '17 9-14 * * 1', $cron$
--       select net.http_post(
--         url := 'https://jjjtkowvxemvituvywvf.supabase.co/functions/v1/perfis-instagram',
--         headers := jsonb_build_object(
--           'Content-Type', 'application/json',
--           'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'email_queue_service_role_key'),
--           'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
--         ),
--         body := jsonb_build_object('acao', 'rodada_semanal')
--       );
--     $cron$);
--   END IF;
-- END $$;
--
-- Para desligar: select cron.unschedule(jobid) from cron.job where jobname = 'perfis-instagram-semanal';
