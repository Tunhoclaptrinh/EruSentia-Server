# Chạy EruSentia trên máy phát triển

Đưa backend demo lên Internet: dùng [hướng dẫn hosting riêng](FREE_HOSTING.md),
không dùng tài khoản/secret và launcher dev bên dưới trên môi trường public.

Cấu hình này dùng cho máy cá nhân và dữ liệu minh họa. API, worker và hạ tầng chạy
trong một Compose project riêng: `erusentia-project`. Không dùng volume/database
của các bài thực hành tuần 1–5; không gọi `db:fresh` hoặc reset dữ liệu hiện có.

Yêu cầu: Docker Engine + Compose v2 có `up --wait`, Node.js 24 và pnpm 12.11.2.
Kiểm tra `docker info` có phần **Server**. Trên Ubuntu, nếu daemon đang tắt, chạy
`sudo systemctl start docker` tại terminal của bạn. Không đặt mật khẩu sudo vào
file cấu hình. Lần đầu dựng image cần mạng để tải dependency đã khóa phiên bản.

## Chọn cách chạy

Giữ hai checkout cạnh nhau khi cần chạy App:

```text
EruSentia/
├── erusentia-server/
└── erusentia-app/       # repo riêng tư
```

| Nhu cầu | Thư mục | Lệnh |
|---|---|---|
| Cả bộ backend + App web bằng Docker | `erusentia-app` | `pnpm start` |
| Backend Docker + App web trên host, có HMR | `erusentia-app` | `pnpm dev:all` |
| Backend Docker + App Electron trên host | `erusentia-app` | `pnpm start:desktop` |
| Chỉ backend: PostgreSQL, RabbitMQ, Redis, Mailpit, API, worker | `erusentia-server` | `pnpm stack:up` |
| Xem trạng thái | Repo đang dùng | `pnpm stack:status` |
| Xem log liên tục | Repo đang dùng | `pnpm stack:logs` hoặc `pnpm stack:logs api worker` |
| Dừng cả bộ, giữ volume/dữ liệu | `erusentia-app` | `pnpm stop` |

Từ thư mục cha `EruSentia` có `package.json` và README điều phối, có thể chạy
`pnpm start`, `pnpm start:desktop`, `pnpm dev` hoặc `pnpm stop`. Các lệnh gọi
launcher hiện có; không gộp hai repo thành pnpm workspace. Nếu chỉ clone từng
repo, dùng các lệnh theo thư mục trong bảng trên.
Các lệnh App `stack:up`, `stack:down`, `dev:all:desktop` vẫn dùng được qua cùng
launcher. Trong server, `pnpm stack:down` dừng backend; `pnpm start` chỉ chạy API
đã build, không mở App hay hạ tầng.

Trước khi chạy frontend trên host, cài `pnpm install --frozen-lockfile` trong App.
Electron chạy trên desktop của máy; container App chỉ chạy bản web. Build container
web không tải binary Electron và không cài Rust/Tauri. Các lệnh Tauri riêng của
repo App vẫn giữ để dùng khi cần.

`stack:up` đợi dependency healthy, chạy migrations/seed rồi khởi động dịch vụ.
API/worker cũng bootstrap khi tiến trình container khởi động lại. Bước seed dùng
lock/transaction và chỉ thêm bản ghi chưa có; không tạo bản sao sau mỗi lần chạy.
`dev:all*` mở frontend trong terminal hiện tại. `Ctrl+C` dừng frontend; backend Docker
vẫn chạy. Dùng `stack:down` để dừng backend. Web trong Docker dùng source tại lúc
build; chạy lại `stack:up` sau khi đổi source để dựng lại image. Host dev có HMR.
Khi chọn host dev, launcher dừng riêng web container của project để nhường cổng.

## Chạy riêng từng phần

Trong `erusentia-server`:

```bash
pnpm stack:up postgres
pnpm stack:up redis
pnpm stack:up rabbitmq mailpit
pnpm stack:up api
pnpm stack:up worker
pnpm stack:seed
pnpm stack:stop api worker
pnpm stack:logs worker
```

API tự khởi động các dependency cần thiết; worker kéo theo API và hạ tầng. Chỉ mở
PostgreSQL/Redis không tự mở API. `stack:seed` chạy lại migrations, seed trung tính
và tài khoản demo trong DB project. Khi cần dừng database, hãy dừng API/worker trước
hoặc dùng `stack:down`.

Chạy frontend riêng trong `erusentia-app`:

```bash
pnpm dev                  # Vite, mặc định port 5173
ERU_API_BASE_URL=http://127.0.0.1:3001 pnpm electron:open
```

Lệnh Electron ở terminal thứ hai cần Vite đang chạy. Có thể dùng `pnpm electron:dev`
để mở Vite và Electron cùng nhau; truyền cùng `ERU_API_BASE_URL`. API base URL cho
browser là `VITE_ERU_API_BASE_URL` trong `.env.local` hoặc môi trường khởi chạy Vite.
`dev:all*` tự truyền đúng URL theo cấu hình stack cho cả browser và Electron.

## Địa chỉ mặc định

Các cổng publish chỉ bind `127.0.0.1` trên host.

| Thành phần | Địa chỉ / thông tin |
|---|---|
| App web | http://127.0.0.1:5173 |
| API / Swagger | http://127.0.0.1:3001/docs |
| OpenAPI JSON | http://127.0.0.1:3001/docs-json |
| PostgreSQL project | `127.0.0.1:5433`, DB `eru_project_docker`, user `eru`, password dev `eru_project_dev_password` |
| Redis project | `127.0.0.1:6380` |
| RabbitMQ AMQP | `127.0.0.1:5673`, user `eru`, password dev `eru_project_queue_password` |
| RabbitMQ management | http://127.0.0.1:15673 |
| Mailpit SMTP / hộp thư | `127.0.0.1:1026` / http://127.0.0.1:8026 |

Trong Docker network, API dùng tên service `postgres:5432`, `rabbitmq:5672`,
`redis:6379`, `mailpit:1025`; browser trên host dùng các URL publish ở bảng trên.
Redis là cache có thể tạo lại. PostgreSQL và RabbitMQ dùng named volume giữ qua
`stack:down`; lệnh dừng không dùng `-v`. Mailpit dành cho email local, không gửi
mail ra Internet. Seed không tạo welcome email; đăng ký mới qua API khi worker
đang chạy mới đi qua outbox → RabbitMQ → Mailpit.

## Tài khoản có sẵn

**Mật khẩu ban đầu chung: `EruSentiaDemo!2026`**

| Email | Role | Quyền hiện đã triển khai |
|---|---|---|
| `user@erusentia.test` | `user` | Đọc mẫu công khai/mẫu của mình; CRUD mẫu do mình tạo. |
| `creator@erusentia.test` | `creator` | Hiện có quyền Template như user; chưa có cơ chế xét duyệt/ưu đãi riêng cho creator. |
| `admin@erusentia.test` | `admin` | Xem danh sách user; đọc/sửa/xóa Template qua API theo quyền admin. |

Đăng nhập bằng nút tài khoản trong App hoặc `/auth/login` trong Swagger. Đăng ký
công khai chỉ tạo `user`, không được gửi role/admin từ form. UI App hiện có hồ sơ
và xác thực; chưa có màn quản trị hay feed community để sử dụng toàn bộ quyền API.
Không hiểu role `admin` là đã có sẵn giao diện quản trị.

Seed tạo 3 hồ sơ cùng 4 Template do các role sở hữu: ghi chú cá nhân private, mục tiêu
tuần public, kế hoạch dự án public và ghi chú quản trị private. Cộng seed trung tính
cũ có **4 user (1 tác giả bị khóa), 3 profile, 2 category và 7 Template** khi DB mới.
Nội dung trung tính, không chứa template riêng hoặc mã App. Không đánh dấu email
đã xác minh. Tài khoản public API không mặc nhiên được nâng quyền creator/admin.

Chạy lại giữ ID, mật khẩu, role và nội dung đã chỉnh. Mật khẩu ở trên là mật khẩu
**ban đầu**, sẽ không tự khôi phục nếu bạn đã đổi. Nếu email/ID demo đụng tài khoản
khác, seed báo lỗi và rollback; không nhận tài khoản đó rồi nâng quyền. Không xóa
volume để xử lý lỗi trước khi kiểm tra dữ liệu cần giữ.

Muốn thêm bộ demo vào DB project trên host đã chọn rõ:

```bash
DB_DATABASE=eru_project_local pnpm project:seed:demo
```

Đối chiếu các DB_* còn lại trong `.env` trước khi chạy lệnh này. CLI chỉ chấp nhận
DB có prefix `eru_project_`/`project_test_`. Bộ demo từ chối `NODE_ENV=production`;
bootstrap chỉ nạp tài khoản khi `PROJECT_DEMO_ACCOUNTS=true` (stack dev đã bật).
Không dùng DB/volume và mật khẩu demo này để triển khai public/production.

## Cấu hình riêng và cổng đang bận

Lần đầu, launcher tạo `docker/.env.project.local` với quyền file `600` và JWT secret
ngẫu nhiên ổn định. File được ignore, không thay `.env` hiện có. Xem các trường ở
[.env.project.example](../docker/.env.project.example); giữ secret sinh tự động.
`pnpm stack:config` kiểm tra Compose và in địa chỉ, không in secret.

Nếu 5173 đã có Vite đang chạy, có thể dùng backend đã mở và giữ Vite đó, hoặc dừng
Vite tại terminal của nó trước khi chạy frontend mới. Launcher dùng `--strictPort`,
không tự chọn cổng khác hay dừng tiến trình có sẵn.

Ví dụ chạy web Docker ở cổng khác:

```bash
# Trong App. Có hiệu lực cho lần gọi này.
PROJECT_WEB_PORT=5184 pnpm stack:up
```

CORS mặc định được tính theo web port đã chọn. Nếu cần đồng thời nhiều origin, đặt
`PROJECT_CORS_ORIGINS` thành danh sách origin chính xác, phân cách dấu phẩy. Không
dùng `*`. Các biến `PROJECT_*` trong môi trường ghi đè file local. Muốn ổn định cho
các lần chạy sau, sửa file local; khi dừng/xem trạng thái phải dùng cùng cấu hình
project. `ERU_PROJECT_ENV_FILE` chọn file config khác, `ERU_SERVER_DIR` trong App
chỉ đến server checkout khi hai repo không nằm cạnh nhau.

Đổi mật khẩu DB/RabbitMQ trong file không đổi mật khẩu đã được khởi tạo trong volume;
cần thao tác đổi mật khẩu có chủ đích trên dịch vụ hoặc dùng project dev mới. Khi
đổi API port, `dev:all*`/web Docker tự dùng URL mới; Vite đã chạy từ trước cần restart
với biến `VITE_ERU_API_BASE_URL` tương ứng.

## Giao diện và ảnh báo cáo

Profile mới mặc định dùng theme sáng. **Mọi ảnh thao tác/báo cáo dùng nền sáng**, gồm
cả gallery và các hộp thoại. Không chỉnh ảnh ghép, không thêm khoanh vùng hướng dẫn.
App vẫn giữ tùy chọn theme người dùng đã chọn; script chụp chủ động chọn
`default-light` cho profile minh họa riêng, không sửa cấu hình cá nhân.

## Cơ sở cấu hình

Chờ readiness bằng [Compose healthcheck và startup order](https://docs.docker.com/compose/how-tos/startup-order/).
Dockerfile dùng pnpm có version khóa, workspace settings và frozen lockfile theo
[hướng dẫn pnpm Docker](https://pnpm.io/docker). Các Compose thực hành cũ được giữ
nguyên để các báo cáo tuần vẫn tái hiện được.

## Kết quả kiểm tra trên Ubuntu — 04/11/2026

Đã dựng image từ frozen lockfile và mở đủ 7 service khi ghép App. Kiểm tra thực tế
đạt: đăng nhập ba role, phân quyền `/admin/users`, Redis cache HIT, đăng ký → outbox
→ RabbitMQ → worker → Mailpit, giữ JWT và số lượng seed sau restart API. Worker
chỉ healthy sau khi consumer sẵn sàng; hỗ trợ SMTP host loopback và đúng service
`mailpit`, tiếp tục chặn SMTP host tùy ý. RabbitMQ có hostname ổn định để dùng lại
storage qua các lần tạo lại container.

Server mặc định 46 pass/6 suite opt-in skip; suite seed demo PostgreSQL 6 pass.
App đạt typecheck/build, 15 Node, 14 browser foundation/account, 33 hồi quy editor/
template/vault và Electron dev/file-origin. Đường file-origin là harness, chưa phải
nghiệm thu installer. `dev:all` và đăng nhập admin qua UI thật cũng đã kiểm tra.
Web Docker đã được mở bằng Chrome và kiểm tra đăng nhập/đăng xuất đủ ba role.
Healthcheck web kiểm tra cả HTML và entry TypeScript để phát hiện lỗi tải ứng dụng.

Trên máy đang cấu hình, file local chọn web **5184** để giữ Vite5173 có sẵn; API
vẫn **3001**. Các địa chỉ còn lại theo bảng mặc định. Đây là cấu hình riêng của máy;
file ví dụ và checkout mới vẫn mặc định web5173.

## Phạm vi bàn giao và cập nhật tài liệu

Đợt này chốt nền tảng C0–C1, hợp đồng catalog summary, môi trường local và seed đủ
ba role. App dùng được luồng tài khoản; giao diện Creator/Admin, community feed,
xuất bản và lịch sử phiên bản vẫn thuộc các chặng tiếp theo trong roadmap App.

Khi thay đổi lệnh chạy, biến cấu hình, API hoặc quyền, cập nhật hướng dẫn tương ứng
và kết quả kiểm tra trong cùng commit. Tài liệu này đi cùng phiên bản mã nguồn;
khi dẫn chứng từ báo cáo, ghim link đến commit cụ thể thay vì đầu nhánh đang thay đổi.
