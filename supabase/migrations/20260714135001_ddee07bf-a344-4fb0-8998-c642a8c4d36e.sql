CREATE TABLE IF NOT EXISTS public.project_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL,
  project_id uuid NULL,
  kind text NOT NULL DEFAULT 'note',
  source text NOT NULL DEFAULT 'studio',
  title text NULL,
  content text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_memory_client_idx  ON public.project_memory (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_memory_project_idx ON public.project_memory (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_memory_kind_idx    ON public.project_memory (kind);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_memory TO authenticated;
GRANT ALL ON public.project_memory TO service_role;

ALTER TABLE public.project_memory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "memory staff full"
ON public.project_memory FOR ALL
TO authenticated
USING (public.is_staff(auth.uid()))
WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "memory client read own"
ON public.project_memory FOR SELECT
TO authenticated
USING (client_id = auth.uid());

CREATE TRIGGER project_memory_touch
BEFORE UPDATE ON public.project_memory
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();