
-- =========================================================
-- ACQ-OPS-001B: hardening for external_accounts & project_external_accounts
-- =========================================================

-- 1) Recreate access helpers with empty search_path and role gating
CREATE OR REPLACE FUNCTION public.can_access_client(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR (
        public.has_role(auth.uid(), 'client'::public.app_role)
        AND auth.uid() = _client_id
      )
      OR (
        (
          public.has_role(auth.uid(), 'manager'::public.app_role)
          OR public.has_role(auth.uid(), 'design'::public.app_role)
          OR public.has_role(auth.uid(), 'traffic'::public.app_role)
        )
        AND EXISTS (
          SELECT 1 FROM public.team_client_assignments tca
          WHERE tca.user_id = auth.uid() AND tca.client_id = _client_id
        )
      )
    )
$$;

REVOKE ALL ON FUNCTION public.can_access_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_client(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_manage_client(_client_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
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

REVOKE ALL ON FUNCTION public.can_manage_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_client(uuid) TO authenticated, service_role;

-- 2) CHECK constraints against empty platform/display_name
ALTER TABLE public.external_accounts
  ADD CONSTRAINT external_accounts_platform_nonempty
  CHECK (length(btrim(platform)) > 0);

ALTER TABLE public.external_accounts
  ADD CONSTRAINT external_accounts_display_name_nonempty
  CHECK (length(btrim(display_name)) > 0);

-- 3) Recreate handle uniqueness independent of external_id
DROP INDEX IF EXISTS public.external_accounts_unique_handle;
CREATE UNIQUE INDEX external_accounts_unique_handle
  ON public.external_accounts (client_id, platform, lower(handle))
  WHERE handle IS NOT NULL;

-- 4) Rewrite external_accounts guard: default author + immutability of key fields
CREATE OR REPLACE FUNCTION public.external_accounts_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := COALESCE(NEW.created_at, now());
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'id is immutable on external_accounts';
    END IF;
    IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
      RAISE EXCEPTION 'client_id is immutable on external_accounts';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'created_at is immutable on external_accounts';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'created_by is immutable on external_accounts';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.external_accounts_guard() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS external_accounts_guard_trg ON public.external_accounts;
CREATE TRIGGER external_accounts_guard_trg
BEFORE INSERT OR UPDATE ON public.external_accounts
FOR EACH ROW EXECUTE FUNCTION public.external_accounts_guard();

-- 5) Guard for project_external_accounts: default author + immutability
CREATE OR REPLACE FUNCTION public.project_external_accounts_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := auth.uid();
    NEW.created_at := COALESCE(NEW.created_at, now());
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
      RAISE EXCEPTION 'created_by is immutable on project_external_accounts';
    END IF;
    IF NEW.client_id IS DISTINCT FROM OLD.client_id THEN
      RAISE EXCEPTION 'client_id is immutable on project_external_accounts';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'created_at is immutable on project_external_accounts';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.project_external_accounts_guard() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS project_external_accounts_guard_trg ON public.project_external_accounts;
CREATE TRIGGER project_external_accounts_guard_trg
BEFORE INSERT OR UPDATE ON public.project_external_accounts
FOR EACH ROW EXECUTE FUNCTION public.project_external_accounts_guard();

-- 6) Policies: require created_by = auth.uid() on INSERT (belt & suspenders vs trigger)
DROP POLICY IF EXISTS "external_accounts_insert" ON public.external_accounts;
CREATE POLICY "external_accounts_insert"
ON public.external_accounts FOR INSERT
TO authenticated
WITH CHECK (
  public.can_manage_client(client_id)
  AND (created_by IS NULL OR created_by = auth.uid())
);

DROP POLICY IF EXISTS "pea_insert" ON public.project_external_accounts;
CREATE POLICY "pea_insert"
ON public.project_external_accounts FOR INSERT
TO authenticated
WITH CHECK (
  public.can_manage_client(client_id)
  AND (created_by IS NULL OR created_by = auth.uid())
);

-- 7) Revoke all privileges from anon
REVOKE ALL ON public.external_accounts FROM anon;
REVOKE ALL ON public.project_external_accounts FROM anon;
