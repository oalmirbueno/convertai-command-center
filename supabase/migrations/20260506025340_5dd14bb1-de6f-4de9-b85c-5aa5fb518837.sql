ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS kanban_status text,
  ADD COLUMN IF NOT EXISTS ops_updated_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_ops_node_id_unique
  ON public.tasks (ops_node_id)
  WHERE ops_node_id IS NOT NULL;