# Dịch vụ tài nguyên có xác thực

Đích cấu hình: `https://erusentia-api.onrender.com`. Mã hiện ở `feat/typ-week6-advanced-features`; Render Blueprint đang theo dõi `main`. Chưa coi endpoint mới đã live khi chưa deploy và kiểm tra URL thật.

## Luồng mở HTML

File HTML mở iframe `/resource-gateway/connect#<nonce-phiên>`. Người dùng đăng nhập ngay trong iframe. Khung gọi API cùng origin và chỉ gửi metadata/kết quả qua `postMessage`, giữ JWT/refresh token trong bộ nhớ. Kiểm tra window source, origin và nonce ở hai đầu. Public connect UI không cấp quyền API; service endpoints vẫn yêu cầu JWT và session đang hoạt động. CORS của API không mở cho `null` hoặc wildcard.

API đích cùng origin dùng phiên dịch vụ; API khác chỉ nhận token do người dùng chủ động cấp. Server kiểm tra origin trong allowlist, IP public, DNS được ghim, chặn redirect và không cho relay tới resource/admin routes. Không tự chuyển cookie hoặc Authorization của outer request vào upstream.

## Endpoint

| Endpoint | Quyền / hành vi |
| --- | --- |
| `GET /resource-gateway/me` | Identity, server plan, quota UTC, targets |
| `POST /resource-gateway/requests` | JWT; `{url, method, headers?, body?, documentId?}` → envelope status/headers/bodyBase64 |
| `POST /resource-documents` | JWT; `{title, html, access: private/shared/premium}` → metadata ID |
| `GET /resource-documents` | Chỉ danh sách tài liệu do mình sở hữu |
| `GET /resource-documents/:id` | Kiểm tra ACL, quota, ghi audit rồi trả HTML dưới dạng JSON |
| `GET /resource-documents/:id/grants` | Owner/admin, danh sách tài khoản được chia sẻ |
| `POST /resource-documents/:id/grants` | Owner/admin; shared document; `{userId}` |
| `DELETE /resource-documents/:id/grants/:userId` | Owner/admin, thu hồi quyền ngay ở lần gọi sau |
| `GET /resource-documents/:id/access-events` | Owner/admin, 50 sự kiện gần nhất, user ID và kết quả |
| `DELETE /resource-documents/:id` | Owner/admin, soft delete |
| `PATCH /admin/resource-plans/:userId` | Admin; `{plan: free/premium/blocked, expiresAt?: ISO8601}` |

`private`: owner/admin. `shared`: owner/admin hoặc tài khoản được grant. `premium`: owner/admin hoặc người có entitlement premium còn hạn. `blocked` không mở tài liệu hoặc relay được dù có grant. Plan hết hạn trở về free. Không có billing tự động; cấp gói hiện do admin quản lý.

ID trong request relay kiểm tra quyền đối với tài liệu đó, không khóa HTML đã tồn tại trong file local. Để nội dung thực sự cần được cấp quyền mới xem được, giữ HTML trên server và chỉ xuất ID/loader. Plaintext đã được tải xuống vẫn có thể được sao chép và đọc offline. HTML người dùng không bao giờ được thực thi trực tiếp trên API origin; template hiển thị trong iframe sandbox không same-origin.

## Cấu hình và vận hành

- `RESOURCE_GATEWAY_ENABLED=true`
- `RESOURCE_TARGET_ORIGINS=https://erusentia-api.onrender.com`: chỉ exact HTTPS origins, không phải arbitrary public proxy.
- `RESOURCE_FREE_DAILY_LIMIT=30`, `RESOURCE_PREMIUM_DAILY_LIMIT=500`, tối đa 10000. `0` tắt gói tương ứng.
- `RESOURCE_ALLOW_LOCAL_TARGETS=true` chỉ dành cho fixture test; khởi động bị từ chối nếu `NODE_ENV=production`.

Migration `14_resource_gateway.sql` thêm bảng plan, usage, document/grant và access audit. `PROJECT_BOOTSTRAP=true` trong Render chạy migration có journal/advisory lock trước khi khởi động. Docker image đóng gói `public/resource-connect.html`. Bảng cũ không bị reset. Audit chỉ lưu identity, action, target origin và kết quả; không lưu URL query, token hay body.

Quota được tăng nguyên tử theo user/ngày UTC trong PostgreSQL, áp dụng cả request thất bại đã được nhận xử lý và đọc tài liệu thành công. Request tối đa 512 KiB, response 2 MiB, timeout upstream 12 giây, tối đa 8 yêu cầu upstream/instance. Tối đa 10 tài liệu free hoặc 100 premium/admin, 512 KiB/tài liệu. Đây chưa phải media streaming, remote browser hoặc dịch vụ phá hạn chế iframe của website. Access token hết hạn thì đăng nhập lại.

## Kiểm tra trước/sau deploy

`pnpm test:week6` tạo PostgreSQL tạm, áp dụng migration và kiểm tra ACL, grant/revoke, premium/blocked, quota đồng thời, audit và chống relay vào private IP. `node --test test/resources.test.cjs` kiểm tra bản memory. Repo app có `pnpm test:api-tools`: Chromium mở `file://` và đăng nhập iframe thật, gọi API, xác minh private document và không gửi JWT về parent.

Khi đã kết nối Render: chọn đúng commit đã kiểm tra, deploy service hiện có và theo dõi bootstrap/health. Xác nhận `/resource-gateway/connect` trả HTML có nonce CSP, `/resource-gateway/me` và `/resource-documents` trả 401 khi thiếu token; sau đăng nhập `me` trả đúng user/plan/quota. Kiểm tra file standalone gọi được API và tài liệu không có quyền bị 403. Kiểm tra lại sau restart để xác nhận plan/quyền vẫn còn. Chỉ lúc đó ghi nhận đã live.

## Bằng chứng kiểm tra cục bộ ngày 10/11/2026

- Server build đạt; `pnpm test:week6`: 44/44 bài qua trên PostgreSQL tạm, gồm migration mới và quota đồng thời.
- App production build và typecheck test đạt; `pnpm test:session`: 88/88; `pnpm test:api-tools`: 7/7 luồng Chromium qua, gồm hai template dùng phiên hosted service từ `file://`.
- Image `erusentia-server:week6-resource-review` đã build và chạy smoke qua: connect/CSP, JWT, tài liệu private, docs và file migration có trong image. Máy local chỉ có legacy Docker builder; bản Dockerfile kiểm tra tạm bỏ cache mount của bước pnpm install, giữ nguyên dependencies/runtime. Render/CI vẫn dùng Dockerfile gốc với BuildKit.
- Kiểm tra URL thật `https://erusentia-api.onrender.com/resource-gateway/connect` hiện trả 404. Chưa deploy commit mới, chưa nghiệm thu service cloud. Phiên làm việc chưa có kết nối Render.
