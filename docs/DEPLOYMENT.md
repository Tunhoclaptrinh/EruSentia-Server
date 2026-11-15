# Triển khai EruSentia: App, API và Admin

Cập nhật 15/11/2026. Các cấu hình đã được chuẩn bị trong mã nguồn; chưa tạo service,
đổi environment cloud, push/merge GitHub hoặc chạy migration trên Neon trong lượt này.

| Thành phần              | Repo/thư mục                            | Nơi deploy                                             | Dữ liệu                           |
| ----------------------- | --------------------------------------- | ------------------------------------------------------ | --------------------------------- |
| App dùng cho người dùng | `EruSentia` / `erusentia-app`           | Vercel, `pnpm build:web`, output `dist`                | Vault local và API hiện có        |
| API dùng chung          | `EruSentia-Server` / `erusentia-server` | Render Docker, `render.yaml`                           | Neon PostgreSQL                   |
| Web Admin mới           | `erusentia-admin`                       | Vercel, `node scripts/build-hosted.mjs`, output `dist` | Dùng chính API và PostgreSQL trên |
| Landing/tải desktop     | workflow Pages của App                  | GitHub Pages, `dist-pages`                             | Showcase công khai                |

Không có MongoDB trong deployment EruSentia này. Yêu cầu Mongo local ở cuộc trao đổi
trước thuộc dự án khác. Queue/worker/Redis/Mailpit của Docker local không được tạo
thêm trên Render Free. Các tính năng cần worker/email không được coi là đã hoạt động.

## 1. Đưa mã đã tích hợp lên GitHub

App và Server đã có origin; Admin hiện chưa có remote. Các commit đang ở nhánh làm
việc riêng. Push nhánh, tạo PR, kiểm tra và merge vào `main` trước khi dùng auto-deploy.
Không force-push `main`. Xem tên nhánh bằng `git branch --show-current` trong từng repo.

Nếu muốn Admin tự deploy từ GitHub, tạo repo **riêng tư** rồi đặt origin cho repo local.
Không import repo App vào project Admin. Có thể dùng Vercel CLI trực tiếp tại thư mục
Admin để deploy mà chưa cần remote; hướng dẫn ở `erusentia-admin/docs/DEPLOYMENT.md`.

## 2. Backup và kiểm tra Neon

- Dùng database mới `eru_project_render` khi thiết lập lần đầu. Không chạy `db:fresh`,
  `db:reset` hoặc import lại toàn bộ SQL vào database đang có người dùng.
- Với database đã hoạt động, tạo backup/restore point trước release. Phải có bảng
  `eru_schema_migrations` và lịch sử/checksum đúng. Migrator từ chối tự nhận database
  legacy chưa có journal; khi gặp lỗi này cần đánh giá migration riêng, không xóa bảng.
- `DB_HOST` dùng endpoint **direct**, không chứa `-pooler`. Đặt `DB_SSL=true`; luôn
  kiểm tra chứng chỉ TLS. API và bootstrap cùng dùng endpoint này, pool tối đa 5.
- Các migration mới là additive; giữ nguyên SQL/checksum đã áp dụng. Schema hiện có
  16 migration bắt buộc, gồm `15_admin_portal_core.sql`, `16_community_documents.sql`,
  `17_admin_resource_lifecycle.sql`, `18_community_document_versions.sql`. Migration
  `09_account_email.sql` chỉ chạy khi bật chức năng email local được hỗ trợ; không
  tự bật Mailpit trong production.

## 3. Deploy API trên Render Free

Nếu service đã tồn tại, cập nhật service/Blueprint đó; không tạo thêm bản sao service
hoặc database. Lần đầu: **New → Blueprint**, chọn repo Server, branch `main`, path
`render.yaml`. Dockerfile ở gốc repo. Chọn đúng plan **Free**.

Blueprint yêu cầu nhập:

| Biến                          | Giá trị                                                   |
| ----------------------------- | --------------------------------------------------------- |
| `DB_HOST`                     | Direct hostname Neon                                      |
| `DB_USERNAME` / `DB_PASSWORD` | Role và password Neon, chỉ lưu ở Render                   |
| `CORS_ORIGINS`                | Origin App, Admin, Pages nếu cần; phân cách bằng dấu phẩy |
| `RESOURCE_TARGET_ORIGINS`     | Origin HTTPS thực tế của API Render                       |

Ví dụ origin **cần thay bằng URL thật**:

```text
CORS_ORIGINS=https://eru-sentia.vercel.app,https://your-admin.vercel.app,https://tunhoclaptrinh.github.io
RESOURCE_TARGET_ORIGINS=https://your-api.onrender.com
```

Khi chưa biết URL Admin/API, tạo project/service để có URL ổn định, cập nhật các biến
rồi deploy lại. `sync: false` yêu cầu nhập khi tạo Blueprint; khi service đã tồn tại,
hãy chỉnh Environment trực tiếp và giữ allowlist App hiện có.

Giữ `JWT_SECRET` ngẫu nhiên và ổn định, `PROJECT_DEMO_ACCOUNTS=false`,
`ACCOUNT_EMAIL_MODE=disabled`, `QUEUE_ENABLED=false`, `CACHE_ENABLED=false`.
Blueprint đặt `TRUST_PROXY_HOPS=1` cho proxy Render để rate limit/log không gom
mọi người dùng vào IP socket của proxy. Nếu đổi kiến trúc proxy phải đánh giá lại
chuỗi hop; không dùng `trust proxy=true` hoặc tin IP ngoài cùng bên trái vô điều kiện.
`PROJECT_COMMUNITY_DEMO=true` seed catalog mẫu, không tạo tài khoản có mật khẩu chung.
`PROJECT_BOOTSTRAP=true` chạy migrator có journal/checksum/advisory lock trước khi
API lắng nghe; startup dừng nếu migration lỗi. Render Free không có pre-deploy
command nên không thêm bước đó hoặc chạy migration trong Docker build.

Đợi CI xanh. `autoDeployTrigger: checksPass` áp dụng cho auto-deploy; vẫn kiểm tra
commit và Logs khi manual deploy. Log lần đầu phải có migration mới; lần khởi động
lại khi không có migration mới phải báo `applied: []`. `/health` là liveness, không
chứng nhận kết nối DB hay nghiệp vụ.

## 4. Tạo tài khoản quản trị riêng

Làm một lần trên máy tin cậy sau khi migration thành công. Script chỉ INSERT admin
mới; email đã có thì dừng, không tự nâng quyền hoặc thay mật khẩu tài khoản cũ.
Không seed demo account, không sửa trực tiếp password hash.

Tại repo Server, sao chép `deploy/production.env.example` thành
`docker/.env.hosted.local` (đã ignore), điền DB thật và giữ file private:

```bash
cp deploy/production.env.example docker/.env.hosted.local
chmod 600 docker/.env.hosted.local
# Mở file trên máy để điền DB_HOST/USERNAME/PASSWORD/DATABASE.
pnpm install --frozen-lockfile
pnpm build
read -r -p 'Email quản trị mới: ' ADMIN_EMAIL
read -r -s -p 'Mật khẩu riêng (12–128 ký tự): ' ADMIN_PASSWORD
printf '\n'
export ADMIN_EMAIL ADMIN_PASSWORD
node --env-file=docker/.env.hosted.local dist/scripts/create-admin.js
unset ADMIN_EMAIL ADMIN_PASSWORD
```

Không nhập literal password vào command history, không gửi file cấu hình vào chat/Git.
Nếu tài khoản đã tồn tại, dùng chức năng phân quyền của một admin hiện có; đừng xóa
tài khoản để chạy lại script. JWT role hiện tại được dùng; Keycloak/OIDC/MFA chưa có.

## 5. Deploy hai project Vercel

App giữ project/repo hiện có, Node 24.x, cấu hình `vercel.json` tại gốc repo App.
Đặt `VITE_ERU_API_BASE_URL=https://your-api.onrender.com` trong Vercel Production
và các Preview được phép; build `pnpm build:web`, output `dist`.

Admin dùng project riêng, Node 24.x, repo/working directory `erusentia-admin`.
Cùng biến `VITE_ERU_API_BASE_URL`, cùng API URL, build/output theo `vercel.json`
của Admin. Không có `/api/v1`, `/api` hay path sau API origin trên phương án này.
Không đưa `DB_*`, `JWT_SECRET`, password hoặc secret OAuth vào `VITE_*`.

Chỉ thêm đúng các origin tin cậy vào CORS; URL hash route không phải origin.
Đổi biến Vite cần build/deploy lại. Preview trỏ API production cũng có thể ghi dữ
liệu production; dùng staging hoặc chỉ cấp các origin preview thực sự cần thiết.

GitHub Pages hiện là landing/release hub và dùng `dist-pages`; không thay nó bằng
bundle Admin hay toàn bộ App. Giữ ranh giới source riêng tư đã có của repo App.

## 6. Smoke check sau deploy

Tại repo Server:

```bash
PUBLIC_API_URL=https://your-api.onrender.com \
APP_ORIGIN=https://eru-sentia.vercel.app \
ADMIN_ORIGIN=https://your-admin.vercel.app \
node scripts/check-hosted.mjs
```

Lệnh chỉ đọc và gửi OPTIONS: chờ API thức tối đa 120 giây, kiểm tra liveness,
401 khi chưa đăng nhập và CORS App/Admin. Không tạo tài khoản, sửa hoặc xóa dữ liệu.
Sau đó kiểm tra bằng trình duyệt: App login/catalog, Admin login/danh sách/chi tiết,
một thao tác trên bản ghi thử và audit tương ứng; tài khoản user không vào được Admin.
So sánh số liệu cần thiết trước/sau, kiểm tra Logs không lộ credential.

Nếu deploy lỗi: giữ backup và dữ liệu, xem migration/CORS/env trước. Rollback image
chỉ dùng khi tương thích schema hiện tại; không xóa journal hoặc tự downgrade SQL.

## Giới hạn phương án miễn phí

Vercel phục vụ hai frontend tĩnh; Render Free có thể ngủ sau 15 phút không có traffic
và thức lại khoảng một phút. Không có cam kết always-on, hết hạn mức vẫn tiếp tục
phục vụ, hoặc bỏ vĩnh viễn không cần bảo trì. Không tạo worker/disk/DB trả phí trong
Blueprint này; kiểm tra plan/usage của tài khoản trước khi bấm deploy. Không thiết
lập ping định kỳ để giữ máy chủ thức. SMTP production/SSO không được mô phỏng là sẵn có.

Nguồn chính thức: [Render Free](https://render.com/docs/free),
[Render deploy lifecycle](https://render.com/docs/deploys),
[Blueprint](https://render.com/docs/blueprint-spec),
[Vite trên Vercel](https://vercel.com/docs/frameworks/frontend/vite),
[Neon connection pooling](https://neon.com/docs/connect/connection-pooling).

Cấu hình proxy Render tham chiếu [hướng dẫn Express của Render](https://render.com/articles/how-to-implement-authentication-and-authorization).
