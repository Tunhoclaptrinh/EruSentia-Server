-- C4-B: shared, expiring rate counters. No raw IP, email or credentials.
CREATE TABLE service_rate_limits (
  key_hash char(64) PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  hits integer NOT NULL CHECK (hits > 0 AND hits <= 10001),
  expires_at timestamptz NOT NULL
);
CREATE INDEX service_rate_limits_expiry_idx ON service_rate_limits(expires_at);

-- Keep quota reads on small scalar columns, including inserts from trusted seed scripts.
ALTER TABLE templates ADD COLUMN content_bytes bigint
  GENERATED ALWAYS AS (octet_length(content_json::text)) STORED;
CREATE INDEX templates_owner_quota_idx ON templates(author_id) INCLUDE(content_bytes)
  WHERE deleted_at IS NULL;
