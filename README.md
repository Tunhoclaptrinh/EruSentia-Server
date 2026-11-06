# Sentia Hub Service

Backend TypeScript của EruSentia: NestJS, TypeORM và PostgreSQL 16. Tuần 3 phát triển
API Template từ tuần 2 với tài khoản, JWT, quyền sở hữu và refresh-token rotation.
Tuần 4 bổ sung welcome email bất đồng bộ bằng RabbitMQ, outbox và worker riêng.
Tuần 5 bổ sung Redis cache; bước chuẩn bị project thêm CORS và danh mục có JWT.
Mã chạy/SQL/tests ở server; báo cáo và lý thuyết ở TYP. Đợt C0–C1 đã ghép tài khoản
với client; App đã bổ sung catalog template, xem thử cô lập và bản sao local ở C2.
Xuất bản nội dung và giao diện Creator/Admin thuộc các chặng tiếp theo.

## Stack project: chạy bằng một lệnh

```bash
pnpm stack:up          # PostgreSQL + RabbitMQ + Redis + Mailpit + API + worker
pnpm stack:up api      # API và các dependency; không mở worker
pnpm stack:up worker   # Worker cùng dependency
pnpm stack:status
pnpm stack:down        # Dừng, giữ volume
```

Để mở **cả App và backend**, từ thư mục cha `EruSentia` có `package.json` và README điều phối:

```bash
pnpm start          # App desktop Electron + toàn bộ backend/hạ tầng Docker
pnpm start:desktop  # Alias của pnpm start
pnpm start:web      # App web + backend/hạ tầng Docker
pnpm stop           # Dừng Docker, giữ volume/dữ liệu
```

`pnpm start`/`start:desktop` ở thư mục ngoài cùng cần `pnpm setup:app` hoặc
`pnpm install --frozen-lockfile` trong App trước lần chạy đầu. Nếu chỉ clone từng
repo và chưa có bộ điều phối, dùng các lệnh bên trong App/server.
Các lệnh `stack:up`, `dev:all`, `dev:all:desktop` của App vẫn dùng được.
`pnpm start` **trong repo server** chỉ chạy API đã build; không khởi động App.
Stack project dùng DB `eru_project_docker` và tự migrate/seed mỗi lần mở. Tài khoản ban đầu:
`user@erusentia.test`, `creator@erusentia.test`, `admin@erusentia.test`; mật khẩu
chung **`EruSentiaDemo!2026`**, chỉ dùng cho phát triển. Seed không ghi đè bản ghi
đã chỉnh. [Hướng dẫn đầy đủ và các cổng](docs/LOCAL_DEVELOPMENT.md).

## Hosted demo miễn phí

- **Đang chọn: [Render Free + Neon, từng bước và CI/CD GitHub](docs/RENDER_NEON.md)**.
  `render.yaml` tạo một API Docker có Swagger, PostgreSQL TLS tại Neon; Render chờ
  GitHub Actions thành công trước auto-deploy. Queue/worker/cache tắt trên hosted demo,
  stack local vẫn đầy đủ. Không seed tài khoản mật khẩu mặc định.
- [Oracle Always Free để chạy đủ stack](docs/FREE_HOSTING.md): Compose overlay riêng,
  giữ queue/cache/worker và Caddy HTTPS.

Cấu hình đã có trong repo; cần tạo tài khoản/dịch vụ, điền credential và nghiệm thu
trên cloud. Push `main` chỉ auto-deploy sau khi đã kết nối Render theo hướng dẫn.

## Cài đặt và database thực hành tuần học

**Nhánh C3-A:** [revision, If-Match và lịch sử template](docs/TEMPLATE_REVISIONS.md)
bổ sung chống ghi đè, history và restore private. Đây là thay đổi contract ghi:
PATCH/DELETE cần If-Match; database cần migration `08_template_revisions.sql`.
Nhánh này chưa được merge/deploy lên hosted demo.

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
pnpm db:revisions  # C3: revision/history; không reset dữ liệu
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

### Database riêng cho project C0–C1

Giữ database thực hành/benchmark để tái hiện tuần học. Với DB project **mới**:

```bash
# Chỉ tạo khi tên này chưa tồn tại; nếu đã có thì không xóa/reset.
docker exec sentia_postgres_dev createdb -U postgres eru_project_local
DB_DATABASE=eru_project_local pnpm project:migrate
DB_DATABASE=eru_project_local pnpm project:seed
```

Đối chiếu DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD trong `.env` với Compose trước khi
chạy. CLI bắt buộc DB_DATABASE tường minh có prefix `eru_project_` hoặc `project_test_`;
không nhận `sentia_hub_db`. Migration dùng journal `eru_schema_migrations`, checksum
chuẩn hóa CRLF/LF, advisory lock và transaction từng file. Database đã có bảng nhưng
chưa có journal bị từ chối để tránh tự nhận schema cũ. Không sửa migration đã áp;
thay đổi sau phải thêm migration mới và kiểm tra upgrade.

Seed project riêng có hai category và ba template trung tính: HTML public, HTML
private và legacy để kiểm tra tương thích. Không nạp 1.000 dòng benchmark hoặc mã
App. Tác giả của seed trung tính bị vô hiệu hóa; `project:seed` không tạo thông tin
đăng nhập. `project:seed:demo` hoặc stack project bổ sung ba tài khoản phát triển
ở bảng trong [hướng dẫn local](docs/LOCAL_DEVELOPMENT.md#tài-khoản-có-sẵn). Chạy lại
seed không ghi đè các row đã có.

Trong phiên triển khai 04/11/2026, `eru_project_local` đã được tạo/migrate/seed để
dùng tiếp; các database `project_test_c0c1_*` chỉ phục vụ kiểm thử và được dọn sau lượt chạy.

### Khóa JWT và tiến trình API

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
| GET | `/categories` | JWT; lấy danh mục và ID để tạo Template |
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

Seed tuần 1 chứa hash placeholder nên không dùng để đăng nhập. Stack project có
admin demo riêng như mô tả ở trên. Với DB thực hành, CLI sau tạo tài khoản mới,
không ghi đè/nâng quyền tài khoản đã tồn tại:

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
3. Gọi `/auth/me`, lấy danh mục từ `/categories`, tạo/đọc/sửa/xóa template; không gửi authorId trong body.
4. Refresh bằng token mới nhất; cập nhật Authorize bằng access token vừa nhận.
5. Logout bằng refresh token; request protected tiếp theo trả 401.

Đặc tả có 12 operation trên 9 path và Bearer authentication. Swagger bật mặc định ngoài
production; `SWAGGER_ENABLED=false` tắt cả UI/JSON. Production mặc định tắt nếu không
có override. Bộ ảnh Postman/collection v2.1 trong `tools/postman` thuộc tuần 2;
chúng được tái hiện bằng [snapshot tuần 2](https://github.com/Tunhoclaptrinh/EruSentia-Server/tree/b9017f77f6b97a4935fd72d22f2e149f32c4b649),
không chạy nguyên collection cũ trên hợp đồng auth tuần 3.

## Message Queue — tuần 4

Welcome email dùng RabbitMQ **4.4.0**, Mailpit **1.32.0**, amqplib **2.2.1** và
Nodemailer **10.3.1**. Mailpit là hộp thư nhận local, không gửi email ra Internet.
Email này không xác minh địa chỉ hoặc kích hoạt tài khoản. Client đăng ký có thể
tạo welcome event khi API bật queue; Mailpit vẫn chỉ là môi trường nhận local.

```bash
docker compose -f docker/docker-compose.queue.yml up -d --wait
pnpm db:queue
# Terminal API: sau khi chuẩn bị schema/index/seed/auth/queue trên DB đã chọn
QUEUE_ENABLED=true pnpm dev
# Terminal worker: cùng DB_* và QUEUE_NAMESPACE với API
QUEUE_ENABLED=true pnpm worker:welcome
```

`QUEUE_ENABLED=false` mặc định giữ flow tuần 3. Bật queue yêu cầu PostgreSQL và
migration `sql/06_message_queue.sql`; không có queue giả trong memory mode.
Worker gửi qua SMTP localhost:1025; RabbitMQ UI http://127.0.0.1:15672 dùng
`eru` / `eru_dev_password`, Mailpit UI http://127.0.0.1:8025. Các cổng mới chỉ bind
loopback; credential trên chỉ dùng cho Docker thực hành local.

POST `/auth/register` vẫn trả **201 UserDto**. Khi bật queue, user và outbox commit
cùng transaction; API không chờ RabbitMQ/SMTP. Worker poll outbox, publish persistent
message với confirm/mandatory, consumer xử lý rồi manual ack. Có retry trễ 5 giây,
tối đa 3 lần xử lý trước DLQ; malformed event vào DLQ ngay. Consumer chết trước ack
được redeliver, không tự động đi DLQ ngay lần chết đầu tiên.

Email ledger chống gửi lại sự kiện đã ghi `sent` và khóa theo event ID giữa workers.
SMTP không tham gia transaction PostgreSQL: nếu SMTP đã nhận nhưng DB chưa commit,
retry vẫn có thể gửi trùng. Không cam kết exactly-once email; Message-ID ổn định
chỉ giúp đối chiếu, không bảo đảm hộp thư deduplicate.

Kiểm chứng đầy đủ trên database mới/rỗng, giữ RabbitMQ/Mailpit đang chạy:

```bash
docker exec sentia_postgres_dev createdb -U postgres week4_test_local
RUN_QUEUE_TESTS=1 DB_HOST=127.0.0.1 DB_PORT=5432 DB_USERNAME=postgres \
  DB_PASSWORD=postgres_dev_password DB_DATABASE=week4_test_local pnpm test:queue
docker exec sentia_postgres_dev dropdb -U postgres week4_test_local
```

Suite tự tạo namespace RabbitMQ riêng, nạp SQL 01/02/03/05/06, thực thi HTTP + SMTP,
dọn đúng queues/exchanges/email của lượt test; không xóa mailbox hoặc vhost chung.
Chi tiết kiến trúc, retry/DLQ và thao tác vận hành: [MESSAGE_QUEUE](docs/MESSAGE_QUEUE.md).

## Redis cache — tuần 5

Cache-aside cho **GET /templates/:id** của Template public; private, list và dữ liệu
đăng nhập không được cache. App C2 đã dùng catalog/detail để xem thử và lưu/chèn
bản sao local. Redis **8.10.3**, node-redis
**5.12.1** (phù hợp peer TypeORM). CACHE_ENABLED=false mặc định giữ flow trước.

```bash
docker compose -f docker/docker-compose.cache.yml up -d --wait
# Database đã có schema/auth; đối chiếu DB_* trước khi ghi migration.
pnpm db:cache
CACHE_ENABLED=true pnpm dev
```

Redis chỉ bind localhost:6379, giới hạn 128 MB, allkeys-lru, tắt persistence vì cache
có thể dựng lại. Không dùng --remove-orphans với các Compose riêng. Bật cache yêu
cầu PostgreSQL và migration `sql/07_template_cache_revision.sql`.

Mỗi GET vẫn kiểm tra user/session và đọc metadata visibility/revision từ PostgreSQL.
HIT bỏ full query lấy HTML/JSON/catalog projection; không có nghĩa không query DB.
Key namespace:template:v1:id:revision, TTL 60–71 giây (jitter). PATCH/DELETE đổi
revision bằng DB trigger và DEL key cũ; SQL update trực tiếp cũng đổi revision.
Cache cũ không cấp quyền đọc khi Template đã private/deleted. GET đang chạy trước
mutation có thể hoàn tất với snapshot trước đó.

Swagger response header **X-Cache**: HIT, MISS, COALESCED, BYPASS_DISABLED,
BYPASS_PRIVATE, BYPASS_REDIS. Cache-Control:no-store vẫn áp cho HTTP; Redis là cache
nội bộ. Redis lỗi/timeout thì fallback DB; DB lỗi không được che bằng cached permissions.
Miss được gộp trong một process, chưa có distributed lock hoặc negative cache.

```bash
# DB rỗng/mới do người chạy tạo, không reset database có sẵn:
RUN_CACHE_TESTS=1 DB_DATABASE=week5_test_local pnpm test:cache
# Demo 5 data types, đọc Template public từ DB đã chọn, tự xóa scratch keys:
pnpm cache:types
# Đo HTTP trên DB week5_test_* đã nạp schema/index/seed/auth/cache:
DB_DATABASE=week5_test_local pnpm cache:benchmark
```

Benchmark dùng dữ liệu sinh riêng và ghi user/template vào DB test, đọc hết response,
không thêm delay giả. Cần các DB_* đúng cùng máy. Xem [CACHE](docs/CACHE.md) về
privacy, invalidation, giới hạn và cách tái hiện benchmark.

## Kiểm thử

```bash
pnpm typecheck
pnpm test          # build; hiện có 46 pass, 6 suite opt-in skip theo mặc định
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
MFA, cookie/CSRF flow, quản lý nhiều phiên qua UI hay kiểm thử tải. Client đã có
luồng tài khoản cơ bản; chưa nghiệm thu toàn bộ sản phẩm hoặc bộ cài phát hành.

## Chuẩn bị project / kết nối client

CORS development mặc định cho `http://localhost:5173` và `http://127.0.0.1:5173`;
production mặc định không mở cross-origin. Đặt `CORS_ORIGINS` bằng danh sách origin
HTTP(S) phân cách bằng dấu phẩy; giá trị rỗng tắt cross-origin. Origin được chuẩn hóa
và bỏ trùng; không nhận wildcard/null/file origin, credentials, path, query hoặc
fragment. Dấu `/` cuối origin được chấp nhận. Host/port khác nhau là origin khác nhau.

Cho phép GET/POST/PATCH/DELETE/OPTIONS với Authorization/Content-Type; expose X-Cache
và WWW-Authenticate, không bật credentials/cookie. Preflight hợp lệ trả 204. Origin
ngoài danh sách không nhận allow-origin; CORS không thay JWT hoặc kiểm tra quyền.
Swagger cùng origin và CLI không cần CORS. Electron packaged cần transport riêng,
không allow `Origin:null` đại trà hoặc tắt web security để kết nối.

`GET /categories` trả taxonomy để chọn categoryId, riêng với nhóm chủ đề hoặc nguồn
hiển thị ở client. Xem [hợp đồng Template](docs/TEMPLATE_API.md).

Catalog dùng `GET /templates?projection=summary&contentFormat=erusentia-template-html&schemaVersion=1`.
Response không chứa `contentJson`/HTML; PostgreSQL chỉ chọn metadata cần thiết.
Filter format/schema áp trước count/pagination. Bỏ `projection` vẫn giữ list full
để tương thích; detail GET theo ID không đổi. Các endpoint này vẫn cần JWT.

Client browser dev dùng `VITE_ERU_API_BASE_URL`; Electron main dùng `ERU_API_BASE_URL`.
URL hiện là origin, chưa có `/api/v1`. Browser chỉ lưu phiên trong memory; Electron
giữ token trong main process trong lần mở App. Chưa có remember login bền vững.
Ví dụ chạy với DB project đã chuẩn bị:

```bash
DB_DATABASE=eru_project_local pnpm dev
```

Kiểm thử foundation trên DB mới/rỗng `project_test_*` dùng
`RUN_FOUNDATION_TESTS=1 DB_DATABASE=project_test_new pnpm test:foundation`; suite
kiểm tra từ chối schema không được theo dõi, rollback/resume, migration đồng thời,
checksum/seed và catalog memory/PostgreSQL. Không reset DB có dữ liệu.

`pnpm test:project` là suite opt-in bật auth/PostgreSQL/RabbitMQ/SMTP local/Redis
cùng nhau, cần `RUN_PROJECT_TESTS=1` và DB rỗng `project_test_*`. Xem
[lệnh chạy và dọn](docs/COMMANDS_AND_CHEATSHEET.md#kiểm-thử-stack-project).
Kế hoạch chung ở `week-6/PROJECT_PLAN.md` của [TYP](https://github.com/Tunhoclaptrinh/trainning-typ-2026),
nhánh `week-6-project-plan`: DB project/HTML, summary list, chống ghi đè và cô lập HTML.

## Cấu trúc và tài liệu

- `src/messaging/`: event contract, RabbitMQ transport, outbox dispatcher, email worker.
- `src/auth/`: DTO, guard, JWT/password service, memory/PostgreSQL auth store.
- `src/categories/`: danh mục chỉ đọc, dùng JWT và ID chung với Template store.
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

## Nội dung cộng đồng cho demo

[Bộ 14 mẫu HTML tương tác, seed local/Neon và kịch bản thử App](docs/COMMUNITY_DEMO.md).
Seed nội dung không tạo tài khoản có thể đăng nhập, không reset dữ liệu và không áp dụng migration C3.
