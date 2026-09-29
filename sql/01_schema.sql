-- ==============================================================================
-- SENTIA HUB SERVICE - DATABASE SCHEMA (3NF NORMALIZED & EXTENSIBLE)
-- PostgreSQL 16
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 1. USERS TABLE (Account & Authentication)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'creator', 'admin')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    email_verified_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ NULL
);

-- ------------------------------------------------------------------------------
-- 2. PROFILES TABLE (Public Creator / User Information - 1:1 with users)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    username VARCHAR(64) NOT NULL UNIQUE,
    display_name VARCHAR(128) NOT NULL,
    avatar_url VARCHAR(512) NULL,
    bio TEXT NULL,
    website VARCHAR(255) NULL,
    reputation_score INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------------------------
-- 3. CATEGORIES TABLE (Template & Document taxonomy)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(64) NOT NULL UNIQUE,
    slug VARCHAR(64) NOT NULL UNIQUE,
    icon VARCHAR(64) NOT NULL DEFAULT 'folder',
    description VARCHAR(255) NULL,
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------------------------
-- 4. TEMPLATES TABLE (Core Community Marketplace Entity)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(280) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    content_json JSONB NOT NULL,
    thumbnail_url VARCHAR(512) NULL,
    version VARCHAR(32) NOT NULL DEFAULT '1.0.0',
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    is_featured BOOLEAN NOT NULL DEFAULT FALSE,
    forks_count INT NOT NULL DEFAULT 0 CHECK (forks_count >= 0),
    views_count INT NOT NULL DEFAULT 0 CHECK (views_count >= 0),
    rating_avg NUMERIC(3, 2) NOT NULL DEFAULT 0.00 CHECK (rating_avg >= 0.00 AND rating_avg <= 5.00),
    ratings_count INT NOT NULL DEFAULT 0 CHECK (ratings_count >= 0),
    tags TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ NULL
);

-- ------------------------------------------------------------------------------
-- 5. DOCUMENTS TABLE (Community Shared Notes & Docs Hub)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id UUID NULL REFERENCES templates(id) ON DELETE SET NULL,
    title VARCHAR(255) NOT NULL,
    slug VARCHAR(280) NOT NULL UNIQUE,
    content_markdown TEXT NOT NULL,
    content_json JSONB NULL,
    visibility VARCHAR(32) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'unlisted', 'private')),
    views_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TIMESTAMPTZ NULL
);

-- ------------------------------------------------------------------------------
-- 6. FORKS TABLE (Tracking lineage when a user clones a template/doc)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS forks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_template_id UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    forked_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_document_id UUID NULL REFERENCES documents(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (original_template_id, forked_by_user_id)
);

-- ------------------------------------------------------------------------------
-- 7. RATINGS TABLE (Star reviews 1-5 with Anti-Spam unique constraint)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    score SMALLINT NOT NULL CHECK (score >= 1 AND score <= 5),
    comment VARCHAR(500) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (template_id, user_id)
);

-- ------------------------------------------------------------------------------
-- 8. NOTIFICATIONS TABLE (Event alerts - Producer/Consumer ready)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(64) NOT NULL, -- e.g. 'template.forked', 'template.rated'
    title VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ------------------------------------------------------------------------------
-- 9. AUDIT_LOGS TABLE (Security & Compliance Tracking)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id UUID NULL,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(512) NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
