-- Week 6: Shared Workspaces, Fine-Grained RBAC & Concurrency Protection
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(128) NOT NULL,
  slug varchar(128) NOT NULL UNIQUE,
  description text NULL,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(16) NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id, role);

CREATE TABLE IF NOT EXISTS workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email varchar(255) NOT NULL,
  role varchar(16) NOT NULL CHECK (role IN ('editor', 'viewer')),
  token varchar(64) NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz NULL,
  accepted_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_token ON workspace_invites(token);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace ON workspace_invites(workspace_id);

CREATE TABLE IF NOT EXISTS workspace_resources (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  added_by uuid NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  permission varchar(16) NOT NULL DEFAULT 'read_write' CHECK (permission IN ('read_only', 'read_write')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_resources_template ON workspace_resources(template_id);

CREATE TABLE IF NOT EXISTS workspace_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  action varchar(32) NOT NULL,
  target_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_audit ON workspace_audit_logs(workspace_id, created_at DESC);

