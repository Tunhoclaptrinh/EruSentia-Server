# C4-A2 — Xác minh email và đặt lại mật khẩu local

Ngày 07/11/2026. Dùng **Mailpit trên máy phát triển**, chưa gửi email ra Internet.
Tiếp nối [quản lý phiên](ACCOUNT_SESSIONS.md); email trên Render/Neon vẫn tắt.

## Chạy và thử

Hai repo đặt cạnh nhau. Từ thư mục cha có bộ lệnh điều phối:

```bash
pnpm start                 # Electron trên host + backend Docker
# Hoặc, thay cho lệnh trên:
pnpm start:web             # App web Docker + backend
```

Nếu chỉ clone server, dùng `pnpm stack:up`; App chạy theo
[hướng dẫn local](LOCAL_DEVELOPMENT.md). Launcher dựng lại image và chạy migration,
giữ volume. Không dùng `db:fresh`, `db:reset` hoặc xóa volume.

| Thành phần | Mặc định |
|---|---|
| App web / đích liên kết email | http://127.0.0.1:5173 |
| Swagger | http://127.0.0.1:3001/docs |
| Hộp thư Mailpit | http://127.0.0.1:8026 |
| SMTP host / Compose | `127.0.0.1:1026` / `mailpit:1025` |

1. Đăng nhập demo local, ví dụ `user@erusentia.test`, mật khẩu **ban đầu**
   `EruSentiaDemo!2026`. Seed không xác minh email hoặc đặt lại mật khẩu đã đổi.
   Đăng ký mới qua API cũng phát thư xác minh.
2. Trong Tài khoản chọn **Xác minh email → Gửi lại email xác minh** nếu chưa có thư. Mở
   Mailpit, chọn đúng người nhận và thư mới nhất. Dán mã hoặc liên kết vào App,
   bấm **Xác minh email**. Badge lấy trạng thái thật từ server.
3. Đăng xuất → **Quên mật khẩu?**, nhập email. Phản hồi chung không tiết lộ tài
   khoản tồn tại. Mở thư đặt lại trong Mailpit → **Tôi đã có mã đặt lại** trên App → dán
   mã, nhập mật khẩu mới 12–128 ký tự và xác nhận. Thành công phải đăng nhập lại;
   mọi phiên cũ bị thu hồi, có thư thông báo đổi mật khẩu. Nên dùng tài khoản tự
   đăng ký khi thử reset để giữ mật khẩu demo thuận tiện cho máy dùng chung.

Liên kết email mở **App web** trên cổng đã cấu hình, cần frontend đang chạy.
Electron có thể dán mã/liên kết trực tiếp trong hộp thoại, không cần frontend web.
Đọc email hoặc mở link chưa tiêu thụ mã; phải xác nhận trên App. Chưa áp dụng
điều kiện xác minh email cho quyền ghi chú/xuất bản hiện có.

## Cấu hình

Launcher local mặc định `PROJECT_ACCOUNT_EMAIL_MODE=mailpit`; App URL lấy từ
`PROJECT_WEB_PORT`. Có thể đặt `PROJECT_ACCOUNT_EMAIL_APP_URL` thành HTTP origin
loopback khác trong `docker/.env.project.local`, rồi chạy lại stack. File riêng
máy không đưa vào Git. API chạy trực tiếp trên host dùng:

```dotenv
ACCOUNT_EMAIL_MODE=mailpit
ACCOUNT_EMAIL_APP_URL=http://127.0.0.1:5173
SMTP_HOST=127.0.0.1
SMTP_PORT=1026
```

Sau khi chọn rõ DB project local và cấu hình kết nối, chạy `pnpm project:migrate`
trước khi mở API. Ngoài launcher, mode mặc định là `disabled`. Hosted Compose
đặt `ACCOUNT_EMAIL_MODE=disabled`; `NODE_ENV=production` từ chối mode `mailpit`.
SMTP chỉ nhận loopback hoặc service `mailpit`. App URL chỉ nhận HTTP loopback,
không path/query/fragment/tài khoản trong URL.

## API và hợp đồng

Response dùng `Cache-Control: no-store`; DTO whitelist, không nhận user ID,
redirect hoặc SMTP từ caller. Chi tiết DTO có trong Swagger.

| Phương thức và đường dẫn | Quyền / kết quả |
|---|---|
| `GET /auth/email/capabilities` | Public; `{emailActionsEnabled}` kể cả khi tắt |
| `GET /auth/email/status` | Bearer; `{emailVerifiedAt}` của chính tài khoản |
| `POST /auth/email/verification/request` | Bearer; gửi cho chính tài khoản, `202` |
| `POST /auth/email/verification/confirm` | Public; `{token}`, `204` |
| `POST /auth/email/password/request` | Public; `{email}`, phản hồi chung `202` |
| `POST /auth/email/password/confirm` | Public; `{token,password}`, `204` |

Mã ngẫu nhiên 32 byte/base64url 43 ký tự; DB chỉ giữ SHA-256. Xác minh hạn 24 giờ,
reset 15 phút. Mỗi tài khoản/mục đích giữ mã mới nhất; phát lại cách tối thiểu
60 giây. Mã đã dùng/hết hạn/sai mục đích bị từ chối. Reset không tự xác minh email
hoặc tự đăng nhập. Quên mật khẩu trả lời chung, SMTP bất đồng bộ, thời gian phản
hồi tối thiểu 250 ms; không hứa chống mọi phép đo thời gian.

Đổi mật khẩu, tiêu thụ mã và thu hồi mọi phiên nằm cùng transaction. Login kiểm
tra lại hash khi ghi phiên, ngăn mật khẩu cũ đã kiểm tra trước reset tạo phiên
muộn. Khóa user/refresh-family có thứ tự chung với refresh. Kiểm thử cả cạnh
tranh và rollback, không chỉ mã HTTP.

Giới hạn local theo IP socket, không tin `X-Forwarded-For`: 20 lần phát thư và
50 xác nhận/15 phút; `429` kèm `Retry-After`. Tối đa 5.000 bucket, bỏ bucket hết
hạn. Đây là giới hạn một tiến trình, chưa phải rate limit đăng nhập/phân tán.

## Migration và bảo toàn dữ liệu

`09_account_email.sql` thêm `auth_email_actions` và `auth_email_verifications`,
không đổi users hoặc migration cũ. Mặc định journal vẫn **6**; chỉ mode Mailpit
yêu cầu entry thứ 7. Code mới vẫn kiểm tra checksum entry 09 khi tắt lại tính
năng. Bật email với schema thiếu dừng startup trước khi nhận đăng ký.

**Không truy cập hoặc migrate Neon trong đợt này.** DB local đã backup nhất quán,
thử restore PostgreSQL tạm và bootstrap trước khi nâng: 7 tài khoản, 21 mẫu và
33 bản ghi phiên tại lúc nâng được giữ nguyên. Backup riêng tư ở `.local/backups`
thư mục cha, quyền thư mục 0700/file 0600, không commit dump hoặc mã email.

Tắt tính năng trên **code mới** bằng mode `disabled` giữ trạng thái xác minh.
Image trước C4-A2 chưa biết journal 09, có thể từ chối bootstrap DB đã nâng.
Không tự xóa entry/bảng để hạ image; nếu cần bản cũ, thử restore backup vào DB
riêng, đối chiếu dữ liệu phát sinh rồi mới chuyển kết nối.

## Kiểm thử và phạm vi còn lại

```bash
pnpm typecheck
pnpm test
pnpm test:hosted
pnpm test:account-email
```

Suite email tạo PostgreSQL 16/Mailpit riêng, cổng loopback ngẫu nhiên, tự dọn
container. 23 test gồm memory/PostgreSQL, SMTP thật, migration tắt/bật, schema
thiếu, phản hồi chung, hết hạn/replay, reset đồng thời login/refresh, rollback
khi ghi mã thất bại và thu hồi mọi phiên. `test:hosted` kiểm tra mode tắt vẫn
khởi chạy với journal 6/TLS PostgreSQL. Count gồm parent/subtest.

SMTP local có tối đa 16 thư chờ và timeout hữu hạn; `202` là nhận yêu cầu,
**không xác nhận giao thư**. Hàng chờ trong bộ nhớ không bền qua crash. Log lỗi
không ghi email/mã/mật khẩu. Mailpit đọc được thư/mã nên chỉ dùng dữ liệu thử.

Hosted còn cần provider/domain, link HTTPS phù hợp, giao thư bền có retry,
giới hạn phân tán, retention và chính sách verified/quota/moderation. Welcome
worker hiện có không chứng minh các phần này đã xong. Đối chiếu thiết kế với
[OWASP Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html)
và [Email Verification](https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html);
đây không phải chứng nhận kiểm toán bảo mật.
