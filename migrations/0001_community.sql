-- Affirmations families share, waiting for or past a maintainer's decision.
CREATE TABLE submissions (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  challenge TEXT NOT NULL CHECK (length(challenge) BETWEEN 1 AND 160),
  response TEXT NOT NULL CHECK (length(response) BETWEEN 1 AND 160),
  contact TEXT CHECK (contact IS NULL OR length(contact) <= 120),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT
);

-- One heart per device per affirmation.
CREATE TABLE hearts (
  submission_id TEXT NOT NULL REFERENCES submissions(id),
  device TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (submission_id, device)
);

-- Hourly request counts per connection. `key` is "<bucket>:<HMAC of the IP>"; the IP is never stored.
CREATE TABLE rate_counts (
  key TEXT NOT NULL,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (key, window)
);

CREATE INDEX submissions_status ON submissions(status);
