# Tham chiếu tài liệu TYP

Tài liệu học tập và bằng chứng thực hành được giữ tại repo TYP. Trang này dẫn tới từng bài tương ứng với mã nguồn backend hiện có.

## Tuần 1

- [Báo cáo kỹ thuật](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1/week-1/WEEK1_REPORT.md).
- [Mục lục tài liệu](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1/week-1/docs/00_GUIDE_INDEX.md).
- [Hướng dẫn tái hiện](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1/week-1/README.md).

| Chủ đề | Tài liệu TYP | Mã nguồn / bằng chứng đối chiếu |
|---|---|---|
| Docker và môi trường | [Bài đọc](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1/week-1/docs/01_docker_and_environment_handbook.md) | [Docker Compose](../docker/docker-compose.dev.yml), [Biến môi trường mẫu](../.env.example) |
| SQL và schema | [Bài đọc](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1/week-1/docs/02_sql_basics.md) | [Schema nghiệp vụ](../sql/01_schema.sql), [Seed](../sql/03_seed.sql) |
| Index và EXPLAIN | [Bài đọc](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1/week-1/docs/03_index.md) | [Index](../sql/02_indexes.sql), [Bài benchmark](../sql/04_week01_benchmark.sql) |
| Phân trang | [Bài đọc](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1/week-1/docs/04_pagination.md) | [Ảnh kết quả trong báo cáo](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1/week-1/WEEK1_REPORT.md) |
| Locking | [Bài đọc](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1/week-1/docs/05_locking.md) | [Thực hành hai session trong báo cáo](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1/week-1/WEEK1_REPORT.md) |
| Transaction | [Bài đọc](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1/week-1/docs/06_transaction.md) | [Transaction trong seed](../scripts/seed.ts) |
| OOP | [Bài đọc](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1/week-1/docs/07_oop.md) | [Demo OOP](../src/week01-practice/oop/demo.ts), [Domain entities](../src/domain/entities/Template.ts) |
| DI và IoC | [Bài đọc](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1/week-1/docs/08_di_ioc.md) | [Demo DI](../src/week01-practice/di/demo.ts), [Repository interface hiện có](../src/domain/repositories/ITemplateRepository.ts) |

Các ví dụ SQL/TypeScript trong bài đọc có thể minh họa mô hình mở rộng. Những file đã triển khai được dẫn cụ thể trong bảng trên. Demo DI dùng repository Postgres mô phỏng; các script `db:*` kết nối database thật.

## Cách dùng liên kết giữa hai repo

- Các liên kết TYP ở đây dùng tag lưu trữ `typ-2026-week-1`; phần `week-1` tiếp theo là tên thư mục tài liệu.
- TYP ghim các dẫn chứng backend bằng mã commit đầy đủ. Bản lưu trữ vẫn mở được SQL, seed và demo tại mốc đó khi các file thay đổi hoặc bị xóa trong những commit mới.
- Giữ nguyên tag đã chốt; mốc báo cáo mới dùng tag mới. Commit/tag cần được đẩy lên remote để các liên kết GitHub truy cập được.
- [Cách mở và tải toàn bộ bản nguồn đã chốt](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1/week-1/SOURCE_SNAPSHOT.md) nằm trong bản lưu trữ TYP.

[Về README backend](../README.md).
