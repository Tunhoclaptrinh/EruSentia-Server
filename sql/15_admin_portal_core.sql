BEGIN;

-- 1. Suspension tracking for users
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS suspended_by UUID NULL REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS users_is_active_idx ON users(is_active);

-- 2. Centralized Admin Audit Logs
CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(32) NOT NULL,
    target_id VARCHAR(128) NULL,
    ip_address VARCHAR(45) NULL,
    user_agent TEXT NULL,
    reason TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_actor_idx ON admin_audit_logs(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_logs_target_idx ON admin_audit_logs(target_type, target_id);
CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx ON admin_audit_logs(created_at DESC);

-- 3. Curation metadata for curated community templates
ALTER TABLE templates
  ADD COLUMN IF NOT EXISTS is_curated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS curated_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS curated_by UUID NULL REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS templates_curated_idx ON templates(is_curated) WHERE is_curated = TRUE;

COMMIT;

