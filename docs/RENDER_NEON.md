# Deploy API EruSentia bằng Render Free + Neon, kèm CI/CD GitHub

Cập nhật 06/11/2026. Đây là hosted demo cho tài khoản, API Template/catalog và
Swagger. PostgreSQL lưu tại Neon; App vẫn phát hành riêng. Queue, worker, Mailpit
và Redis không chạy trên phương án này; stack Docker local vẫn đầy đủ và không đổi.
Chưa tạo dịch vụ Render/Neon hoặc chạy nghiệm thu trên tài khoản cloud thực tế.

Kiểm chứng cục bộ 06/11/2026: typecheck đạt; test thông thường 49 pass, 7 test hạ
tầng opt-in skip; bộ hosted PostgreSQL TLS 16 pass. Docker image build thành công;
smoke `/health` và Swagger trong image dùng memory fixture đạt. TLS/migration/restart
được kiểm thử riêng với PostgreSQL 16 tạm, không phải Neon thật. CI cloud chỉ chạy
sau khi push các thay đổi lên GitHub.

## 1. Chuẩn bị repo và CI

Dùng repo **server**: <https://github.com/Tunhoclaptrinh/EruSentia-Server>.
Không đưa mã nguồn App riêng tư vào Render. Bộ cấu hình cần có trên nhánh `main`:

| File | Vai trò |
|---|---|
| [`render.yaml`](../render.yaml) | Một Docker Web Service, plan `free`, Singapore, tự deploy sau CI |
| [`Dockerfile`](../Dockerfile) | Build bằng Node 24 và pnpm 12.11.2 đã ghim |
| [`checks.yml`](../.github/workflows/checks.yml) | Typecheck, test API, Compose và PostgreSQL TLS/migration/startup |
| [`project-entrypoint.sh`](../docker/project-entrypoint.sh) | Migration/seed an toàn trước khi mở API |

Kiểm tra ở máy phát triển, trong `erusentia-server`:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:hosted
```

`test:hosted` cần Docker đang chạy và `openssl`. Nó tạo PostgreSQL/CA thử riêng,
kiểm tra TLS, migration, catalog và restart rồi tự xóa container/volume tạm.
Không kết nối Neon hoặc reset database hiện tại.

Commit các file triển khai đã kiểm tra, push qua nhánh làm việc/PR và merge vào
`main`. Trong GitHub → **Actions**, chờ workflow **Backend checks** có hai job xanh:
`test` và `Hosted PostgreSQL TLS and startup`. Nếu file mới chưa lên GitHub,
Render chưa đọc được Blueprint. GitHub Actions phải được bật trong repo.

**Kết quả cần thấy:** mở repo server trên GitHub, nhánh `main` có `render.yaml`
ngay thư mục gốc. Actions → Backend checks của commit đó có hai job xanh.
Chưa cần thêm secret Neon/Render trong GitHub.

## 2. Tạo PostgreSQL trên Neon

1. Đăng nhập <https://console.neon.tech> và tạo project `erusentia-demo`, chọn Free.
2. Chọn PostgreSQL **16**, region Singapore nếu có; nếu không có, chọn region gần
   region Render nhất có thể. Giữ compute tự ngủ theo gói Free.
3. Chọn branch sẽ dùng cho demo ở menu project/branch phía trên sidebar →
   **Postgres database → Databases → Add database**. Điền tên
   **`eru_project_render`**, owner chọn role Neon của bạn rồi **Create**.
   Database này phải mới, rỗng; không dùng database cũ có dữ liệu.
4. Mở **Connect**, chọn đúng branch, database `eru_project_render` và role.
5. **Tắt Connection pooling** để lấy kết nối direct. Hostname không chứa `-pooler`.
6. Giữ lại `host`, `user`, `password`; port PostgreSQL là `5432`.

**Kết quả cần thấy:** danh sách Databases có `eru_project_render`; hộp Connect chọn
đúng database đó và direct host không có `-pooler`. Nếu project tự tạo `neondb`, cứ
giữ nguyên database đó và chọn `eru_project_render` cho bước deploy. Chưa import SQL
hoặc bấm tạo sample data: bootstrap của server sẽ tự tạo schema.

Repo dùng các biến `DB_*`, không đọc `DATABASE_URL`. Nhập từng trường trong Render;
mật khẩu là giá trị gốc, không phải chuỗi đã URL-encode. Không đưa connection string
vào Git, chat, ảnh báo cáo hoặc log. Xem [quản lý database Neon](https://neon.com/docs/manage/databases).

**Vì sao direct?** Migration dùng session advisory lock trên một connection.
Neon pooled endpoint chạy PgBouncer transaction mode, không hỗ trợ loại lock này.
API demo có pool tối đa 5 connection nên dùng chung direct endpoint cho cả bootstrap
và API. [Giới hạn pooling của Neon](https://neon.com/docs/connect/connection-pooling).

## 3. Tạo Render Web Service từ Blueprint

1. Đăng nhập <https://dashboard.render.com>, kết nối tài khoản GitHub.
2. Chọn **New → Blueprint**, chọn repo `EruSentia-Server` qua kết nối GitHub,
   branch `main`, Blueprint Path **`render.yaml`**.
3. Nếu GitHub yêu cầu cấp quyền, chỉ chọn repo server cần deploy. Không dùng đường
   dẫn public Git thay cho kết nối GitHub: auto-deploy cần Git provider đã kết nối.
4. Điền ba biến Render hỏi:

   | Biến | Lấy từ Neon |
   |---|---|
   | `DB_HOST` | Direct hostname, ví dụ `ep-….ap-southeast-1.aws.neon.tech` |
   | `DB_USERNAME` | Role/username Neon |
   | `DB_PASSWORD` | Password của role đó |

5. Kiểm tra chỉ có **một Web Service**, plan **Free**, region Singapore. Không có
   database Render, disk, worker hoặc dịch vụ trả phí được tạo bởi Blueprint này.
6. Chọn **Deploy Blueprint**. Render build Docker image, chạy bootstrap rồi mở API.
   Lần tạo đầu cần theo dõi trực tiếp; không coi CI gate là bảo đảm cho thao tác
   tạo dịch vụ hoặc manual deploy. Chỉ thực hiện sau khi CI của commit trên `main` xanh.

**Kết quả cần thấy:** Render có service `erusentia-api` hoặc tên thêm hậu tố, trạng
thái chuyển sang **Live**, kèm URL `https://….onrender.com`. Trong Logs, bootstrap
lần đầu báo 5 migration đã áp dụng và `fixtures: 3`, sau đó API listening. Lần sau
`applied: []` là đúng nếu không có migration mới. Các dòng này là kết quả dự kiến;
cần đối chiếu với Logs thực tế sau khi bạn tạo dịch vụ.

Nếu giao diện có tên khác, đối chiếu các trường trong
[Blueprint reference](https://render.com/docs/blueprint-spec).
Tên service có thể được Render thêm hậu tố nếu trùng; lấy URL thực tế ở Dashboard.

Các biến còn lại đã nằm trong `render.yaml`:

| Biến | Giá trị/mục đích |
|---|---|
| `NODE_ENV` | `production` |
| `HOST` / `PORT` | `0.0.0.0` / `10000` |
| `TEMPLATE_STORE` | `postgres` |
| `DB_DATABASE` / `DB_PORT` | `eru_project_render` / `5432` |
| `DB_SSL` / `DB_POOL_MAX` | `true` / `5` |
| `JWT_SECRET` | Render sinh ngẫu nhiên; giữ ổn định qua deploy |
| `CORS_ORIGINS` | `https://tunhoclaptrinh.github.io` |
| `SWAGGER_ENABLED` | `true` cho hosted demo |
| `PROJECT_BOOTSTRAP` | `true`: migrate/seed trước mỗi lần mở API |
| `PROJECT_DEMO_ACCOUNTS` | `false`: không tạo user/creator/admin có mật khẩu chung |
| `QUEUE_ENABLED` / `CACHE_ENABLED` | `false` / `false` |

TLS kiểm tra chứng chỉ và hostname, áp dụng cho cả TypeORM lẫn CLI SQL/migration.
Không đặt `NODE_TLS_REJECT_UNAUTHORIZED=0` hoặc tắt kiểm tra chứng chỉ khi có lỗi TLS.

Free Web Service không có pre-deploy command. Entry point dùng migration journal,
checksum và advisory lock trước khi chạy API; lỗi thì dừng startup. Không chạy
migration trong Docker build, không dùng `db:fresh`/reset. Seed không ghi đè bản ghi
đã có: tạo một owner bị khóa, hai danh mục và ba fixture, trong đó **một HTML public
tương thích App, một private draft và một public legacy**. Không phải ba mẫu HTML public.

## 4. Nghiệm thu lần deploy đầu

Chờ Render báo **Live**, mở URL thật của service, ví dụ:

```text
https://erusentia-api-….onrender.com/health
https://erusentia-api-….onrender.com/docs
```

- `/health`: `200`, JSON `{"status":"ok"}`. Đây là **liveness của API**, không query
  database để health probe của Render không giữ Neon thức liên tục. Không thay thế
  các bước kiểm thử nghiệp vụ dưới đây.
- `/auth/me` khi chưa có token: `401` JSON. Không đặt đường dẫn này làm Render health check.
- `/docs`: Swagger UI. Dùng `POST /auth/register` với email/mật khẩu riêng (12–128
  ký tự), rồi `POST /auth/login`. Copy **accessToken** vào **Authorize → bearer**.
- Thử `GET /auth/me`, `GET /categories`, `GET /templates` và lấy chi tiết mẫu HTML.
  Các route nghiệp vụ này cần token; Swagger vẫn public nhưng không bỏ qua quyền.
- Tạo mẫu riêng, xem/sửa/xóa bằng tài khoản của mình; tài khoản khác không xem được
  mẫu private. Refresh token và logout phải hoạt động.
- Chọn **Manual Deploy → Restart service**, đăng nhập lại và xác nhận dữ liệu còn.
  Dữ liệu nằm tại Neon, không nằm trên filesystem tạm của Render.
- Không có welcome email vì queue đã tắt; không có `X-Cache: HIT` từ Redis.

Ghi lại URL, commit SHA ở Render, thời điểm nghiệm thu và kết quả thao tác để làm
báo cáo. Nếu chụp ảnh, dùng giao diện sáng và che password, JWT, refresh token cùng
connection string. Chỉ đánh dấu cloud deploy hoàn thành sau khi kiểm tra thực tế.

## 5. CI/CD GitHub hoạt động thế nào

```text
Push nhánh làm việc → PR vào main → GitHub Actions kiểm tra
→ Merge main → GitHub Actions kiểm tra commit main
→ Render chờ checks pass → Build Docker → Migrate/seed → Start API → /health → Live
```

Trong Render → Service → **Settings → Auto-Deploy**, xác nhận
**After CI Checks Pass** (`autoDeployTrigger: checksPass` trong Blueprint).
Render đọc GitHub Actions checks của commit, không cần deploy hook/API token.
Một check lỗi hoặc không có check sẽ không kích hoạt auto-deploy.
Render tính cả kết quả `neutral`/`skipped` là pass: giữ hai job cốt lõi luôn chạy,
không dùng điều kiện/path filter để bỏ qua chúng trên `main`.
[Render tích hợp CI](https://render.com/docs/deploys#integrating-with-ci).

GitHub → **Settings → Rules → Rulesets**, nếu repo cho phép, đặt rule cho `main`:
yêu cầu PR và hai status check nói trên trước merge, tránh force push. Chọn đúng
tên check GitHub hiển thị sau lần chạy đầu. Rule không thay thế CI gate của Render.

Database credentials và JWT chỉ lưu trong Render. **GitHub không cần secret Neon
hay Render cho pipeline này.** CI dùng PostgreSQL TLS tạm do chính job tạo.
CI xanh là xác nhận tests; trạng thái cloud deploy xem tại **Render → Events/Logs**,
không suy ra Live chỉ từ dấu xanh của GitHub.

Các lần sau: tạo nhánh → thay đổi → test → PR → merge. Render tự deploy commit đã
qua CI trên `main`. Manual deploy/restart, thay env hay đồng bộ Blueprint là thao
tác riêng; kiểm tra commit và tác động trước khi thực hiện, không dùng chúng để bỏ qua CI.
Không cần tạo commit rỗng để thử CD: dùng thay đổi hợp lệ tiếp theo và đối chiếu SHA.

## 6. Nối App vào API

### Web GitHub Pages

Trong **repo App** → Settings → Secrets and variables → Actions → **Variables**,
tạo `ERU_API_BASE_URL` bằng URL Render, ví dụ `https://erusentia-api-….onrender.com`
(không thêm `/docs`). Chạy lại workflow **Deploy GitHub Pages & Release Hub** trên
`main`; URL được nhúng thành `VITE_ERU_API_BASE_URL` lúc build.

`CORS_ORIGINS` tại server chỉ chứa origin như `https://tunhoclaptrinh.github.io`,
không thêm `/EruSentia/app/`. Nếu dùng web local, thêm chính xác origin/cổng hiện tại,
phân cách dấu phẩy. Biến do Blueprint quản lý nên sửa `render.yaml` và review qua PR.
URL API là public configuration; JWT/database password không đặt trong repo App.

### Electron Linux

Đóng hẳn App rồi mở lại, thay URL bằng service thật:

```bash
ERU_API_BASE_URL=https://TEN-SERVICE.onrender.com ./EruSentia-1.1.0-beta.2.AppImage
```

App chưa có form đổi API URL. Kiểm tra đăng nhập → Community catalog → xem thử →
lưu thư viện → chèn vào ghi chú → mở HTML offline. Ghi chú/thư viện vẫn ở thiết bị;
deploy API không tự bổ sung Cloud Sync.

## 7. Giới hạn, lỗi thường gặp và cập nhật

Render Free ngủ sau 15 phút không có traffic; lần gọi tiếp theo có thể chờ khoảng
một phút. Có 750 instance-giờ/workspace/tháng và quota build/bandwidth riêng.
Neon Free hiện có 1 GB/project và 100 CU-giờ/project/tháng, tự ngủ khi không hoạt động.
Kiểm tra Usage ở cả hai dịch vụ; không dùng cron ping liên tục để giữ dịch vụ thức.
Không dùng Render Postgres Free cho phương án này vì database đó hết hạn sau 30 ngày.
[Render Free](https://render.com/docs/free), [Neon Free](https://neon.com/blog/neon-free-plan-1-gb-per-project).

| Hiện tượng | Cách kiểm tra |
|---|---|
| Build/start lỗi | Xem Render Logs của deploy, đối chiếu SHA và bước lỗi; không dán secret |
| TLS/authentication DB lỗi | Direct hostname, role, mật khẩu gốc, đúng DB và `DB_SSL=true`; không tắt verify |
| Migration từ chối database | Tên phải bắt đầu `eru_project_`; dùng database mới rỗng, không tự xóa bảng cũ |
| Migration history mismatch | Đọc journal và commit SQL; bổ sung migration mới thay vì sửa checksum hoặc reset DB |
| Health check fail | `/health`, port 10000, bind `0.0.0.0`; kiểm tra bootstrap hoàn thành |
| GitHub xanh nhưng không deploy | Kết nối GitHub, branch `main`, After CI Checks Pass và Events; không chọn public repo URL |
| Swagger hoạt động nhưng App lỗi | API URL lúc build/start App, HTTPS và CORS origin; mở lại App sau khi đổi URL |
| Request đầu chậm | Render/Neon đang thức dậy; chờ và thử lại, không coi đây là mất dữ liệu |

Trước migration mới, backup qua Neon/direct connection và thử restore trên DB khác.
Giữ dump ngoài Git. Rollback image trên Render **không rollback database**; migration
phải tương thích với phiên bản cũ trong thời gian chuyển deploy. Bootstrap hiện tại
có transaction từng migration nhưng không rollback toàn bộ lịch sử khi deploy lỗi.
Nếu đổi password Neon, cập nhật Render Environment và redeploy có chủ đích.

Phương án này phục vụ demo/tích hợp. Full stack vẫn chạy bằng `pnpm stack:up` ở local;
khi cần queue/worker/cache trên cloud, chọn VM hoặc cấu hình dịch vụ phù hợp trong
[FREE_HOSTING.md](FREE_HOSTING.md).

## Nội dung demo cộng đồng

Bản server có bộ 14 mẫu tại [COMMUNITY_DEMO.md](COMMUNITY_DEMO.md). Bootstrap
seed các mẫu còn thiếu bằng kết nối Neon sẵn có; không cần đưa mật khẩu ra khỏi
Render. Giữ `PROJECT_DEMO_ACCOUNTS=false`. Có thể tắt seed nội dung ở lần khởi
động sau bằng `PROJECT_COMMUNITY_DEMO=false`, không xóa dữ liệu đã thêm.
