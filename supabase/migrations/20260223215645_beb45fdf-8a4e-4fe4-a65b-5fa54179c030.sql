
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS caption text;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS carousel_text text;
ALTER TABLE public.files ADD COLUMN IF NOT EXISTS description text;
