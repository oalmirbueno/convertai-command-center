-- 17/10/2026 (rodada 4 da base dos agentes):
-- 1. Ads com resultado real: quantos anúncios no ar usaram a ficha e a eficiência média deles (o custo por
--    resultado mediano dos criativos do cliente dividido pelo custo por resultado do anúncio: acima de 1 é
--    mais barato que o normal da conta). Vem de ads_creative_daily, pela rotina da base.
-- 2. Faxina mensal: a ficha arquivada pela rotina diz o porquê ('sem_uso' em 60 dias ou 'repetida' de outra
--    que ensina a mesma técnica). Arquivar é desligar (ativa = false): o dono liga de volta na tela.

ALTER TABLE public.agente_base_fichas
  ADD COLUMN IF NOT EXISTS anuncios integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS eficiencia numeric(6, 2) NULL,
  ADD COLUMN IF NOT EXISTS arquivada_por text NULL CHECK (arquivada_por IS NULL OR arquivada_por IN ('sem_uso', 'repetida'));
