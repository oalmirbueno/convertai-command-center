-- O cronograma completo do cliente inclui as PAUTAS do Kanban (prazos
-- roxos): o cliente le as tarefas dos proprios projetos. Leitura apenas;
-- escrita continua exclusiva da equipe.

DROP POLICY IF EXISTS tasks_client_schedule_read ON public.tasks;
CREATE POLICY tasks_client_schedule_read ON public.tasks
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND public.has_role(auth.uid(), 'client'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.projects AS project
      WHERE project.id = tasks.project_id
        AND project.client_id = auth.uid()
        AND project.deleted_at IS NULL
    )
  );
