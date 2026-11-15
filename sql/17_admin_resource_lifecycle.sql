-- Additive management versions and quota controls. Existing rows/content are preserved.
ALTER TABLE resource_documents ADD COLUMN content_bytes bigint GENERATED ALWAYS AS (octet_length(html)) STORED;
ALTER TABLE resource_documents ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE resource_account_plans ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE resource_account_plans ADD COLUMN daily_limit integer CHECK(daily_limit BETWEEN 0 AND 10000);
ALTER TABLE resource_account_plans ADD COLUMN document_limit integer CHECK(document_limit BETWEEN 0 AND 1000);
ALTER TABLE resource_account_plans ADD COLUMN retained_bytes_limit bigint CHECK(retained_bytes_limit BETWEEN 1024 AND 1073741824);
CREATE FUNCTION eru_resource_document_revision() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.revision:=OLD.revision+1; NEW.updated_at:=now(); RETURN NEW; END $$;
CREATE TRIGGER eru_resource_revision BEFORE UPDATE ON resource_documents FOR EACH ROW EXECUTE FUNCTION eru_resource_document_revision();
CREATE INDEX resource_documents_admin_updated ON resource_documents(updated_at DESC,id DESC);
CREATE INDEX resource_events_admin_created ON resource_access_events(created_at DESC,id DESC);

CREATE INDEX resource_documents_retained_owner ON resource_documents(owner_id) INCLUDE(content_bytes,deleted_at);
