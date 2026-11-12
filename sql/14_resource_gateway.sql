-- Hosted resource service: server-controlled plans, document ACLs and access audit.
CREATE TABLE IF NOT EXISTS resource_account_plans (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan varchar(16) NOT NULL CHECK (plan IN ('free','premium','blocked')),
  expires_at timestamptz NULL,
  updated_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS resource_daily_usage (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_day date NOT NULL DEFAULT CURRENT_DATE,
  requests integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  PRIMARY KEY(user_id, usage_day)
);
CREATE TABLE IF NOT EXISTS resource_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title varchar(160) NOT NULL,
  html text NOT NULL CHECK (octet_length(html) <= 524288),
  access varchar(16) NOT NULL CHECK (access IN ('private','shared','premium')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);
CREATE TABLE IF NOT EXISTS resource_document_grants (
  document_id uuid NOT NULL REFERENCES resource_documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(document_id,user_id)
);
CREATE TABLE IF NOT EXISTS resource_access_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  document_id uuid NULL REFERENCES resource_documents(id) ON DELETE SET NULL,
  action varchar(40) NOT NULL,
  target_origin varchar(300) NULL,
  outcome varchar(30) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_resource_events_user ON resource_access_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_resource_documents_owner ON resource_documents(owner_id, created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_resource_events_document ON resource_access_events(document_id, id DESC) WHERE document_id IS NOT NULL;
