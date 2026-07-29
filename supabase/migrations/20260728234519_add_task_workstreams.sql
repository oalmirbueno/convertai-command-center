BEGIN;

ALTER TABLE public.tasks
  ADD COLUMN workstream text NOT NULL DEFAULT 'general';

-- Backfill only from explicit team roles. Design takes deterministic
-- precedence if a user happens to hold both design and traffic roles.
-- Keep this technical classification from rewriting task activity dates.
ALTER TABLE public.tasks DISABLE TRIGGER update_tasks_updated_at;

UPDATE public.tasks AS task
SET workstream = CASE
  WHEN EXISTS (
    SELECT 1
    FROM public.user_roles AS role_row
    WHERE role_row.user_id = task.assigned_to
      AND role_row.role = 'design'::public.app_role
  ) THEN 'design'
  WHEN EXISTS (
    SELECT 1
    FROM public.user_roles AS role_row
    WHERE role_row.user_id = task.assigned_to
      AND role_row.role = 'traffic'::public.app_role
  ) THEN 'traffic'
  ELSE 'general'
END;

ALTER TABLE public.tasks ENABLE TRIGGER update_tasks_updated_at;

ALTER TABLE public.tasks
  ADD CONSTRAINT tasks_workstream_check
  CHECK (
    workstream IN (
      'general',
      'design',
      'content',
      'video',
      'traffic',
      'development',
      'operations'
    )
  );

CREATE INDEX tasks_workstream_status_idx
  ON public.tasks (workstream, status)
  WHERE deleted_at IS NULL;

COMMIT;
