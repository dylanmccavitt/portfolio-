-- GitHub issue #191: shared, privacy-safe fixed-window DM request limiter.
-- Only versioned HMAC client hashes are retained. Raw addresses and request
-- content never enter this table.

CREATE TABLE IF NOT EXISTS dm_rate_limit_windows (
  key_version text NOT NULL,
  client_hash text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (key_version, client_hash, window_start)
);

CREATE INDEX IF NOT EXISTS dm_rate_limit_windows_expiry_idx
  ON dm_rate_limit_windows (expires_at);
