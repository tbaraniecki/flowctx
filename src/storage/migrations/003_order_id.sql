ALTER TABLE requests ADD COLUMN order_id INTEGER;

UPDATE requests SET order_id = (SELECT seq FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY recording_id ORDER BY timestamp ASC, id ASC) AS seq FROM requests) AS t WHERE t.id = requests.id);

CREATE INDEX IF NOT EXISTS idx_requests_order ON requests(recording_id, order_id);
