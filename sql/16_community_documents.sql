BEGIN;
CREATE TABLE community_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  title varchar(160) NOT NULL,
  summary varchar(600) NOT NULL DEFAULT '',
  html text NOT NULL CHECK (octet_length(html) <= 524288),
  license varchar(20) NOT NULL CHECK (license IN ('MIT','CC-BY-4.0')),
  attribution varchar(160) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','changes_requested','published','archived')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  review_reason varchar(2000),
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX community_documents_author ON community_documents(author_id,updated_at DESC,id);
CREATE INDEX community_documents_queue ON community_documents(status,submitted_at,id);
CREATE INDEX community_documents_category ON community_documents(category_id);
CREATE TABLE community_document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES community_documents(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action varchar(32) NOT NULL,
  reason varchar(2000),
  version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX community_document_events_history ON community_document_events(document_id,created_at,id);
COMMIT;
