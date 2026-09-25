-- Mesa Ads v5 (26/09): vínculo automático anúncio x criativo, cache da impressão digital das imagens
-- e token de anúncios para a Biblioteca de Anúncios (só chave de serviço). Fonte: docs/mesa-ads/v5/01_vinculos_e_biblioteca.sql.

CREATE TABLE IF NOT EXISTS public.ads_vinculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  criativo_id uuid REFERENCES public.ads_criativos(id) ON DELETE CASCADE,
  ad_id text NOT NULL,
  estado text NOT NULL CHECK (estado IN ('ligado', 'recusado', 'jev_incerto')),
  origem text NOT NULL CHECK (origem IN ('automatico', 'jev', 'equipe')),
  confianca numeric,
  sinais jsonb NOT NULL DEFAULT '[]'::jsonb,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_vinculos_cliente_idx ON public.ads_vinculos (client_id, estado, criado_em DESC);
CREATE INDEX IF NOT EXISTS ads_vinculos_ad_idx ON public.ads_vinculos (client_id, ad_id);

CREATE TABLE IF NOT EXISTS public.ads_impressoes (
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chave text NOT NULL,
  impressao text NOT NULL CHECK (impressao ~ '^[0-9a-f]{16}$'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, chave)
);

ALTER TABLE public.ads_vinculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_impressoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ads_vinculos, public.ads_impressoes FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS ads_vinculos_equipe_le ON public.ads_vinculos;
CREATE POLICY ads_vinculos_equipe_le ON public.ads_vinculos FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

GRANT SELECT ON public.ads_vinculos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ads_vinculos, public.ads_impressoes TO service_role;

CREATE OR REPLACE FUNCTION public.ads_token_para_biblioteca(_client_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  SELECT secret_row.decrypted_secret
  FROM social_private.ads_tokens AS token
  JOIN vault.decrypted_secrets AS secret_row ON secret_row.id = token.access_token_secret_id
  LEFT JOIN public.external_accounts AS account ON account.id = token.external_account_id
  WHERE token.revoked_at IS NULL
    AND (
      token.external_account_id IS NULL
      OR (account.client_id = _client_id AND account.platform = 'meta_ads')
    )
  ORDER BY (token.external_account_id IS NULL), token.saved_at DESC
  LIMIT 1;
$function$;

REVOKE ALL ON FUNCTION public.ads_token_para_biblioteca(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ads_token_para_biblioteca(uuid) TO service_role;