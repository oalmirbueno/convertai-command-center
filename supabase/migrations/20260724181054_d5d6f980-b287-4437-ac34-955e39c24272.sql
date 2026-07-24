
-- Support composite FK from child tables
ALTER TABLE public.projects ADD CONSTRAINT projects_id_client_id_key UNIQUE (id, client_id);

-- =========================
-- external_accounts
-- =========================
CREATE TABLE public.external_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform text NOT NULL,
  external_id text,
  display_name text NOT NULL,
  handle text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_accounts_id_client_id_key UNIQUE (id, client_id)
);

-- Block duplicate accounts per client+platform (external_id when present; otherwise handle)
CREATE UNIQUE INDEX external_accounts_unique_external
  ON public.external_accounts (client_id, platform, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX external_accounts_unique_handle
  ON public.external_accounts (client_id, platform, lower(handle))
  WHERE external_id IS NULL AND handle IS NOT NULL;

CREATE INDEX external_accounts_client_idx ON public.external_accounts (client_id);

GRANT SELECT, INSERT, UPDATE ON public.external_accounts TO authenticated;
GRANT ALL ON public.external_accounts TO service_role;

ALTER TABLE public.external_accounts ENABLE ROW LEVEL SECURITY;

-- Immutability: client_id cannot be changed after creation
CREATE OR REPLACE FUNCTION public.external_accounts_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.client_id IS DISTINCT FROM OLD.client_id THEN
    RAISE EXCEPTION 'client_id is immutable on external_accounts';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER external_accounts_guard_trg
BEFORE UPDATE ON public.external_accounts
FOR EACH ROW EXECUTE FUNCTION public.external_accounts_guard();

-- Access helper: does the current user have access to this client?
-- Admin: yes; client owner: yes; staff (design/traffic/manager): only if assigned.
CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR auth.uid() = _client_id
      OR EXISTS (
        SELECT 1 FROM public.team_client_assignments tca
        WHERE tca.user_id = auth.uid() AND tca.client_id = _client_id
      )
    )
$$;

REVOKE EXECUTE ON FUNCTION public.can_access_client(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_client(uuid) TO authenticated, service_role;

-- Manage helper: only admins and assigned managers can write for a given client.
CREATE OR REPLACE FUNCTION public.can_manage_client(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (
        public.has_role(auth.uid(), 'manager'::public.app_role)
        AND EXISTS (
          SELECT 1 FROM public.team_client_assignments tca
          WHERE tca.user_id = auth.uid() AND tca.client_id = _client_id
        )
      )
    )
$$;

REVOKE EXECUTE ON FUNCTION public.can_manage_client(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_client(uuid) TO authenticated, service_role;

-- Policies
CREATE POLICY "external_accounts_select"
ON public.external_accounts FOR SELECT
TO authenticated
USING (public.can_access_client(client_id));

CREATE POLICY "external_accounts_insert"
ON public.external_accounts FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_client(client_id));

CREATE POLICY "external_accounts_update"
ON public.external_accounts FOR UPDATE
TO authenticated
USING (public.can_manage_client(client_id))
WITH CHECK (public.can_manage_client(client_id));

-- No DELETE policy: hard delete forbidden through the API.

-- =========================
-- project_external_accounts
-- =========================
CREATE TABLE public.project_external_accounts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  external_account_id uuid NOT NULL,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_external_accounts_project_fk
    FOREIGN KEY (project_id, client_id)
    REFERENCES public.projects (id, client_id) ON DELETE CASCADE,
  CONSTRAINT project_external_accounts_account_fk
    FOREIGN KEY (external_account_id, client_id)
    REFERENCES public.external_accounts (id, client_id) ON DELETE CASCADE,
  CONSTRAINT project_external_accounts_unique UNIQUE (project_id, external_account_id)
);

CREATE INDEX pea_client_idx ON public.project_external_accounts (client_id);
CREATE INDEX pea_project_idx ON public.project_external_accounts (project_id);
CREATE INDEX pea_account_idx ON public.project_external_accounts (external_account_id);

GRANT SELECT, INSERT, DELETE ON public.project_external_accounts TO authenticated;
GRANT ALL ON public.project_external_accounts TO service_role;

ALTER TABLE public.project_external_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pea_select"
ON public.project_external_accounts FOR SELECT
TO authenticated
USING (public.can_access_client(client_id));

CREATE POLICY "pea_insert"
ON public.project_external_accounts FOR INSERT
TO authenticated
WITH CHECK (public.can_manage_client(client_id));

CREATE POLICY "pea_delete"
ON public.project_external_accounts FOR DELETE
TO authenticated
USING (public.can_manage_client(client_id));
