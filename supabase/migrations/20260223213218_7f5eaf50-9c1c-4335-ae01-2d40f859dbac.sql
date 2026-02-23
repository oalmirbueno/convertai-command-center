
-- Add version and parent_file_id columns to files table
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS version integer DEFAULT 1;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS parent_file_id uuid REFERENCES public.files(id);

-- Create storage bucket for files
INSERT INTO storage.buckets (id, name, public) VALUES ('files', 'files', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Anyone can read files" ON storage.objects FOR SELECT USING (bucket_id = 'files');
CREATE POLICY "Authenticated can upload files" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'files');
CREATE POLICY "Authenticated can delete files" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'files');

-- Add delete policy for files table (admin only)
CREATE POLICY "files_admin_delete" ON public.files FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));

-- Add update policy for milestones (admin)
CREATE POLICY "milestones_admin_update" ON public.milestones FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role));

-- Add delete policy for tasks (admin)  
CREATE POLICY "tasks_admin_delete" ON public.tasks FOR DELETE USING (has_role(auth.uid(), 'admin'::app_role));
