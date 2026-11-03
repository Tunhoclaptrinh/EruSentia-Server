# Sentia Hub Service

Backend TypeScript của EruSentia: NestJS, TypeORM và PostgreSQL 16. Tuần 3 phát triển
API Template từ tuần 2 với tài khoản, JWT, quyền sở hữu và refresh-token rotation.
Mã chạy/SQL/tests ở server; báo cáo và lý thuyết ở TYP. App chưa tích hợp API.

## Cài đặt và database

Đã kiểm tra với Node.js **24.21.0**, pnpm **12.11.2**, PostgreSQL **16.15**.

```bash
if [ ! -f .env ]; then cp .env.example .env; fi
pnpm install --frozen-lockfile
docker compose -f docker/docker-compose.dev.yml up -d --wait
pnpm db:check
pnpm db:schema
pnpm db:indexes
pnpm db:seed
pnpm db:auth
```

Compose dùng `sentia_hub_db` tại localhost:5432; Adminer ở http://localhost:8080,
server `postgres`, user `postgres`, password dev `postgres_dev_password`. Đối chiếu
DB_* trong .env trước khi chạy lệnh ghi dữ liệu. Trên Ubuntu, `docker info` cần có
phần Server; nếu chưa chạy daemon, dùng `sudo systemctl start docker` trong terminal.

Với database tuần 2 đã có schema/seed, chỉ cần áp dụng **`pnpm db:auth`** cho tuần 3.
Script `sql/05_auth_sessions.sql` thêm bảng refresh sessions và unique index trên
LOWER(email); không reset bảng cũ. Nếu dữ liệu cũ có email trùng khi bỏ qua hoa thường,
index sẽ báo lỗi để xử lý dữ liệu trước. Bootstrap ORM vẫn tắt synchronize/migrationsRun.
Không dùng `db:fresh` trên database cần giữ: lệnh đó xóa schema để tạo lại.

## Cấu hình JWT và chạy

Tạo khóa ngẫu nhiên rồi đặt `JWT_SECRET` trong .env riêng của máy:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Không commit khóa thật. Production bắt buộc khóa ít nhất 32 byte; development không
đặt khóa sẽ sinh khóa tạm mỗi lần khởi động và ghi cảnh báo. Muốn access token còn
hợp lệ qua restart, dùng khóa ổn định. Access JWT có hạn 15 phút; refresh family có
hạn tuyệt đối 7 ngày từ login.

```bash
pnpm dev
# Hoặc chạy bản build
pnpm build
pnpm start
# Cùng API với bộ lưu trữ memory, không kết nối DB
TEMPLATE_STORE=memory HOST=127.0.0.1 PORT=3001 pnpm dev
```

HOST/PORT mặc định `127.0.0.1:3001`, có thể bị thay bởi .env. `pnpm dev` dùng ts-node
để phát decorator metadata. Memory không có tài khoản/template ban đầu; đăng ký qua
API trước khi tạo template. Có hai category mẫu `...0001` và `...0002`; tài khoản và
sessions mất khi restart. PostgreSQL lưu tài khoản, template và sessions bền vững.

## Authentication và quyền truy cập

| Method | Endpoint | Quyền / kết quả |
|---|---|---|
| POST | `/auth/register` | Công khai; chỉ tạo role user; 201 |
| POST | `/auth/login` | Công khai; JWT + refresh token; 200 |
| POST | `/auth/refresh` | Công khai, cần refresh token mới nhất; 200 |
| POST | `/auth/logout` | Cần refresh token của phiên; 204 |
| GET | `/auth/me` | Bearer JWT; tài khoản hiện tại |
| GET | `/admin/users?page=1&size=10` | Chỉ admin; dữ liệu tài khoản an toàn |
| GET | `/templates`, `/templates/:id` | JWT; public + private của mình; admin xem tất cả |
| POST | `/templates` | JWT; authorId lấy từ người đăng nhập |
| PATCH/DELETE | `/templates/:id` | Tác giả hoặc admin |

Thiếu/sai token trả 401. User/creator gọi API admin trả 403. Template riêng của người
khác trả 404 và không được tính vào total; tài nguyên công khai được đọc nhưng chỉ
chủ sở hữu/admin được sửa hoặc xóa. Body POST/PATCH gửi authorId bị từ chối 400.
Password dùng Argon2id; refresh token ngẫu nhiên chỉ được lưu dưới dạng SHA-256.
Refresh cũ bị dùng lại sẽ thu hồi cả phiên, gồm các access token của phiên đó.
Xem [hợp đồng auth](docs/AUTHENTICATION.md) và [Template API](docs/TEMPLATE_API.md).

### Tạo tài khoản admin cho thực hành PostgreSQL

Không có mật khẩu admin mặc định; seed tuần 1 chứa hash placeholder nên không dùng
để đăng nhập. CLI tạo tài khoản mới, không ghi đè/nâng quyền tài khoản đã tồn tại:

```bash
read -r -s -p 'Admin password (12-128 characters): ' ADMIN_PASSWORD
export ADMIN_PASSWORD
ADMIN_EMAIL=admin@example.test pnpm auth:admin
unset ADMIN_PASSWORD
```

CLI dùng DB_* của .env; nhập password tại terminal, không đặt password thật trong
command history hoặc tài liệu. Memory không có admin cài sẵn; dùng PostgreSQL cho
luồng admin thực hành đầy đủ.

## Swagger/OpenAPI

Mở **http://127.0.0.1:3001/docs**, JSON ở **/docs-json**. Thứ tự thực hành:

1. Register → login bằng Try it out.
2. Sao chép `accessToken` vào **Authorize**, chỉ dán token, không thêm chữ Bearer.
3. Gọi `/auth/me`, tạo/đọc/sửa/xóa template; không gửi authorId trong body.
4. Refresh bằng token mới nhất; cập nhật Authorize bằng access token vừa nhận.
5. Logout bằng refresh token; request protected tiếp theo trả 401.

Đặc tả có 11 operation và Bearer authentication. Swagger bật mặc định ngoài
production; `SWAGGER_ENABLED=false` tắt cả UI/JSON. Production mặc định tắt nếu không
có override. Bộ ảnh Postman/collection v2.1 trong `tools/postman` thuộc tuần 2;
chúng được tái hiện bằng [snapshot tuần 2](https://github.com/Tunhoclaptrinh/EruSentia-Server/tree/b9017f77f6b97a4935fd72d22f2e149f32c4b649),
không chạy nguyên collection cũ trên hợp đồng auth tuần 3.

## Kiểm thử

```bash
pnpm typecheck
pnpm test          # build + 32 pass, 1 DB test skip theo mặc định
pnpm test:auth     # auth memory
pnpm test:api      # CRUD memory có JWT
```

Integration dùng database mới/rỗng **`week3_test_*`**, không reset database có sẵn:

```bash
docker exec sentia_postgres_dev createdb -U postgres week3_test_local
RUN_DB_TESTS=1 DB_HOST=127.0.0.1 DB_PORT=5432 DB_USERNAME=postgres \
  DB_PASSWORD=postgres_dev_password DB_DATABASE=week3_test_local pnpm test:api:db
docker exec sentia_postgres_dev dropdb -U postgres week3_test_local
```

DB suite tự nạp schema/index/seed/migration auth, kiểm tra 19 test gồm CRUD, auth,
rotation/replay đồng thời, admin CLI, hash lưu trữ và persistence qua app mới.
Giới hạn thực nghiệm: chưa có rate limiting, email verification, reset password,
MFA, cookie/CSRF flow, quản lý phiên qua UI hay kiểm thử tải. Chưa tích hợp App.

## Cấu trúc và tài liệu

- `src/auth/`: DTO, guard, JWT/password service, memory/PostgreSQL auth store.
- `src/templates/`: CRUD có quyền sở hữu, validation và persistence adapters.
- `src/openapi.ts`: Swagger UI/JSON từ metadata DTO/controller.
- `sql/05_auth_sessions.sql`: migration auth bổ sung; schema/seed tuần 1 giữ nguyên.
- `scripts/create-admin.ts`: cấp tài khoản admin qua kênh quản trị local.
- `test/`: CLI, JWT/config, HTTP contracts memory và PostgreSQL bằng node:test.
- `src/domain/`, `src/week01-practice/`: domain và demo OOP/DI tuần 1, độc lập ORM.

`pnpm db:check`, `demo:oop`, `demo:di`, `db:benchmark` giữ chức năng riêng. Domain
ITemplateRepository tuần 1 tách biệt TemplateStore dùng cho projection HTTP.
[Thiết kế DB](docs/DATABASE_DESIGN.md) · [Lệnh thực hành](docs/COMMANDS_AND_CHEATSHEET.md) ·
[Tài liệu TYP](docs/TRAINING_REFERENCES.md).
