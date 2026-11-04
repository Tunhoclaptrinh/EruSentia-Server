# Chuẩn bị server cho project

**Ngày đối chiếu:** 04/11/2026. App chưa tích hợp API. Các bổ sung chuẩn bị hiện tại
là CORS, category discovery và suite kiểm thử các thành phần chạy cùng nhau.
[Repo TYP](https://github.com/Tunhoclaptrinh/trainning-typ-2026) giữ báo cáo và kế hoạch
ở `week-6/PRE_PROJECT_REVIEW.md` và `week-6/PROJECT_PLAN.md` trên nhánh chuẩn bị
`week-6-project-plan`. Báo cáo rà soát ghi commit server của lượt chuẩn bị; commit/
nhánh tài liệu cần được push trước khi mở nguồn tương ứng trên GitHub.

## Origin của client web

`CORS_ORIGINS` là danh sách HTTP(S) origin phân cách bằng dấu phẩy:

```dotenv
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

Ngoài production, hai origin trên là mặc định khi không đặt biến. Production mặc
định danh sách rỗng; giá trị rỗng tường minh cũng tắt cross-origin. Được chuẩn hóa
theo URL origin và bỏ trùng; wildcard, file/null origin, credentials, path, query và
fragment không hợp lệ. Dấu `/` cuối origin được chấp nhận. `localhost` khác `127.0.0.1`,
port khác là origin khác. Giá trị này là cấu hình server, không phải secret.

Cho phép GET/POST/PATCH/DELETE/OPTIONS với Authorization/Content-Type. Browser đọc
được X-Cache và WWW-Authenticate; không bật credentials/cookie. Preflight origin
hợp lệ trả 204. Origin ngoài danh sách không nhận allow-origin. CORS kiểm soát khả
năng đọc response của browser; request đơn giản vẫn có thể tới server, nên CORS
không thay JWT, ownership, CSRF design hoặc chính sách cô lập HTML.

Swagger cùng origin và CLI không cần cross-origin. Electron packaged cần transport
được thiết kế riêng; không thêm `null` hoặc `*`, không tắt web security để vượt lỗi.
[NestJS CORS](https://docs.nestjs.com/security/cors).

## Lấy category ID

Sau register/login, gọi `GET /categories` với Bearer access token:

```bash
curl http://127.0.0.1:3001/categories -H "Authorization: Bearer $ACCESS_TOKEN"
```

Response là mảng `{id,name,slug,icon,description,displayOrder}`, trong đó description
có thể null. PostgreSQL sắp theo display_order rồi id; memory có hai danh mục mẫu
dùng chung ID với Template store. SQL seed có tám danh mục. Thiếu token trả 401;
response không được cache HTTP. Không có create/update/delete category API.

Client chọn `categoryId` từ response khi tạo Template. Taxonomy server khác nhóm
chủ đề/nguồn hiển thị của client; không suy UUID từ tên hoặc hardcode theo seed.
Swagger hiện có **12 operation trên 9 path**.

## Kiểm thử stack chung

Chạy từ repo server, với Docker daemon và ba Compose dev:

```bash
docker compose -f docker/docker-compose.dev.yml up -d --wait
docker compose -f docker/docker-compose.queue.yml up -d --wait
docker compose -f docker/docker-compose.cache.yml up -d --wait

docker exec sentia_postgres_dev createdb -U postgres project_test_local
RUN_PROJECT_TESTS=1 DB_HOST=127.0.0.1 DB_PORT=5432 DB_USERNAME=postgres \
  DB_PASSWORD=postgres_dev_password DB_DATABASE=project_test_local pnpm test:project
# Sau khi test kết thúc và đã xem kết quả, dọn đúng DB vừa tạo:
docker exec sentia_postgres_dev dropdb -U postgres project_test_local
```

Tên DB bắt buộc `project_test_*`, public schema phải rỗng. Nếu DB đã tồn tại, chọn
tên mới và kiểm tra nguyên nhân; suite không reset schema. Test nạp SQL 01/02/03/
05/06/07, không gọi seed benchmark. Kết quả lượt rà soát: 5/5 pass, gồm parent và
4 subtest; không phải năm endpoint.

Suite xác nhận 12 bảng, JWT/danh mục/tạo Template, Redis MISS/HIT, chuyển private
và 404 cho người khác, hai welcome email qua outbox/RabbitMQ/SMTP local, refresh/
logout và thu hồi access session. RabbitMQ/Redis dùng namespace ngẫu nhiên riêng;
cleanup chỉ xóa queues/exchanges/keys/email sinh trong lượt test và đóng app/worker.
Database do người chạy tạo và dọn riêng. Không chạy `down -v`, không xóa mailbox/vhost
chung. Mã: [project-stack.integration.test.cjs](../test/project-stack.integration.test.cjs).

`pnpm test` mặc định bỏ qua suite này cùng ba suite opt-in PostgreSQL/queue/cache;
không tự chạy Docker. CORS/category memory nằm trong
[integration-prep.test.cjs](../test/integration-prep.test.cjs). Lượt browser độc lập
qua Chrome xác nhận register/login/categories khác origin; chưa phải App E2E.

## Database và contract cần làm tiếp

DB dev nghiệp vụ hiện có 1.012 payload legacy, chưa có migration 05/06/07. Không
trỏ App vào DB đó rồi coi kết quả rỗng/lỗi format là lỗi UI. Tạo DB project riêng,
chọn seed HTML trung tính và tạo tài khoản mới. SQL 03 có 12 templates; `db:seed`
thêm 1.000 rows benchmark. Không sửa seed lịch sử hoặc chạy db:fresh trên dữ liệu cần giữ.

Các mục sau chưa được triển khai:

- Summary list và filter format/schema ở server trước pagination/count; list hiện
  trả cả contentJson. Search hiện tìm title/description, tag là filter riêng.
- Optimistic concurrency: UPDATE có expected revision, trả conflict và revision mới.
  Chuỗi `version` nội dung và UUID `cache_revision` hiện không phải điều kiện từ client.
  Nếu dùng If-Match/ETag phải cập nhật CORS/OpenAPI và giữ quyền/private semantics.
- Lịch sử phiên bản và event nghiệp vụ commit cùng mutation trong transaction.
  Worker [welcome-worker.ts](../src/messaging/welcome-worker.ts) đang dùng routing
  REGISTERED cho outbox; phải phân loại event trước khi thêm template event.
- Chốt versioned routes nếu cần: hiện không có `/api/v1`. Ratings/forks/notifications
  có bảng nhưng chưa có API. Không mô tả chúng là tính năng hiện hữu.
- Rate limiting, verification/reset, TLS/secrets, migration journal/restore,
  health/readiness và monitoring trước vận hành thật.

Server lưu/trả HTML, không chứng nhận an toàn để client thực thi. Preview/chèn nội
dung cộng đồng phải qua runner cô lập, không có quyền của trang cha. CORS không
giải quyết việc script cùng origin đọc storage. Xem
[iframe sandbox của MDN](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe).

[Template API](TEMPLATE_API.md) · [Hợp đồng client](APP_TEMPLATE_CONTRACT.md) ·
[Authentication](AUTHENTICATION.md) · [Queue](MESSAGE_QUEUE.md) · [Cache](CACHE.md).
