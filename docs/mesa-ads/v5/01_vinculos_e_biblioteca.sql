-- Mesa Ads v5 (pedido do dono em 26/09/2026). NÃO APLICADO: o coordenador aplica,
-- renomeia para a versão e registra no manifesto. Só amplia; nada existente muda.
--
-- A função mesa-ads funciona sem este SQL (cai no modo sem histórico):
-- - sem ads_vinculos: o vínculo automático liga igual, mas a recusa da equipe e o
--   "nenhum" do Jev não ficam guardados (o par pode voltar como sugestão e o Jev
--   é perguntado de novo sobre a mesma peça);
-- - sem ads_impressoes: a impressão digital das imagens é recalculada a cada leitura
--   (mais lenta, limitada a 90 imagens por chamada);
-- - sem ads_token_para_biblioteca: o agente sênior não consulta a Biblioteca de
--   Anúncios da Meta e fica só com a pesquisa web.

-- 1) Histórico das decisões de vínculo anúncio x criativo
CREATE TABLE IF NOT EXISTS public.ads_vinculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  criativo_id uuid REFERENCES public.ads_criativos(id) ON DELETE CASCADE,
  ad_id text NOT NULL,
  -- ligado: par ligado (ads_criativos.ad_id); recusado: "não é este" (equipe ou Jev com "nenhum");
  -- jev_incerto: o Jev foi perguntado e não teve certeza (não pergunta de novo sobre a peça).
  estado text NOT NULL CHECK (estado IN ('ligado', 'recusado', 'jev_incerto')),
  origem text NOT NULL CHECK (origem IN ('automatico', 'jev', 'equipe')),
  confianca numeric,
  sinais jsonb NOT NULL DEFAULT '[]'::jsonb,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_vinculos_cliente_idx ON public.ads_vinculos (client_id, estado, criado_em DESC);
CREATE INDEX IF NOT EXISTS ads_vinculos_ad_idx ON public.ads_vinculos (client_id, ad_id);

-- 2) Cache da impressão digital (dHash de 64 bits) das imagens do vínculo
--    chave: 'peca:<chave da peça da Meta>' ou 'arte:<bucket>/<caminho no storage>'
CREATE TABLE IF NOT EXISTS public.ads_impressoes (
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chave text NOT NULL,
  impressao text NOT NULL CHECK (impressao ~ '^[0-9a-f]{16}$'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, chave)
);

-- 3) RLS: equipe com acesso ao cliente lê; só a função (chave de serviço) escreve
ALTER TABLE public.ads_vinculos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_impressoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ads_vinculos, public.ads_impressoes FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS ads_vinculos_equipe_le ON public.ads_vinculos;
CREATE POLICY ads_vinculos_equipe_le ON public.ads_vinculos FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

GRANT SELECT ON public.ads_vinculos TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ads_vinculos, public.ads_impressoes TO service_role;

-- 4) Token de anúncios para a Biblioteca de Anúncios (ads_archive), SÓ LEITURA e SÓ
--    para a chave de serviço: o token sai do Vault para a função de borda e nunca
--    chega ao navegador. O token da conta do cliente ganha do token da agência.
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

-- 5) agente_conversas.referencia_tipo não tem check: a conversa do agente sênior usa
--    referencia_tipo = 'ads_conta' e referencia_id = client_id, sem mudança de banco.
