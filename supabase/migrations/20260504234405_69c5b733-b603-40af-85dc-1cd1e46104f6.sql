-- Drop existing unique constraint/index if it covers nulls and replace with partial index
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='tasks_ops_node_id_key'
  ) THEN
    -- already exists, skip
    NULL;
  ELSE
    -- Drop the old non-partial unique index/constraint if present
    IF EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'tasks_ops_node_id_key'
    ) THEN
      ALTER TABLE public.tasks DROP CONSTRAINT tasks_ops_node_id_key;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='tasks_ops_node_id_idx'
    ) THEN
      DROP INDEX IF EXISTS public.tasks_ops_node_id_idx;
    END IF;
    CREATE UNIQUE INDEX tasks_ops_node_id_key
      ON public.tasks(ops_node_id)
      WHERE ops_node_id IS NOT NULL;
  END IF;
END$$;