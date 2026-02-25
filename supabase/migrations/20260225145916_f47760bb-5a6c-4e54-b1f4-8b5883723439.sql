
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS plan_value numeric DEFAULT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS overdue_since date DEFAULT NULL;
