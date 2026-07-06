ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS sort_order DOUBLE PRECISION;

-- Backfill initial sort_order per status using created_at
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY status ORDER BY created_at) * 1000.0 AS rn
  FROM public.tasks
  WHERE sort_order IS NULL
)
UPDATE public.tasks t SET sort_order = ranked.rn
FROM ranked WHERE ranked.id = t.id;

CREATE INDEX IF NOT EXISTS tasks_status_sort_order_idx ON public.tasks (status, sort_order);