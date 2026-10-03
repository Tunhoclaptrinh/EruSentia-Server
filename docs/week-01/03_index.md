# 🔍 PHẦN 3 — INDEX (Lý thuyết đầy đủ + Benchmark EruSentia)

---

## 3.1 Index là gì?

**Index** (chỉ mục) là một **cấu trúc dữ liệu phụ** được tạo ra bên cạnh bảng,
lưu trữ giá trị của một hoặc nhiều cột kèm con trỏ (pointer) đến vị trí của row tương ứng.

**Mục đích:** Tăng tốc các thao tác tìm kiếm, sắp xếp, và lọc — đặc biệt với bảng lớn.

### Tại sao cần Index?

Không có index, database phải thực hiện **Sequential Scan** (Full Table Scan):
- Đọc từng row từ đầu đến cuối bảng
- Độ phức tạp: **O(n)** — n là số rows
- 1,000,000 rows: phải đọc qua 1,000,000 rows để tìm 1 kết quả

Với Index (B-Tree):
- Tra cứu theo cấu trúc cây cân bằng
- Độ phức tạp: **O(log n)**
- 1,000,000 rows: chỉ cần ~20 bước (log₂(1,000,000) ≈ 20)

### Analogy — Mục lục sách

```
Không có index = sách không có mục lục
  → Muốn tìm "PostgreSQL" phải đọc từ trang 1 đến trang 500

Có index = sách có mục lục
  → Mục lục: "PostgreSQL → trang 287"
  → Lật thẳng đến trang 287
```

---

## 3.2 Cấu trúc B-Tree Index

**B-Tree (Balanced Tree)** là cấu trúc index mặc định trong PostgreSQL (và hầu hết DBMS).

### Đặc điểm B-Tree
- **Balanced:** mọi node lá ở cùng độ sâu → thời gian tìm kiếm nhất quán
- **Ordered:** dữ liệu được sắp xếp → hỗ trợ range query (>, <, BETWEEN)
- **Self-balancing:** tự cân bằng khi insert/delete

### Minh họa B-Tree

```
Giả sử index trên cột `price` của bảng templates:

                    [50000]
                   /       \
            [20000]         [80000]
           /       \       /       \
       [10000]  [35000] [65000]  [90000]
         ↓         ↓       ↓        ↓
      row ptr   row ptr  row ptr  row ptr
```

- Tìm price = 35000: root → rẽ trái → [20000] → rẽ phải → tìm thấy, 3 bước
- Tìm price > 50000: dùng node lá theo thứ tự → range scan hiệu quả

### Những loại query B-Tree hỗ trợ

```sql
WHERE col = value           -- equality
WHERE col > value           -- range (greater than)
WHERE col < value           -- range (less than)
WHERE col BETWEEN a AND b   -- range
WHERE col LIKE 'abc%'       -- prefix search (không hỗ trợ '%abc')
ORDER BY col                -- nếu có index, sort free
```

---

## 3.3 Các loại Index trong PostgreSQL

| Loại | Cấu trúc | Dùng cho |
|------|---------|---------|
| **B-Tree** | Balanced Tree | Mặc định, equality + range, sort |
| **Hash** | Hash table | Chỉ equality (`=`), nhanh hơn B-Tree cho exact match |
| **GiST** | Generalized Search Tree | Geometric data, full-text search |
| **GIN** | Generalized Inverted Index | Array, JSONB, full-text (contains queries) |
| **BRIN** | Block Range Index | Bảng cực lớn, dữ liệu có thứ tự tự nhiên (time-series) |

```sql
-- B-Tree (mặc định)
CREATE INDEX idx_users_email ON users(email);

-- Hash (chỉ equality)
CREATE INDEX idx_users_email_hash ON users USING hash(email);

-- GIN cho JSONB (EruSentia có thể lưu template metadata dạng JSON)
CREATE INDEX idx_templates_meta ON templates USING gin(metadata);

-- GIN cho full-text search
CREATE INDEX idx_templates_search ON templates USING gin(to_tsvector('english', title));
```

---

## 3.4 Khi nào NÊN đánh Index?

### ✅ NÊN đánh

**1. Cột thường xuyên xuất hiện trong WHERE:**
```sql
-- Query phổ biến: tìm user theo email
SELECT * FROM users WHERE email = ?;
-- → Cần index trên email

-- Query phổ biến: template theo status + author
SELECT * FROM templates WHERE status = 'published' AND author_id = ?;
-- → Cần index trên (status, author_id)
```

**2. Cột dùng trong JOIN ON:**
```sql
SELECT * FROM templates t JOIN users u ON t.author_id = u.id;
-- → Cần index trên templates.author_id
-- (PostgreSQL KHÔNG tự tạo index cho FK như MySQL)
```

**3. Cột dùng trong ORDER BY (với bảng lớn):**
```sql
SELECT * FROM templates ORDER BY created_at DESC LIMIT 20;
-- → Index trên created_at giúp tránh full sort
```

**4. Cột có cardinality cao:**
- **Cardinality** = số lượng giá trị phân biệt trong cột
- `email`: cardinality = số users (rất cao) → index rất hiệu quả
- `status`: cardinality = 3-4 giá trị (thấp) → index kém hiệu quả
- `is_active`: cardinality = 2 (boolean) → thường không nên index

### ❌ KHÔNG NÊN đánh

**1. Bảng nhỏ (< 1,000-5,000 rows):**
Sequential Scan trên bảng nhỏ thường nhanh hơn Index Scan vì overhead của index lookup.

**2. Cột cardinality thấp:**
```sql
-- Nếu 90% users có is_active = TRUE
-- Index trả về 90% bảng → planner sẽ chọn Seq Scan thay vì dùng index
CREATE INDEX idx_users_active ON users(is_active);  -- ít tác dụng
```

**3. Cột bị UPDATE liên tục:**
Mỗi UPDATE trên cột có index → phải rebuild index đó. Write-heavy column.

**4. Quá nhiều index trên 1 bảng:**
- Mỗi INSERT/UPDATE/DELETE phải cập nhật TẤT CẢ index
- Với 10 index: 1 INSERT → 10 index operations
- Storage tăng đáng kể

---

## 3.5 Index đặc biệt

### Composite Index (Index nhiều cột)

```sql
-- Composite index: (col_a, col_b)
CREATE INDEX idx_templates_status_author ON templates(status, author_id);
```

**Leftmost Prefix Rule — Quy tắc quan trọng nhất:**
```sql
-- Index (status, author_id) hỗ trợ:
WHERE status = ?                              -- ✅ dùng được (prefix đầu)
WHERE status = ? AND author_id = ?            -- ✅ dùng được (cả 2)
WHERE status = ? AND author_id = ? AND ...   -- ✅ dùng được

-- Index (status, author_id) KHÔNG hỗ trợ:
WHERE author_id = ?                           -- ❌ bỏ qua cột đầu
WHERE author_id = ? AND status = ?           -- ❌ không theo thứ tự prefix
```

**Thứ tự cột trong composite index:**
- Đặt cột **equality** (`=`) trước, cột **range** (`>`, `<`) sau
- Đặt cột **cardinality cao** trước để filter nhiều nhất

```sql
-- Tốt: status (equality) trước, created_at (range) sau
CREATE INDEX idx_good ON templates(status, created_at);
WHERE status = 'published' AND created_at > '2024-01-01'  -- ✅

-- Kém: created_at (range) trước, status (equality) sau
CREATE INDEX idx_bad ON templates(created_at, status);
-- Index này kém hiệu quả hơn cho query trên
```

### Partial Index (Index có điều kiện)

```sql
-- Chỉ index templates đang published (không index draft/archived)
-- Nếu 80% queries chỉ quan tâm đến published
CREATE INDEX idx_published_templates ON templates(created_at DESC, author_id)
WHERE status = 'published';

-- Ưu điểm:
-- - Index nhỏ hơn nhiều (chỉ index 20% bảng)
-- - Insert/Update draft không phải rebuild index này
-- - Query cho published nhanh hơn

-- Để sử dụng partial index, query phải có điều kiện tương ứng:
SELECT * FROM templates WHERE status = 'published' ORDER BY created_at DESC;
```

### Covering Index

```sql
-- Index bao gồm tất cả cột query cần → không cần truy cập bảng gốc
CREATE INDEX idx_templates_listing ON templates(status, created_at DESC)
INCLUDE (id, title, price, author_id);

-- Query này chỉ cần đọc index (Index Only Scan), không cần đọc heap
SELECT id, title, price, author_id
FROM templates
WHERE status = 'published'
ORDER BY created_at DESC
LIMIT 20;
```

---

## 3.6 EXPLAIN ANALYZE — Đọc Execution Plan

**EXPLAIN** cho biết PostgreSQL **dự định** làm gì (không thực sự chạy query).
**EXPLAIN ANALYZE** thực sự chạy query và cho biết **đã làm gì** (timing thực tế).

```sql
EXPLAIN ANALYZE
SELECT * FROM users WHERE email = 'test@erusentia.com';
```

**Đọc output:**
```
Index Scan using users_email_key on users
  (cost=0.42..8.44 rows=1 width=89)
  (actual time=0.043..0.044 rows=1 loops=1)
  Index Cond: ((email)::text = 'test@erusentia.com')
Planning Time: 0.15 ms
Execution Time: 0.065 ms
```

| Trường | Ý nghĩa |
|--------|---------|
| `Index Scan` | Loại scan: Index Scan, Seq Scan, Index Only Scan, Bitmap Heap Scan |
| `cost=0.42..8.44` | Chi phí ước tính: startup_cost..total_cost (đơn vị tương đối, không phải ms) |
| `rows=1` | Số rows ước tính sẽ trả về |
| `width=89` | Kích thước trung bình mỗi row (bytes) |
| `actual time=0.043..0.044` | Thời gian thực: startup..total (ms) |
| `rows=1` | Số rows thực tế trả về |
| `loops=1` | Node này chạy bao nhiêu lần |
| `Planning Time` | Thời gian optimizer tính execution plan |
| `Execution Time` | Tổng thời gian thực thi (bao gồm planning nếu dùng EXPLAIN ANALYZE) |

**Các loại Scan:**

| Scan type | Khi nào | Hiệu quả |
|-----------|---------|---------|
| `Seq Scan` | Không có index, hoặc index không hiệu quả | Chậm với bảng lớn |
| `Index Scan` | Có index, trả về ít rows | Nhanh |
| `Index Only Scan` | Covering index (không cần truy cập heap) | Nhanh nhất |
| `Bitmap Heap Scan` | Index trả về nhiều rows → gộp thành bitmap | Trung bình |

---

## 3.7 Thực hành Benchmark trên EruSentia

### Bước 1: Tạo dữ liệu benchmark

```bash
# Chạy file benchmark tạo 100,000 bản ghi
docker exec -i sentia_postgres_dev psql -U postgres -d sentia_hub_db < sql/04_week01_benchmark.sql
```

### Bước 2: Query KHÔNG có index

```sql
\timing on

-- Bảng không có index
EXPLAIN ANALYZE
SELECT * FROM users_no_index WHERE email = 'bench_50000@erusentia.test';
-- Kết quả thực tế: Seq Scan, duyệt qua 100,009 rows, time ≈ 7.312 ms
```

### Bước 3: Query CÓ index (bảng gốc)

```sql
EXPLAIN ANALYZE
SELECT * FROM users WHERE email = 'admin@sentiahub.local';
-- Kết quả thực tế: Index Scan (B-Tree), đọc đúng 1 row duy nhất, time ≈ 0.112 ms
-- So sánh: Tốc độ tối ưu hơn ~65 lần
```

### Bước 4: Test Foreign Key index

```sql
-- templates.author_id có index chưa?
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'templates' AND indexdef LIKE '%author_id%';

-- Nếu chưa có:
CREATE INDEX IF NOT EXISTS idx_templates_author_id ON templates(author_id);

-- So sánh
EXPLAIN ANALYZE SELECT * FROM templates WHERE author_id = '<some_uuid>';
```

---

## 3.8 Quản lý Index

```sql
-- Xem tất cả index + kích thước
SELECT
    indexname,
    tablename,
    pg_size_pretty(pg_relation_size(indexname::regclass)) AS index_size,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexname::regclass) DESC;

-- Xóa index
DROP INDEX IF EXISTS idx_users_is_active;

-- Rebuild index (nếu index bị bloat sau nhiều UPDATE)
REINDEX INDEX idx_templates_author_id;

-- Tạo index không block production (CONCURRENTLY)
CREATE INDEX CONCURRENTLY idx_templates_price ON templates(price);
-- Chú ý: CONCURRENTLY chậm hơn nhưng không lock bảng
```
