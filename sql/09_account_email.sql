-- Optional C4 local Mailpit module. Apply only when account email is enabled.
CREATE TABLE auth_email_actions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose varchar(8) NOT NULL CHECK (purpose IN ('verify','reset')),
  token_hash char(64) NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  PRIMARY KEY (user_id,purpose),
  CHECK (expires_at > requested_at)
);
CREATE TABLE auth_email_verifications (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  verified_at timestamptz NOT NULL
);
