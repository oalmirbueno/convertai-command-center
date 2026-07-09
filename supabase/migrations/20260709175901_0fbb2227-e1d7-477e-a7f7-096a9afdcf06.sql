
CREATE TABLE public.workspace_agent_personas (
  user_id uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  gpt_url text,
  gpt_name text,
  gpt_description text,
  persona_prompt text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_agent_personas TO authenticated;
GRANT ALL ON public.workspace_agent_personas TO service_role;
ALTER TABLE public.workspace_agent_personas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own persona rw" ON public.workspace_agent_personas
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
