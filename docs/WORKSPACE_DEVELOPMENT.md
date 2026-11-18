# Đồng bộ và phát triển workspace EruSentia

Hướng dẫn này nằm trong Git để máy khác kéo được cùng source. Các lệnh dưới đây
chạy tại **thư mục EruSentia ngoài cùng**, có ba checkout nằm cạnh nhau:

```text
EruSentia/                    # Không phải repo Git
├── package.json              # Manifest điều phối local
├── .nvmrc
├── erusentia-app/            # Editor web/Electron
├── erusentia-server/         # API, worker, hạ tầng và launcher
├── erusentia-admin/          # Web quản trị
└── trainning-typ-2026/       # Báo cáo, không phải service
```

## 1. Kéo source sau khi PR đã merge

Kiểm working tree của từng repo trước:

```bash
git -C erusentia-app status --short --branch
git -C erusentia-server status --short --branch
git -C erusentia-admin status --short --branch
```

Nếu có thay đổi local, lưu bằng commit riêng hoặc stash có chủ đích trước khi
đồng bộ. Giữ nhánh chứa commit chưa merge; không dùng `reset --hard` để ép khớp.
Khi các repo sạch và đã xác định chuyển về main:

```bash
git -C erusentia-app switch main
git -C erusentia-app pull --ff-only origin main
git -C erusentia-server switch main
git -C erusentia-server pull --ff-only origin main
git -C erusentia-admin switch main
git -C erusentia-admin pull --ff-only origin main
```

`--ff-only` từ chối lịch sử phân kỳ để người thực hiện đối chiếu trước. Repo báo
cáo giữ nhánh đang dùng, ví dụ `week-6-project-plan`; không đổi nó thành main.

## 2. Khởi tạo manifest cha và dependencies

Cần Node **24**, pnpm **12.11.2**, Docker daemon và Compose plugin có `up --wait`.
Manifest mẫu tạo `.nvmrc` với Node 24.22.1. Nếu dùng nvm:

```bash
nvm install 24.22.1
nvm use 24.22.1
pnpm --dir erusentia-server workspace:init
pnpm setup:all
```

`workspace:init` chỉ tạo `package.json` và `.nvmrc` ở thư mục cha khi chưa có,
không ghi đè manifest cũ. README, biên bản thiết lập hoặc hướng dẫn tự viết ở thư
mục cha cũng là file local; clone/pull repo không tự mang chúng sang máy khác.
Hướng dẫn trong file này và [WORKSPACE_LAUNCHER.md](WORKSPACE_LAUNCHER.md) luôn
được kéo cùng repo Server.

`setup:all` cài riêng ba lockfile bằng `--frozen-lockfile`, kiểm binary Electron
và cấu hình kết nối local. Không cần `pnpm install` trong thư mục cha. Khi dev
hằng ngày, chỉ cần cài lại nếu dependencies/lockfile thay đổi.

Kiểm đầy đủ bằng lệnh nằm trong Server, kể cả khi manifest cha là bản cũ:

```bash
pnpm --dir erusentia-server workspace:test
pnpm --dir erusentia-server workspace:check
```

Manifest mới có `pnpm check:launcher` gọi hai bước này. Nếu manifest cha đã có
nhưng thiếu script, ghép script cần thiết từ `scripts/workspace-package.json`;
giữ các alias và cấu hình riêng của máy. Có thể dùng trực tiếp
`pnpm --dir erusentia-server workspace:setup` để cài ba repo.

## 3. Chạy và dừng

Hằng ngày, tại thư mục EruSentia:

```bash
nvm use
pnpm start
```

`pnpm start` mở Electron, Vite của App, Vite Admin và backend Docker. Lần đầu
Docker build có thể lâu; các lần sau dùng cache. Backend migrate/seed additive
và chờ healthy trước khi mở frontend.

| Nhu cầu                   | Lệnh                      |
| ------------------------- | ------------------------- |
| Electron + Server + Admin | `pnpm start`              |
| App web + Server + Admin  | `pnpm start:web`          |
| Electron + Server         | `pnpm start:app-server`   |
| Server + Admin            | `pnpm start:server-admin` |
| Chỉ Electron              | `pnpm start:app`          |
| Chỉ App web               | `pnpm start:app:web`      |
| Chỉ Server/hạ tầng        | `pnpm start:server`       |
| Chỉ Admin                 | `pnpm start:admin`        |
| Dừng backend, giữ dữ liệu | `pnpm stop`               |

Nếu manifest cha cũ chưa có các lệnh trên, dùng từ repo Server:
`pnpm workspace:start`, `pnpm workspace:web`, `pnpm workspace:app-server`
hoặc `pnpm workspace:server-admin`.

Ctrl+C dừng đúng nhóm frontend của terminal đó. Backend vẫn chạy; `pnpm stop`
dừng stack và giữ volumes. Các profile chỉ frontend không tự mở backend.
Không mở hai nhóm chiếm cùng cổng App/Admin; launcher báo lỗi cổng bận và không
kill tiến trình của project khác.

## 4. Cổng, cấu hình và tài khoản

Mỗi máy giữ cấu hình riêng ở `erusentia-server/docker/.env.project.local`.
App dùng `PROJECT_WEB_PORT` (mặc định 5173), Admin dùng `PROJECT_ADMIN_PORT`
(5183), API dùng `PROJECT_API_PORT` (3001). Chọn cổng App 5184 nếu 5173 đã được
project khác dùng. Không ghi đè env của máy bên kia bằng file credential của máy này.

Sau khi sửa cổng, chạy `pnpm setup:env` hoặc, nếu manifest cũ thiếu script:

```bash
node erusentia-server/scripts/workspace-dev.mjs configure
pnpm --dir erusentia-server workspace:check
```

Khởi động lại nhóm frontend sau khi đổi cấu hình. Các cổng App/Admin/API và hạ
tầng phải khác nhau. Launcher giữ khóa env không liên quan và backup giá trị cũ
trước khi sửa kết nối. Không sửa config hosted hoặc secret backend để đổi cổng Vite.

Ví dụ máy có App 5184, Admin 5183, API 3001:

| Thành phần          | Địa chỉ                           |
| ------------------- | --------------------------------- |
| App web             | http://127.0.0.1:5184             |
| Admin               | http://127.0.0.1:5183             |
| Swagger             | http://127.0.0.1:3001/docs        |
| API health          | http://127.0.0.1:3001/health      |
| Admin proxy health  | http://127.0.0.1:5183/api/health  |
| Email local Mailpit | http://127.0.0.1:8026             |
| RabbitMQ UI         | http://127.0.0.1:15673            |
| Báo cáo tuần 6      | http://127.0.0.1:3001/docs/week-6 |

Admin dùng `VITE_ERU_API_BASE_URL=/api`; Vite proxy tới API theo
`ERU_API_PROXY_TARGET` và bỏ tiền tố `/api`. App/Electron dùng API origin local
tương ứng. File `.env.local` nằm riêng trong từng frontend. Dùng nhất quán
`127.0.0.1` và cổng cũ khi mở dữ liệu browser vì OPFS/IndexedDB gắn với origin.

Tài khoản seed local ban đầu: `user@erusentia.test`, `creator@erusentia.test`,
`admin@erusentia.test`, cùng mật khẩu `EruSentiaDemo!2026`. Chỉ tài khoản role admin
vào được web quản trị. Seed giữ mật khẩu/quyền đã chỉnh, không đặt lại tài khoản.
Mailpit nhận email local, không gửi SMTP ra Internet.

## 5. Dev, kiểm tra và xử lý lỗi

App/Admin dùng HMR khi sửa UI. Thay Electron main/preload thì mở lại nhóm App.
Sau khi sửa backend, `pnpm start:server` build lại API/worker với dữ liệu hiện có.
Nếu không có manifest cha, dùng `pnpm --dir erusentia-server stack:up`.

```bash
pnpm --dir erusentia-app test:session
pnpm --dir erusentia-server test
pnpm --dir erusentia-server test:admin
pnpm --dir erusentia-server test:week6
pnpm --dir erusentia-admin test:ui
```

Các kiểm PostgreSQL tạo/xóa DB test riêng; cần DB_HOST/PORT/USERNAME/PASSWORD
local đúng cho tiến trình Node host. File `.env` dùng cho lệnh Node host và env
Docker project là hai nguồn khác nhau. Không trỏ kiểm ghi dữ liệu sang DB cloud.

Sau khi mở App web và Admin, có thể kiểm editor/login/proxy/quyền/CORS bằng profile tạm:

```bash
node erusentia-server/scripts/workspace-smoke.mjs
```

Xem Docker/log từ Server:

```bash
pnpm --dir erusentia-server stack:status
pnpm --dir erusentia-server stack:logs
```

Status Docker không chứng minh frontend đã mở. Khi Vite báo ECONNREFUSED, kiểm API
`/health`, cổng thực tế và proxy; mở backend trước khi thử lại. Nếu cổng bận,
dừng đúng terminal sở hữu nó hoặc chọn cổng khác trong env project.

Ubuntu 24.04 có thể cần AppArmor userns cho Electron tại checkout mới. Xem
[hướng dẫn sandbox](WORKSPACE_LAUNCHER.md#electron-sandbox-trên-ubuntu-2404).
`pnpm setup:sandbox` là bước có xác thực Ubuntu; không chạy lại sau mỗi pull.
Đổi đường dẫn checkout thì review lại profile. Không dùng `--no-sandbox` để thay bước này.

## 6. Dữ liệu và phạm vi đồng bộ

Git đồng bộ source, không đồng bộ vault, profile Electron/browser, OPFS, Docker
volumes, env, database backup, report/PDF/binary hay bộ nộp bài local.
Các dữ liệu này phải chuyển riêng khi cần; giữ cả manifest/receipt/hash của bản xuất.
Không ghi đè profile đang mở hoặc dùng `down -v`/`db:fresh` để chữa lỗi khởi chạy.

Engine của App lấy từ `erusentia-app/src/config/engine.json`. HTML cũ giữ runtime
cũ, muốn bản xuất mới phải đi qua runtime thật; không đổi nhãn bản cũ. Changelog
và bằng chứng trong repo ghi phiên bản/môi trường đã kiểm, không thay thế kiểm lại
toàn bộ PDF/native trên máy mới.

Local dev không cần dịch vụ cloud hoặc GitHub runner. CI/deploy là bước riêng;
pull source không phát hành binary, không chuyển credential và không mặc định
đã deploy hosted. Xem [deploy Server](DEPLOYMENT.md),
[Render/Neon](RENDER_NEON.md) và `erusentia-app/docs/CI_SETUP.md` trong workspace.
