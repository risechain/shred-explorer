-- Add new performance metrics to blocks table
ALTER TABLE blocks
ADD COLUMN IF NOT EXISTS avg_tps DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS avg_shred_interval DOUBLE PRECISION;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_blocks_avg_tps ON blocks(avg_tps);
CREATE INDEX IF NOT EXISTS idx_blocks_avg_shred_interval ON blocks(avg_shred_interval);

COMMENT ON COLUMN blocks.avg_tps IS 'Average transactions per second for this block';
COMMENT ON COLUMN blocks.avg_shred_interval IS 'Average time between shreds in milliseconds';