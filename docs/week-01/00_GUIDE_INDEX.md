# 🗺️ TÀI LIỆU KỸ THUẬT & HƯỚNG DẪN THỰC HÀNH TUẦN 1

> Tổng hợp toàn bộ 8 chuyên đề lý thuyết chuyên sâu, phân tích kỹ thuật và mã nguồn thực hành của Tuần 1.

---

## 📁 Cấu trúc tài liệu

| Tài liệu | Nội dung trọng tâm |
|----------|-------------------|
| [01_docker_and_environment_handbook.md](./01_docker_and_environment_handbook.md) | Kiến trúc môi trường Docker, WSL 2, mạng container và PostgreSQL 16 |
| [02_sql_basics.md](./02_sql_basics.md) | DDL/DML, Foreign Keys, UUID PK, Soft Delete, INNER/LEFT JOIN, GROUP BY & Aggregate |
| [03_index.md](./03_index.md) | Cấu trúc dữ liệu B-Tree Index, chi phí tra cứu và phương pháp đo kiểm EXPLAIN ANALYZE |
| [04_pagination.md](./04_pagination.md) | So sánh chi tiết kỹ thuật Offset-based vs Cursor-based Pagination |
| [05_locking.md](./05_locking.md) | Cơ chế Pessimistic Lock (`FOR UPDATE`), Optimistic Lock (Version) và xử lý Deadlock |
| [06_transaction.md](./06_transaction.md) | Nguyên lý ACID, các cấp độ Isolation và kỹ thuật kiểm soát điểm lưu (Savepoint) |
| [07_oop.md](./07_oop.md) | 4 tính chất OOP (Encapsulation, Inheritance, Polymorphism, Abstraction) trên TypeScript |
| [08_di_ioc.md](./08_di_ioc.md) | Kiến trúc Dependency Injection, Inversion of Control Container và ứng dụng trong NestJS |

---

## 🏗️ Mã nguồn thực hành & Báo cáo kết quả

| Đường dẫn | Nội dung |
|-----------|----------|
| [`src/week01-practice/oop/demo.ts`](../../src/week01-practice/oop/demo.ts) | Thực nghiệm 4 tính chất OOP (Encapsulation, Inheritance, Polymorphism, Abstraction) |
| [`src/week01-practice/di/demo.ts`](../../src/week01-practice/di/demo.ts) | Thực nghiệm Dependency Injection & DI Container |
| [`sql/`](../../sql/) | Toàn bộ script DDL Schema, Index, Seed nghiệp vụ cốt lõi & Benchmark đo kiểm |
| [`WEEK1_REPORT.md`](./WEEK1_REPORT.md) | Báo cáo chi tiết: Đo kiểm Index (100,000 dòng), Locking, Transaction & 12 ảnh chụp thực tế |

---

## 📋 Kết quả hoàn thành

| # | Hạng mục yêu cầu | Trạng thái |
|---|-----------------|------------|
| 1 | Trình bày lý thuyết Database + OOP | ✅ Hoàn thành |
| 2 | Database có dữ liệu mẫu, chạy được JOIN / GROUP BY | ✅ Hoàn thành |
| 3 | Demo sự khác nhau trước/sau khi đánh Index (EXPLAIN ANALYZE) | ✅ Hoàn thành |
| 4 | Demo cơ chế Locking: Chạy transaction kiểm chứng lock hoạt động | ✅ Hoàn thành |
