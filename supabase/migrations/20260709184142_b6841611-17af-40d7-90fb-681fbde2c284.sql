ALTER TABLE public.workspace_agent_personas
  ADD COLUMN IF NOT EXISTS usage_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_personas_user_usage ON public.workspace_agent_personas(user_id, usage_count DESC);