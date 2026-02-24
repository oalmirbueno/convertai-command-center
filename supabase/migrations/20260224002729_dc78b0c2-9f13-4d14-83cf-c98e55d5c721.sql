
ALTER TABLE reports ADD COLUMN IF NOT EXISTS highlights text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS next_steps text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS internal_notes text;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS images jsonb DEFAULT '[]';
