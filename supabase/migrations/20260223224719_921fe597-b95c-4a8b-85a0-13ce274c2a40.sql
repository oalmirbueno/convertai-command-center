-- BUG 5 FIX: Allow any authenticated user to insert tasks (system creates tasks on rejection)
DROP POLICY IF EXISTS "tasks_insert" ON tasks;
CREATE POLICY "tasks_insert" ON tasks FOR INSERT TO authenticated WITH CHECK (true);