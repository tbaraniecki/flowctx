CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,
  timestamp TEXT,
  method TEXT,
  host TEXT,
  path TEXT,
  url TEXT,
  http_version TEXT,
  request_headers TEXT,
  request_body TEXT,
  status_code INTEGER,
  status_text TEXT,
  response_headers TEXT,
  response_body TEXT,
  timings TEXT
);
