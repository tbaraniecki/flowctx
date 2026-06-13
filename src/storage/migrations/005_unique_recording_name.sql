-- Make recording names unique. Recording name is now a stable identifier that
-- the MCP server (and humans) can use interchangeably with the id.

-- Safety net: if any pre-existing rows share a name, keep the newest as-is and
-- disambiguate the rest by appending a short slice of their (unique) id, so the
-- unique index below can be created without failing.
UPDATE recordings
SET name = name || ' (' || substr(id, 1, 8) || ')'
WHERE rowid NOT IN (
  SELECT rowid FROM (
    SELECT rowid, ROW_NUMBER() OVER (PARTITION BY name ORDER BY created_at DESC, rowid DESC) AS rn
    FROM recordings
  ) WHERE rn = 1
);

CREATE UNIQUE INDEX idx_recordings_name ON recordings(name);
