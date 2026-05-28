
-- =========================================================
-- Helper functions
-- =========================================================
CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin'::app_role, 'design'::app_role, 'traffic'::app_role, 'manager'::app_role)
  )
$$;

CREATE OR REPLACE FUNCTION public.user_owns_project(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = _project_id AND p.client_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.user_owns_task(_user_id uuid, _task_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tasks t
    JOIN public.projects p ON p.id = t.project_id
    WHERE t.id = _task_id AND p.client_id = _user_id
  )
$$;

-- =========================================================
-- profiles
-- =========================================================
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (auth.uid() = id OR public.is_staff(auth.uid()));

-- =========================================================
-- briefings (restrict to owner / staff; public token flow must go via edge fn)
-- =========================================================
DROP POLICY IF EXISTS briefings_public_select ON public.briefings;
DROP POLICY IF EXISTS briefings_public_insert ON public.briefings;
DROP POLICY IF EXISTS briefings_public_update ON public.briefings;

CREATE POLICY briefings_select ON public.briefings
  FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE POLICY briefings_insert ON public.briefings
  FOR INSERT TO authenticated
  WITH CHECK (client_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE POLICY briefings_update ON public.briefings
  FOR UPDATE TO authenticated
  USING (
    (client_id = auth.uid() AND submitted IS NOT TRUE)
    OR public.is_staff(auth.uid())
  )
  WITH CHECK (client_id = auth.uid() OR public.is_staff(auth.uid()));

-- =========================================================
-- client_requests
-- =========================================================
DROP POLICY IF EXISTS client_requests_insert ON public.client_requests;
CREATE POLICY client_requests_insert ON public.client_requests
  FOR INSERT TO authenticated
  WITH CHECK (client_id = auth.uid() OR public.is_staff(auth.uid()));

-- =========================================================
-- files
-- =========================================================
DROP POLICY IF EXISTS files_select ON public.files;
DROP POLICY IF EXISTS files_update ON public.files;
DROP POLICY IF EXISTS files_insert ON public.files;

CREATE POLICY files_select ON public.files
  FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE POLICY files_update ON public.files
  FOR UPDATE TO authenticated
  USING (client_id = auth.uid() OR public.is_staff(auth.uid()))
  WITH CHECK (client_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE POLICY files_insert ON public.files
  FOR INSERT TO authenticated
  WITH CHECK (
    (client_id = auth.uid() AND uploaded_by = auth.uid())
    OR public.is_staff(auth.uid())
  );

-- =========================================================
-- milestones
-- =========================================================
DROP POLICY IF EXISTS milestones_select ON public.milestones;
CREATE POLICY milestones_select ON public.milestones
  FOR SELECT TO authenticated
  USING (
    public.is_staff(auth.uid())
    OR public.user_owns_project(auth.uid(), project_id)
  );

-- =========================================================
-- notifications
-- =========================================================
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_staff(auth.uid()));

-- =========================================================
-- payment_audit_log
-- =========================================================
DROP POLICY IF EXISTS audit_log_insert ON public.payment_audit_log;
CREATE POLICY audit_log_insert ON public.payment_audit_log
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));

-- =========================================================
-- quiz_submissions (lock down public reads)
-- =========================================================
DROP POLICY IF EXISTS "anon can read by token" ON public.quiz_submissions;
DROP POLICY IF EXISTS "anon can update draft by token" ON public.quiz_submissions;

-- inserts can stay public (lead capture), reads/updates limited
CREATE POLICY quiz_submissions_service_select ON public.quiz_submissions
  FOR SELECT
  USING (auth.role() = 'service_role' OR public.is_staff(auth.uid()));

CREATE POLICY quiz_submissions_service_update ON public.quiz_submissions
  FOR UPDATE
  USING (auth.role() = 'service_role' OR public.is_staff(auth.uid()))
  WITH CHECK (auth.role() = 'service_role' OR public.is_staff(auth.uid()));

-- =========================================================
-- task_attachments
-- =========================================================
DROP POLICY IF EXISTS task_attachments_select ON public.task_attachments;
CREATE POLICY task_attachments_select ON public.task_attachments
  FOR SELECT TO authenticated
  USING (
    public.is_staff(auth.uid())
    OR public.user_owns_task(auth.uid(), task_id)
  );

-- =========================================================
-- task_checklist_items
-- =========================================================
DROP POLICY IF EXISTS task_checklist_select ON public.task_checklist_items;
DROP POLICY IF EXISTS task_checklist_update ON public.task_checklist_items;

CREATE POLICY task_checklist_select ON public.task_checklist_items
  FOR SELECT TO authenticated
  USING (
    public.is_staff(auth.uid())
    OR public.user_owns_task(auth.uid(), task_id)
  );

CREATE POLICY task_checklist_update ON public.task_checklist_items
  FOR UPDATE TO authenticated
  USING (
    public.is_staff(auth.uid())
    OR created_by = auth.uid()
  )
  WITH CHECK (
    public.is_staff(auth.uid())
    OR created_by = auth.uid()
  );

-- =========================================================
-- task_comments
-- =========================================================
DROP POLICY IF EXISTS task_comments_select ON public.task_comments;
CREATE POLICY task_comments_select ON public.task_comments
  FOR SELECT TO authenticated
  USING (
    public.is_staff(auth.uid())
    OR public.user_owns_task(auth.uid(), task_id)
  );

-- =========================================================
-- tasks
-- =========================================================
DROP POLICY IF EXISTS tasks_select ON public.tasks;
DROP POLICY IF EXISTS tasks_insert ON public.tasks;

CREATE POLICY tasks_select ON public.tasks
  FOR SELECT TO authenticated
  USING (
    public.is_staff(auth.uid())
    OR public.user_owns_project(auth.uid(), project_id)
  );

CREATE POLICY tasks_insert ON public.tasks
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_staff(auth.uid())
    OR public.user_owns_project(auth.uid(), project_id)
  );

-- =========================================================
-- updates
-- =========================================================
DROP POLICY IF EXISTS updates_select ON public.updates;
DROP POLICY IF EXISTS updates_insert ON public.updates;

CREATE POLICY updates_select ON public.updates
  FOR SELECT TO authenticated
  USING (
    public.is_staff(auth.uid())
    OR public.user_owns_project(auth.uid(), project_id)
  );

CREATE POLICY updates_insert ON public.updates
  FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND (
      public.is_staff(auth.uid())
      OR public.user_owns_project(auth.uid(), project_id)
    )
  );

-- =========================================================
-- storage: files bucket – remove anonymous public read
-- =========================================================
DROP POLICY IF EXISTS "Anyone can read files" ON storage.objects;

CREATE POLICY "Authenticated can read files"
ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'files');
