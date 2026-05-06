ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'synced',
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'synced',
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS ops_workspace_id uuid,
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

ALTER TABLE public.milestones
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'synced',
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS sync_status text NOT NULL DEFAULT 'synced',
  ADD COLUMN IF NOT EXISTS sync_error text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS profiles_sync_status_idx ON public.profiles(sync_status);
CREATE INDEX IF NOT EXISTS projects_sync_status_idx ON public.projects(sync_status);
CREATE INDEX IF NOT EXISTS milestones_sync_status_idx ON public.milestones(sync_status);
CREATE INDEX IF NOT EXISTS tasks_sync_status_idx ON public.tasks(sync_status);

CREATE UNIQUE INDEX IF NOT EXISTS projects_ops_workspace_id_unique
  ON public.projects(ops_workspace_id)
  WHERE ops_workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS profiles_deleted_at_idx ON public.profiles(deleted_at);
CREATE INDEX IF NOT EXISTS projects_deleted_at_idx ON public.projects(deleted_at);
CREATE INDEX IF NOT EXISTS milestones_deleted_at_idx ON public.milestones(deleted_at);
CREATE INDEX IF NOT EXISTS tasks_deleted_at_idx ON public.tasks(deleted_at);