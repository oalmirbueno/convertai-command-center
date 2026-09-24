-- Mesa Foto v2: exemplo ilustrado na biblioteca de prompts (docs/mesa-foto/CONTRATO-V2.md).
ALTER TABLE public.foto_biblioteca ADD COLUMN IF NOT EXISTS miniatura_url text;
ALTER TABLE public.foto_biblioteca ADD COLUMN IF NOT EXISTS exemplo jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'foto_biblioteca_exemplo_objeto') THEN
    ALTER TABLE public.foto_biblioteca
      ADD CONSTRAINT foto_biblioteca_exemplo_objeto CHECK (exemplo IS NULL OR jsonb_typeof(exemplo) = 'object');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS foto_biblioteca_sem_imagem_idx ON public.foto_biblioteca (destaque DESC, titulo)
  WHERE client_id IS NULL AND tipo = 'prompt' AND imagem_url IS NULL AND storage_path IS NULL;