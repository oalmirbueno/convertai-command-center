-- Frente SIT2 (30/09/2026): Mesa Site mais completa.
-- 1) sites ganha tipo de site, mapa (páginas e seções), estilo (preset e
--    movimento), integrações (WhatsApp, formulário, pixel, GA4, mapa,
--    cookies) e SEO; a etapa nova "integracoes" entra na CHECK.
-- 2) site_versoes: fotografia do que o site decidiu antes de cada mudança
--    (comparar e voltar). O código tem as versões dele no git do worker.
-- 3) Formulário público do site: site_formulario_envios (registro e limite
--    por IP e por site) e a RPC site_registrar_lead, que põe o contato no CRM
--    (commercial_leads, origem "site"). Só backend chama: a função pública
--    site-formulario faz a conferência anti-spam e usa a service_role.
--
-- Só amplia, idempotente. RLS: equipe com acesso ao cliente lê; escrita só
-- pela service_role (função mesa-site e site-formulario). Apagar = arquivar.

-- ─── 1) Colunas novas em sites ─────────────────────────────────────────────

ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS tipo text,
  ADD COLUMN IF NOT EXISTS mapa jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS estilo jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS integracoes jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS seo jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS pacote_mudou_em timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sites'::regclass AND conname = 'sites_tipo_check') THEN
    ALTER TABLE public.sites ADD CONSTRAINT sites_tipo_check CHECK (tipo IS NULL OR tipo IN ('institucional', 'landing', 'portfolio', 'loja', 'bio'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.sites'::regclass AND conname = 'sites_jsonb_sit2_check') THEN
    ALTER TABLE public.sites ADD CONSTRAINT sites_jsonb_sit2_check CHECK (
      jsonb_typeof(mapa) = 'object' AND jsonb_typeof(estilo) = 'object' AND jsonb_typeof(integracoes) = 'object' AND jsonb_typeof(seo) = 'object'
    );
  END IF;
END $$;

-- A etapa nova (Integrações e SEO) entra na lista; as antigas continuam.
ALTER TABLE public.sites DROP CONSTRAINT IF EXISTS sites_etapa_check;
ALTER TABLE public.sites ADD CONSTRAINT sites_etapa_check
  CHECK (etapa IN ('briefing', 'referencias', 'direcao', 'conteudo', 'imagens', 'integracoes', 'construcao', 'revisao', 'publicacao'));

-- A chave pública do formulário acha o site no envio (uma por site).
CREATE UNIQUE INDEX IF NOT EXISTS sites_formulario_chave_idx
  ON public.sites ((integracoes -> 'formulario' ->> 'chave'))
  WHERE integracoes -> 'formulario' ->> 'chave' IS NOT NULL;

-- ─── 2) Versões do que o site decidiu ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.site_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  motivo text NOT NULL CHECK (char_length(motivo) BETWEEN 1 AND 120),
  assinatura text NOT NULL CHECK (char_length(assinatura) BETWEEN 1 AND 64),
  dados jsonb NOT NULL CHECK (jsonb_typeof(dados) = 'object'),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_versoes_site_idx ON public.site_versoes (site_id, criado_em DESC);

ALTER TABLE public.site_versoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS site_versoes_staff_read ON public.site_versoes;
CREATE POLICY site_versoes_staff_read ON public.site_versoes
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

REVOKE INSERT, UPDATE, DELETE ON public.site_versoes FROM anon, authenticated;
REVOKE ALL ON public.site_versoes FROM anon;
GRANT SELECT ON public.site_versoes TO authenticated;
GRANT ALL ON public.site_versoes TO service_role;

-- ─── 3) Formulário público: envios e o lead no CRM ─────────────────────────

CREATE TABLE IF NOT EXISTS public.site_formulario_envios (
  id bigserial PRIMARY KEY,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  ip_hash text NOT NULL CHECK (char_length(ip_hash) BETWEEN 16 AND 128),
  resultado text NOT NULL CHECK (resultado IN ('aceito', 'duplicado', 'spam', 'limite')),
  motivo text CHECK (motivo IS NULL OR char_length(motivo) <= 60),
  lead_id uuid REFERENCES public.commercial_leads(id) ON DELETE SET NULL,
  pagina text CHECK (pagina IS NULL OR char_length(pagina) <= 200),
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS site_formulario_envios_site_idx ON public.site_formulario_envios (site_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS site_formulario_envios_ip_idx ON public.site_formulario_envios (ip_hash, criado_em DESC);

ALTER TABLE public.site_formulario_envios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS site_formulario_envios_staff_read ON public.site_formulario_envios;
CREATE POLICY site_formulario_envios_staff_read ON public.site_formulario_envios
  FOR SELECT TO authenticated USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

REVOKE INSERT, UPDATE, DELETE ON public.site_formulario_envios FROM anon, authenticated;
REVOKE ALL ON public.site_formulario_envios FROM anon;
GRANT SELECT ON public.site_formulario_envios TO authenticated;
GRANT ALL ON public.site_formulario_envios TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.site_formulario_envios_id_seq TO service_role;

-- O envio já conferido pela função pública (anti-spam de formato) entra aqui.
-- Aqui ficam as travas que precisam do banco: site com formulário ligado,
-- limite por IP (5 em 10 min) e por site (60 por hora), e o repetido (mesmo
-- contato em 10 min) que não vira lead de novo. Spam também é registrado,
-- para a equipe ver. A empresa digitada vai para a qualificação e para a
-- nota, não para commercial_leads.company: texto público não cria empresa
-- no CRM sozinho (o gatilho da ficha criaria).
CREATE OR REPLACE FUNCTION public.site_registrar_lead(
  _chave text,
  _ip_hash text,
  _nome text,
  _email text,
  _whatsapp text,
  _empresa text,
  _mensagem text,
  _pagina text,
  _spam_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $body$
DECLARE
  _s record;
  _lead uuid;
  _repetido uuid;
  _por_ip int;
  _por_site int;
BEGIN
  IF NOT app_private.rpc_trusted_backend() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SITE_FORMULARIO_SO_BACKEND';
  END IF;
  IF _chave IS NULL OR _chave !~ '^[a-z0-9]{20,40}$' OR _ip_hash IS NULL OR char_length(_ip_hash) NOT BETWEEN 16 AND 128 THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'pedido_invalido');
  END IF;

  SELECT s.id, s.client_id, s.nome INTO _s
  FROM public.sites s
  WHERE s.integracoes -> 'formulario' ->> 'chave' = _chave
    AND COALESCE((s.integracoes -> 'formulario' ->> 'ligado')::boolean, false)
    AND s.arquivado_em IS NULL
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'formulario_desligado');
  END IF;

  -- Um envio por vez por site: a contagem e a gravação não se atropelam.
  PERFORM pg_advisory_xact_lock(hashtext('site_formulario:' || _s.id::text));

  IF _spam_motivo IS NOT NULL THEN
    INSERT INTO public.site_formulario_envios (site_id, client_id, ip_hash, resultado, motivo, pagina)
    VALUES (_s.id, _s.client_id, _ip_hash, 'spam', left(_spam_motivo, 60), left(_pagina, 200));
    RETURN jsonb_build_object('ok', false, 'codigo', 'spam');
  END IF;

  SELECT count(*) INTO _por_ip FROM public.site_formulario_envios
   WHERE ip_hash = _ip_hash AND criado_em > now() - interval '10 minutes';
  SELECT count(*) INTO _por_site FROM public.site_formulario_envios
   WHERE site_id = _s.id AND resultado IN ('aceito', 'duplicado') AND criado_em > now() - interval '1 hour';
  IF _por_ip >= 5 OR _por_site >= 60 THEN
    INSERT INTO public.site_formulario_envios (site_id, client_id, ip_hash, resultado, motivo, pagina)
    VALUES (_s.id, _s.client_id, _ip_hash, 'limite', CASE WHEN _por_ip >= 5 THEN 'ip' ELSE 'site' END, left(_pagina, 200));
    RETURN jsonb_build_object('ok', false, 'codigo', 'limite');
  END IF;

  SELECT e.lead_id INTO _repetido
  FROM public.site_formulario_envios e
  JOIN public.commercial_leads l ON l.id = e.lead_id
  WHERE e.site_id = _s.id AND e.resultado = 'aceito' AND e.criado_em > now() - interval '10 minutes'
    AND ((NULLIF(_email, '') IS NOT NULL AND lower(l.email) = lower(_email)) OR (NULLIF(_whatsapp, '') IS NOT NULL AND l.whatsapp = _whatsapp))
  ORDER BY e.criado_em DESC
  LIMIT 1;
  IF _repetido IS NOT NULL THEN
    INSERT INTO public.site_formulario_envios (site_id, client_id, ip_hash, resultado, lead_id, pagina)
    VALUES (_s.id, _s.client_id, _ip_hash, 'duplicado', _repetido, left(_pagina, 200));
    RETURN jsonb_build_object('ok', true, 'duplicado', true);
  END IF;

  INSERT INTO public.commercial_leads (name, email, whatsapp, origin, notes, qualificacao)
  VALUES (
    left(btrim(_nome), 120),
    NULLIF(left(btrim(COALESCE(_email, '')), 120), ''),
    NULLIF(left(btrim(COALESCE(_whatsapp, '')), 20), ''),
    'site',
    NULLIF(left(concat_ws(E'\n', CASE WHEN NULLIF(btrim(COALESCE(_empresa, '')), '') IS NOT NULL THEN 'Empresa: ' || left(btrim(_empresa), 120) END, NULLIF(btrim(COALESCE(_mensagem, '')), '')), 2200), ''),
    jsonb_build_object('fonte', 'site', 'site_id', _s.id, 'client_id', _s.client_id, 'site', _s.nome, 'pagina', left(COALESCE(_pagina, ''), 200), 'empresa', left(COALESCE(_empresa, ''), 120))
  )
  RETURNING id INTO _lead;

  INSERT INTO public.commercial_lead_events (lead_id, kind, note)
  VALUES (_lead, 'nota', left('Chegou pelo formulário do site ' || _s.nome || COALESCE(' (' || NULLIF(_pagina, '') || ')', '') || '.', 400));

  INSERT INTO public.site_formulario_envios (site_id, client_id, ip_hash, resultado, lead_id, pagina)
  VALUES (_s.id, _s.client_id, _ip_hash, 'aceito', _lead, left(_pagina, 200));

  RETURN jsonb_build_object('ok', true, 'lead_id', _lead);
END;
$body$;

REVOKE ALL ON FUNCTION public.site_registrar_lead(text, text, text, text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.site_registrar_lead(text, text, text, text, text, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';

-- Conferir depois de aplicar (só leitura):
-- select column_name from information_schema.columns where table_name = 'sites' and column_name in ('tipo','mapa','estilo','integracoes','seo','pacote_mudou_em');
-- select pg_get_constraintdef(oid) from pg_constraint where conname = 'sites_etapa_check';
-- select policyname, tablename from pg_policies where tablename in ('site_versoes','site_formulario_envios');
-- select proname, prosecdef from pg_proc where proname = 'site_registrar_lead';
