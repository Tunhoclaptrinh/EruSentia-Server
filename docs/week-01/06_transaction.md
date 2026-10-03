# 💳 PHẦN 6 — TRANSACTION (Lý thuyết ACID + Thực hành EruSentia)

---

## 6.1 Transaction là gì?

**Transaction** là một đơn vị công việc logic bao gồm **một hoặc nhiều thao tác DB**
được thực thi như một khối **không thể tách rời (atomic)**.

Toàn bộ thao tác phải:
- **Tất cả thành công** → COMMIT (lưu vĩnh viễn)
- **Hoặc tất cả thất bại** → ROLLBACK (hoàn tác về trạng thái trước)

### Tại sao cần Transaction?

**Scenario: Publish template trên EruSentia**

Khi creator publish template, hệ thống phải:
1. UPDATE `templates.status = 'published'`
2. UPDATE `profiles.reputation_score += 10`
3. INSERT activity log

Nếu step 1 thành công nhưng server crash tại step 2:
- Template đã published nhưng reputation không được cộng
- Database ở trạng thái **không nhất quán** (inconsistent)

Với Transaction:
- Nếu bất kỳ step nào fail → ROLLBACK tất cả về trạng thái trước
- Database luôn ở trạng thái nhất quán

---

## 6.2 ACID Properties

**ACID** là 4 tính chất cốt lõi của transaction trong CSDL quan hệ, đảm bảo data integrity.

### A — Atomicity (Tính nguyên tử)

**Định nghĩa:** Transaction là một đơn vị không thể chia nhỏ — hoặc tất cả thành công, hoặc tất cả thất bại. Không có trạng thái "thành công một phần".

**Ví dụ EruSentia:**
```sql
BEGIN;
-- Step 1: publish template
UPDATE templates SET status = 'published' WHERE id = 'T1';
-- Step 2: cộng reputation
UPDATE profiles SET reputation_score = reputation_score + 10 WHERE user_id = 'U1';
-- Nếu step 2 fail vì bất kỳ lý do gì → ROLLBACK cả step 1
COMMIT;
```

**Cơ chế:** PostgreSQL sử dụng **WAL (Write-Ahead Logging)** — ghi log trước khi thực sự ghi data. Nếu crash giữa chừng, WAL được dùng để replay hoặc rollback.

### C — Consistency (Tính nhất quán)

**Định nghĩa:** Transaction đưa database từ **trạng thái hợp lệ này sang trạng thái hợp lệ khác**. Tất cả constraints, rules, và triggers phải được thỏa mãn sau transaction.

**Ví dụ EruSentia:**
```sql
-- Constraint: templates.author_id phải tồn tại trong users.id
-- Nếu INSERT template với author_id không tồn tại → vi phạm FK constraint
-- → Transaction bị ROLLBACK tự động
-- → Database vẫn nhất quán
INSERT INTO templates (author_id, ...) VALUES ('không_tồn_tại', ...);
-- ERROR: insert or update on table "templates" violates foreign key constraint
```

Consistency là trách nhiệm **chung** của database (constraints) và application (business rules).

### I — Isolation (Tính cô lập)

**Định nghĩa:** Các transaction đồng thời **không thấy kết quả trung gian của nhau**. Mỗi transaction thực thi như thể nó là transaction duy nhất đang chạy.

**Ví dụ EruSentia:**
```sql
-- T1 đang UPDATE template (chưa COMMIT)
BEGIN;  -- T1
UPDATE templates SET status = 'published' WHERE id = 'T1';
-- Chưa COMMIT

-- T2 đọc cùng lúc
SELECT status FROM templates WHERE id = 'T1';
-- → Thấy 'draft' (không thấy uncommitted changes của T1)
-- → READ COMMITTED isolation level
```

Mức độ isolation được kiểm soát bởi **Isolation Level** (đã học ở phần Locking).

### D — Durability (Tính bền vững)

**Định nghĩa:** Sau khi transaction COMMIT thành công, dữ liệu **tồn tại vĩnh viễn** ngay cả khi server crash, mất điện, hay restart.

**Cơ chế:** PostgreSQL ghi WAL log ra disk **trước** khi báo COMMIT success. Sau khi restart, WAL được replay để khôi phục trạng thái.

**Ví dụ:**
```sql
BEGIN;
UPDATE templates SET status = 'published' WHERE id = 'T1';
COMMIT;
-- PostgreSQL đảm bảo: dù server tắt ngay sau COMMIT, template vẫn là published khi restart
```

---

## 6.3 Cú pháp Transaction

```sql
-- Bắt đầu transaction
BEGIN;
-- hoặc
START TRANSACTION;

-- Các thao tác DB...

-- Lưu tất cả thay đổi
COMMIT;
-- hoặc
END;  -- tương đương COMMIT

-- Hủy tất cả thay đổi
ROLLBACK;
```

### Auto-commit

Mặc định trong PostgreSQL, **mỗi lệnh SQL đơn lẻ là một transaction riêng** (auto-commit).

```sql
-- Không có BEGIN/COMMIT → mỗi lệnh tự COMMIT ngay
UPDATE templates SET status = 'published' WHERE id = 'T1';
-- → Auto COMMIT

-- Nếu muốn group nhiều lệnh → phải explicit BEGIN
BEGIN;
UPDATE templates SET status = 'published' WHERE id = 'T1';
UPDATE profiles SET reputation_score = reputation_score + 10 WHERE user_id = 'U1';
COMMIT;
```

---

## 6.4 Demo: Transaction với ROLLBACK

```sql
-- Xem data trước
SELECT id, reputation_score FROM profiles LIMIT 3;

BEGIN;

-- Thử thay đổi
UPDATE profiles SET reputation_score = reputation_score + 9999
WHERE id = (SELECT id FROM profiles LIMIT 1);

-- Kiểm tra trong transaction (chỉ session này thấy)
SELECT id, reputation_score FROM profiles LIMIT 3;
-- → reputation_score tăng thêm 9999

-- Quyết định: ROLLBACK
ROLLBACK;

-- Verify: reputation_score đã về lại
SELECT id, reputation_score FROM profiles LIMIT 3;
-- → Không đổi gì cả
```

**Ứng dụng thực tế:** Trước khi chạy migration lớn trong production, bọc trong transaction → kiểm tra kết quả → ROLLBACK (hoặc COMMIT nếu đúng).

---

## 6.5 Khi nào PHẢI dùng Transaction?

### Rule of thumb
**Khi nào có 2+ thao tác DB phải thành công cùng nhau → cần Transaction.**

### Scenario 1: Tạo User + Profile (EruSentia)

```sql
BEGIN;

-- Tạo user account
INSERT INTO users (id, email, password_hash, role)
VALUES (gen_random_uuid(), 'new@user.com', 'hash', 'user')
RETURNING id;  -- lấy id vừa tạo

-- Tạo profile cho user đó (cần user_id vừa tạo)
INSERT INTO profiles (id, user_id, username, display_name)
VALUES (gen_random_uuid(), '<user_id_vừa_lấy>', 'newuser', 'New User');

-- Cả hai phải thành công cùng nhau
-- Nếu user tạo OK nhưng profile fail → ROLLBACK cả user
COMMIT;
```

### Scenario 2: Publish Template (EruSentia)

```sql
BEGIN;

-- 1. Update trạng thái template
UPDATE templates
SET status = 'published', updated_at = NOW()
WHERE id = '<template_id>'
  AND author_id = '<user_id>'
  AND status = 'draft';

-- Kiểm tra có thực sự update được không (nếu 0 rows → fail)
-- Trong psql: GET DIAGNOSTICS affected = ROW_COUNT;

-- 2. Cộng reputation
UPDATE profiles
SET reputation_score = reputation_score + 10
WHERE user_id = '<user_id>';

-- 3. Ghi log (nếu có bảng activity_log)
-- INSERT INTO activity_log ...

COMMIT;
```

### Scenario 3: Soft Delete Template

```sql
BEGIN;

-- Soft delete template
UPDATE templates
SET deleted_at = NOW(), status = 'archived'
WHERE id = '<template_id>' AND author_id = '<user_id>';

-- Trừ reputation khi xóa template đã publish
UPDATE profiles
SET reputation_score = GREATEST(0, reputation_score - 5)  -- không để âm
WHERE user_id = '<user_id>';

COMMIT;
```

---

## 6.6 Savepoint — Checkpoint trong Transaction

**Savepoint** là điểm kiểm tra trong transaction — có thể ROLLBACK về savepoint mà không ROLLBACK toàn bộ.

```sql
BEGIN;

-- Thao tác 1: thành công
UPDATE profiles SET reputation_score = reputation_score + 10 WHERE user_id = 'U1';

SAVEPOINT after_reputation;  -- đánh dấu checkpoint

-- Thao tác 2: thử, có thể fail
INSERT INTO activity_log (user_id, action) VALUES ('U1', 'publish');

-- Nếu thao tác 2 fail, rollback về savepoint (giữ kết quả thao tác 1)
ROLLBACK TO SAVEPOINT after_reputation;

-- Thao tác 1 vẫn còn hiệu lực
COMMIT;  -- chỉ commit thao tác 1

-- Xóa savepoint không cần nữa
-- RELEASE SAVEPOINT after_reputation;
```

---

## 6.7 Transaction trong Application Code (TypeScript)

### Pattern 1: Manual transaction

```typescript
// src/week01-practice/transaction-demo.ts
import { Pool, PoolClient } from 'pg';

const pool = new Pool({ /* config */ });

async function publishTemplate(templateId: string, authorId: string) {
  const client: PoolClient = await pool.connect();

  try {
    await client.query('BEGIN');

    // Step 1: Publish template
    const result = await client.query(
      `UPDATE templates
       SET status = 'published', updated_at = NOW()
       WHERE id = $1 AND author_id = $2 AND status = 'draft'
       RETURNING id, title`,
      [templateId, authorId]
    );

    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      throw new Error('Template not found, not yours, or not in draft status');
    }

    // Step 2: Add reputation
    await client.query(
      `UPDATE profiles
       SET reputation_score = reputation_score + 10
       WHERE user_id = $1`,
      [authorId]
    );

    await client.query('COMMIT');
    console.log(`Published: ${result.rows[0].title}`);
    return result.rows[0];

  } catch (error) {
    await client.query('ROLLBACK');
    throw error;  // re-throw để caller biết
  } finally {
    client.release();  // PHẢI release, nếu không pool bị cạn kiệt
  }
}
```

### Pattern 2: withTransaction helper (recommended)

```typescript
// Helper tái sử dụng — encapsulate BEGIN/COMMIT/ROLLBACK/release
async function withTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Sử dụng helper:
const published = await withTransaction(pool, async (client) => {
  const t = await client.query(
    `UPDATE templates SET status='published' WHERE id=$1 RETURNING *`,
    [templateId]
  );
  if (t.rowCount === 0) throw new Error('Not found');

  await client.query(
    `UPDATE profiles SET reputation_score = reputation_score + 10 WHERE user_id=$1`,
    [authorId]
  );

  return t.rows[0];
});
```

---

## 6.8 Transaction và Connection Pool

**Quan trọng:** Transaction phải ở trên **cùng một DB connection**.

```
Connection Pool:
  conn-1: T1 (BEGIN → UPDATE → COMMIT)
  conn-2: T2 (BEGIN → UPDATE → COMMIT)
  conn-3: free

Nếu T1 dùng conn-1 cho BEGIN, conn-2 cho UPDATE → sai! Chúng là 2 transaction khác nhau.
```

Vì vậy: luôn `pool.connect()` → `client.query(BEGIN)` → dùng `client` cho toàn bộ transaction → `client.release()`.
