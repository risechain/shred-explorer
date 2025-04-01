-- Update state_changes table to rename code column to new_code and make it nullable
ALTER TABLE state_changes ALTER COLUMN code DROP NOT NULL;
ALTER TABLE state_changes RENAME COLUMN code TO new_code;