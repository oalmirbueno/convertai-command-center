DROP INDEX IF EXISTS public.workspace_agent_personas_scope_uidx;
CREATE INDEX IF NOT EXISTS workspace_agent_personas_scope_idx
  ON public.workspace_agent_personas (user_id, client_id, folder_path);