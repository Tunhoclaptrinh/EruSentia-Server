# Sentia Hub Service

Backend TypeScript của EruSentia: PostgreSQL 16, NestJS và TypeORM. API tuần 2 quản lý
Template trên schema tuần 1; mã nguồn chạy, SQL và kiểm thử tập trung tại repo này.
Báo cáo/lý thuyết nằm tại repo TYP.

## Cài đặt

Đã kiểm tra với Node.js **24.21.0**, pnpm **12.11.2**, PostgreSQL **16.15**.

```bash
if [ ! -f .env ]; then cp .env.example .env; fi
pnpm install --frozen-lockfile
docker compose -f docker/docker-compose.dev.yml up -d --wait
pnpm db:check
pnpm db:schema
pnpm db:indexes
pnpm db:seed
```

Compose: DB `sentia_hub_db` tại localhost:5432; Adminer ở http://localhost:8080,
server `postgres`, user `postgres`, password dev `postgres_dev_password`.
Đặt `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_DATABASE` trong `.env` nếu
khác môi trường này. Không ghi đè `.env` đang có.

Trên Ubuntu, `docker info` cần có phần Server; nếu daemon chưa chạy, mở terminal
Ubuntu và dùng `sudo systemctl start docker`.
[Hướng dẫn Ubuntu](https://github.com/Tunhoclaptrinh/trainning-typ-2026/blob/typ-2026-week-1-reviewed/week-1/docs/01_docker_and_environment_handbook.md#7-chạy-thực-tế-trên-ubuntu-native)
được quản lý tại TYP.

## Chạy API tuần 2

```bash
# PostgreSQL/TypeORM — mặc định
pnpm dev
# Hoặc bản biên dịch
pnpm build
pnpm start
```

API mặc định ở **http://127.0.0.1:3001**; đổi bằng `HOST`, `PORT`.
`pnpm dev` dùng ts-node để giữ decorator metadata của NestJS; Node watch khởi động
lại khi file TypeScript được import thay đổi. Không chạy bootstrap NestJS qua tsx
vì tsx/esbuild không phát đầy đủ `emitDecoratorMetadata`.

Để học bước CRUD chưa có DB, đổi adapter cho **cùng API**:

```bash
TEMPLATE_STORE=memory pnpm dev
```

Memory mode không mở kết nối DB, khởi đầu không có templates, mất dữ liệu khi restart.
Có sẵn tham chiếu mẫu cho author seed `...0002`, `...0003` và category `...0001`, `...0002`.
PostgreSQL mode đọc dữ liệu thực, `synchronize: false`, không tự sửa schema.

| Method | Endpoint | Hành vi |
|--------|----------|---------|
| GET | `/templates?page=1&size=10` | Danh sách, lọc và phân trang |
| GET | `/templates/:id` | Chi tiết + category, không tăng view |
| POST | `/templates` | Tạo mới; 201 |
| PATCH | `/templates/:id` | Cập nhật các field được gửi; 200 |
| DELETE | `/templates/:id` | Soft delete; 204, không body |

Xem [hợp đồng và ví dụ cURL](docs/TEMPLATE_API.md).
Đã [đối chiếu dữ liệu Template với App hiện tại](docs/APP_TEMPLATE_CONTRACT.md):
HTML và metadata nằm trong content_json; App vẫn dùng localStorage, chưa tích hợp API.
API hiện phục vụ thực hành local, chưa có đăng nhập/phân quyền của tuần 3; `authorId`
ở POST là dữ liệu đầu vào, chưa được xác thực là người gọi. Endpoint quản lý có thể
đọc template private; không coi đây là public feed đã áp quyền truy cập.

## Swagger/OpenAPI

Khi API đang chạy, mở **http://127.0.0.1:3001/docs** để xem 5 endpoint, query/body,
response schema và dùng **Try it out**. Đặc tả JSON ở **/docs-json**, cùng host/port
với API; dùng được ở cả memory và PostgreSQL. Tạo template trước rồi dùng ID trả về
cho GET/PATCH/DELETE; mỗi POST cần slug mới vì soft-delete vẫn giữ slug.

Swagger bật mặc định ngoài production. Đặt `SWAGGER_ENABLED=false` để tắt cả UI/JSON,
hoặc `SWAGGER_ENABLED=true` để bật tường minh; `NODE_ENV=production` mặc định tắt nếu
không có override. Không cần Postman để thao tác API qua Swagger UI.

## Kiểm thử

```bash
pnpm typecheck
pnpm test             # build + CLI/HTTP memory/OpenAPI: 18 pass; DB test mặc định skip
pnpm test:api         # HTTP contract memory, không cần PostgreSQL
```

Integration test dùng **database mới, rỗng, riêng biệt** có tên `week2_test_*`:

```bash
docker exec sentia_postgres_dev createdb -U postgres week2_test_local
RUN_DB_TESTS=1 DB_HOST=127.0.0.1 DB_PORT=5432 DB_USERNAME=postgres \
  DB_PASSWORD=postgres_dev_password DB_DATABASE=week2_test_local pnpm test:api:db
# Sau khi test xong; lần test kế tiếp tạo DB mới hoặc drop/create lại đúng DB test này.
docker exec sentia_postgres_dev dropdb -U postgres week2_test_local
```

Test tự nạp schema/index/seed vào DB test rỗng. Nếu đã có bảng, test từ chối thay vì
reset. Kiểm tra validation, 5 API, pagination, unique slug cả khi ghi đồng thời,
soft-delete, không tăng view ngầm, dữ liệu còn sau tạo app mới và schema không đổi.

Để tái hiện bộ minh chứng Postman, mở collection bằng **Native Git Local mode**
theo hướng dẫn bên dưới. Đặt `baseUrl` và chạy collection theo thứ tự. Collection tạo slug riêng rồi soft-delete
row vừa tạo. Có thể chạy collection v2.1 qua Newman tạm:

```bash
pnpm dlx newman@6.2.3 run tools/postman/templates.postman_collection.json --bail
```

Newman chỉ dùng để kiểm chứng collection v2.1 này; không cài global hoặc thêm vào
runtime. HTTP tests Node vẫn là bộ test chính trong repo.
Collection có 12 request, 30 assertion, kiểm tra HTML/metadata và CRUD trên cùng ID.
Hướng dẫn thao tác Postman và ảnh thật nằm tại TYP `week-2/docs/09_postman.md`.

Với Postman 12, có thể dùng **Native Git Local mode** để cấu hình Variables,
Environment và chạy Runner mà không đưa collection lên Cloud:

```bash
node tools/postman/prepare-local.cjs
```

Mở đường dẫn lệnh in ra bằng **Open Folder**, sau đó chọn **Local Items**. File
`tools/postman/erusentia-local.postman_environment.json` chỉ có baseUrl localhost.
Script tạo bản v3 local từ collection v2.1 chuẩn đang dùng cho Newman, không thêm
dependency, không tạo Git repo hay liên kết Cloud và không ghi đè folder đã có.
Giữ bản local khi thực hành; không dùng Push to Cloud. Hướng dẫn TYP minh họa từng
bước cấu hình và kết quả Runner local 30/30 assertion.

## Database và demo tuần 1

`pnpm db:check` vẫn chỉ kiểm tra DB rồi thoát, đã chuyển sang `scripts/check-db.ts`.
`pnpm start` từ tuần 2 **khởi động HTTP API**, không còn là lệnh kiểm tra DB.

`db:seed` nạp 12 template mẫu + tối đa 1.000 template benchmark, chạy lại không nhân
đôi. `db:benchmark`, `demo:oop`, `demo:di` giữ nguyên cách chạy. Demo DI tuần 1 vẫn
là stub; adapter PostgreSQL thật của API nằm trong `src/templates/persistence/`.

## Cấu trúc

```text
src/
  main.ts, app.ts, config.ts  # Bootstrap NestJS, cấu hình, chọn adapter
  common/                    # Error response và UUID pipe
  templates/                 # Controller, service, DTO, catalog port
    persistence/             # Memory store, TypeORM store, entity mapping
  domain/                    # Domain entities và port tuần 1, không gắn ORM decorators
  infrastructure/database/   # pg pool dùng cho CLI db:*
  week01-practice/            # Demo OOP/DI TypeScript
scripts/                     # db:check, SQL runner, seed, benchmark
test/                        # CLI và HTTP contract/integration bằng node:test
tools/postman/               # Collection v2.1 có assertions
sql/                         # Schema tuần 1 giữ nguyên, nguồn bootstrap DB
```

`TemplateStore` là port cho projection HTTP (category, pagination); chưa thay thế
`ITemplateRepository` nhận/trả domain entity tuần 1. Các ORM decorators nằm ở adapter
lưu trữ; domain model tuần 1 vẫn độc lập với TypeORM.

- [Database design](docs/DATABASE_DESIGN.md).
- [Lệnh vận hành](docs/COMMANDS_AND_CHEATSHEET.md).
- [Tham chiếu tài liệu TYP](docs/TRAINING_REFERENCES.md).
- [Bản lưu tuần 1](https://github.com/Tunhoclaptrinh/trainning-typ-2026/tree/typ-2026-week-1-reviewed/week-1).

Swagger/OpenAPI dùng metadata của DTO/controller; bộ kiểm thử xác nhận UI/JSON,
schema cập nhật và payload mẫu thực thi được. Hướng dẫn và bằng chứng tuần 2 nằm tại TYP.
