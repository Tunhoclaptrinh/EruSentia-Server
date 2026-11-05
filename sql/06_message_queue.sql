-- Week 4: registration outbox + consumer inbox/delivery ledger. Apply explicitly.
BEGIN;
CREATE TABLE IF NOT EXISTS message_outbox (
    id UUID PRIMARY KEY,
    event_type VARCHAR(80) NOT NULL,
    payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    published_at TIMESTAMPTZ NULL
);
CREATE INDEX IF NOT EXISTS message_outbox_pending_idx ON message_outbox (created_at, id) WHERE published_at IS NULL;
CREATE TABLE IF NOT EXISTS welcome_email_deliveries (
    event_id UUID PRIMARY KEY REFERENCES message_outbox(id),
    user_id UUID NOT NULL REFERENCES users(id),
    status VARCHAR(16) NOT NULL CHECK (status IN ('sent', 'skipped')),
    message_id VARCHAR(120) NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMIT;
