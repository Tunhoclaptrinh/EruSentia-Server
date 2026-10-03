# 🔒 PHẦN 5 — LOCKING (Lý thuyết đầy đủ + Demo EruSentia)

---

## 5.1 Tại sao cần Locking?

### Vấn đề: Concurrent Access

Database thường phục vụ **nhiều kết nối đồng thời** (concurrent connections).
Khi nhiều transaction cùng đọc/ghi một dữ liệu, có thể xảy ra **data anomalies** (dị thường dữ liệu).

### Các dạng Data Anomaly

#### 1. Lost Update (Mất cập nhật)
```
T1 đọc: reputation = 100
T2 đọc: reputation = 100
T1 tính: 100 + 10 = 110, ghi lại
T2 tính: 100 + 20 = 120, ghi lại  ← ghi đè kết quả của T1!
Kết quả: 120 (đúng ra phải là 130)
```

#### 2. Dirty Read (Đọc dữ liệu bẩn)
```
T1 bắt đầu: cập nhật balance = 0 (đang trong transaction, chưa COMMIT)
T2 đọc: thấy balance = 0 (đọc uncommitted data!)
T1 ROLLBACK: balance về lại giá trị cũ
T2 đã hành động dựa trên dữ liệu không bao giờ tồn tại!
```

#### 3. Non-Repeatable Read
```
T1 đọc: price = 99000
T2 UPDATE: price = 199000, COMMIT
T1 đọc lại trong cùng transaction: price = 199000 (đã thay đổi!)
```

#### 4. Phantom Read
```
T1 đếm: SELECT COUNT(*) WHERE status='published' → 100
T2 INSERT thêm 5 published templates, COMMIT
T1 đếm lại: SELECT COUNT(*) WHERE status='published' → 105
(records "ma" xuất hiện trong transaction của T1)
```

**Locking giải quyết các vấn đề này** bằng cách kiểm soát thứ tự và tính cô lập giữa các transaction.

---

## 5.2 Transaction Isolation Levels

PostgreSQL hỗ trợ 4 mức cô lập (theo chuẩn SQL):

| Isolation Level | Dirty Read | Non-Repeatable Read | Phantom Read |
|----------------|-----------|--------------------|--------------| 
| **READ UNCOMMITTED** | ❌ Có thể | ❌ Có thể | ❌ Có thể |
| **READ COMMITTED** (default PG) | ✅ Không | ❌ Có thể | ❌ Có thể |
| **REPEATABLE READ** | ✅ Không | ✅ Không | ✅ Không (PG) |
| **SERIALIZABLE** | ✅ Không | ✅ Không | ✅ Không |

> PostgreSQL mặc định dùng **READ COMMITTED** — transaction chỉ thấy data đã được COMMIT.

```sql
-- Thay đổi isolation level
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
```

---

## 5.3 Pessimistic Locking

### Định nghĩa

**Pessimistic Locking** (Khóa bi quan) = giả định rằng **conflict sẽ xảy ra**,
do đó **khóa row lại ngay khi đọc** để không ai khác có thể sửa cho đến khi transaction hoàn tất.

Tên gọi "bi quan" vì: "tôi bi quan, tôi nghĩ sẽ có người khác muốn sửa dữ liệu này — nên tôi khóa trước".

### Cơ chế hoạt động

```sql
BEGIN;

SELECT * FROM template_slots WHERE id = 1
FOR UPDATE;   -- ← Ghi lock vào row này

-- Các session khác muốn SELECT ... FOR UPDATE cùng row:
-- → BỊ BLOCK, phải đợi transaction này COMMIT hoặc ROLLBACK

UPDATE template_slots SET slots = slots - 1 WHERE id = 1;

COMMIT;  -- → Release lock, session đang chờ sẽ được thực thi
```

### Các variants của SELECT FOR UPDATE

```sql
-- Đợi vô thời hạn nếu bị lock (mặc định)
SELECT * FROM template_slots WHERE id = 1 FOR UPDATE;

-- Không đợi, lỗi ngay nếu bị lock
SELECT * FROM template_slots WHERE id = 1 FOR UPDATE NOWAIT;
-- → ERROR: could not obtain lock on row in relation "template_slots"

-- Bỏ qua rows đang bị lock (lấy rows khác không bị lock)
SELECT * FROM template_slots WHERE id IN (1,2,3) FOR UPDATE SKIP LOCKED;
-- → Hữu ích cho job queue: worker A lấy item đầu, worker B tự động lấy item tiếp theo

-- Lock nhẹ hơn: chỉ block UPDATE/DELETE, không block SELECT FOR SHARE
SELECT * FROM template_slots WHERE id = 1 FOR SHARE;
```

### Lock Types trong PostgreSQL

| Lock | Mô tả | Blocked by |
|------|-------|-----------|
| `FOR UPDATE` | Exclusive row lock | Mọi loại lock khác |
| `FOR SHARE` | Shared row lock | Chỉ bị block bởi FOR UPDATE |
| `FOR NO KEY UPDATE` | Exclusive, nhưng không lock FK lookups | FOR SHARE, FOR UPDATE |
| `FOR KEY SHARE` | Shared, chỉ cần cho FK checks | FOR UPDATE, FOR NO KEY UPDATE |

### Demo Pessimistic Lock — 2 Terminal

**Setup:**
```sql
CREATE TABLE IF NOT EXISTS template_slots (
    id      SERIAL PRIMARY KEY,
    name    VARCHAR(100),
    slots   INT NOT NULL DEFAULT 0,
    version INT NOT NULL DEFAULT 0
);
INSERT INTO template_slots (name, slots) VALUES ('Limited Edition Pack', 1);
```

**Terminal 1:**
```sql
BEGIN;
SELECT id, slots FROM template_slots WHERE id = 1 FOR UPDATE;
-- → slots = 1, session này đang giữ lock
-- DỪNG LẠI đây, không COMMIT ngay
```

**Terminal 2 (mở ngay sau):**
```sql
BEGIN;
SELECT id, slots FROM template_slots WHERE id = 1 FOR UPDATE;
-- → BỊ BLOCK (đứng chờ, không trả về kết quả)
```

**Quay Terminal 1:**
```sql
UPDATE template_slots SET slots = slots - 1 WHERE id = 1;
COMMIT;  -- → Terminal 2 tự động UNBLOCK
```

**Terminal 2 (sau khi unblock):**
```sql
-- Giờ mới nhận được kết quả
SELECT id, slots FROM template_slots WHERE id = 1 FOR UPDATE;
-- → slots = 0 (đã hết!)
-- Xử lý: kiểm tra slots <= 0 → ROLLBACK
ROLLBACK;
```

### Ưu điểm Pessimistic

- ✅ **Đảm bảo không conflict** — chắc chắn nhất quán
- ✅ **Đơn giản:** không cần retry logic phức tạp
- ✅ **Phù hợp conflict rate cao:** nhiều user cùng tranh 1 resource

### Nhược điểm Pessimistic

- ❌ **Throughput thấp:** các session xếp hàng chờ nhau
- ❌ **Nguy cơ Deadlock:** A chờ B, B chờ A
- ❌ **Không phù hợp read-heavy:** lock ngay cả khi read-only không cần

---

## 5.4 Optimistic Locking

### Định nghĩa

**Optimistic Locking** (Khóa lạc quan) = giả định rằng **conflict hiếm khi xảy ra**,
do đó **không khóa khi đọc** — chỉ kiểm tra conflict **tại thời điểm ghi**.

Nếu phát hiện conflict → **retry** toàn bộ operation.

Tên gọi "lạc quan" vì: "tôi lạc quan, tôi nghĩ không ai tranh với tôi — nên tôi đọc mà không lock".

### Cơ chế: Version Column

Thêm cột `version` vào bảng. Mỗi lần UPDATE thành công → version tăng lên 1.

```sql
ALTER TABLE template_slots ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 0;
```

**Quy trình:**
```
1. READ: SELECT id, slots, version FROM template_slots WHERE id = 1
   → version = 3

2. Business logic: tính toán, xử lý...

3. WRITE: UPDATE template_slots
          SET slots = new_value, version = version + 1
          WHERE id = 1 AND version = 3   ← điều kiện then chốt!

4. Kiểm tra rowsAffected:
   - rowsAffected = 1 → THÀNH CÔNG (version vẫn là 3 khi ta ghi)
   - rowsAffected = 0 → CONFLICT (ai đó đã UPDATE và version đã thay đổi)
   → Retry từ bước 1
```

### Demo Optimistic Lock — 2 Terminal

**Terminal 1:**
```sql
BEGIN;
SELECT slots, version FROM template_slots WHERE id = 1;
-- → slots=10, version=0
-- Giả vờ đang xử lý business logic (không làm gì cả, chờ T2)
```

**Terminal 2:**
```sql
BEGIN;
SELECT slots, version FROM template_slots WHERE id = 1;
-- → slots=10, version=0

UPDATE template_slots
SET slots = 9, version = version + 1, updated_at = NOW()
WHERE id = 1 AND version = 0;
-- → 1 row affected ✅ SUCCESS

COMMIT;
-- version bây giờ = 1
```

**Terminal 1 (thử ghi với version cũ):**
```sql
UPDATE template_slots
SET slots = 9, version = version + 1
WHERE id = 1 AND version = 0;  -- version = 0 không còn đúng nữa!
-- → 0 rows affected ← CONFLICT DETECTED

-- Phải retry: đọc lại version mới
SELECT slots, version FROM template_slots WHERE id = 1;
-- → slots=9, version=1
-- Quyết định: có muốn tiếp tục không?

ROLLBACK;
```

### Timestamp thay vì Version?

Một số hệ thống dùng `updated_at` thay vì `version`:
```sql
WHERE id = 1 AND updated_at = '2024-03-15 10:30:00.123456'
```

**Rủi ro:** Clock precision — nếu 2 update xảy ra trong cùng 1 microsecond, timestamp giống nhau → không phát hiện conflict. Version counter đảm bảo unique hơn.

### Ưu điểm Optimistic

- ✅ **Throughput cao:** không block ai khi đọc
- ✅ **Không có Deadlock:** không có lock nên không có deadlock
- ✅ **Phù hợp read-heavy:** phần lớn thời gian chỉ đọc, hiếm khi ghi đồng thời

### Nhược điểm Optimistic

- ❌ **Cần retry logic:** phức tạp hơn để implement đúng
- ❌ **Lãng phí khi conflict rate cao:** nhiều retry = nhiều work vô ích
- ❌ **Không phù hợp conflict rate cao:** booking vé concert → mọi người đều cùng tranh

---

## 5.5 Deadlock

### Định nghĩa

**Deadlock** = tình trạng **hai (hoặc nhiều) transaction đang chờ nhau**,
không transaction nào có thể tiến hành được.

```
Transaction A: Đang giữ lock trên row 1, muốn lock row 2
Transaction B: Đang giữ lock trên row 2, muốn lock row 1
→ A chờ B release row 2
→ B chờ A release row 1
→ Cả hai chờ nhau mãi mãi = DEADLOCK
```

### PostgreSQL phát hiện và xử lý Deadlock

PostgreSQL chủ động **phát hiện deadlock** định kỳ.
Khi phát hiện: **kill một trong hai transaction** (victim selection), transaction kia tiếp tục.

```
ERROR: deadlock detected
DETAIL: Process 12345 waits for ShareLock on transaction 67890;
        blocked by process 67890.
        Process 67890 waits for ShareLock on transaction 12345;
        blocked by process 12345.
HINT: See server log for query details.
```

### Tái tạo Deadlock

**Terminal 1:**
```sql
BEGIN;
SELECT * FROM template_slots WHERE id = 1 FOR UPDATE;
-- Đang giữ lock id=1, muốn lock id=2
```

**Terminal 2:**
```sql
BEGIN;
SELECT * FROM template_slots WHERE id = 2 FOR UPDATE;
-- Đang giữ lock id=2, muốn lock id=1
SELECT * FROM template_slots WHERE id = 1 FOR UPDATE;
-- → BLOCK
```

**Terminal 1:**
```sql
SELECT * FROM template_slots WHERE id = 2 FOR UPDATE;
-- → Một trong hai terminal sẽ nhận ERROR: deadlock detected
```

### Cách phòng tránh Deadlock

**Nguyên tắc vàng: Lock theo thứ tự nhất quán**
```sql
-- BAD: T1 lock (1, 2), T2 lock (2, 1) → deadlock
-- T1: lock id=1, rồi lock id=2
-- T2: lock id=2, rồi lock id=1

-- GOOD: Cả hai đều lock theo thứ tự id ASC
-- T1: lock id=1, rồi lock id=2
-- T2: lock id=1 (block, chờ T1), rồi lock id=2 (sau khi T1 xong)
-- → Không deadlock
```

```sql
-- Trong PostgreSQL: sort ids trước khi lock
SELECT * FROM template_slots WHERE id = ANY(ARRAY[1, 2])
ORDER BY id  -- ← đảm bảo lock theo thứ tự tăng dần
FOR UPDATE;
```

---

## 5.6 So sánh Pessimistic vs Optimistic

| Tiêu chí | Pessimistic | Optimistic |
|---------|------------|-----------|
| **Triết lý** | "Conflict sẽ xảy ra — lock trước" | "Conflict hiếm — check khi ghi" |
| **Cơ chế** | `SELECT FOR UPDATE` | version column + rowsAffected check |
| **Blocking** | Có (các session xếp hàng) | Không |
| **Throughput** | Thấp hơn | Cao hơn |
| **Deadlock risk** | Có | Không |
| **Retry logic** | Không cần | Cần |
| **Conflict rate cao** | ✅ Phù hợp | ❌ Nhiều retry |
| **Read-heavy** | ❌ Lãng phí | ✅ Phù hợp |
| **Use case EruSentia** | Mua template giới hạn | Edit profile, update template |
