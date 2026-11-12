-- Week 6: Template follows and asynchronous in-app notifications
CREATE TABLE IF NOT EXISTS template_follows (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_template_follows_template ON template_follows(template_id, created_at);
CREATE INDEX IF NOT EXISTS idx_template_follows_user ON template_follows(user_id, created_at DESC);

-- Extend existing notifications table from 01_schema.sql
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS template_id uuid NULL REFERENCES templates(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS revision integer NULL CHECK (revision > 0),
  ADD COLUMN IF NOT EXISTS event_id uuid NULL REFERENCES message_outbox(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS read_at timestamptz NULL;

-- Unique constraint for template revision idempotency per recipient
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_recipient_template_revision
  ON notifications (recipient_id, template_id, revision)
  WHERE template_id IS NOT NULL AND revision IS NOT NULL;

-- Composite index for high-performance cursor pagination
CREATE INDEX IF NOT EXISTS idx_notifications_feed
  ON notifications (recipient_id, created_at DESC, id DESC);
