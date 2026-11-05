# Authentication và authorization — tuần 3

API quản lý Template dùng cùng NestJS/TypeORM/PostgreSQL của tuần 2. Đợt C0–C1 đã
ghép tài khoản browser/Electron; C2 đã bổ sung catalog, xem thử và bản sao template
local. Giao diện Creator/Admin và xuất bản chưa triển khai.
Swagger `/docs` hỗ trợ register/login, Authorize bằng accessToken và thao tác
protected; đặc tả JSON ở `/docs-json`. Hướng dẫn môi trường ở [README](../README.md).

## Tài khoản và mật khẩu

Register nhận `{email,password}`. Email trim/lowercase, tối đa 255; password giữ
nguyên 12–128 ký tự, không trim. Role luôn `user`; role/isActive/passwordHash gửi từ
client bị từ chối. UNIQUE LOWER(email) xử lý cả race đăng ký trùng.

Password là Argon2id v19: memoryCost=19456 KiB, timeCost=2, parallelism=1; thư viện
`@node-rs/argon2` tự sinh salt ngẫu nhiên. PHC string lưu trong users.password_hash.
Hash không được trả ra HTTP và cột ORM select:false; login mới chọn cột để verify.
Lỗi email không có, password sai hoặc tài khoản bị vô hiệu hóa đều trả 401 với
thông báo chung. Unknown/legacy hashes vẫn có dummy verification; không coi đây là
bằng chứng HTTP constant-time hoặc thay thế rate limiting.

Các hash seed tuần 1 là placeholder, không phải tài khoản có mật khẩu mặc định.
`pnpm auth:admin` dùng ADMIN_EMAIL/ADMIN_PASSWORD trong environment để tạo admin mới;
trùng email thì dừng, không nâng quyền hoặc đổi password tài khoản đã có.

## Endpoint

| Endpoint | Input / output |
|---|---|
| POST /auth/register | Email/password → 201 UserDto |
| POST /auth/login | Email/password → 200 TokenPairDto |
| POST /auth/refresh | `{refreshToken}` → 200 cặp token mới |
| POST /auth/logout | `{refreshToken}` → 204, body rỗng, idempotent |
| GET /auth/me | Bearer → 200 UserDto |
| GET /admin/users | Bearer admin, page/size → trang UserDto |

UserDto chỉ có id/email/role/createdAt. TokenPairDto có accessToken, refreshToken,
tokenType=Bearer, expiresIn=900, refreshExpiresAt và user. Token/response tài khoản
đặt Cache-Control:no-store. Không gửi token qua query string.

## Welcome email tùy chọn — tuần 4

Khi QUEUE_ENABLED=true, PostgreSQL lưu user và message_outbox trong cùng transaction
đăng ký. Response 201 không chờ gửi email. Worker riêng chuyển sự kiện qua RabbitMQ
đến Mailpit local; event không mang password, hash, email hay token. Cấp admin qua
CLI không phát welcome event. Cơ chế này không phải email verification.
Xem [Message Queue](MESSAGE_QUEUE.md); queue tắt mặc định, memory không hỗ trợ queue.

## Access JWT

HS256 với key ngẫu nhiên ít nhất 32 byte, kiểm tra chữ ký, allowlist HS256, issuer
`erusentia-server`, audience `erusentia-api`, exp, tokenUse=access, UUID sub/sid.
Claims phát hành gồm sub, sid (family ID), tokenUse, jti, iat, exp, iss, aud; không
có password/email. JWT ký không có nghĩa được mã hóa.

AccessTokenGuard chạy global trừ @Public của register/login/refresh/logout. Sau
verify, guard kiểm tra tài khoản active/chưa soft-delete và refresh family còn
hiệu lực, rồi lấy role hiện tại từ store. RolesGuard chạy sau để bảo vệ admin API.
Đổi role/khóa tài khoản có hiệu lực ở request tiếp theo, không phụ thuộc role cũ
trong JWT. Thiết kế có truy vấn trạng thái server mỗi request, không hoàn toàn stateless.

NODE_ENV=production bắt buộc JWT_SECRET; development thiếu key sinh key tạm và cảnh
báo. Key ổn định giữ access token hợp lệ qua restart; đổi key làm JWT cũ mất hiệu lực.
Access JWT 15 phút, refresh family hết hạn tuyệt đối sau 7 ngày; refresh không gia hạn
vô thời hạn. API login riêng này không triển khai đầy đủ giao thức OAuth/OIDC.

## Refresh rotation và thu hồi phiên

Refresh là 32 byte ngẫu nhiên, base64url dài 43 ký tự, khác JWT. DB chỉ lưu SHA-256
hex của token. SHA-256 phù hợp lookup token ngẫu nhiên entropy cao; không dùng cách
này để băm mật khẩu do người dùng tự chọn.

Mỗi login tạo family mới. Mỗi refresh trong transaction:

1. Tìm token hash và lấy transaction advisory lock theo family ID.
2. Khóa row, kiểm tra chưa used/revoked/expired và tài khoản còn hợp lệ.
3. Đặt used_at cho token cũ, insert token hash mới trong cùng family, giữ expires_at.
4. Commit rồi phát cặp token mới. Nếu token đã dùng lại, revoke toàn bộ family và
   commit trạng thái đó trước khi trả 401.

Khóa theo family bảo vệ cả race giữa hai thế hệ token và logout/refresh. Khóa riêng
row token cũ có thể bỏ sót child vừa được tạo. Hai refresh cùng một token cho một
200 và một 401; replay làm family bị thu hồi, kể cả token của response 200. Client
phải tuần tự hóa refresh; mất response sau khi token đã tiêu thụ có thể cần login lại.

Logout thu hồi family xác định bởi refresh token, kể cả token đã dùng. Token không
biết cũng trả 204; các phiên login khác không bị thu hồi. Guard kiểm tra family nên
access JWT của phiên bị logout/replay bị từ chối ở request tiếp theo. Request đã
vượt guard trước lúc thu hồi có thể vẫn hoàn tất.

## Quyền Template

Mọi route Template cần JWT. User/creator đọc public và private của mình, tạo với
authorId từ JWT, sửa/xóa của mình. Admin đọc/sửa/xóa mọi template. Query authorId
chỉ lọc, không cấp quyền. WHERE visibility được áp trước data/count/pagination.

Private của người khác trả 404; sửa/xóa public của người khác trả 403. POST/PATCH
nhận authorId từ body trả 400. Mã CRUD, metadata HTML và soft-delete giữ hợp đồng
còn lại của tuần 2. GET/PATCH/DELETE không tăng view ngầm.

## Database và giới hạn

`sql/05_auth_sessions.sql` thêm auth_refresh_sessions và index email không phân biệt
hoa thường. Không sửa 01_schema/02_indexes/03_seed; không auto migrate khi khởi động.
Migration chạy lại được, nhưng không thay thế kiểm tra dữ liệu trước rollout.

Memory dùng cùng interface, chỉ phù hợp một process và mất dữ liệu khi restart.
PostgreSQL dùng transaction/lock liên kết các instance. Chưa có rate limiting,
email verification, reset password, MFA, purge lịch sử sessions, TLS deployment,
cookie/CSRF flow hoặc integration App; đây là nền tảng thực hành local.

Nguồn: [Nest authentication](https://docs.nestjs.com/security/authentication),
[Nest authorization](https://docs.nestjs.com/security/authorization),
[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html),
[RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html),
[RFC 9700 §4.14](https://www.rfc-editor.org/rfc/rfc9700.html#section-4.14).
