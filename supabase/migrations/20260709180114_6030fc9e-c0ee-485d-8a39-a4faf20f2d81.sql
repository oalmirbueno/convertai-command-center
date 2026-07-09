
ALTER TABLE public.workspace_agent_personas DROP CONSTRAINT IF EXISTS workspace_agent_personas_pkey;
ALTER TABLE public.workspace_agent_personas ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.workspace_agent_personas ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.workspace_agent_personas ADD COLUMN IF NOT EXISTS folder_path text;
ALTER TABLE public.workspace_agent_personas ADD PRIMARY KEY (id);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_agent_personas_scope_uidx
  ON public.workspace_agent_personas (user_id, COALESCE(client_id::text, ''), COALESCE(folder_path, ''));
CREATE INDEX IF NOT EXISTS workspace_agent_personas_user_client_idx
  ON public.workspace_agent_personas (user_id, client_id);
