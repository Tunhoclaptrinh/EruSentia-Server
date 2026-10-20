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
| `pnpm db:benchmark` | In execution plan cho truy vấn danh sách và full-text search |

`pnpm db:reset` xóa các bảng của dự án. `pnpm db:fresh` chạy reset, schema, indexes và seed. Chỉ dùng các lệnh reset trên database phát triển có thể xóa dữ liệu.

## Build và demo

| Lệnh | Công dụng |
|---|---|
| `pnpm typecheck` | Kiểm tra TypeScript của source và scripts |
| `pnpm test` | Kiểm tra lỗi đầu vào, lỗi kết nối và exit code của các CLI |
| `pnpm build` | Biên dịch source và scripts vào `dist/` |
| `pnpm start` | Chạy `dist/src/main.js` để kiểm tra database |
| `pnpm dev` | Theo dõi thay đổi và chạy lại kiểm tra database |
| `pnpm demo:oop` | Chạy demo đóng gói, kế thừa, đa hình và trừu tượng |
| `pnpm demo:di` | Chạy demo dependency injection và IoC container |

Hiện chưa có HTTP listener, ORM adapter, ESLint hoặc Jest. Bộ kiểm thử CLI dùng test runner có sẵn của Node.js.

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

[Báo cáo và lý thuyết tuần 1](https://github.com/Tunhoclaptrinh/trainning-typ-2026/tree/week-1/week-1) được lưu tại repo TYP.
