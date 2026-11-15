-- Existing content becomes one baseline; no invented historical versions.
CREATE TABLE community_document_versions (
 document_id uuid NOT NULL REFERENCES community_documents(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version>0),
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 snapshot jsonb NOT NULL,
 snapshot_bytes bigint GENERATED ALWAYS AS(octet_length(snapshot::text)) STORED,
 PRIMARY KEY(document_id,version)
);
CREATE FUNCTION eru_document_snapshot(d community_documents) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_build_object('title',d.title,'summary',d.summary,'categoryId',d.category_id,'html',d.html,'license',d.license,'attribution',d.attribution,'status',d.status)
$$;
INSERT INTO community_document_versions(document_id,version,snapshot) SELECT id,version,eru_document_snapshot(community_documents) FROM community_documents;
CREATE FUNCTION eru_record_document_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 INSERT INTO community_document_versions(document_id,version,actor_id,snapshot) VALUES(NEW.id,NEW.version,nullif(current_setting('eru.actor_id',true),'')::uuid,eru_document_snapshot(NEW));
 RETURN NEW;
END $$;
CREATE TRIGGER eru_document_version_history AFTER INSERT OR UPDATE ON community_documents FOR EACH ROW EXECUTE FUNCTION eru_record_document_version();
CREATE INDEX community_document_versions_bytes ON community_document_versions(document_id) INCLUDE(snapshot_bytes);
CREATE TABLE community_document_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),document_id uuid NOT NULL REFERENCES community_documents(id) ON DELETE CASCADE,
 reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,document_version integer NOT NULL,reported_title text NOT NULL,
 reason_code varchar(32) NOT NULL CHECK(reason_code IN('unsafe','copyright','spam','other')),description varchar(2000) NOT NULL,
 state varchar(16) NOT NULL DEFAULT 'open' CHECK(state IN('open','resolved','dismissed')),version integer NOT NULL DEFAULT 1,
 resolution_reason varchar(2000),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_id,reporter_id,document_version)
);
CREATE INDEX community_reports_admin_state ON community_document_reports(state,created_at DESC,id DESC);
