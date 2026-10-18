-- 17/10/2026: o resultado de cada ficha da base dos agentes (dono: "a base aprender com o que eu aprovo e
-- reprovo" e "os números do Instagram voltando para a técnica que gerou").
--
-- A rotina da base (base-dos-agentes, ação aprender_com_resultados, também chamada no começo da pesquisa de
-- terça) cruza agente_base_usos com o desfecho da peça (estudio_trabalhos.entrega_status/entrega_rodada,
-- ads_criativos.status) e com o múltiplo do post publicado (social_post_metrics contra a mediana do perfil),
-- e grava o resumo aqui. A geração (_shared/base-do-agente.ts) e a tela só leem: nada de consulta pesada
-- a cada arte. Sem dado ainda, tudo fica em zero/nulo e a ficha vale como antes.

ALTER TABLE public.agente_base_fichas
  ADD COLUMN IF NOT EXISTS aprovadas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ajustadas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reprovadas integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS posts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS multiplo numeric(6, 2) NULL,
  ADD COLUMN IF NOT EXISTS resultado_em timestamptz NULL;
