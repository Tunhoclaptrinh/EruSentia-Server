-- =============================================================================
-- WEEK 1 — BENCHMARK & INDEX DEMO
-- Chạy file này để tạo dữ liệu test và thực hành EXPLAIN ANALYZE
-- =============================================================================

-- Bật timing
\timing on

-- -----------------------------------------------------------------------------
-- BƯỚC 1: Tạo thêm dữ liệu benchmark (100,000 users)
-- Chú ý: chạy sau khi đã có schema + seed cơ bản
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- Chỉ insert nếu chưa có benchmark data
  IF (SELECT COUNT(*) FROM users WHERE email LIKE 'bench_%') = 0 THEN
    INSERT INTO users (id, email, password_hash, role, is_active)
    SELECT
      gen_random_uuid(),
      'bench_' || i || '@erusentia.test',
      '$2b$10$placeholder_hash_for_bench',
      CASE WHEN i % 5 = 0 THEN 'creator' ELSE 'user' END,
      (i % 10 != 0)
    FROM generate_series(1, 100000) AS i;

    RAISE NOTICE 'Inserted 100,000 benchmark users';
  ELSE
    RAISE NOTICE 'Benchmark data already exists, skipping';
  END IF;
END $$;

SELECT COUNT(*) AS total_users FROM users;

-- -----------------------------------------------------------------------------
-- BƯỚC 2: Tạo bảng tạm không có index (để so sánh)
-- -----------------------------------------------------------------------------
DROP TABLE IF EXISTS users_no_index;
CREATE TABLE users_no_index AS SELECT * FROM users;

-- Kiểm tra: bảng này không có index gì
SELECT indexname FROM pg_indexes WHERE tablename = 'users_no_index';
-- → rỗng

-- -----------------------------------------------------------------------------
-- BƯỚC 3: Query KHÔNG có index
-- Ghi lại: Execution Time = ??? ms
-- -----------------------------------------------------------------------------
EXPLAIN ANALYZE
SELECT * FROM users_no_index WHERE email = 'bench_50000@erusentia.test';

-- -----------------------------------------------------------------------------
-- BƯỚC 4: Query CÓ index (bảng gốc có UNIQUE constraint → tự có index)
-- Ghi lại: Execution Time = ??? ms
-- -----------------------------------------------------------------------------
EXPLAIN ANALYZE
SELECT * FROM users WHERE email = 'bench_50000@erusentia.test';

-- -----------------------------------------------------------------------------
-- BƯỚC 5: Test với cột chưa có index — is_active (boolean, cardinality thấp)
-- -----------------------------------------------------------------------------
-- Trước:
EXPLAIN ANALYZE SELECT COUNT(*) FROM users WHERE is_active = TRUE;

-- Tạo index:
CREATE INDEX IF NOT EXISTS idx_bench_users_active ON users(is_active);

-- Sau:
EXPLAIN ANALYZE SELECT COUNT(*) FROM users WHERE is_active = TRUE;
-- → Quan sát: PostgreSQL có thể vẫn dùng Seq Scan! Tại sao?

-- -----------------------------------------------------------------------------
-- BƯỚC 6: Xem tất cả index trong DB
-- -----------------------------------------------------------------------------
SELECT
    indexname,
    tablename,
    pg_size_pretty(pg_relation_size(indexname::regclass)) AS index_size,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

-- -----------------------------------------------------------------------------
-- CLEANUP (chạy khi xong để dọn dẹp)
-- -----------------------------------------------------------------------------
-- DROP TABLE IF EXISTS users_no_index;
-- DROP INDEX IF EXISTS idx_bench_users_active;
-- DELETE FROM users WHERE email LIKE 'bench_%';
