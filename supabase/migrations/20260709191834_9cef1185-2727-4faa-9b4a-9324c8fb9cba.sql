
CREATE TABLE IF NOT EXISTS public.studio_docs (
  project_id UUID PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
  notes TEXT NOT NULL DEFAULT '',
  doc_blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  published BOOLEAN NOT NULL DEFAULT false,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.studio_docs TO authenticated;
GRANT ALL ON public.studio_docs TO service_role;

ALTER TABLE public.studio_docs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff full access studio_docs" ON public.studio_docs
FOR ALL TO authenticated
USING (public.is_staff(auth.uid()))
WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY "Clients read published own studio_docs" ON public.studio_docs
FOR SELECT TO authenticated
USING (
  published = true
  AND EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = studio_docs.project_id AND p.client_id = auth.uid()
  )
);

DROP TRIGGER IF EXISTS trg_studio_docs_updated_at ON public.studio_docs;
CREATE TRIGGER trg_studio_docs_updated_at
BEFORE UPDATE ON public.studio_docs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.studio_docs;
