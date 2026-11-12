-- Logical retained payload accounting; no history or user content is deleted by this migration.
ALTER TABLE template_revisions ADD COLUMN snapshot_bytes bigint GENERATED ALWAYS AS (octet_length(snapshot::text)) STORED;
CREATE INDEX templates_retained_owner ON templates(author_id) INCLUDE(content_bytes);
CREATE INDEX template_revisions_retained_bytes ON template_revisions(template_id) INCLUDE(snapshot_bytes);
-- Permanent deletion requires the dedicated owner + password + ETag workflow.
ALTER TABLE template_revisions DROP CONSTRAINT template_revisions_template_id_fkey;
ALTER TABLE template_revisions ADD CONSTRAINT template_revisions_template_id_fkey FOREIGN KEY(template_id) REFERENCES templates(id) ON DELETE CASCADE;
