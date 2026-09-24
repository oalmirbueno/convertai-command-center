-- ═══════════════════════════════════════════════════════════════════════
-- MESA FOTO v2 (docs/mesa-foto/CONTRATO-V2.md): exemplo ilustrado na
-- biblioteca de prompts.
--
-- Só a biblioteca muda. O resto da v2 (produto_identificar, kits salvos,
-- variações, campanha) usa as colunas que já existem:
-- - referência da internet: cliente_imagens com tags ['referencia_web',
--   'fonte:<site>', 'nao_publicar'] e a fonte escrita em descricao;
-- - produto identificado: foto_kits.atributos.identificacao (jsonb);
-- - campanha e variações: foto_ensaios.direcao (guia_de_estilo, modelo,
--   referencias_estilo) e os campos novos dentro de tomadas (jsonb).
--
-- foto_biblioteca ganha:
-- - miniatura_url: miniatura da foto que ilustra o prompt (Openverse);
-- - exemplo: de onde veio o exemplo (banco público ou gerado), o crédito
--   completo e o crédito original do prompt antes da ilustração.
--
-- Sem as colunas, a função grava o resto (imagem, licença, autor, página) e
-- avisa que a migration está pendente. Idempotente. NÃO aplicar sem o dono:
-- validar com begin/rollback e aplicar pelo SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════

ALTER TABLE public.foto_biblioteca ADD COLUMN IF NOT EXISTS miniatura_url text;
ALTER TABLE public.foto_biblioteca ADD COLUMN IF NOT EXISTS exemplo jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'foto_biblioteca_exemplo_objeto') THEN
    ALTER TABLE public.foto_biblioteca
      ADD CONSTRAINT foto_biblioteca_exemplo_objeto CHECK (exemplo IS NULL OR jsonb_typeof(exemplo) = 'object');
  END IF;
END $$;

-- Prompts da agência ainda sem imagem (o que biblioteca_ilustrar percorre).
CREATE INDEX IF NOT EXISTS foto_biblioteca_sem_imagem_idx ON public.foto_biblioteca (destaque DESC, titulo)
  WHERE client_id IS NULL AND tipo = 'prompt' AND imagem_url IS NULL AND storage_path IS NULL;

-- Conferência (rodar depois de aplicar):
-- select column_name, data_type from information_schema.columns
--  where table_schema = 'public' and table_name = 'foto_biblioteca' and column_name in ('miniatura_url', 'exemplo');
