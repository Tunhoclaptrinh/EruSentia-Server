# Sentia Hub Service

Backend quản lý template và tài liệu cộng đồng. Repo này lưu mã nguồn thực thi, schema PostgreSQL, script vận hành và kiểm thử.

Hiện tại đã có nền tảng database, domain models và demo OOP/DI. HTTP API chưa được triển khai; `pnpm db:check` và `pnpm start` chỉ kiểm tra kết nối PostgreSQL rồi thoát.

## Cài đặt và chạy

Cần Node.js, pnpm `12.11.2` theo `packageManager`, cùng Docker Compose hoặc PostgreSQL 16 có sẵn.

```bash
cp .env.example .env
pnpm install --frozen-lockfile
docker compose -f docker/docker-compose.dev.yml up -d
pnpm db:check
pnpm db:schema
pnpm db:indexes
pnpm db:seed
```

Compose tạo PostgreSQL tại `localhost:5432`, database `sentia_hub_db`. Adminer ở `http://localhost:8080`, server `postgres`, user `postgres`, mật khẩu phát triển `postgres_dev_password`. Nếu dùng PostgreSQL riêng, đặt các biến `DB_*` trong `.env` theo môi trường đó.

`db:schema` tạo 9 bảng nghiệp vụ; `db:seed` nạp 12 template mẫu và tối đa 1.000 template benchmark. Seed có thể chạy lại mà không nhân đôi các bản ghi này. Hai bảng phụ trong ảnh báo cáo tuần 1 là dữ liệu thực hành, không thuộc schema nghiệp vụ.

## Kiểm tra

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm start
pnpm demo:oop
pnpm demo:di
pnpm db:benchmark
```

`test` kiểm tra hành vi và exit code của các CLI khi thiếu đầu vào hoặc mất kết nối database. `start` và `db:benchmark` cần PostgreSQL đang chạy. Các lệnh database trả exit code khác 0 khi thất bại.

`pnpm dev` chạy lại bước kiểm tra database khi mã nguồn thay đổi. Lệnh này chưa khởi động HTTP server.

## Cấu trúc hiện có

```text
src/
  domain/entities/          # BaseEntity, User, Template
  domain/repositories/      # Interface ITemplateRepository
  infrastructure/database/ # PostgreSQL pool và quản lý client
  week01-practice/           # Demo OOP và DI độc lập
  main.ts                    # Kiểm tra kết nối database
scripts/                     # Chạy SQL, seed, EXPLAIN ANALYZE
sql/                         # Schema, indexes, seed và bài thực hành SQL
test/                       # Kiểm thử CLI
```

Domain entities không phụ thuộc thư viện database. `ITemplateRepository` hiện là interface; adapter ORM và HTTP layer sẽ được bổ sung trong giai đoạn tiếp theo.

Demo DI dùng repository Postgres mô phỏng để giải thích cách thay dependency. Chỉ các script `db:*` mới kết nối PostgreSQL thật.

## Tài liệu

- [Thiết kế database](docs/DATABASE_DESIGN.md).
- [Lệnh vận hành và thực hành](docs/COMMANDS_AND_CHEATSHEET.md).
- [Báo cáo tuần 1](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/week-1/week-1/WEEK1_REPORT.md), [lý thuyết và hướng dẫn](https://github.com/Tunhoclaptrinh/trainning-typ-2026/tree/week-1/week-1/docs), [ảnh demo](https://github.com/Tunhoclaptrinh/trainning-typ-2026/tree/week-1/week-1/screenshots) được quản lý tại repo TYP.

Các phép đo hiệu năng cần đi kèm dữ liệu đầu vào và execution plan; repo không cam kết một mức thời gian cố định cho mọi môi trường.
