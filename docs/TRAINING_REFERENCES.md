# Tham chiếu tài liệu TYP

Tài liệu học tập và bằng chứng thực hành được giữ tại repo TYP. Trang này dẫn tới từng bài tương ứng với mã nguồn backend hiện có.

## Tuần 1 — bản lưu sau hiệu đính

- [Báo cáo kỹ thuật](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1-reviewed/week-1/WEEK1_REPORT.md).
- [Mục lục tài liệu](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1-reviewed/week-1/docs/00_GUIDE_INDEX.md).
- [Hướng dẫn tái hiện](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1-reviewed/week-1/docs/00_GUIDE_INDEX.md).

| Chủ đề | Tài liệu TYP | Mã nguồn / bằng chứng đối chiếu |
|---|---|---|
| Docker và môi trường | [Bài đọc](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1-reviewed/week-1/docs/01_docker_and_environment_handbook.md) | [Docker Compose](../docker/docker-compose.dev.yml), [Biến môi trường mẫu](../.env.example) |
| SQL và schema | [Bài đọc](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1-reviewed/week-1/docs/02_sql_basics.md) | [Schema nghiệp vụ](../sql/01_schema.sql), [Seed](../sql/03_seed.sql) |
| Index và EXPLAIN | [Bài đọc](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1-reviewed/week-1/docs/03_index.md) | [Index](../sql/02_indexes.sql), [Bài benchmark](../sql/04_week01_benchmark.sql) |
| Phân trang | [Bài đọc](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1-reviewed/week-1/docs/04_pagination.md) | [Ảnh kết quả trong báo cáo](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1-reviewed/week-1/WEEK1_REPORT.md) |
| Locking | [Bài đọc](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1-reviewed/week-1/docs/05_locking.md) | [Thực hành hai session trong báo cáo](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1-reviewed/week-1/WEEK1_REPORT.md) |
| Transaction | [Bài đọc](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1-reviewed/week-1/docs/06_transaction.md) | [Transaction trong seed](../scripts/seed.ts) |
| OOP | [Bài đọc](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1-reviewed/week-1/docs/07_oop.md) | [Demo OOP](../src/week01-practice/oop/demo.ts), [Domain entities](../src/domain/entities/Template.ts) |
| DI và IoC | [Bài đọc](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1-reviewed/week-1/docs/08_di_ioc.md) | [Demo DI](../src/week01-practice/di/demo.ts), [Repository interface hiện có](../src/domain/repositories/ITemplateRepository.ts) |

Các ví dụ SQL/TypeScript trong bài đọc có thể minh họa mô hình mở rộng. Những file đã triển khai được dẫn cụ thể trong bảng trên. Demo DI dùng repository Postgres mô phỏng; các script `db:*` kết nối database thật.

## Cách dùng liên kết giữa hai repo

- Các liên kết TYP ở đây dùng tag lưu trữ `typ-2026-week-1-reviewed`; phần `week-1` tiếp theo là tên thư mục tài liệu.
- TYP ghim các dẫn chứng backend bằng mã commit đầy đủ. Bản lưu trữ vẫn mở được SQL, seed và demo tại mốc đó khi các file thay đổi hoặc bị xóa trong những commit mới.
- Tag `typ-2026-week-1` vẫn giữ bản trước hiệu đính. Giữ nguyên các tag đã chốt; mốc báo cáo mới dùng tag mới. Commit/tag cần được đẩy lên remote để các liên kết GitHub truy cập được.
- [Cách mở và tải toàn bộ bản nguồn đã chốt](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1-reviewed/week-1/SOURCE_SNAPSHOT.md) nằm trong bản lưu trữ TYP.

[Về README backend](../README.md).

## Tuần 2

Bản nguồn đã chốt: [server b9017f7](https://github.com/Tunhoclaptrinh/EruSentia-Server/tree/b9017f77f6b97a4935fd72d22f2e149f32c4b649).
[Báo cáo và nguồn đối chiếu tuần 2](https://github.com/Tunhoclaptrinh/trainning-typ-2026/tree/bafe279cb9c397210bb965306983a5ff607eff55/week-2)
giữ hợp đồng CRUD trước khi thêm auth. Swagger UI/JSON cơ bản nằm trong mốc đó.

## Tuần 3 — Authentication và Authorization

Server nhánh `feat/week-3-auth`; báo cáo và lý thuyết ở TYP, nhánh `week-3`.
[Báo cáo tuần 3](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-3/week-3/WEEK3_REPORT.md),
[mục lục](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-3/week-3/docs/00_GUIDE_INDEX.md)
và [snapshot nguồn](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-3/week-3/SOURCE_SNAPSHOT.md)
dùng tag lưu trữ `typ-2026-week-3`. Giữ nguyên tag này khi có cập nhật về sau.

Hợp đồng hiện tại: [Authentication](AUTHENTICATION.md), [Template](TEMPLATE_API.md),
[cách chạy/Swagger](../README.md).

## Tuần 4 — Message Queue

Server nhánh `feat/week-4-message-queue`; tài liệu TYP ở nhánh `week-4`.
[Báo cáo tuần 4](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-4/week-4/WEEK4_REPORT.md),
[mục lục](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-4/week-4/docs/00_GUIDE_INDEX.md)
và [snapshot nguồn](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-4/week-4/SOURCE_SNAPSHOT.md)
dùng tag lưu trữ `typ-2026-week-4`. Giữ nguyên tag này khi cập nhật về sau.

[Message Queue](MESSAGE_QUEUE.md) mô tả triển khai hiện tại; nguồn/báo cáo tuần 3
vẫn được giữ tại tag TYP `typ-2026-week-3`.

## Tuần 5 — Caching và Redis

Server nhánh `feat/week-5-redis-cache`; tài liệu TYP ở nhánh `week-5`.
[Báo cáo tuần 5](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-5/week-5/WEEK5_REPORT.md),
[mục lục](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-5/week-5/docs/00_GUIDE_INDEX.md)
và [snapshot nguồn](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-5/week-5/SOURCE_SNAPSHOT.md)
dùng tag lưu trữ `typ-2026-week-5`. Giữ nguyên tag khi cập nhật về sau;
commit/tag cần được push để các đường dẫn GitHub truy cập được.

[Redis cache](CACHE.md) mô tả triển khai hiện tại; các mốc tuần 1–4 được giữ nguyên.
