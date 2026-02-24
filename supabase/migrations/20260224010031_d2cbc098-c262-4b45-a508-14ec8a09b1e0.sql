
-- Add chart_data column to reports for storing time-series data for charts
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS chart_data jsonb DEFAULT '[]'::jsonb;

-- Add chart_type column to allow choosing chart visualization type
ALTER TABLE public.reports ADD COLUMN IF NOT EXISTS chart_type text DEFAULT 'area';
