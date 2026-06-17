
-- Enums
DO $$ BEGIN
  CREATE TYPE public.client_type AS ENUM ('recurring', 'one_off', 'hybrid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.brand_type AS ENUM ('aceleriq', 'sitebolt');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.project_billing_mode AS ENUM ('included', 'one_off');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Profiles: client_type + brand
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS client_type public.client_type NOT NULL DEFAULT 'recurring',
  ADD COLUMN IF NOT EXISTS brand public.brand_type;

CREATE INDEX IF NOT EXISTS idx_profiles_client_type ON public.profiles(client_type);
CREATE INDEX IF NOT EXISTS idx_profiles_brand ON public.profiles(brand);

-- Projects: billing_mode + financial fields for one_off
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS billing_mode public.project_billing_mode NOT NULL DEFAULT 'included',
  ADD COLUMN IF NOT EXISTS brand public.brand_type,
  ADD COLUMN IF NOT EXISTS total_value numeric;

CREATE INDEX IF NOT EXISTS idx_projects_billing_mode ON public.projects(billing_mode);
CREATE INDEX IF NOT EXISTS idx_projects_brand ON public.projects(brand);
