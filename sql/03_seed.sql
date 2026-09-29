-- ==============================================================================
-- SENTIA HUB SERVICE - SEED DATA (SANITIZED / MOCK FOR DEMO & BENCHMARK)
-- 100% Mock data - An toàn tuyệt đối không lộ dữ liệu thật
-- ==============================================================================

-- 1. SEED CATEGORIES
INSERT INTO categories (id, name, slug, icon, description, display_order)
VALUES
    ('c0000000-0000-0000-0000-000000000001', 'Software Engineering', 'software-engineering', 'code', 'System design blueprints, API specs, and technical documentation', 1),
    ('c0000000-0000-0000-0000-000000000002', 'Project Management', 'project-management', 'trello', 'Sprint boards, meeting minutes, and roadmaps', 2),
    ('c0000000-0000-0000-0000-000000000003', 'Study & Research', 'study-research', 'book-open', 'Cornell note systems, flashcard formats, and paper summaries', 3),
    ('c0000000-0000-0000-0000-000000000004', 'Personal Productivity', 'personal-productivity', 'check-circle', 'Daily journals, habit trackers, and GTD systems', 4)
ON CONFLICT (id) DO NOTHING;

-- 2. SEED USERS (Password hash is bcrypt of 'Password123!')
INSERT INTO users (id, email, password_hash, role, is_active, email_verified_at)
VALUES
    ('u0000000-0000-0000-0000-000000000001', 'admin@sentiahub.local', '$2b$10$wT8Kz5cWqU5uJ.eL19XQtehC2qT2kZ/R0N2FjK5Q1qF2.s9N1sT6.', 'admin', TRUE, CURRENT_TIMESTAMP),
    ('u0000000-0000-0000-0000-000000000002', 'alex.dev@sentiahub.local', '$2b$10$wT8Kz5cWqU5uJ.eL19XQtehC2qT2kZ/R0N2FjK5Q1qF2.s9N1sT6.', 'creator', TRUE, CURRENT_TIMESTAMP),
    ('u0000000-0000-0000-0000-000000000003', 'sarah.pm@sentiahub.local', '$2b$10$wT8Kz5cWqU5uJ.eL19XQtehC2qT2kZ/R0N2FjK5Q1qF2.s9N1sT6.', 'creator', TRUE, CURRENT_TIMESTAMP),
    ('u0000000-0000-0000-0000-000000000004', 'david.student@sentiahub.local', '$2b$10$wT8Kz5cWqU5uJ.eL19XQtehC2qT2kZ/R0N2FjK5Q1qF2.s9N1sT6.', 'user', TRUE, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

-- 3. SEED PROFILES
INSERT INTO profiles (user_id, username, display_name, avatar_url, bio, reputation_score)
VALUES
    ('u0000000-0000-0000-0000-000000000001', 'admin', 'System Administrator', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150', 'Managing Sentia Hub Cloud Infrastructure', 999),
    ('u0000000-0000-0000-0000-000000000002', 'alex_architect', 'Alex Rivers', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150', 'Distributed systems & Clean Architecture enthusiast', 420),
    ('u0000000-0000-0000-0000-000000000003', 'sarah_agile', 'Sarah Chen', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150', 'Certified Scrum Master | Crafting clean product workflows', 310),
    ('u0000000-0000-0000-0000-000000000004', 'david_notes', 'David Miller', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150', 'CS Student @ Tech University | Note-taking addict', 85)
ON CONFLICT (user_id) DO NOTHING;

-- 4. SEED TEMPLATES
INSERT INTO templates (id, author_id, category_id, title, slug, description, content_json, version, is_public, is_featured, forks_count, views_count, rating_avg, ratings_count, tags)
VALUES
    (
        't0000000-0000-0000-0000-000000000001',
        'u0000000-0000-0000-0000-000000000002',
        'c0000000-0000-0000-0000-000000000001',
        'Clean Architecture Backend Blueprint',
        'clean-architecture-backend-blueprint',
        'A comprehensive template for structuring enterprise Node.js & Go microservices following Domain-Driven Design.',
        '{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "System Architecture Overview"}]}]}'::jsonb,
        '1.2.0',
        TRUE,
        TRUE,
        142,
        1890,
        4.92,
        38,
        ARRAY['clean-architecture', 'ddd', 'backend', 'typescript']
    ),
    (
        't0000000-0000-0000-0000-000000000002',
        'u0000000-0000-0000-0000-000000000003',
        'c0000000-0000-0000-0000-000000000002',
        'Agile Sprint Planning & Retro Matrix',
        'agile-sprint-planning-retro-matrix',
        'Complete two-week sprint workflow including backlog refinement, user story breakdown, and 4Ls retrospective.',
        '{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Sprint Goal & Deliverables"}]}]}'::jsonb,
        '2.0.0',
        TRUE,
        TRUE,
        98,
        1240,
        4.85,
        27,
        ARRAY['agile', 'scrum', 'sprint', 'management']
    ),
    (
        't0000000-0000-0000-0000-000000000003',
        'u0000000-0000-0000-0000-000000000004',
        'c0000000-0000-0000-0000-000000000003',
        'Cornell Method Interactive Study Notes',
        'cornell-method-interactive-study-notes',
        'Classic Cornell University format with dedicated Cue Column, Note Area, and Summary Section.',
        '{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Cornell Note Sheet"}]}]}'::jsonb,
        '1.0.0',
        TRUE,
        FALSE,
        64,
        830,
        4.70,
        18,
        ARRAY['cornell', 'study', 'productivity', 'education']
    )
ON CONFLICT (id) DO NOTHING;

-- 5. SEED RATINGS
INSERT INTO ratings (template_id, user_id, score, comment)
VALUES
    ('t0000000-0000-0000-0000-000000000001', 'u0000000-0000-0000-0000-000000000004', 5, 'Exceptional modular structure, saved me 3 days of scaffolding!'),
    ('t0000000-0000-0000-0000-000000000001', 'u0000000-0000-0000-0000-000000000003', 5, 'Great for onboarding new backend devs into our team.')
ON CONFLICT (template_id, user_id) DO NOTHING;
