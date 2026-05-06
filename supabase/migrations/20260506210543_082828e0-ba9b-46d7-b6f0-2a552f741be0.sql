ALTER TABLE public.milestones
  ADD COLUMN IF NOT EXISTS ops_milestone_id uuid,
  ADD COLUMN IF NOT EXISTS sync_origin text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS milestones_project_ops_unique
  ON public.milestones (project_id, ops_milestone_id)
  WHERE ops_milestone_id IS NOT NULL;