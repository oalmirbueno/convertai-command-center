
CREATE TABLE public.voice_command_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  transcript text NOT NULL,
  intent jsonb,
  status text NOT NULL DEFAULT 'pending',
  result text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.voice_command_log TO authenticated;
GRANT ALL ON public.voice_command_log TO service_role;

ALTER TABLE public.voice_command_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "voice_log_admin_select" ON public.voice_command_log
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "voice_log_self_insert" ON public.voice_command_log
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_voice_log_created_at ON public.voice_command_log (created_at DESC);
