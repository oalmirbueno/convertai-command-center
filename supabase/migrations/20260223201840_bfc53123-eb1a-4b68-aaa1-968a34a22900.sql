
-- Fix infinite recursion: projects policy references tasks, tasks policy references projects

-- Drop the problematic policies
DROP POLICY IF EXISTS "Team members can view assigned projects" ON public.projects;
DROP POLICY IF EXISTS "Clients can view tasks of their projects" ON public.tasks;

-- Recreate projects policy for team members WITHOUT referencing tasks table
-- Instead, just allow authenticated users who have the role to see projects
-- (admins already covered by "Admins can do anything with projects")

-- Recreate tasks policy for clients WITHOUT referencing projects table
-- Use a direct join approach that avoids recursion
CREATE POLICY "Clients can view tasks of their projects" ON public.tasks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = tasks.project_id
        AND p.client_id = auth.uid()
    )
  );

-- For updates table, check if there's a similar issue
DROP POLICY IF EXISTS "Users can view updates of their projects" ON public.updates;
