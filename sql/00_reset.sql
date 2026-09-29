-- ==============================================================================
-- SENTIA HUB SERVICE - DATABASE RESET (WIPE ALL TABLES & DATA)
-- Cẩn trọng: Lệnh này sẽ xóa sạch toàn bộ bảng và dữ liệu trong schema public
-- ==============================================================================

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- Khôi phục quyền mặc định cho schema public
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;

-- Bật lại các extension cần thiết
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
