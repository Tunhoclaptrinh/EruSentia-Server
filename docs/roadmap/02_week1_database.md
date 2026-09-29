# 📅 TUẦN 1: CƠ SỞ DỮ LIỆU & LẬP TRÌNH HƯỚNG ĐỐI TƯỢNG
**Thời gian:** 28/09/2026 – 02/10/2026  
**Ref TYP:** Tuần 1 — Database & OOP  
**Module EruSentia:** Thiết kế toàn bộ schema Database cho Cloud Layer

---

## 🎯 MỤC TIÊU TUẦN NÀY

Theo yêu cầu TYP: *"Database có dữ liệu mẫu, thực hành SQL, demo Index/Locking và trình bày lý thuyết"*

Áp dụng vào EruSentia: Tuần 1 thiết kế **schema nền tảng** — đây là quyết định quan trọng nhất vì schema sai → sửa cực khó về sau. Dành thêm thời gian nghĩ kỹ trước khi gõ.

---

## 📅 LỊCH BIỂU TỪNG NGÀY

### 🗓️ Thứ 2 — 28/09 (Hôm nay): SQL Cơ Bản & Thiết Kế Schema

**Buổi sáng: Lý thuyết (2-3 tiếng)**
- [ ] Cài Docker + chạy `docker compose up -d` (xem file compose bên dưới)
- [ ] Kết nối Adminer: http://localhost:8080
- [ ] Ôn lại SQL cơ bản: SELECT, WHERE, JOIN (INNER / LEFT / RIGHT / FULL)
- [ ] GROUP BY + HAVING + ORDER BY + Aggregate (COUNT, SUM, AVG, MAX, MIN)
- [ ] DDL: CREATE TABLE, ALTER TABLE, DROP, TRUNCATE
- [ ] DML: INSERT, UPDATE, DELETE

**Buổi chiều: Thực hành — Thiết kế Schema EruSentia (3-4 tiếng)**
- [ ] Đọc kỹ `ecosystem_and_hub_architecture.md` §2 (Template Hub) và §3 (Document Hub)
- [ ] Tự vẽ ERD (Entity Relationship Diagram) ra giấy/draw.io trước khi code
- [ ] Tạo file `sql/01_schema.sql` và viết toàn bộ CREATE TABLE

**ERD cần thiết kế:**
```
users ──┬── templates (author_id → users.id)
        ├── documents (author_id → users.id)
        └── forks     (user_id  → users.id)

documents ── document_notes (document_id → documents.id)
templates ── template_downloads (template_id → templates.id)

ratings ── (target_id: template hoặc document — polymorphic)
notifications ── users (user_id → users.id)
user_sessions ── users (user_id → users.id)
```

**SQL Schema đầy đủ (copy vào `sql/01_schema.sql`):**

```sql
-- ═══════════════════════════════════════════════════════
-- ERUSENTIA DATABASE SCHEMA v1.0
-- Ngày tạo: 28/09/2026
-- Mọi thay đổi sau này → dùng migration, KHÔNG sửa file này
-- ═══════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── USERS ─────────────────────────────────────────────
CREATE TABLE users (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email               VARCHAR(255) UNIQUE NOT NULL,
  username            VARCHAR(100) UNIQUE NOT NULL,
  display_name        VARCHAR(200),
  avatar_url          TEXT,
  bio                 TEXT,
  role                VARCHAR(50)  NOT NULL DEFAULT 'user',
    -- 'user' | 'creator' | 'admin'
  password_hash       VARCHAR(255),
  refresh_token_hash  VARCHAR(255),
  is_verified         BOOLEAN      NOT NULL DEFAULT false,
  is_banned           BOOLEAN      NOT NULL DEFAULT false,
  social_links        JSONB        DEFAULT '{}',
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── TEMPLATES ─────────────────────────────────────────
-- Kho Template Marketplace (Canva-style Hub)
-- Ref: ecosystem_and_hub_architecture.md §2
CREATE TABLE templates (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(500) NOT NULL,
  slug            VARCHAR(600) UNIQUE NOT NULL,
  description     TEXT,
  short_desc      VARCHAR(300),
  category        VARCHAR(100) NOT NULL,
    -- 'education' | 'work' | 'presentation' | 'thinking' | 'personal'
  tags            TEXT[]       NOT NULL DEFAULT '{}',
  thumbnail_url   TEXT,
  html_content    TEXT         NOT NULL,
  schema_json     JSONB,
  template_type   VARCHAR(50)  NOT NULL DEFAULT 'full',
    -- 'full' (có Visual Inspector) | 'semi' (chỉ Code Editor)
  download_count  INT          NOT NULL DEFAULT 0,
  view_count      INT          NOT NULL DEFAULT 0,
  is_public       BOOLEAN      NOT NULL DEFAULT true,
  price_vnd       INT          NOT NULL DEFAULT 0,
  status          VARCHAR(50)  NOT NULL DEFAULT 'published',
    -- 'draft' | 'published' | 'hidden' | 'flagged'
  shadow_markdown TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── DOCUMENTS ─────────────────────────────────────────
-- Kho Tài Liệu Học Thuật (Studocu-style Hub)
-- Ref: ecosystem_and_hub_architecture.md §3
CREATE TABLE documents (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title           VARCHAR(500) NOT NULL,
  slug            VARCHAR(600) UNIQUE NOT NULL,
  description     TEXT,
  short_desc      VARCHAR(300),
  university      VARCHAR(300),
  faculty         VARCHAR(300),
  subject         VARCHAR(300),
  course_code     VARCHAR(100),
  academic_year   VARCHAR(50),
  semester        SMALLINT,
  tags            TEXT[]       NOT NULL DEFAULT '{}',
  thumbnail_url   TEXT,
  fork_count      INT          NOT NULL DEFAULT 0,
  view_count      INT          NOT NULL DEFAULT 0,
  notes_count     INT          NOT NULL DEFAULT 0,
  is_public       BOOLEAN      NOT NULL DEFAULT true,
  price_vnd       INT          NOT NULL DEFAULT 0,
  status          VARCHAR(50)  NOT NULL DEFAULT 'published',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── DOCUMENT_NOTES ─────────────────────────────────────
CREATE TABLE document_notes (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID         NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  title           VARCHAR(500),
  html_content    TEXT         NOT NULL,
  shadow_markdown TEXT,
  order_index     INT          NOT NULL DEFAULT 0,
  word_count      INT          NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── FORKS ──────────────────────────────────────────────
-- Git-style knowledge inheritance
-- Ref: ecosystem_and_hub_architecture.md §5
CREATE TABLE forks (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_type       VARCHAR(50)  NOT NULL, -- 'template' | 'document'
  source_id         UUID         NOT NULL,
  source_title      VARCHAR(500),
  source_author_id  UUID,
  forked_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, source_type, source_id)
);

-- ── RATINGS ────────────────────────────────────────────
CREATE TABLE ratings (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type VARCHAR(50)  NOT NULL, -- 'template' | 'document'
  target_id   UUID         NOT NULL,
  stars       SMALLINT     NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, target_type, target_id)
);

-- ── NOTIFICATIONS ──────────────────────────────────────
-- Ghi bởi RabbitMQ Consumer (Tuần 4)
CREATE TABLE notifications (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(100) NOT NULL,
    -- 'fork_received' | 'template_download' | 'new_rating' | 'system'
  payload     JSONB        NOT NULL DEFAULT '{}',
  is_read     BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── TEMPLATE_DOWNLOADS ─────────────────────────────────
-- Tách riêng để tránh write-storm (Tuần 4: batch update qua Queue)
CREATE TABLE template_downloads (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   UUID         NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  user_id       UUID         REFERENCES users(id) ON DELETE SET NULL,
  ip_hash       VARCHAR(64),
  downloaded_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── USER_SESSIONS ──────────────────────────────────────
-- Track refresh token (revoke khi logout)
CREATE TABLE user_sessions (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_jti VARCHAR(255) UNIQUE NOT NULL,
  device_info       TEXT,
  ip_address        INET,
  expires_at        TIMESTAMPTZ  NOT NULL,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_used_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

**Commit sau khi xong:**
```bash
git add sql/01_schema.sql
git commit -m "feat(db): add initial schema - 8 tables for EruSentia Cloud layer"
```

---

### 🗓️ Thứ 3 — 29/09: Transaction & ACID

**Buổi sáng: Lý thuyết Transaction**
- [ ] ACID: Atomicity, Consistency, Isolation, Durability — ví dụ thực tế với EruSentia
- [ ] COMMIT và ROLLBACK — khi nào dùng
- [ ] Isolation levels: READ UNCOMMITTED → SERIALIZABLE — trade-off là gì?
- [ ] Dirty Read, Non-repeatable Read, Phantom Read — mỗi level ngăn được cái gì?

**Buổi chiều: Demo Locking (bài tập TYP yêu cầu)**

Mở **2 cửa sổ terminal psql** chạy đồng thời:

```sql
-- TERMINAL 1: Pessimistic Locking demo
-- Bài toán: 2 người cùng fork document tại 1 thời điểm
-- Phải đảm bảo fork_count tăng chính xác

BEGIN;
SELECT fork_count FROM documents WHERE id = 'xxx' FOR UPDATE;
-- Terminal 2 sẽ bị BLOCK ở đây

-- Giả lập xử lý (2 giây)
SELECT pg_sleep(2);
UPDATE documents SET fork_count = fork_count + 1 WHERE id = 'xxx';
COMMIT;  -- Lúc này Terminal 2 mới chạy tiếp được
```

```sql
-- TERMINAL 2: Chạy ngay sau Terminal 1
BEGIN;
SELECT fork_count FROM documents WHERE id = 'xxx' FOR UPDATE;
-- BỊ BLOCK! Phải đợi Terminal 1 COMMIT
-- Sau khi Terminal 1 COMMIT, Terminal 2 đọc giá trị mới (fork_count đã tăng)
UPDATE documents SET fork_count = fork_count + 1 WHERE id = 'xxx';
COMMIT;
```

```sql
-- Optimistic Locking demo (dùng version column)
-- Thêm cột version:
ALTER TABLE documents ADD COLUMN version INT NOT NULL DEFAULT 0;

-- Terminal 1:
BEGIN;
SELECT id, fork_count, version FROM documents WHERE id = 'xxx';
-- Giả sử version = 5
UPDATE documents
SET fork_count = fork_count + 1, version = version + 1
WHERE id = 'xxx' AND version = 5;  -- Chỉ update nếu version khớp
-- Affected rows = 1 → thành công
COMMIT;

-- Terminal 2 (chạy sau khi T1 commit):
BEGIN;
SELECT id, fork_count, version FROM documents WHERE id = 'xxx';
-- version bây giờ = 6 (T1 đã tăng)
UPDATE documents
SET fork_count = fork_count + 1, version = version + 1
WHERE id = 'xxx' AND version = 5;  -- version cũ = 5, không khớp!
-- Affected rows = 0 → CONFLICT! → Application phải retry
COMMIT;
```

**Ghi chú cho báo cáo:**
> - Pessimistic Locking: block ngay, an toàn, nhưng chậm nếu nhiều concurrent user
> - Optimistic Locking: không block, nhanh hơn, nhưng phải retry khi conflict
> - EruSentia dùng Pessimistic cho fork (ưu tiên tính đúng đắn hơn tốc độ)

**Commit:**
```bash
git commit -m "docs(db): add locking demo notes and transaction examples"
```

---

### 🗓️ Thứ 4 — 30/09: Index & EXPLAIN ANALYZE

**Buổi sáng: Lý thuyết Index**
- [ ] B-tree index: cấu trúc, hoạt động thế nào, trường hợp nên dùng
- [ ] Hash index: tốt cho `=` nhưng không dùng được cho `<`, `>`, `LIKE`
- [ ] GIN index: cho array (TEXT[]) và JSONB
- [ ] Composite index: thứ tự cột quan trọng (leftmost prefix rule)
- [ ] Khi nào KHÔNG nên đánh index: bảng nhỏ, cột cardinality thấp (boolean), write-heavy table

**Buổi chiều: Thực hành Index + Đo EXPLAIN ANALYZE**

```sql
-- BƯỚC 1: Seed dữ liệu 5000 templates (để thấy sự khác biệt)
INSERT INTO users (email, username, role)
SELECT
  'user' || i || '@test.com',
  'user_' || i,
  CASE WHEN i % 10 = 0 THEN 'creator' ELSE 'user' END
FROM generate_series(1, 100) i;

INSERT INTO templates (author_id, title, slug, category, tags, html_content, status)
SELECT
  (SELECT id FROM users ORDER BY RANDOM() LIMIT 1),
  'Template ' || i,
  'template-' || i || '-' || substr(md5(random()::text), 1, 8),
  (ARRAY['education','work','presentation','thinking','personal'])[1 + (i % 5)],
  ARRAY['tag' || (i%10), 'tag' || (i%7)],
  '<html><body>Template ' || i || '</body></html>',
  'published'
FROM generate_series(1, 5000) i;
```

```sql
-- BƯỚC 2: ĐO TRƯỚC KHI TẠO INDEX (GHI LẠI SỐ MS!)
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, title, download_count
FROM templates
WHERE category = 'education'
  AND status = 'published'
ORDER BY download_count DESC
LIMIT 20;

-- Ghi vào bảng số liệu: "BEFORE index: ___ms, Seq Scan"
```

```sql
-- BƯỚC 3: Tạo index
-- Index đơn
CREATE INDEX idx_templates_category ON templates(category)
  WHERE status = 'published';          -- Partial index: chỉ index published

-- Index composite (category + download_count)
CREATE INDEX idx_templates_category_popular
  ON templates(category, download_count DESC)
  WHERE status = 'published';

-- GIN index cho tags array
CREATE INDEX idx_templates_tags ON templates USING GIN(tags);

-- Index cho documents
CREATE INDEX idx_documents_university_subject
  ON documents(university, subject)
  WHERE status = 'published';

-- Index cho notifications (unread first, mới nhất lên đầu)
CREATE INDEX idx_notifs_user_unread
  ON notifications(user_id, is_read, created_at DESC);

-- Commit file index:
-- git add sql/02_indexes.sql
```

```sql
-- BƯỚC 4: ĐO SAU KHI TẠO INDEX (GHI LẠI SỐ MS!)
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, title, download_count
FROM templates
WHERE category = 'education'
  AND status = 'published'
ORDER BY download_count DESC
LIMIT 20;

-- Ghi vào bảng số liệu: "AFTER index: ___ms, Index Scan"
-- Kết quả mong đợi: nhanh hơn 20x-100x!
```

**Bảng số liệu (điền vào và đưa vào báo cáo tuần 6):**

| Query | Execution Plan | Time |
|---|---|---|
| `WHERE category='education' ORDER BY download_count` | Seq Scan | ___ms |
| `WHERE category='education' ORDER BY download_count` (sau index) | Index Scan | ___ms |
| `WHERE tags @> ARRAY['tag1']` | Seq Scan | ___ms |
| `WHERE tags @> ARRAY['tag1']` (sau GIN index) | Bitmap Index Scan | ___ms |

**Commit:**
```bash
git add sql/02_indexes.sql
git commit -m "feat(db): add index strategy - measured Xms → Yms improvement"
```

---

### 🗓️ Thứ 5 — 01/10: Pagination

**Buổi sáng: Lý thuyết Pagination**

**Offset-based (dễ implement, có vấn đề ở trang lớn):**
```sql
-- Cách hoạt động: skip N rows rồi lấy LIMIT
SELECT * FROM templates
WHERE status = 'published'
ORDER BY created_at DESC
LIMIT 20 OFFSET 200;   -- Trang 11 (mỗi trang 20)

-- Vấn đề: OFFSET 10000 → DB phải scan qua 10000 rows rồi bỏ
-- Càng trang sau càng chậm
```

**Cursor-based (phức tạp hơn, hiệu năng tốt hơn):**
```sql
-- Lần đầu:
SELECT id, title, created_at FROM templates
WHERE status = 'published'
ORDER BY created_at DESC, id DESC   -- Luôn sort 2 cột để đảm bảo unique
LIMIT 20;
-- Lấy cursor = created_at của row cuối: "2026-10-01T10:00:00Z" + id cuối

-- Trang tiếp theo (dùng cursor):
SELECT id, title, created_at FROM templates
WHERE status = 'published'
  AND (created_at, id) < ('2026-10-01T10:00:00Z', 'last-id-uuid')
ORDER BY created_at DESC, id DESC
LIMIT 20;
-- Ưu điểm: nhanh như nhau dù trang 1 hay trang 1000
```

**Buổi chiều: Viết Pagination cho Templates**
- [ ] Viết SQL cursor-based pagination cho `templates`
- [ ] Test: chạy query trang 1, lấy cursor, chạy trang 2
- [ ] So sánh: EXPLAIN ANALYZE offset=1000 vs cursor approach

**Commit:**
```bash
git commit -m "docs(db): add pagination examples and comparison"
```

---

### 🗓️ Thứ 6 — 02/10: OOP & DI/IoC + Viết README

**Buổi sáng: OOP & DI/IoC (chuẩn bị cho NestJS tuần 2)**

Mục tiêu: Hiểu DI trước khi dùng NestJS, không học "black box".

**Tự viết DI container tối giản bằng TypeScript:**
```typescript
// Ví dụ: Không có DI (code cứng, khó test)
class TemplateService {
  private repo = new TemplateRepository();  // Tạo trực tiếp → không swap được
  findAll() { return this.repo.findAll(); }
}

// Có DI: inject interface, không phụ thuộc implementation cụ thể
interface ITemplateRepository {
  findAll(): Promise<Template[]>;
  findById(id: string): Promise<Template | null>;
}

class TemplateService {
  constructor(private repo: ITemplateRepository) {}  // Nhận từ ngoài
  findAll() { return this.repo.findAll(); }
}

// Trong test: inject mock
const mockRepo: ITemplateRepository = { findAll: jest.fn(), findById: jest.fn() }
const service = new TemplateService(mockRepo)

// Trong production: inject thật
const realRepo = new TemplateTypeOrmRepository(dataSource)
const service = new TemplateService(realRepo)

// NestJS làm điều này tự động qua @Injectable() và @Inject()
```

**Buổi chiều: Viết README + nộp bài**
- [ ] Viết `README.md` cho repo EruSentia-API
- [ ] Chụp screenshot EXPLAIN ANALYZE trước/sau index
- [ ] Chụp video demo Locking (2 terminal)
- [ ] Commit + push lên GitHub

**Commit cuối tuần:**
```bash
git add .
git commit -m "docs: add README with week1 demo screenshots and metrics"
git push origin main
```

---

### 🗓️ Cuối Tuần — Bù thiếu + 5 Q&A

**5 câu hỏi tự hỏi và tự trả lời (chuẩn bị phỏng vấn):**

1. **Transaction ACID là gì? Cho ví dụ với EruSentia.**
   > A: Atomicity — fork document hoặc thành công hoàn toàn (ghi forks + tăng fork_count) hoặc không làm gì cả. C: DB luôn đúng ràng buộc (UNIQUE, FK). I: 2 transaction fork cùng lúc không thấy nhau. D: Sau COMMIT, dữ liệu an toàn kể cả mất điện.

2. **Index B-tree hoạt động thế nào? Khi nào không nên đánh?**
   > B-tree là cây cân bằng, tìm kiếm O(log n). Không nên index: bảng nhỏ (<1000 rows), cột cardinality thấp (is_public chỉ có true/false), cột write nhiều hơn read.

3. **Sự khác nhau giữa Pessimistic và Optimistic Locking?**
   > Pessimistic: lock ngay khi đọc (FOR UPDATE), an toàn nhưng block. Optimistic: không lock, dùng version column, conflict thì retry. EruSentia dùng Pessimistic cho fork vì không thể "retry" ở tầng application dễ dàng.

4. **OFFSET pagination có vấn đề gì?**
   > Càng trang sau càng chậm vì DB phải scan qua N rows bị bỏ. OFFSET 10000 = scan 10000 rows trước khi lấy 20. Cursor-based không có vấn đề này vì dùng index để nhảy thẳng đến vị trí cần.

5. **GIN index dùng cho kiểu dữ liệu nào? Tại sao dùng cho tags?**
   > GIN (Generalized Inverted Index) dùng cho ARRAY, JSONB, tsvector. Tags là TEXT[] nên cần GIN để tìm kiếm `tags @> ARRAY['education']` (array contains) hiệu quả.

---

## 📋 CHECKLIST TUẦN 1

- [ ] `docker compose up -d` chạy không lỗi (DB + Adminer)
- [ ] File `sql/01_schema.sql` tạo đủ 8 bảng không lỗi
- [ ] File `sql/02_indexes.sql` tạo đủ index
- [ ] File `sql/03_seed.sql` seed 5000+ rows thành công
- [ ] Ghi lại 2 con số EXPLAIN ANALYZE trước/sau index (vào bảng số liệu)
- [ ] Video demo Locking: 2 terminal psql chạy đồng thời
- [ ] Hiểu và giải thích được Pessimistic vs Optimistic Locking
- [ ] Hiểu và viết được DI container tối giản (chuẩn bị Tuần 2)
- [ ] Commit push lên GitHub với message theo convention
- [ ] Viết 5 Q&A để luyện phỏng vấn

---

## 🔧 FILE HỖ TRỢ

### docker-compose.dev.yml (khởi động ngay hôm nay)
```yaml
version: '3.9'
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: eru
      POSTGRES_PASSWORD: password
      POSTGRES_DB: erusentia
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./sql:/docker-entrypoint-initdb.d   # Auto chạy sql/*.sql khi start
    ports: ["5432:5432"]

  adminer:
    image: adminer:4
    ports: ["8080:8080"]
    depends_on: [db]

volumes:
  pgdata:
```

```bash
# Khởi động:
docker compose -f docker-compose.dev.yml up -d

# Kết nối Adminer:
# URL: http://localhost:8080
# System: PostgreSQL
# Server: db
# Username: eru / Password: password / Database: erusentia

# Hoặc kết nối psql trực tiếp:
docker exec -it eru_postgres psql -U eru -d erusentia
```

### .env.example (tạo ngay, commit được)
```bash
# App
NODE_ENV=development
PORT=3001

# Database
DATABASE_URL=postgresql://eru:password@localhost:5432/erusentia
DATABASE_POOL_SIZE=10

# Redis (chưa cần tuần này, chuẩn bị trước)
REDIS_URL=redis://localhost:6379

# RabbitMQ (chưa cần tuần này)
RABBITMQ_URL=amqp://eru:password@localhost:5672

# JWT (chuẩn bị tuần 3)
JWT_SECRET=CHANGE_THIS_32_CHARS_MINIMUM
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

---

> ⬅️ [Kế hoạch tổng thể](./01_master_plan.md) | ➡️ [Tuần 2: REST API & ORM](./03_week2_api.md)
