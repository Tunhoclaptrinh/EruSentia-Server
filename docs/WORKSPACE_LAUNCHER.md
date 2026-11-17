# Chạy App, Server và Admin trong local workspace

Nguồn launcher: `scripts/workspace-dev.mjs`, dùng lại `project-stack.mjs` cho Docker. Không đổi runtime tài liệu hoặc engine. Các repo đặt cạnh nhau; có thể đổi `ERU_APP_DIR`, `ERU_ADMIN_DIR`. Cần Node 24, pnpm 12.11.2, Docker Compose và dependencies đã cài bằng `pnpm workspace:setup`.

| Từ repo Server | Thành phần |
|---|---|
| `pnpm workspace:start` | Backend Docker + App Vite/Electron + Admin Vite |
| `pnpm workspace:web` | Backend Docker + App Vite + Admin Vite |
| `pnpm workspace:app-server` | Backend Docker + App Vite/Electron |
| `pnpm workspace:server-admin` | Backend Docker + Admin Vite |
| `node scripts/workspace-dev.mjs app` | App Vite/Electron, không bật backend |
| `node scripts/workspace-dev.mjs app-web` | Chỉ App Vite |
| `node scripts/workspace-dev.mjs admin` | Chỉ Admin Vite |
| `pnpm stack:up` | Chỉ backend Docker |

Ở thư mục cha, `pnpm start`, `start:web`, `start:app-server`, `start:server-admin`, `start:app`, `start:app:web`, `start:admin`, `start:server` gọi cùng launcher. Bộ lệnh cha là local; nếu chỉ clone repo, dùng các lệnh trong bảng. Profile không chọn App không cần checkout/dependencies App; tương tự với Admin.

Thêm `--dry-run` sau profile để kiểm checkout/cổng và xem kế hoạch mà không chạy Docker/frontend. Chế độ này có thể tạo file cấu hình local nếu chưa tồn tại; không đọc/in secret ra terminal. Ví dụ `node scripts/workspace-dev.mjs server-admin --dry-run`.

`PROJECT_WEB_PORT` mặc định 5173, `PROJECT_ADMIN_PORT` 5183, `PROJECT_API_PORT` 3001. Launcher kiểm trùng cổng trong cấu hình và thử bind cổng frontend trước khi bật backend. Không dừng process bên ngoài. Khi chọn App có backend, nó chỉ dừng service Docker `web` thuộc stack project để chuyển sang Vite trên host. Admin dùng `/api` và `ERU_API_PROXY_TARGET` từ cấu hình stack, kể cả khi đổi cổng API. Biến môi trường này được Vite Admin ưu tiên hơn `.env`.

Backend được build, migrate/seed additive và chờ healthy trước khi mở frontend. Không reset volume. Các giao diện được gom bằng `concurrently --kill-others`; một frontend kết thúc hoặc lỗi thì các frontend cùng nhóm được dừng. Electron chờ Vite tối đa 60 giây. Ctrl+C đóng nhóm frontend; backend còn chạy để có thể dùng terminal khác. `pnpm stack:down` dừng Docker, giữ dữ liệu. `pnpm stack:status` chỉ phản ánh Docker.

Form Admin để trống; dùng tài khoản local `admin@erusentia.test` với mật khẩu demo đã seed nếu chưa đổi. Chạy riêng frontend không tạo tài khoản, migrate hoặc tự đăng nhập.

Kiểm hồi quy: `node --test test/workspace-launcher.test.cjs` kiểm profile thiếu checkout không liên quan, cổng tùy chỉnh, trùng cổng và cổng bị chiếm mà không kill process chủ cổng. Kiểm end-to-end local cần Docker thật, trang App/Admin, proxy `/api/health` và thao tác Ctrl+C; không dùng dry-run thay thế kết quả đó.
