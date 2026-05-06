-- Drop old single-column unique index if it exists (replaced by composite)
DROP INDEX IF EXISTS public.tasks_ops_node_id_unique;

-- Composite unique partial index for Ops sync upserts
CREATE UNIQUE INDEX IF NOT EXISTS tasks_project_ops_node_unique
  ON public.tasks (project_id, ops_node_id)
  WHERE ops_node_id IS NOT NULL;

-- Realtime: full row payloads + add to publication if missing
ALTER TABLE public.tasks REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
  END IF;
END $$;