# C4 — Quản lý phiên đăng nhập

Lát cắt đầu của C4 cho phép người dùng xem và thu hồi các phiên đăng nhập của
chính mình. Dùng bảng `auth_refresh_sessions` và khóa theo family đã có; **không
có migration mới**. Không gọi đây là danh sách thiết bị: hệ thống chưa lưu hệ
điều hành, IP hay user-agent. Thời điểm xoay token không phải lần hoạt động cuối.

| API | Kết quả |
|---|---|
| `GET /auth/sessions?page=1&size=10` | Các family còn leaf refresh chưa dùng/chưa thu hồi/chưa hết hạn của tài khoản hiện tại; phân trang tối đa 100 |
| `DELETE /auth/sessions/:id` | Thu hồi family thuộc tài khoản hiện tại; 204 cả khi không tồn tại/không sở hữu |
| `POST /auth/sessions/revoke-others` | Thu hồi các family khác đang có, giữ family của JWT gọi API |

Cả ba cần Bearer access token, trả `Cache-Control: no-store`. `id` là định danh
family, không phải credential. Response list chỉ gồm `id`, `createdAt`,
`lastRefreshedAt`, `expiresAt`, `current` và metadata phân trang. Không có token,
hash, email tài khoản khác hoặc dữ liệu client giả định. `current` lấy từ `sid`
đã xác minh của JWT, không nhận user/family của caller qua body/query.

Một lần đăng nhập vẫn là một dòng trong danh sách dù refresh nhiều lần:
`createdAt` là lần đầu, `lastRefreshedAt` là lần cấp/xoay gần nhất, `expiresAt` giữ
hạn tuyệt đối ban đầu. Chỉ liệt kê phiên đang active, không phải audit lịch sử.
Danh sách sắp xếp theo lúc đăng nhập mới nhất, ID là tie-breaker ổn định.

Thu hồi dùng cùng advisory transaction lock theo family với refresh/logout,
rồi cập nhật toàn family sau khi lấy khóa. Vì vậy refresh chạy đồng thời không
để lại child còn dùng được. Thu hồi nhiều family lấy khóa theo ID tăng dần.
Danh sách family của thao tác được lấy tại thời điểm xử lý; đăng nhập mới sau
đó là phiên mới, không bị hứa chặn vĩnh viễn. Phiên bị thu hồi không dùng được
access hoặc refresh ở các request tiếp theo. Request đã được xác thực trước
thời điểm thu hồi có thể vẫn đang hoàn thành.

API cho phép thu hồi cả phiên đang gọi; sau 204 client phải đăng nhập lại.
Giao diện App dùng thao tác đăng xuất hiện có cho phiên này, còn danh sách có
xác nhận trước khi thu hồi phiên khác. Không tự gửi lại mutation khi mất response
hoặc 401; tải lại danh sách để xác nhận kết quả trước khi thử lại.

## Thử bằng Swagger

1. Đăng nhập cùng tài khoản hai lần ở `POST /auth/login`, giữ hai token pair riêng.
2. Authorize bằng access token thứ nhất, mở `GET /auth/sessions`; có hai family,
   đúng một dòng `current: true`.
3. Refresh pair thứ hai, danh sách vẫn có hai family và ngày bắt đầu không đổi.
4. Xóa ID của family thứ hai. Access token thứ hai gọi `/auth/me` nhận 401;
   refresh token mới nhất của family đó cũng nhận 401. Pair thứ nhất vẫn dùng được.
5. Thử ID tài khoản khác: nhận 204 nhưng tài khoản đó không bị thu hồi. User,
   creator và admin đều chỉ quản lý các phiên của chính mình qua API này.

## Kiểm thử và triển khai

```bash
pnpm typecheck
pnpm test
pnpm test:hosted
```

`test/account-sessions.test.cjs` chạy cùng contract trên memory và PostgreSQL TLS
riêng. Bao phủ pagination/field whitelist, quyền sở hữu, gộp rotation, hết hạn,
idempotency, thu hồi hiện tại/khác, race refresh với thu hồi một hoặc nhiều family.
`test:hosted` tự tạo/xóa container và DB `project_test_sessions`; không dùng Neon.

Triển khai API trước App rồi kiểm tra `/docs-json` có đủ ba endpoint. Nếu Render
chưa deploy commit mới, chọn Manual Deploy trên service; CI xanh chưa chứng minh
service đã cập nhật. Không bật UI chỉ dựa vào kết quả build cũ.

Lát cắt này chưa triển khai email xác minh/đặt lại mật khẩu, rate limit/quota,
kiểm duyệt, retention của session history hoặc vận hành pilot. Các phần đó giữ
trong plan C4; không xem quản lý phiên là đã hoàn tất C4.
