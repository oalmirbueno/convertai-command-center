ALTER TABLE public.client_onboarding_items
ADD COLUMN IF NOT EXISTS is_skipped boolean NOT NULL DEFAULT false;