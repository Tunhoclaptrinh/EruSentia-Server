-- ==============================================================================
-- SENTIA HUB SERVICE - SEED DATA (RICH REALISTIC TEMPLATES FOR ERUSENTIA)
-- 100% Valid UUIDs (Hexadecimal 0-9, a-f) & Khớp hoàn toàn với EruSentia blocks
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SEED CATEGORIES (8 Danh mục phong phú)
-- ------------------------------------------------------------------------------
INSERT INTO categories (id, name, slug, icon, description, display_order)
VALUES
    ('c0000000-0000-0000-0000-000000000001', 'Software Engineering', 'software-engineering', 'code', 'System design blueprints, API specs, and technical documentation', 1),
    ('c0000000-0000-0000-0000-000000000002', 'Project Management', 'project-management', 'trello', 'Sprint boards, meeting minutes, and roadmaps', 2),
    ('c0000000-0000-0000-0000-000000000003', 'Study & Research', 'study-research', 'book-open', 'Cornell note systems, flashcard formats, and paper summaries', 3),
    ('c0000000-0000-0000-0000-000000000004', 'Personal Productivity', 'personal-productivity', 'check-circle', 'Daily journals, habit trackers, and GTD systems', 4),
    ('c0000000-0000-0000-0000-000000000005', 'Education & Teaching', 'education-teaching', 'graduation-cap', 'Lecture slides, interactive quizzes, and course outlines', 5),
    ('c0000000-0000-0000-0000-000000000006', 'Science & Mathematics', 'science-math', 'atom', 'Math plotters, scientific lab reports, and physics models', 6),
    ('c0000000-0000-0000-0000-000000000007', 'Creative & Brainstorming', 'creative-brainstorming', 'lightbulb', 'Whiteboards, mindmaps, and storytelling outlines', 7),
    ('c0000000-0000-0000-0000-000000000008', 'Business & Strategy', 'business-strategy', 'briefcase', 'Pitch decks, business model canvas, and financial trackers', 8)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

-- ------------------------------------------------------------------------------
-- 2. SEED USERS (10 Người dùng với UUID chuẩn a0000000...)
-- Password hash: bcrypt of 'Password123!'
-- ------------------------------------------------------------------------------
INSERT INTO users (id, email, password_hash, role, is_active, email_verified_at)
VALUES
    ('a0000000-0000-0000-0000-000000000001', 'admin@sentiahub.local', '$2b$10$wT8Kz5cWqU5uJ.eL19XQtehC2qT2kZ/R0N2FjK5Q1qF2.s9N1sT6.', 'admin', TRUE, CURRENT_TIMESTAMP),
    ('a0000000-0000-0000-0000-000000000002', 'alex.dev@sentiahub.local', '$2b$10$wT8Kz5cWqU5uJ.eL19XQtehC2qT2kZ/R0N2FjK5Q1qF2.s9N1sT6.', 'creator', TRUE, CURRENT_TIMESTAMP),
    ('a0000000-0000-0000-0000-000000000003', 'sarah.pm@sentiahub.local', '$2b$10$wT8Kz5cWqU5uJ.eL19XQtehC2qT2kZ/R0N2FjK5Q1qF2.s9N1sT6.', 'creator', TRUE, CURRENT_TIMESTAMP),
    ('a0000000-0000-0000-0000-000000000004', 'david.student@sentiahub.local', '$2b$10$wT8Kz5cWqU5uJ.eL19XQtehC2qT2kZ/R0N2FjK5Q1qF2.s9N1sT6.', 'user', TRUE, CURRENT_TIMESTAMP),
    ('a0000000-0000-0000-0000-000000000005', 'elena.teacher@sentiahub.local', '$2b$10$wT8Kz5cWqU5uJ.eL19XQtehC2qT2kZ/R0N2FjK5Q1qF2.s9N1sT6.', 'creator', TRUE, CURRENT_TIMESTAMP),
    ('a0000000-0000-0000-0000-000000000006', 'marcus.science@sentiahub.local', '$2b$10$wT8Kz5cWqU5uJ.eL19XQtehC2qT2kZ/R0N2FjK5Q1qF2.s9N1sT6.', 'creator', TRUE, CURRENT_TIMESTAMP),
    ('a0000000-0000-0000-0000-000000000007', 'clara.design@sentiahub.local', '$2b$10$wT8Kz5cWqU5uJ.eL19XQtehC2qT2kZ/R0N2FjK5Q1qF2.s9N1sT6.', 'creator', TRUE, CURRENT_TIMESTAMP),
    ('a0000000-0000-0000-0000-000000000008', 'tom.business@sentiahub.local', '$2b$10$wT8Kz5cWqU5uJ.eL19XQtehC2qT2kZ/R0N2FjK5Q1qF2.s9N1sT6.', 'user', TRUE, CURRENT_TIMESTAMP),
    ('a0000000-0000-0000-0000-000000000009', 'linda.writer@sentiahub.local', '$2b$10$wT8Kz5cWqU5uJ.eL19XQtehC2qT2kZ/R0N2FjK5Q1qF2.s9N1sT6.', 'user', TRUE, CURRENT_TIMESTAMP),
    ('a0000000-0000-0000-0000-000000000010', 'kevin.student@sentiahub.local', '$2b$10$wT8Kz5cWqU5uJ.eL19XQtehC2qT2kZ/R0N2FjK5Q1qF2.s9N1sT6.', 'user', TRUE, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;

-- ------------------------------------------------------------------------------
-- 3. SEED PROFILES
-- ------------------------------------------------------------------------------
INSERT INTO profiles (user_id, username, display_name, avatar_url, bio, reputation_score)
VALUES
    ('a0000000-0000-0000-0000-000000000001', 'admin', 'System Administrator', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150', 'Managing Sentia Hub Cloud Infrastructure', 999),
    ('a0000000-0000-0000-0000-000000000002', 'alex_architect', 'Alex Rivers', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150', 'Software Architect | Clean Code & Cloud native templates', 520),
    ('a0000000-0000-0000-0000-000000000003', 'sarah_agile', 'Sarah Chen', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150', 'Agile Coach & Scrum Master | Streamlining team workflows', 410),
    ('a0000000-0000-0000-0000-000000000004', 'david_notes', 'David Miller', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150', 'Computer Science student @ Tech University', 95),
    ('a0000000-0000-0000-0000-000000000005', 'elena_edu', 'Prof. Elena Rostova', 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150', 'Education Specialist | Crafting active learning notes & slides', 680),
    ('a0000000-0000-0000-0000-000000000006', 'marcus_stem', 'Dr. Marcus Vance', 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=150', 'Physics Researcher | Math plotter and scientific simulations', 350),
    ('a0000000-0000-0000-0000-000000000007', 'clara_ux', 'Clara Belle', 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=150', 'Design Lead | Visual notes, mindmaps, and whiteboard templates', 290),
    ('a0000000-0000-0000-0000-000000000008', 'tom_ventures', 'Tom Harrison', 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=150', 'Startup founder | Strategy frameworks & business planners', 180),
    ('a0000000-0000-0000-0000-000000000009', 'linda_words', 'Linda Nguyen', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150', 'Author & Copywriter | Character sheets and novel plotting', 140),
    ('a0000000-0000-0000-0000-000000000010', 'kevin_study', 'Kevin Park', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150', 'High School Math & Science student | Flashcard fanatic', 80)
ON CONFLICT (user_id) DO UPDATE SET display_name = EXCLUDED.display_name, bio = EXCLUDED.bio;

-- ------------------------------------------------------------------------------
-- 4. SEED TEMPLATES (12 Mẫu Template tiêu biểu khớp hoàn toàn với EruSentia)
-- ID chuẩn b0000000...
-- ------------------------------------------------------------------------------
INSERT INTO templates (id, author_id, category_id, title, slug, description, content_json, version, is_public, is_featured, forks_count, views_count, rating_avg, ratings_count, tags)
VALUES
    -- 1. Clean Architecture Blueprint
    (
        'b0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000002',
        'c0000000-0000-0000-0000-000000000001',
        'Clean Architecture Backend Blueprint',
        'clean-architecture-backend-blueprint',
        'Cấu trúc mẫu cho dự án Backend 4 tầng (Domain, Application, Infrastructure, Presentation) áp dụng DDD.',
        '{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Clean Architecture Blueprint"}]}, {"type": "paragraph", "content": [{"type": "text", "text": "Định nghĩa ranh giới giữa Domain thuần túy và Infrastructure adapter."}]}]}'::jsonb,
        '1.2.0', TRUE, TRUE, 142, 2150, 4.92, 38,
        ARRAY['clean-architecture', 'ddd', 'backend', 'typescript']
    ),
    -- 2. Agile Sprint Planning & 4Ls Retro
    (
        'b0000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000003',
        'c0000000-0000-0000-0000-000000000002',
        'Agile Sprint Planning & Retro Matrix',
        'agile-sprint-planning-retro-matrix',
        'Mẫu quản lý Sprint 2 tuần hoàn chỉnh gồm Backlog refinement, User stories và bảng hồi tưởng 4Ls (Liked, Learned, Lacked, Longed for).',
        '{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Sprint 24: Planning & Retro"}]}]}'::jsonb,
        '2.0.0', TRUE, TRUE, 118, 1680, 4.86, 29,
        ARRAY['agile', 'scrum', 'sprint', 'kanban']
    ),
    -- 3. Cornell Method Interactive Study Notes
    (
        'b0000000-0000-0000-0000-000000000003',
        'a0000000-0000-0000-0000-000000000004',
        'c0000000-0000-0000-0000-000000000003',
        'Cornell Method Interactive Study Notes',
        'cornell-method-interactive-study-notes',
        'Định dạng Cornell kinh điển gồm Cột gợi ý (Cue Column), Khu vực ghi chú (Note Taking Area) và Phần tổng kết (Summary).',
        '{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Cornell Study Template"}]}]}'::jsonb,
        '1.1.0', TRUE, TRUE, 260, 3420, 4.95, 62,
        ARRAY['cornell', 'study', 'education', 'note-taking']
    ),
    -- 4. Interactive Flashcards for Active Recall
    (
        'b0000000-0000-0000-0000-000000000004',
        'a0000000-0000-0000-0000-000000000005',
        'c0000000-0000-0000-0000-000000000003',
        'Interactive Flashcard Deck & Spaced Repetition',
        'interactive-flashcard-deck-spaced-repetition',
        'Bộ thẻ học ghi nhớ thông minh 2 mặt hỗ trợ lật thẻ và đánh giá độ khó phục vụ thuật toán lặp lại ngắt quãng (Spaced Repetition).',
        '{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Vocabulary & Concept Flashcards"}]}]}'::jsonb,
        '1.3.0', TRUE, TRUE, 185, 2590, 4.88, 44,
        ARRAY['flashcard', 'spaced-repetition', 'learning', 'quiz']
    ),
    -- 5. Daily Pomodoro Journal & Task Tracker
    (
        'b0000000-0000-0000-0000-000000000005',
        'a0000000-0000-0000-0000-000000000004',
        'c0000000-0000-0000-0000-000000000004',
        'Daily Pomodoro Journal & Deep Work Tracker',
        'daily-pomodoro-journal-deep-work-tracker',
        'Kế hoạch làm việc tập trung sâu chia theo phiên Pomodoro 25/5, nhật ký thói quen và đánh giá năng lượng cuối ngày.',
        '{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Deep Work Pomodoro Log"}]}]}'::jsonb,
        '1.0.0', TRUE, FALSE, 92, 1140, 4.65, 21,
        ARRAY['pomodoro', 'productivity', 'habits', 'journal']
    ),
    -- 6. Interactive Mathematical Plotter & Calculus Notes
    (
        'b0000000-0000-0000-0000-000000000006',
        'a0000000-0000-0000-0000-000000000006',
        'c0000000-0000-0000-0000-000000000006',
        'Mathematical Function Plotter & Calculus Guide',
        'math-plotter-calculus-guide',
        'Tài liệu giải tích tương tác nhúng sẵn công cụ vẽ đồ thị hàm số 2D/3D và công thức LaTeX toán học chuẩn mực.',
        '{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Calculus II: Integrals and Series"}]}]}'::jsonb,
        '1.0.0', TRUE, TRUE, 74, 980, 4.78, 19,
        ARRAY['math', 'calculus', 'plotter', 'stem', 'latex']
    ),
    -- 7. Solar System & Planetary Science Lab Note
    (
        'b0000000-0000-0000-0000-000000000007',
        'a0000000-0000-0000-0000-000000000006',
        'c0000000-0000-0000-0000-000000000006',
        'Solar System & Astrophysics Interactive Lab',
        'solar-system-astrophysics-lab',
        'Mẫu tài liệu thiên văn học với widget quỹ đạo hành tinh tương tác, bảng dữ liệu khối lượng và chu kỳ quỹ đạo.',
        '{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Astrophysics: Orbital Mechanics"}]}]}'::jsonb,
        '1.0.0', TRUE, FALSE, 58, 810, 4.82, 14,
        ARRAY['astronomy', 'physics', 'interactive', 'science']
    ),
    -- 8. Visual Whiteboard & System Architecture Diagram
    (
        'b0000000-0000-0000-0000-000000000008',
        'a0000000-0000-0000-0000-000000000007',
        'c0000000-0000-0000-0000-000000000007',
        'Visual Whiteboard & Architecture Canvas',
        'visual-whiteboard-architecture-canvas',
        'Bảng vẽ vô hạn (Infinite Canvas) cho phép vẽ sơ đồ tư duy, liên kết các block dữ liệu và thiết kế kiến trúc hệ thống.',
        '{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "System Architecture Canvas"}]}]}'::jsonb,
        '1.5.0', TRUE, TRUE, 210, 2980, 4.90, 51,
        ARRAY['whiteboard', 'canvas', 'diagram', 'mindmap', 'design']
    ),
    -- 9. Academic Lecture Presentation Slide Deck
    (
        'b0000000-0000-0000-0000-000000000009',
        'a0000000-0000-0000-0000-000000000005',
        'c0000000-0000-0000-0000-000000000005',
        'Academic Lecture Slide Deck & Presenter Mode',
        'academic-lecture-slide-deck',
        'Mẫu soạn slide bài giảng trực tiếp trong note, hỗ trợ chuyển trang thuyết trình và ghi chú riêng cho diễn giả.',
        '{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Introduction to Computer Science"}]}]}'::jsonb,
        '1.0.0', TRUE, FALSE, 83, 1220, 4.72, 18,
        ARRAY['slides', 'presentation', 'lecture', 'teaching']
    ),
    -- 10. Startup Pitch Deck & Business Model Canvas
    (
        'b0000000-0000-0000-0000-000000000010',
        'a0000000-0000-0000-0000-000000000008',
        'c0000000-0000-0000-0000-000000000008',
        'Business Model Canvas & Investor Pitch Deck',
        'business-model-canvas-pitch-deck',
        'Khung lập kế hoạch kinh doanh 9 khối (Value Propositions, Channels, Revenue Streams...) kèm cấu trúc slide gọi vốn 10 trang.',
        '{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "EruSentia Business Model Canvas"}]}]}'::jsonb,
        '2.1.0', TRUE, TRUE, 134, 1820, 4.85, 32,
        ARRAY['business', 'startup', 'pitch-deck', 'canvas', 'strategy']
    ),
    -- 11. Interactive Student Quiz & Assessment Sheet
    (
        'b0000000-0000-0000-0000-000000000011',
        'a0000000-0000-0000-0000-000000000005',
        'c0000000-0000-0000-0000-000000000005',
        'Self-Grading Quiz & Examination Template',
        'self-grading-quiz-examination-template',
        'Bộ đề kiểm tra trắc nghiệm tương tác tự động chấm điểm, hiển thị lời giải chi tiết và biểu đồ phân tích kết quả làm bài.',
        '{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "Midterm Exam: Algorithms & Data Structures"}]}]}'::jsonb,
        '1.2.0', TRUE, FALSE, 112, 1490, 4.79, 27,
        ARRAY['quiz', 'exam', 'assessment', 'education']
    ),
    -- 12. Meeting Minutes & Action Items Tracker
    (
        'b0000000-0000-0000-0000-000000000012',
        'a0000000-0000-0000-0000-000000000003',
        'c0000000-0000-0000-0000-000000000002',
        'Executive Meeting Minutes & Action Items',
        'executive-meeting-minutes-action-items',
        'Biên bản cuộc họp chuyên nghiệp gồm Người tham dự, Quyết định đạt được, Bảng việc cần làm (Action Items) gán cho từng người.',
        '{"type": "doc", "content": [{"type": "heading", "attrs": {"level": 1}, "content": [{"type": "text", "text": "All-Hands Architecture Meeting"}]}]}'::jsonb,
        '1.0.0', TRUE, FALSE, 65, 870, 4.68, 15,
        ARRAY['meeting', 'minutes', 'collaboration', 'management']
    )
ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, description = EXCLUDED.description, content_json = EXCLUDED.content_json;

-- ------------------------------------------------------------------------------
-- 5. SEED RATINGS (Đánh giá chất lượng đa dạng)
-- ------------------------------------------------------------------------------
INSERT INTO ratings (template_id, user_id, score, comment)
VALUES
    ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', 5, 'Kiến trúc quá sạch sẽ, tiết kiệm được cả tuần dựng khung cho team!'),
    ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 5, 'Rất hợp với các bạn học backend muốn hiểu về Domain Purity.'),
    ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004', 5, 'Mẫu Cornell tốt nhất mình từng dùng trên app ghi chú.'),
    ('b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000010', 5, 'Học thuộc bài nhanh gấp 3 lần nhờ cột Cue và Summary.'),
    ('b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000010', 5, 'Tính năng lật thẻ mượt mà, ôn thi từ vựng tiếng Anh đỉnh chóp.'),
    ('b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000002', 5, 'Bảng Whiteboard vẽ kiến trúc trực quan, không cần bật thêm Miro.')
ON CONFLICT (template_id, user_id) DO UPDATE SET score = EXCLUDED.score, comment = EXCLUDED.comment;

-- ------------------------------------------------------------------------------
-- 6. SEED FORKS (Ghi nhận lượt sao chép template về app EruSentia)
-- ------------------------------------------------------------------------------
INSERT INTO forks (id, original_template_id, forked_by_user_id)
VALUES
    ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004'),
    ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004'),
    ('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000010'),
    ('f0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000010'),
    ('f0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000002')
ON CONFLICT (original_template_id, forked_by_user_id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 7. SEED NOTIFICATIONS (Thông báo sự kiện)
-- ------------------------------------------------------------------------------
INSERT INTO notifications (id, recipient_id, actor_id, type, title, payload, is_read)
VALUES
    (
        'e0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000004',
        'template.forked',
        'David vừa fork template Clean Architecture Blueprint của bạn!',
        '{"template_id": "b0000000-0000-0000-0000-000000000001"}'::jsonb,
        FALSE
    ),
    (
        'e0000000-0000-0000-0000-000000000002',
        'a0000000-0000-0000-0000-000000000004',
        'a0000000-0000-0000-0000-000000000010',
        'template.rated',
        'Kevin đã đánh giá 5 sao cho template Cornell Notes của bạn!',
        '{"score": 5, "template_id": "b0000000-0000-0000-0000-000000000003"}'::jsonb,
        FALSE
    )
ON CONFLICT (id) DO NOTHING;
