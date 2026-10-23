-- 23/10/2026: Mesa Ads > Estúdio > Vídeo > "Gravar nós mesmos". O roteiro de anúncio em vídeo nasce na
-- Mesa Roteiros (ação anuncio_gerar) e fica ligado ao criativo e à oferta, para reabrir na Mesa Ads.
-- Aditiva e idempotente. Sem a migração, a função guarda o roteiro sem o vínculo e a tela lembra o id.
-- A RLS de public.roteiros (equipe com acesso ao cliente) continua valendo; só service_role grava.

ALTER TABLE public.roteiros
  ADD COLUMN IF NOT EXISTS ads_criativo_id uuid REFERENCES public.ads_criativos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ads_oferta_id uuid REFERENCES public.ads_ofertas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS roteiros_ads_criativo_idx
  ON public.roteiros (client_id, ads_criativo_id)
  WHERE ads_criativo_id IS NOT NULL AND arquivado_em IS NULL;

COMMENT ON COLUMN public.roteiros.ads_criativo_id IS 'Criativo da Mesa Ads que este roteiro de anúncio em vídeo grava (Estúdio > Vídeo > Gravar).';
COMMENT ON COLUMN public.roteiros.ads_oferta_id IS 'Oferta da Mesa Ads do plano do criativo, no momento em que o roteiro foi gerado.';
