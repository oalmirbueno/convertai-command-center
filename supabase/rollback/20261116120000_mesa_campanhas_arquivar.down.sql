-- Rollback de supabase/migrations/20261116120000_mesa_campanhas_arquivar.sql.
--
-- Apaga o índice parcial e as duas colunas. Quem estava arquivado volta a
-- aparecer na lista padrão (o status de cada campanha não foi mexido pela
-- migration). Antes de rodar, volte as funções agente-calendario, mesa-foto e
-- mcp-server para a versão anterior: a ação campanha_arquivar passa a
-- responder 503 "campanha_sem_arquivo" sem as colunas, e as leituras seguem
-- funcionando (leem o arquivo à parte e com tolerância).

DROP INDEX IF EXISTS public.mesa_campanhas_ativas_cliente_idx;

ALTER TABLE public.mesa_campanhas
  DROP COLUMN IF EXISTS arquivada_por,
  DROP COLUMN IF EXISTS arquivada_em;
