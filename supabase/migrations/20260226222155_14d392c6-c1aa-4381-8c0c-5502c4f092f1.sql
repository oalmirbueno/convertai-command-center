
-- Task comments table
CREATE TABLE public.task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES public.profiles(id),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_comments_select" ON public.task_comments FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_comments_insert" ON public.task_comments FOR INSERT TO authenticated WITH CHECK (auth.uid() = author_id);
CREATE POLICY "task_comments_delete" ON public.task_comments FOR DELETE TO authenticated USING (
  author_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)
);

CREATE INDEX idx_task_comments_task_id ON public.task_comments(task_id);

-- Task checklist items table
CREATE TABLE public.task_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  checked BOOLEAN NOT NULL DEFAULT false,
  item_order INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.task_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_checklist_select" ON public.task_checklist_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "task_checklist_insert" ON public.task_checklist_items FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'design'::app_role)
    OR has_role(auth.uid(), 'traffic'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
  );
CREATE POLICY "task_checklist_update" ON public.task_checklist_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "task_checklist_delete" ON public.task_checklist_items FOR DELETE TO authenticated USING (
  created_by = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)
);

CREATE INDEX idx_task_checklist_task_id ON public.task_checklist_items(task_id);
