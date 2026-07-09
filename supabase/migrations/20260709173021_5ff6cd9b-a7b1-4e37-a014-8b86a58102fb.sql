
CREATE TABLE public.workspace_agent_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  client_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  parent_node_id UUID NULL REFERENCES public.workspace_nodes(id) ON DELETE SET NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  title TEXT NOT NULL DEFAULT 'Nova conversa',
  system_prompt TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_agent_threads TO authenticated;
GRANT ALL ON public.workspace_agent_threads TO service_role;
ALTER TABLE public.workspace_agent_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_threads_select" ON public.workspace_agent_threads FOR SELECT
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY "own_threads_ins" ON public.workspace_agent_threads FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_threads_upd" ON public.workspace_agent_threads FOR UPDATE
  USING (auth.uid() = user_id OR public.is_staff(auth.uid()));
CREATE POLICY "own_threads_del" ON public.workspace_agent_threads FOR DELETE
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_wat_ctx ON public.workspace_agent_threads (user_id, client_id, updated_at DESC);

CREATE TABLE public.workspace_agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.workspace_agent_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
  content TEXT NOT NULL,
  meta JSONB NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_agent_messages TO authenticated;
GRANT ALL ON public.workspace_agent_messages TO service_role;
ALTER TABLE public.workspace_agent_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_msgs_select" ON public.workspace_agent_messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.workspace_agent_threads t
    WHERE t.id = thread_id AND (t.user_id = auth.uid() OR public.is_staff(auth.uid()))));
CREATE POLICY "own_msgs_ins" ON public.workspace_agent_messages FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspace_agent_threads t
    WHERE t.id = thread_id AND (t.user_id = auth.uid() OR public.is_staff(auth.uid()))));
CREATE POLICY "own_msgs_del" ON public.workspace_agent_messages FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.workspace_agent_threads t
    WHERE t.id = thread_id AND (t.user_id = auth.uid() OR public.has_role(auth.uid(),'admin'))));

CREATE INDEX idx_wam_thread ON public.workspace_agent_messages (thread_id, created_at);

CREATE TRIGGER trg_wat_updated BEFORE UPDATE ON public.workspace_agent_threads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
