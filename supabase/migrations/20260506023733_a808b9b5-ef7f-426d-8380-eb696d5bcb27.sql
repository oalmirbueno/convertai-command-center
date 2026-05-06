ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS progress integer,
  ADD COLUMN IF NOT EXISTS node_type text,
  ADD COLUMN IF NOT EXISTS source text DEFAULT 'portal';

CREATE UNIQUE INDEX IF NOT EXISTS tasks_project_ops_node_uniq
  ON public.tasks(project_id, ops_node_id)
  WHERE ops_node_id IS NOT NULL;