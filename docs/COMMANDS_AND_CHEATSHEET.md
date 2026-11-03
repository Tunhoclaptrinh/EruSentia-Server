# Lệnh vận hành Sentia Hub

Chạy các lệnh dưới đây từ thư mục gốc của repo `EruSentia-Server` sau khi cài bằng `pnpm install --frozen-lockfile` và cấu hình `.env`.

## Database

| Lệnh | Công dụng |
|---|---|
| `docker compose -f docker/docker-compose.dev.yml up -d` | Khởi động PostgreSQL và Adminer |
| `docker compose -f docker/docker-compose.dev.yml ps` | Xem trạng thái container |
| `docker compose -f docker/docker-compose.dev.yml logs -f postgres` | Xem log PostgreSQL |
| `docker compose -f docker/docker-compose.dev.yml down` | Dừng container, giữ volume dữ liệu |
| `pnpm db:check` | Kiểm tra kết nối PostgreSQL rồi đóng pool |
| `pnpm db:schema` | Tạo 9 bảng nghiệp vụ bằng `sql/01_schema.sql` |
| `pnpm db:indexes` | Tạo các index bằng `sql/02_indexes.sql` |
| `pnpm db:seed` | Nạp seed và 1.000 template benchmark trong một transaction |
| `pnpm db:auth` | Áp dụng migration bổ sung refresh sessions và index email cho tuần 3 |
| `pnpm db:benchmark` | In execution plan cho truy vấn danh sách và full-text search |

`pnpm db:reset` xóa schema public và các đối tượng bên trong. `pnpm db:fresh` chạy
reset, schema, indexes, seed và db:auth. Chỉ dùng trên database có thể xóa dữ liệu.

## Build và demo

| Lệnh | Công dụng |
|---|---|
| `pnpm typecheck` | Kiểm tra TypeScript của source và scripts |
| `pnpm test` | Build, kiểm tra CLI và HTTP contract memory; DB test skip nếu chưa bật |
| `pnpm test:auth` | Kiểm thử JWT, quyền sở hữu và refresh rotation bằng memory |
| `pnpm auth:admin` | Tạo admin mới từ ADMIN_EMAIL/ADMIN_PASSWORD; không ghi đè tài khoản |
| `pnpm build` | Biên dịch source và scripts vào `dist/` |
| `pnpm start` | Khởi động HTTP API tại localhost:3001, mặc định dùng TypeORM/PostgreSQL |
| `pnpm dev` | Theo dõi source TypeScript và khởi động lại NestJS HTTP API |
| `pnpm demo:oop` | Chạy demo đóng gói, kế thừa, đa hình và trừu tượng |
| `pnpm demo:di` | Chạy demo dependency injection và IoC container |

Tuần 3 bổ sung JWT/ownership trên NestJS/TypeORM. Bộ kiểm thử CLI/HTTP dùng node:test.
Xem [Template API](TEMPLATE_API.md), [Auth API](AUTHENTICATION.md) và README để chạy
memory, DB integration và Swagger. Collection Postman giữ hợp đồng lịch sử tuần 2.

## Thực hành PostgreSQL

```bash
docker exec -it sentia_postgres_dev psql -U postgres -d sentia_hub_db
```

Trong `psql`: `\dt` liệt kê bảng, `\d templates` xem cấu trúc, `\di` liệt kê index, `\timing` bật đo thời gian, `\q` thoát.

Bài benchmark index tuần 1 có lệnh riêng của `psql`, nên chạy bằng:

```bash
docker exec -i sentia_postgres_dev psql -v ON_ERROR_STOP=1 -U postgres -d sentia_hub_db < sql/04_week01_benchmark.sql
```

Bài này thêm 100.000 user benchmark và tạo `users_no_index`. Dùng database thực hành riêng khi cần tái hiện; các lệnh dọn dữ liệu nằm cuối file SQL.

Đọc `EXPLAIN ANALYZE` theo dữ liệu và điều kiện lọc thực tế. Việc có index không đảm bảo PostgreSQL luôn chọn index scan.

[Báo cáo và lý thuyết tuần 1](https://github.com/Tunhoclaptrinh/trainning-typ-2026/tree/typ-2026-week-1/week-1) được lưu tại repo TYP.

Xem [bảng tham chiếu TYP](TRAINING_REFERENCES.md) để mở đúng bài Docker, Index, Transaction, OOP hoặc DI tương ứng.

## Tuần 4 — welcome email qua RabbitMQ

```bash
docker compose -f docker/docker-compose.queue.yml up -d --wait
pnpm db:queue
QUEUE_ENABLED=true pnpm dev
# Terminal khác, cùng DB_* và QUEUE_NAMESPACE:
QUEUE_ENABLED=true pnpm worker:welcome
# Chỉ dùng database mới/rỗng week4_test_*:
RUN_QUEUE_TESTS=1 DB_DATABASE=week4_test_local pnpm test:queue
```

RabbitMQ UI `127.0.0.1:15672`, Mailpit UI `127.0.0.1:8025`. Đặt DB_* trước lệnh ghi.
`db:fresh` nay chạy thêm migration queue sau auth và vẫn xóa toàn bộ schema hiện có.
Không dùng trên dữ liệu cần giữ. [Hướng dẫn MQ](MESSAGE_QUEUE.md).
