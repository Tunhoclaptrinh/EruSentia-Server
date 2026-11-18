# Launcher App + Server + Admin trên máy phát triển

Cập nhật 17/11/2026. `scripts/workspace-dev.mjs` điều phối App + Server + Admin
trên nền `project-stack.mjs`; script và manifest mẫu nằm trong repo Server để có
thể khởi tạo bộ lệnh ngoài cùng sau khi clone. Cấu hình và dữ liệu riêng của mỗi
máy vẫn được giữ ngoài Git.

Các bước pull main, bootstrap manifest cha, chạy hằng ngày và chuyển dữ liệu sang
máy khác nằm trong [WORKSPACE_DEVELOPMENT.md](WORKSPACE_DEVELOPMENT.md). Tài liệu
này được quản lý trong Server để clone/pull có đủ hướng dẫn, dù các file cha là local.

## Repo và bộ điều phối ngoài cùng

```text
EruSentia/                     # Không phải repo Git
├── package.json               # Phải khởi tạo riêng, không đến từ clone App
├── .nvmrc
├── erusentia-app/             # Git độc lập
├── erusentia-server/          # Git độc lập, chứa launcher và manifest mẫu
├── erusentia-admin/           # Git độc lập
└── trainning-typ-2026/        # Báo cáo, không phải một service
```

Dùng Node **24** và pnpm **12.11.2**. Cần Docker daemon và Compose plugin hỗ trợ
`docker compose`, `up --wait`, profiles và healthcheck. Máy này có Ubuntu 24.04.5,
Docker 29.9.2, Compose plugin **5.6.1** (không phải bản 2.x), đã kiểm trực tiếp các
lệnh stack; không hạ phiên bản Docker đang phục vụ các dự án khác.

Nếu chỉ mới clone repo, cần launcher/template mới này trong repo Server trước.
Sau đó tạo manifest ngoài cùng một lần:

```bash
cd EruSentia
nvm use                       # Máy này có .nvmrc = 24.22.1
# Nếu chưa có .nvmrc: nvm install 24.22.1 && nvm use 24.22.1
pnpm --dir erusentia-server workspace:init
pnpm setup:all
pnpm check:launcher
pnpm start
```

`workspace:init` chép `scripts/workspace-package.json` ra thư mục cha và tạo
`.nvmrc` khi chưa tồn tại. Nó **không ghi đè** manifest hoặc cấu hình ngoài cùng đã
có. Kiểm tra/ghép các script thủ công khi một workspace cũ đã có package.json khác.
Không tạo pnpm workspace chung; mỗi repo vẫn dùng lockfile của nó.

Các lệnh đã có trên main vẫn dùng cùng launcher: `pnpm workspace:start`,
`pnpm workspace:web`, `pnpm workspace:app-server`, `pnpm workspace:server-admin`
và `pnpm workspace:setup` từ repo Server. Cú pháp profile trước
`node scripts/workspace-dev.mjs full` tương đương `start all`; có thêm
`app-server-web` để chạy App web + backend. API `runWorkspace(profile, options)`
vẫn được export, dùng chung quản lý vòng đời với `start(profile, options)`.

`ERU_APP_DIR` và `ERU_ADMIN_DIR` chọn checkout khác khi cần. Chỉ kiểm checkout và
ghi `.env.local` cho frontend được chọn; profile server/admin không cần App.
Thêm `--dry-run` sau profile (hoặc `start <profile>`) để in kế hoạch và kiểm cổng
cấu hình, không bật Docker/frontend hoặc sửa `.env.local`. `projectContext` có
thể tạo env project riêng nếu chưa tồn tại. Dry-run không thay thế kiểm thực tế
bind cổng, browser, proxy hoặc Ctrl+C.

## Electron sandbox trên Ubuntu 24.04

Nếu terminal thường báo `SUID sandbox helper ... not configured correctly`, dùng:

```bash
pnpm setup:sandbox
```

Helper chuẩn bị profile/installer tại `.local/system/`, kiểm cú pháp bằng
`apparmor_parser`, rồi gọi hộp thoại xác thực Ubuntu. Chỉ khi chủ máy xác thực,
profile `/etc/apparmor.d/erusentia-workspace-electron` mới được cài và nạp.
Rule cho phép `userns` đúng binary Electron trong `.pnpm` của checkout App này,
bao gồm các phiên bản Electron cập nhật tại cùng checkout. Không đặt helper SUID,
không sửa sysctl toàn hệ thống và không thêm `--no-sandbox` vào launcher.
Nếu đã có profile khác nội dung, installer dừng để review, không ghi đè tự động.
Đường dẫn chứa ký tự điều khiển/glob bị từ chối trước khi tạo policy. Installer dùng
Python isolated mode (`-I`) khi xác thực để bỏ qua PYTHONPATH và module cạnh script.

Điều này cần kiểm từ terminal của người dùng: process chạy trong IDE/agent có thể
thừa hưởng một AppArmor profile khác nên test từ agent không đủ chứng minh GUI
terminal chạy được. Sau khi cài, chạy lại `pnpm start` trong terminal thường.
Đường dẫn checkout thay đổi thì cần review/cấu hình lại profile.

Cách cấu hình theo [hướng dẫn Ubuntu 24.04 về unprivileged user namespaces](https://documentation.ubuntu.com/release-notes/24.04/#unprivileged-user-namespace-restrictions).

## Các chế độ chạy

Tất cả lệnh trong bảng chạy từ **thư mục EruSentia ngoài cùng**:

| Lệnh                      | Thành phần                                                              |
| ------------------------- | ----------------------------------------------------------------------- |
| `pnpm setup:all`          | Frozen install App, Server, Admin; kiểm binary Electron, cấu hình local |
| `pnpm start`              | Electron + Vite App + Server Docker + Admin Vite                        |
| `pnpm start:web`          | App Vite + Server Docker + Admin Vite                                   |
| `pnpm start:app-server`   | Electron + Vite App + Server Docker                                     |
| `pnpm start:server-admin` | Server Docker + Admin Vite                                              |
| `pnpm start:app`          | Electron + Vite App, không gọi Docker                                   |
| `pnpm start:app:web`      | Chỉ App Vite, không gọi Docker                                          |
| `pnpm start:server`       | Chỉ backend/hạ tầng Docker, trả terminal sau khi sẵn sàng               |
| `pnpm start:admin`        | Chỉ Admin Vite, không gọi Docker                                        |
| `pnpm stop`               | Dừng stack Docker này, giữ nguyên volumes                               |
| `pnpm check:launcher`     | Kiểm profile/cổng/lifecycle, toolchain và Compose config                |

Chạy riêng frontend không tự bật backend. Khi đó editor local vẫn mở, nhưng API
cần được mở riêng nếu muốn đăng nhập/cộng đồng/quản trị. Không chạy hai nhóm có cùng
App/Admin trên cùng cổng. Cổng bị chiếm gây lỗi rõ ràng, không tăng cổng tự động và
không tìm/kill tiến trình của người khác. Lệnh `start:admin` tại gốc dùng cổng local;
`pnpm dev` trong repo Admin vẫn có mặc định riêng trong Vite config.

## Cấu hình local và dữ liệu

Nguồn cấu hình: `erusentia-server/docker/.env.project.local`, hoặc file riêng được
chọn bởi `ERU_PROJECT_ENV_FILE`. Không commit file này. Các cổng trên máy hiện tại:

| Thành phần                 | Địa chỉ                                       |
| -------------------------- | --------------------------------------------- |
| App Vite / editor Electron | http://127.0.0.1:5184                         |
| Admin                      | http://127.0.0.1:5183                         |
| API / Swagger              | http://127.0.0.1:3001/docs                    |
| Health trực tiếp           | http://127.0.0.1:3001/health                  |
| Health qua proxy Admin     | http://127.0.0.1:5183/api/health              |
| PostgreSQL                 | 127.0.0.1:5433, database `eru_project_docker` |
| RabbitMQ AMQP / UI         | 127.0.0.1:5673 / http://127.0.0.1:15673       |
| Redis                      | 127.0.0.1:6380                                |
| Mailpit SMTP / UI          | 127.0.0.1:1026 / http://127.0.0.1:8026        |

`PROJECT_ADMIN_PORT` mặc định 5183; App/API theo `PROJECT_WEB_PORT` và
`PROJECT_API_PORT`. Launcher từ chối mọi cổng project trùng nhau. Admin sử dụng
`VITE_ERU_API_BASE_URL=/api` và `ERU_API_PROXY_TARGET=http://127.0.0.1:<API port>`;
Vite bỏ tiền tố `/api`. App/Electron dùng API loopback tương ứng. CORS được bổ sung
đúng origin App/Admin, không dùng wildcard.

Launcher chỉ cập nhật các khóa connection trong `.env.local` App/Admin và cổng/CORS
trong env project, giữ các khóa khác. Trước thay đổi, lưu bản cũ dưới
`EruSentia/.local/backups/workspace-env/`; file env có mode 600. Không ghi lại
`server/.env`, config hosted/Neon, vault hoặc runtime soạn thảo.

Backend dùng project `erusentia-project`, tách database/volume/network của các
project khác. `project-stack.mjs` build API, chờ PostgreSQL, migrate theo journal và
seed additive trước khi chờ API/worker sẵn sàng. Không gọi `db:fresh`, reset schema,
`down -v` hoặc xóa Docker volume. Tài khoản demo có sẵn ban đầu:

- `user@erusentia.test`, `creator@erusentia.test`, `admin@erusentia.test`.
- Mật khẩu seed ban đầu: `EruSentiaDemo!2026`, chỉ cho local. Seed không đặt lại
  mật khẩu/quyền đã chỉnh; không giả định mật khẩu ban đầu vẫn còn hiệu lực.

## Ctrl+C và kiểm thử thực tế

Frontend giữ terminal hiện tại. Ctrl+C/SIGTERM đóng đúng Vite/Electron và các
tiến trình con của lượt chạy đó. Trên Linux, mỗi child có process group riêng;
launcher gửi SIGTERM rồi mới SIGKILL sau grace period. Một frontend lỗi cũng dừng
các frontend còn lại trong cùng nhóm. Backend Docker tiếp tục chạy; `pnpm stop`
dừng backend nhưng giữ dữ liệu. Đóng Electron bình thường cũng kết thúc nhóm frontend.

Sau khi mở `pnpm start:web`, có thể kiểm lại bằng:

```bash
node erusentia-server/scripts/workspace-smoke.mjs
```

Smoke dùng browser profile mới, tạo note kiểm trong bộ nhớ/OPFS của profile tạm,
kiểm editor, form đăng nhập Admin, JSON health qua proxy, 401 trên API admin và
CORS của App. Không đăng nhập hoặc sửa dữ liệu tài khoản. Kết quả/ảnh nằm trong
`.local/workspace-verification/web/`. Nó không chứng nhận template hoặc phân trang.

Desktop smoke cần **profile tạm rỗng** và debug loopback chỉ trong phiên kiểm:

```bash
# Terminal 1, Linux: đường dẫn tuyệt đối, không trỏ vào profile/vault thật
ERU_USER_DATA_DIR="$PWD/.local/workspace-verification/electron-profile" \
  ERU_ELECTRON_DEBUG_PORT=9239 pnpm start
# Terminal 2, cùng env profile để xác nhận đây là lượt kiểm riêng
ERU_USER_DATA_DIR="$PWD/.local/workspace-verification/electron-profile" \
  ERU_ELECTRON_DEBUG_PORT=9239 node erusentia-server/scripts/workspace-smoke.mjs --desktop
```

`ERU_ELECTRON_DEBUG_PORT` không bật mặc định, chỉ bind loopback. Smoke từ chối khi
đang mở vault/draft có sẵn. Ctrl+C ở terminal launcher sau khi kiểm, rồi kiểm các
cổng frontend được giải phóng. Không dùng thao tác này trên profile đang làm việc.

## Những dữ liệu clone Git không mang theo

Đối chiếu trên máy này ngày 16/11/2026: HTML báo cáo tracked trên nhánh
`week-6-project-plan` có SHA-256 `d47bf9bbdfa8153c37ef4652f01409270a43cdc1bef222c5cffbf6003bd4b3e4`.
Receipt App `docs/evidence/wysiwyg-current/beta3-week6-3.10.2.json` yêu cầu source
`a2b92e3826edb5e5552bf56bf51b38782f539bd9fec7fad162923026ef9dfd9b`; hai bản không khớp.
Không dùng receipt đó để nghiệm thu bản HTML hiện có. Bản trùng hash receipt không
có trong các nhánh remote training đã fetch.

Các đường dẫn đầu ra beta.3 được nhắc trong App nhưng **chưa có ở máy này**:

- `EruSentia/deliverables/TYP_Week6_EruSentia_1.1.0-beta.3_CHO_BUILD/` và ZIP cùng tên.
- `erusentia-app/scratch/week6-release/` (ba artboard và tài nguyên demo).
- `erusentia-app/docs/evidence/2026-11-11-pdf-page-audit/beta3-week6/` (PDF native/audit).
- `erusentia-app/scratch/publication-chain-beta3-week6/comparison.json`.
- `erusentia-app/release/Windows/`, `release/Linux/`, `src-tauri/target/release/bundle/`.
  Receipt hiện ghi installer Windows/Linux còn chờ build; không giả định máy cũ đã có chúng.

Cần chuyển report HTML/PDF, manifest/receipt và đúng bộ đầu ra từ máy cũ nếu muốn
tiếp tục bộ bàn giao đó. Nhiệm vụ môi trường này không sinh đè báo cáo để che chênh lệch.

- `EruSentia/.local/dev-samples/`: vault có chỉnh sửa, manifest, ZIP và Git labs.
- `erusentia-app/examples/local-vaults*/`, `scratch/`, `.local/`, `release/`,
  `src-tauri/target/release/`: chỉ chuyển đúng bundle/export/bộ cài cần giữ từ máy cũ;
  không coi chúng có sẵn vì repo đã clone. Giữ cả manifest/receipt/hash cùng đầu ra.
- Profile Electron dev (Linux thường `~/.config/erusentia-development` hoặc đường
  dẫn `ERU_USER_DATA_DIR`) và browser IndexedDB/OPFS. Chuyển vault/export theo UI;
  đổi host/cổng không tự chuyển ghi chú browser. Không ghi đè profile đang mở.
- Database/queue Docker: chuyển bằng backup/restore có chủ đích. Volume local không
  nằm trong Git. Không copy credential máy cũ vào public repo.
- Báo cáo tuần 6 tracked nằm ở `trainning-typ-2026/week-6/` trên nhánh
  `week-6-project-plan`; `SOURCE_SNAPSHOT.md` cho biết bản nền từng có thay đổi chưa
  commit. Bản tracked không bảo đảm đã có mọi vault, báo cáo xuất sau đó hoặc bộ nộp
  bài trên máy cũ. Cần đối chiếu bundle thực tế với manifest trước khi nộp.

Môi trường chạy không phụ thuộc việc chuyển lại các bundle đó. Không sinh đè hoặc
gắn nhãn engine mới cho báo cáo/vault cũ trong nhiệm vụ khởi chạy này.
