
-- Briefings table for public briefing links
CREATE TABLE IF NOT EXISTS public.briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text UNIQUE NOT NULL DEFAULT gen_random_uuid()::text,
  client_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  responses jsonb DEFAULT '{}',
  submitted boolean DEFAULT false,
  required boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.briefings ENABLE ROW LEVEL SECURITY;

-- Public access for briefing forms (anyone with the token can view/submit)
CREATE POLICY "briefings_public_select" ON public.briefings FOR SELECT USING (true);
CREATE POLICY "briefings_public_insert" ON public.briefings FOR INSERT WITH CHECK (true);
CREATE POLICY "briefings_public_update" ON public.briefings FOR UPDATE USING (true);
