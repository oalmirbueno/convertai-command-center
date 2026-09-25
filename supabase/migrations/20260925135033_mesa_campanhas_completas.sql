-- MESA DO CLIENTE: CAMPANHAS COMPLETAS (imagens, briefing e plano de imagens).
-- Pedido do dono (25/09): a campanha recebe as imagens que vai usar, fica mais completa
-- e diz qual imagem usar em cada peça e por quê. Escrito só pela função agente-calendario.
-- Ver docs/mesa/migrations/20260925120000_mesa_campanhas_completas.sql.

ALTER TABLE public.mesa_campanhas
  ADD COLUMN IF NOT EXISTS briefing jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS imagens jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS plano_imagens jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mesa_campanhas_briefing_objeto') THEN
    ALTER TABLE public.mesa_campanhas
      ADD CONSTRAINT mesa_campanhas_briefing_objeto CHECK (jsonb_typeof(briefing) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mesa_campanhas_imagens_lista') THEN
    ALTER TABLE public.mesa_campanhas
      ADD CONSTRAINT mesa_campanhas_imagens_lista CHECK (jsonb_typeof(imagens) = 'array' AND jsonb_array_length(imagens) <= 12);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mesa_campanhas_plano_objeto') THEN
    ALTER TABLE public.mesa_campanhas
      ADD CONSTRAINT mesa_campanhas_plano_objeto CHECK (plano_imagens IS NULL OR jsonb_typeof(plano_imagens) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.mesa_campanhas.briefing IS
  'Briefing da campanha: produtos em foco com o porquê, oferta, mensagem central, público, provas, tom e CTA. Escrito pela função agente-calendario.';
COMMENT ON COLUMN public.mesa_campanhas.imagens IS
  'Imagens do acervo (cliente_imagens) escolhidas para a campanha, com papel (heroi, apoio, ambiente) e nota do porquê. Até 12.';
COMMENT ON COLUMN public.mesa_campanhas.plano_imagens IS
  'Plano de imagens: qual imagem vai em qual lâmina de qual conteúdo e por quê (estrategista com visão + Jev). O gravar leva a foto escolhida ao Estúdio.';