-- C3: additive revision history. Existing content is the baseline, not invented history.
ALTER TABLE templates ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 1
    CHECK (revision > 0);

CREATE TABLE IF NOT EXISTS template_revisions (
    template_id uuid NOT NULL REFERENCES templates(id) ON DELETE RESTRICT,
    revision integer NOT NULL CHECK (revision > 0),
    operation varchar(16) NOT NULL CHECK (operation IN ('baseline','create','update','delete','restore')),
    actor_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
    PRIMARY KEY (template_id, revision)
);

CREATE OR REPLACE FUNCTION eru_template_snapshot(t templates) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_object(
        'categoryId', t.category_id, 'title', t.title, 'slug', t.slug,
        'description', t.description, 'contentJson', t.content_json,
        'thumbnailUrl', t.thumbnail_url, 'version', t.version,
        'isPublic', t.is_public, 'tags', t.tags
    );
$$;

INSERT INTO template_revisions(template_id, revision, operation, snapshot)
SELECT id, revision, 'baseline', eru_template_snapshot(templates)
FROM templates ON CONFLICT (template_id, revision) DO NOTHING;

CREATE OR REPLACE FUNCTION eru_advance_template_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.revision := OLD.revision + 1;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION eru_record_template_revision() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    operation_name text;
BEGIN
    operation_name := CASE
        WHEN TG_OP = 'INSERT' THEN 'create'
        WHEN current_setting('eru.template_operation', true) = 'restore' THEN 'restore'
        WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN 'delete'
        ELSE 'update'
    END;
    INSERT INTO template_revisions(template_id, revision, operation, actor_id, snapshot)
    VALUES (NEW.id, NEW.revision, operation_name,
        nullif(current_setting('eru.actor_id', true), '')::uuid,
        eru_template_snapshot(NEW));
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS eru_template_revision_counter ON templates;
DROP TRIGGER IF EXISTS eru_template_revision_history ON templates;
CREATE TRIGGER eru_template_revision_counter BEFORE UPDATE ON templates
FOR EACH ROW EXECUTE FUNCTION eru_advance_template_revision();
CREATE TRIGGER eru_template_revision_history AFTER INSERT OR UPDATE ON templates
FOR EACH ROW EXECUTE FUNCTION eru_record_template_revision();
