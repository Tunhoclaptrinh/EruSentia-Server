# 📄 PHẦN 4 — PHÂN TRANG (PAGINATION)

---

## 4.1 Pagination là gì và tại sao cần?

**Pagination (phân trang)** là kỹ thuật chia tập kết quả lớn thành các **trang nhỏ hơn**,
trả về từng phần thay vì toàn bộ.

### Tại sao cần phân trang?

**Vấn đề không có phân trang:**
```sql
SELECT * FROM templates;  -- EruSentia có 500,000 templates
```
- Server phải đọc 500,000 rows từ disk → tốn I/O
- Server phải serialize 500,000 objects thành JSON → tốn CPU + RAM
- Network phải truyền vài trăm MB → user chờ lâu, tốn bandwidth
- Browser phải render 500,000 items → crash tab

**Với phân trang (20 items/trang):**
- Server chỉ xử lý 20 rows
- Response nhỏ, nhanh
- User thấy kết quả trong milliseconds

### Use cases thực tế

| Use case | Dữ liệu | Kỳ vọng |
|----------|---------|---------|
| Marketplace feed | Templates mới nhất | Load nhanh, scroll vô tận |
| Admin dashboard | Quản lý user | Nhảy đến trang N, biết tổng số |
| Search results | Kết quả tìm kiếm | Top N relevant nhất |
| API pagination | Client API | Predictable, cacheable |

---

## 4.2 Offset-based Pagination

### Định nghĩa

**Offset-based pagination** sử dụng `LIMIT` và `OFFSET` để "bỏ qua" N rows đầu và lấy M rows tiếp theo.

```sql
SELECT columns FROM table
ORDER BY sort_column
LIMIT  page_size           -- số rows mỗi trang
OFFSET (page - 1) * page_size;  -- bỏ qua bao nhiêu rows
```

### Cách hoạt động

```
Page 1: LIMIT 20 OFFSET 0   → đọc rows 1-20   → trả rows 1-20
Page 2: LIMIT 20 OFFSET 20  → đọc rows 1-40   → bỏ 20, trả rows 21-40
Page 3: LIMIT 20 OFFSET 40  → đọc rows 1-60   → bỏ 40, trả rows 41-60
...
Page 100: LIMIT 20 OFFSET 1980 → đọc rows 1-2000 → bỏ 1980, trả rows 1981-2000
```

**Quan sát quan trọng:** Ở page 100, PostgreSQL vẫn phải đọc qua 1980 rows rồi mới lấy 20 rows cuối. Đây là nguồn gốc của vấn đề hiệu năng.

### Thực hành

```sql
-- Page 1: 20 templates published mới nhất
SELECT id, title, price, created_at
FROM templates
WHERE status = 'published'
ORDER BY created_at DESC
LIMIT 20 OFFSET 0;

-- Page 2
SELECT id, title, price, created_at
FROM templates
WHERE status = 'published'
ORDER BY created_at DESC
LIMIT 20 OFFSET 20;

-- API thường cần cả total count để tính tổng số trang
SELECT COUNT(*) FROM templates WHERE status = 'published';
-- totalPages = CEILING(total / pageSize)

-- Xem execution plan với OFFSET nhỏ vs lớn
\timing on
EXPLAIN ANALYZE
SELECT id, title FROM templates WHERE status = 'published'
ORDER BY created_at DESC LIMIT 20 OFFSET 0;

EXPLAIN ANALYZE
SELECT id, title FROM templates WHERE status = 'published'
ORDER BY created_at DESC LIMIT 20 OFFSET 10000;
-- → Chú ý: rows bị filter (Rows Removed) khi OFFSET lớn
```

### Ưu điểm Offset-based

- ✅ **Đơn giản:** dễ implement, dễ hiểu
- ✅ **Nhảy đến trang N:** client chỉ cần tính `OFFSET = (N-1) * pageSize`
- ✅ **Biết tổng số trang:** `COUNT(*)` + pageSize → totalPages
- ✅ **Phù hợp pagination bar:** UI hiển thị "1 2 3 ... 50"

### Nhược điểm Offset-based

**Nhược điểm 1: Hiệu năng giảm với OFFSET lớn**
```
OFFSET 0:      scan 20 rows       → nhanh
OFFSET 10000:  scan 10020 rows, skip 10000  → chậm hơn
OFFSET 100000: scan 100020 rows, skip 100000 → rất chậm
```
PostgreSQL KHÔNG thể "nhảy" trực tiếp đến OFFSET mà phải đọc và bỏ qua tuần tự.

**Nhược điểm 2: Dữ liệu thay đổi gây inconsistency**
```
User đọc page 1 (items 1-20)
Creator A thêm template mới → template mới trở thành item #1

User chuyển page 2 → items 21-40 (cũ) giờ là items 22-41
→ User bỏ qua item #21 (item #21 cũ đã thành item #22)
→ Hoặc thấy trùng item từ page 1
```

---

## 4.3 Cursor-based Pagination (Keyset Pagination)

### Định nghĩa

**Cursor-based pagination** (hay keyset pagination) dùng **giá trị của row cuối cùng** làm "con trỏ" (cursor) để xác định điểm bắt đầu của trang tiếp theo.

Thay vì "bỏ qua N rows", ta nói "lấy rows **sau** row này".

### Tại sao hiệu quả?

```
Offset-based: "Bỏ qua 10,000 rows đầu" → phải đọc 10,000 rows
Cursor-based: "Lấy rows có created_at < '2024-03-15'" → Index ngay lập tức
```

Với index trên cột cursor, DB có thể **nhảy thẳng** đến điểm đúng trong B-Tree.

### Cách hoạt động

```sql
-- Trang đầu tiên (không có cursor)
SELECT id, title, price, created_at
FROM templates
WHERE status = 'published'
ORDER BY created_at DESC, id DESC  -- id làm tiebreaker
LIMIT 20;

-- → Row cuối: created_at = '2024-03-15 10:30:00+07', id = 'abc-123'
-- → Đây là cursor cho trang tiếp

-- Trang tiếp (dùng cursor)
SELECT id, title, price, created_at
FROM templates
WHERE status = 'published'
  AND (created_at, id) < ('2024-03-15 10:30:00+07', 'abc-123')
  --                ↑ Row comparison: lấy rows "nhỏ hơn" cursor
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

### Tại sao cần tiebreaker (id)?

`created_at` có thể trùng nhau (nhiều templates tạo cùng giây).
Nếu chỉ dùng `created_at` làm cursor:
```
Templates: [T1: 10:30, T2: 10:30, T3: 10:30, T4: 10:29]
Page 1 cursor: created_at = 10:30 (lấy được T1)
Page 2 query: WHERE created_at < 10:30
→ Bỏ qua T2, T3 (cũng có created_at = 10:30)!
```

Với composite cursor `(created_at, id)`:
- ID là unique → cursor là unique → không bao giờ bỏ sót row

### Tiebreaker phải là cột gì?

- Phải **unique** (đảm bảo cursor unique)
- Nên là cột có **index** (để query nhanh)
- `id` (UUID/SERIAL) là lựa chọn phổ biến nhất

### Encode cursor cho API

```typescript
// Client không nên thấy raw SQL values
// Encode cursor thành opaque string

// Encode
const cursor = Buffer.from(JSON.stringify({
  created_at: lastRow.created_at,
  id: lastRow.id
})).toString('base64');
// → "eyJjcmVhdGVkX2F0IjoiMjAyNC0wMy0xNVQxMDozMDowMFoiLCJpZCI6ImFiYy0xMjMifQ=="

// Decode
const decoded = JSON.parse(Buffer.from(cursor, 'base64').toString());
// → { created_at: '2024-03-15T10:30:00Z', id: 'abc-123' }
```

### Thực hành

```sql
-- Page 1
SELECT id, title, price, created_at
FROM templates
WHERE status = 'published'
ORDER BY created_at DESC, id DESC
LIMIT 5;  -- dùng 5 để dễ test

-- Ghi lại row cuối: created_at = '???', id = '???'

-- Page 2 (thay giá trị thực vào)
SELECT id, title, price, created_at
FROM templates
WHERE status = 'published'
  AND (created_at, id) < ('<created_at_của_row_cuối>', '<id_của_row_cuối>')
ORDER BY created_at DESC, id DESC
LIMIT 5;

-- Tạo index để cursor query hiệu quả
CREATE INDEX IF NOT EXISTS idx_templates_cursor
ON templates(status, created_at DESC, id DESC);

-- Xem execution plan
EXPLAIN ANALYZE
SELECT id, title FROM templates
WHERE status = 'published'
  AND (created_at, id) < (NOW() - INTERVAL '7 days', 'ffffffff-ffff-ffff-ffff-ffffffffffff')
ORDER BY created_at DESC, id DESC
LIMIT 20;
-- → Phải là Index Scan, không phải Seq Scan
```

### Ưu điểm Cursor-based

- ✅ **Hiệu năng O(1):** không quan trọng đang ở "trang" mấy, luôn nhanh như nhau
- ✅ **Consistent:** không bị skip/duplicate khi data thêm/xóa trong lúc phân trang
- ✅ **Phù hợp infinite scroll:** TikTok, Instagram, Twitter feed

### Nhược điểm Cursor-based

- ❌ **Không nhảy đến trang N:** phải đi tuần tự qua các cursor
- ❌ **Không biết tổng số trang:** không có `COUNT(*)`
- ❌ **Cột cursor phải unique + có index**
- ❌ **Phức tạp hơn** để implement và debug

---

## 4.4 Bảng so sánh toàn diện

| Tiêu chí | Offset-based | Cursor-based |
|---------|-------------|-------------|
| **Hiệu năng trang đầu** | ✅ Nhanh | ✅ Nhanh |
| **Hiệu năng trang cuối (OFFSET lớn)** | ❌ Chậm dần | ✅ Không đổi |
| **Nhảy đến trang N** | ✅ Có | ❌ Không |
| **Biết tổng số trang** | ✅ Có (cần COUNT) | ❌ Không |
| **Consistent khi data thay đổi** | ❌ Có thể miss/dup | ✅ Stable |
| **Complexity** | ✅ Đơn giản | ⚠️ Phức tạp hơn |
| **Use case EruSentia** | Admin dashboard | Marketplace feed |
| **UI phù hợp** | Pagination bar | Infinite scroll / "Load more" |

---

## 4.5 Khi nào dùng cái nào?

**Dùng Offset-based khi:**
- Admin interface cần nhảy đến trang N
- Cần hiển thị tổng số trang
- Bảng nhỏ (< 100k rows), OFFSET sẽ không quá lớn
- Ví dụ EruSentia: Admin quản lý users, admin xem danh sách reports

**Dùng Cursor-based khi:**
- Public API với dataset lớn
- Infinite scroll (mobile apps)
- Real-time data (data thay đổi liên tục)
- Ví dụ EruSentia: Marketplace feed, API cho mobile app
