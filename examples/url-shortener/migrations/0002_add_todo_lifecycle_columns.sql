-- Add lifecycle columns for existing todo databases.
ALTER TABLE todos ADD COLUMN updated_at TEXT;
ALTER TABLE todos ADD COLUMN completed_at TEXT;

UPDATE todos
SET updated_at = COALESCE(updated_at, created_at, datetime('now'));

UPDATE todos
SET completed_at = CASE
  WHEN completed = 1 THEN COALESCE(completed_at, updated_at, created_at, datetime('now'))
  ELSE NULL
END;

CREATE INDEX IF NOT EXISTS idx_todos_updated_at ON todos (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_todos_created_at ON todos (created_at DESC);
