
-- ============================================
-- CLEAN UP ALL OLD RLS POLICIES
-- ============================================

-- Profiles: drop all old policies
DROP POLICY IF EXISTS "anyone_read_profiles" ON profiles;
DROP POLICY IF EXISTS "users_insert_own" ON profiles;
DROP POLICY IF EXISTS "users_update_own" ON profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON profiles;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON profiles;
DROP POLICY IF EXISTS "Enable update for users based on id" ON profiles;
DROP POLICY IF EXISTS "Authenticated users can read all profiles" ON profiles;

-- Create clean profiles policies
CREATE POLICY "profiles_select" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update" ON profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Projects: drop old, create clean
DROP POLICY IF EXISTS "Admins can do anything with projects" ON projects;
DROP POLICY IF EXISTS "Clients can view their own projects" ON projects;

CREATE POLICY "projects_select" ON projects FOR SELECT TO authenticated USING (
  client_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)
);
CREATE POLICY "projects_admin_insert" ON projects FOR INSERT TO authenticated WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
);
CREATE POLICY "projects_admin_update" ON projects FOR UPDATE TO authenticated USING (
  has_role(auth.uid(), 'admin'::app_role)
);
CREATE POLICY "projects_admin_delete" ON projects FOR DELETE TO authenticated USING (
  has_role(auth.uid(), 'admin'::app_role)
);

-- Tasks: drop old, create clean
DROP POLICY IF EXISTS "Admins can do anything with tasks" ON tasks;
DROP POLICY IF EXISTS "Assigned users can update their tasks" ON tasks;
DROP POLICY IF EXISTS "Assigned users can view and update tasks" ON tasks;
DROP POLICY IF EXISTS "Clients can view tasks of their projects" ON tasks;

CREATE POLICY "tasks_select" ON tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "tasks_insert" ON tasks FOR INSERT TO authenticated WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
);
CREATE POLICY "tasks_update" ON tasks FOR UPDATE TO authenticated USING (
  has_role(auth.uid(), 'admin'::app_role) OR assigned_to = auth.uid()
);

-- Milestones: drop old, create clean
DROP POLICY IF EXISTS "Admins can do anything with milestones" ON milestones;
DROP POLICY IF EXISTS "Users can view milestones of their projects" ON milestones;

CREATE POLICY "milestones_select" ON milestones FOR SELECT TO authenticated USING (true);
CREATE POLICY "milestones_insert" ON milestones FOR INSERT TO authenticated WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
);

-- Updates: drop old, create clean
DROP POLICY IF EXISTS "Admins can do anything with updates" ON updates;
DROP POLICY IF EXISTS "Authenticated users can insert updates" ON updates;
DROP POLICY IF EXISTS "Clients can view updates of their projects" ON updates;

CREATE POLICY "updates_select" ON updates FOR SELECT TO authenticated USING (true);
CREATE POLICY "updates_insert" ON updates FOR INSERT TO authenticated WITH CHECK (true);

-- Files: drop old, create clean
DROP POLICY IF EXISTS "Admins can do anything with files" ON files;
DROP POLICY IF EXISTS "Clients can update own files approval" ON files;
DROP POLICY IF EXISTS "Clients can view their own files" ON files;

CREATE POLICY "files_select" ON files FOR SELECT TO authenticated USING (true);
CREATE POLICY "files_insert" ON files FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "files_update" ON files FOR UPDATE TO authenticated USING (true);

-- Notifications: drop old, create clean
DROP POLICY IF EXISTS "Authenticated can insert notifications" ON notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;

CREATE POLICY "notifications_select" ON notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notifications_insert" ON notifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "notifications_update" ON notifications FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- Client Requests: drop old, create clean
DROP POLICY IF EXISTS "Admins can do anything with client_requests" ON client_requests;
DROP POLICY IF EXISTS "Clients can create own requests" ON client_requests;
DROP POLICY IF EXISTS "Clients can view own requests" ON client_requests;

CREATE POLICY "client_requests_select" ON client_requests FOR SELECT TO authenticated USING (
  client_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)
);
CREATE POLICY "client_requests_insert" ON client_requests FOR INSERT TO authenticated WITH CHECK (true);

-- Billing: drop old, create clean
DROP POLICY IF EXISTS "Admins can do anything with billing" ON billing;
DROP POLICY IF EXISTS "Clients can view own billing" ON billing;

CREATE POLICY "billing_select" ON billing FOR SELECT TO authenticated USING (
  client_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)
);
CREATE POLICY "billing_insert" ON billing FOR INSERT TO authenticated WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
);

-- User Roles: drop old, create clean
DROP POLICY IF EXISTS "Admins can read all roles" ON user_roles;
DROP POLICY IF EXISTS "Users can read own roles" ON user_roles;

CREATE POLICY "user_roles_select" ON user_roles FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role)
);

-- ============================================
-- FIX TRIGGER: handle_new_user
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, company_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', SPLIT_PART(COALESCE(NEW.email, ''), '@', 1)),
    NEW.raw_user_meta_data->>'company_name'
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    COALESCE((NEW.raw_user_meta_data->>'role')::app_role, 'client')
  )
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Recreate trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
