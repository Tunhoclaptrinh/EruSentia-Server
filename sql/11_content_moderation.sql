-- Policy metadata remains outside content snapshots, including after history restore.
ALTER TABLE templates
  ADD COLUMN moderation_state varchar(16) NOT NULL DEFAULT 'visible' CHECK (moderation_state IN ('visible','hidden')),
  ADD COLUMN moderation_reason text NULL CHECK (length(moderation_reason) <= 2000),
  ADD CONSTRAINT templates_hidden_private CHECK (moderation_state <> 'hidden' OR is_public = false);

CREATE TABLE template_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_revision integer NOT NULL CHECK (template_revision > 0),
  reported_title varchar(255) NOT NULL,
  reason_code varchar(16) NOT NULL CHECK (reason_code IN ('unsafe','copyright','spam','other')),
  description text NOT NULL CHECK (length(description) BETWEEN 1 AND 2000),
  state varchar(16) NOT NULL DEFAULT 'open' CHECK (state IN ('open','resolved','dismissed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  resolution_reason text NULL CHECK (length(resolution_reason) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id,reporter_id,template_revision)
);
CREATE INDEX template_reports_queue ON template_reports(state,created_at DESC,id DESC);
CREATE INDEX template_reports_reporter ON template_reports(reporter_id,created_at DESC,id DESC);
CREATE TABLE moderation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NULL REFERENCES template_reports(id) ON DELETE SET NULL,
  template_id uuid NULL REFERENCES templates(id) ON DELETE SET NULL,
  actor_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  action varchar(16) NOT NULL CHECK (action IN ('hide','dismiss','release')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_audit_report ON moderation_audit(report_id,created_at,id);
