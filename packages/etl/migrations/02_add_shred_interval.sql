-- Add shred_interval column to track time between shreds
ALTER TABLE shreds ADD COLUMN IF NOT EXISTS shred_interval BIGINT;