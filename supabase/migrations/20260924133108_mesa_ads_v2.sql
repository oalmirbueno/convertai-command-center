-- ═════════════════════════════════════════════════════════════════════════
-- MESA ADS v2 (docs/mesa-ads/v2/CONTRATO-V2.md), frente A.
-- Ofertas criadas pelo agente da aba Oferta, análises da conta ao vivo e
-- as origens novas das referências ('padrao' e 'url').
-- Idempotente: rodar de novo não faz mal. NÃO aplicado pela frente A: o
-- coordenador aplica, renomeia para a versão e registra no manifesto.
-- Escritas passam pela função mesa-ads (chave de serviço); a equipe lê e
-- ajusta o que é dela na tela, com a mesma RLS das outras tabelas ads_*.
-- ═════════════════════════════════════════════════════════════════════════

-- 1) Ofertas (o agente cria; a equipe edita, escolhe e arquiva)
CREATE TABLE IF NOT EXISTS public.ads_ofertas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  briefing_id uuid REFERENCES public.ads_briefings(id) ON DELETE SET NULL,
  conversa_id uuid REFERENCES public.agente_conversas(id) ON DELETE SET NULL,
  nome text NOT NULL DEFAULT 'Oferta',
  -- para_quem, promessa, mecanismo, entregaveis[], bonus[], garantia,
  -- urgencia_real, ancoragem, cta, provas_necessarias[], riscos[]
  oferta jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(oferta) = 'object'),
  -- { clareza, forca, risco_politica (0 a 10, 10 = sem risco), alerta_politica } ou null
  jev jsonb,
  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN ('rascunho', 'escolhida', 'arquivada')),
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_ofertas_cliente_idx ON public.ads_ofertas (client_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS ads_ofertas_conversa_idx ON public.ads_ofertas (conversa_id) WHERE conversa_id IS NOT NULL;

DROP TRIGGER IF EXISTS ads_ofertas_tocar ON public.ads_ofertas;
CREATE TRIGGER ads_ofertas_tocar BEFORE UPDATE ON public.ads_ofertas FOR EACH ROW EXECUTE FUNCTION public.mesa_tocar_atualizado_em();

-- 2) Análises da conta (conta_analisar): dados do código + leitura do estrategista
CREATE TABLE IF NOT EXISTS public.ads_analises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  periodo_inicio date,
  periodo_fim date,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  analise jsonb NOT NULL DEFAULT '{}'::jsonb,
  custo_usd numeric NOT NULL DEFAULT 0,
  criado_por uuid,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ads_analises_cliente_idx ON public.ads_analises (client_id, criado_em DESC);

-- 3) Referências: origem 'padrao' (biblioteca do nicho e semente da frente D)
--    e 'url' (referencia_importar_url). A restrição nasceu inline em
--    20260924015930_mesa_ads.sql, com o nome padrão ads_referencias_origem_check.
ALTER TABLE public.ads_referencias DROP CONSTRAINT IF EXISTS ads_referencias_origem_check;
ALTER TABLE public.ads_referencias ADD CONSTRAINT ads_referencias_origem_check
  CHECK (origem IN ('meta_ad_library', 'tiktok', 'swiped', 'pinterest', 'instagram', 'upload', 'anuncio_proprio', 'catalogo', 'padrao', 'url', 'outro'));
-- referencia_importar_url procura o link já importado do cliente antes de criar outro.
CREATE INDEX IF NOT EXISTS ads_referencias_cliente_url_idx ON public.ads_referencias (client_id, url) WHERE url IS NOT NULL;

-- 4) agente_conversas.referencia_tipo NÃO tem check (20260922120000_mesa_do_cliente_base.sql):
--    a conversa da aba Oferta usa referencia_tipo = 'ads_oferta' e referencia_id = client_id
--    sem mudança de banco. O agente 'estrategista_ads' já é aceito (20260924015930).

-- 5) RLS: equipe com acesso ao cliente, igual às outras tabelas ads_*
ALTER TABLE public.ads_ofertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads_analises ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ads_ofertas, public.ads_analises FROM PUBLIC, anon, authenticated, service_role;

DROP POLICY IF EXISTS ads_ofertas_equipe_le ON public.ads_ofertas;
CREATE POLICY ads_ofertas_equipe_le ON public.ads_ofertas FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));
DROP POLICY IF EXISTS ads_ofertas_equipe_altera ON public.ads_ofertas;
CREATE POLICY ads_ofertas_equipe_altera ON public.ads_ofertas FOR UPDATE TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id))
WITH CHECK (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

DROP POLICY IF EXISTS ads_analises_equipe_le ON public.ads_analises;
CREATE POLICY ads_analises_equipe_le ON public.ads_analises FOR SELECT TO authenticated
USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));

GRANT SELECT ON public.ads_ofertas, public.ads_analises TO authenticated;
-- A tela pode escolher e arquivar direto (status); o conteúdo muda por oferta_salvar (zera a nota do Jev).
GRANT UPDATE (nome, status) ON public.ads_ofertas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ads_ofertas, public.ads_analises TO service_role;
