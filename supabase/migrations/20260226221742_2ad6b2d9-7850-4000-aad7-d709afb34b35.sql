
-- Create task_attachments table for file uploads on tasks
CREATE TABLE public.task_attachments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_type TEXT,
  file_size INTEGER,
  uploaded_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.task_attachments ENABLE ROW LEVEL SECURITY;

-- Everyone authenticated can view attachments
CREATE POLICY "task_attachments_select"
ON public.task_attachments FOR SELECT
TO authenticated
USING (true);

-- Admin, design, traffic, manager can insert
CREATE POLICY "task_attachments_insert"
ON public.task_attachments FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin') OR
  has_role(auth.uid(), 'design') OR
  has_role(auth.uid(), 'traffic') OR
  has_role(auth.uid(), 'manager')
);

-- Admin can delete
CREATE POLICY "task_attachments_delete"
ON public.task_attachments FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin') OR uploaded_by = auth.uid());
