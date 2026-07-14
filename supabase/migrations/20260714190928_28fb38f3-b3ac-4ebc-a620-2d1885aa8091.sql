
-- ============================================================
-- BLOCO A: MCP v1.7.0 — Files v2 (aditivo, idempotente)
-- ============================================================

-- 1. Extensões (idempotente)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Ampliação da tabela `files` (todas as colunas nullable/default)
ALTER TABLE public.files
  ADD COLUMN IF NOT EXISTS mime_type          text,
  ADD COLUMN IF NOT EXISTS extension          text,
  ADD COLUMN IF NOT EXISTS size_bytes         bigint,
  ADD COLUMN IF NOT EXISTS sha256             text,
  ADD COLUMN IF NOT EXISTS storage_bucket     text,
  ADD COLUMN IF NOT EXISTS storage_path       text,
  ADD COLUMN IF NOT EXISTS tags               text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS visibility         text DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS sensitivity        text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS requires_approval  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS status             text DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS extraction_status  text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS extraction_error   text,
  ADD COLUMN IF NOT EXISTS page_count         integer,
  ADD COLUMN IF NOT EXISTS sheet_count        integer,
  ADD COLUMN IF NOT EXISTS slide_count        integer,
  ADD COLUMN IF NOT EXISTS extracted_metadata jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS source             text DEFAULT 'panel',
  ADD COLUMN IF NOT EXISTS idempotency_key    text,
  ADD COLUMN IF NOT EXISTS archived_at        timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at         timestamptz DEFAULT now();

-- CHECKs (idempotente via DO block)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='files_visibility_chk') THEN
    ALTER TABLE public.files ADD CONSTRAINT files_visibility_chk
      CHECK (visibility IN ('internal','client_shared','approval'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='files_sensitivity_chk') THEN
    ALTER TABLE public.files ADD CONSTRAINT files_sensitivity_chk
      CHECK (sensitivity IN ('normal','confidential','restricted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='files_status_chk') THEN
    ALTER TABLE public.files ADD CONSTRAINT files_status_chk
      CHECK (status IN ('uploading','processing','ready','failed','quarantined','archived'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='files_extraction_status_chk') THEN
    ALTER TABLE public.files ADD CONSTRAINT files_extraction_status_chk
      CHECK (extraction_status IN ('pending','processing','completed','partial','unsupported','failed'));
  END IF;
END $$;

-- Índices
CREATE UNIQUE INDEX IF NOT EXISTS files_idempotency_key_uidx
  ON public.files(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS files_client_sha_idx
  ON public.files(client_id, sha256) WHERE sha256 IS NOT NULL;
CREATE INDEX IF NOT EXISTS files_status_idx        ON public.files(status);
CREATE INDEX IF NOT EXISTS files_extraction_idx    ON public.files(extraction_status);
CREATE INDEX IF NOT EXISTS files_client_folder_idx ON public.files(client_id, folder);
CREATE INDEX IF NOT EXISTS files_parent_idx        ON public.files(parent_file_id);

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_files_updated_at ON public.files;
CREATE TRIGGER trg_files_updated_at
  BEFORE UPDATE ON public.files
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Conteúdo indexado (chunks por página/slide/planilha)
CREATE TABLE IF NOT EXISTS public.file_content_chunks (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id       uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  client_id     uuid NOT NULL,
  project_id    uuid,
  chunk_index   integer NOT NULL,
  content_type  text NOT NULL DEFAULT 'text',
  page_number   integer,
  sheet_name    text,
  slide_number  integer,
  text          text NOT NULL,
  metadata      jsonb DEFAULT '{}'::jsonb,
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', coalesce(text,''))) STORED,
  created_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.file_content_chunks TO authenticated;
GRANT ALL    ON public.file_content_chunks TO service_role;

ALTER TABLE public.file_content_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff reads chunks" ON public.file_content_chunks;
CREATE POLICY "staff reads chunks" ON public.file_content_chunks
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR client_id = auth.uid());

CREATE INDEX IF NOT EXISTS chunks_file_idx    ON public.file_content_chunks(file_id, chunk_index);
CREATE INDEX IF NOT EXISTS chunks_client_idx  ON public.file_content_chunks(client_id);
CREATE INDEX IF NOT EXISTS chunks_search_idx  ON public.file_content_chunks USING gin(search_vector);
CREATE INDEX IF NOT EXISTS chunks_trgm_idx    ON public.file_content_chunks USING gin(text gin_trgm_ops);

-- 4. Fila de processamento
CREATE TABLE IF NOT EXISTS public.file_processing_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id       uuid NOT NULL REFERENCES public.files(id) ON DELETE CASCADE,
  job_type      text NOT NULL DEFAULT 'extract',
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','completed','failed','skipped')),
  progress      integer NOT NULL DEFAULT 0,
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  payload       jsonb DEFAULT '{}'::jsonb,
  started_at    timestamptz,
  finished_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.file_processing_jobs TO authenticated;
GRANT ALL    ON public.file_processing_jobs TO service_role;

ALTER TABLE public.file_processing_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff reads jobs" ON public.file_processing_jobs;
CREATE POLICY "staff reads jobs" ON public.file_processing_jobs
  FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE INDEX IF NOT EXISTS jobs_status_idx  ON public.file_processing_jobs(status, created_at);
CREATE INDEX IF NOT EXISTS jobs_file_idx    ON public.file_processing_jobs(file_id);

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON public.file_processing_jobs;
CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON public.file_processing_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Storage policies: bucket privado `mcp-files`
--    Layout de path: <client_id>/<file_id>/<version>/<filename>
DROP POLICY IF EXISTS "mcp-files: staff read"   ON storage.objects;
DROP POLICY IF EXISTS "mcp-files: staff write"  ON storage.objects;
DROP POLICY IF EXISTS "mcp-files: owner read"   ON storage.objects;

CREATE POLICY "mcp-files: staff read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'mcp-files' AND public.is_staff(auth.uid()));

CREATE POLICY "mcp-files: staff write" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'mcp-files' AND public.is_staff(auth.uid()))
  WITH CHECK (bucket_id = 'mcp-files' AND public.is_staff(auth.uid()));

CREATE POLICY "mcp-files: owner read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'mcp-files'
    AND split_part(name, '/', 1) = auth.uid()::text
  );
