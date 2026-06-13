CREATE TABLE recordings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  stopped_at TEXT
);

ALTER TABLE requests ADD COLUMN recording_id TEXT;

CREATE INDEX IF NOT EXISTS idx_requests_recording ON requests(recording_id);

-- Only create the legacy bucket when there is pre-existing traffic to adopt, so
-- a fresh install doesn't show a phantom empty "Legacy" recording.
INSERT INTO recordings (id, name, created_at, stopped_at)
SELECT 'e03b8788-77b5-456b-a2c9-05897481175b', 'Legacy (pre-recordings)', '2026-06-11T12:31:03.012Z', '2026-06-11T12:31:03.012Z'
WHERE EXISTS (SELECT 1 FROM requests WHERE recording_id IS NULL);

UPDATE requests SET recording_id = 'e03b8788-77b5-456b-a2c9-05897481175b' WHERE recording_id IS NULL;
