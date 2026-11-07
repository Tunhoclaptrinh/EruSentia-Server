# C4-B — Rate limit và quota mẫu

Ngày 07/11/2026. Giới hạn auth/ghi API và mẫu đang hoạt động trên server. Ghi chú,
HTML xuất và thư viện trên thiết bị không chịu quota này. Redis/RabbitMQ không
bắt buộc; backend PostgreSQL dùng counter bền trong chính DB.

## Chạy và quan sát

Từ thư mục cha có bộ điều phối: `pnpm start` mở Electron + backend;
`pnpm start:web` mở web + backend. Trong server riêng dùng `pnpm stack:up`.
Swagger mặc định http://127.0.0.1:3001/docs. Launcher migrate/seed idempotent,
không reset. Dữ liệu cần giữ phải backup/thử restore trước khi nâng schema.

Đăng nhập → Tài khoản xem **Hạn mức trên máy chủ**. Trong **Mẫu tôi quản lý**,
thẻ hạn mức cập nhật sau thao tác ghi hoặc khi người dùng chọn làm mới. Nếu
server từ chối, bản nháp vẫn còn để sửa/tải bản sao; không tự gửi lại mutation.
`GET /account/usage` chỉ trả số của tài khoản đang đăng nhập, không nhận user ID.
Không trả số giả bằng 0 khi server cũ/chưa tải được dữ liệu.

## Mặc định và cấu hình

| Biến API | Mặc định | Phạm vi |
|---|---:|---|
| `API_RATE_LIMITS_ENABLED` | `true` | Bật giới hạn tần suất, không tắt quota |
| `AUTH_LOGIN_PER_IP` | 200 | Lần thử đăng nhập / 15 phút / IP được tin cậy |
| `AUTH_LOGIN_PER_IDENTITY` | 20 | Lần thử / 15 phút / cặp IP + email chuẩn hóa |
| `AUTH_REGISTER_PER_IP` | 40 | Yêu cầu đăng ký / 15 phút / IP |
| `AUTH_REFRESH_PER_IP` | 300 | Refresh / phút / IP |
| `API_WRITES_PER_USER` | 60 | Ghi template, thu hồi phiên / phút / tài khoản |
| `TEMPLATE_QUOTA_COUNT` | 100 | Mẫu đang hoạt động / tác giả |
| `TEMPLATE_QUOTA_CONTENT_BYTES` | 20.971.520 | Byte JSON của nội dung mẫu đang hoạt động |
| `TRUST_PROXY_HOPS` | 0 | Mặc định không tin header forwarded; tối đa 3 hop |

Compose local nhận các tên trên với tiền tố `PROJECT_` trong
`docker/.env.project.local`. API chạy trực tiếp hoặc Render dùng tên không tiền
tố. Chạy lại stack/deploy sau khi sửa. Các giá trị được kiểm tra kiểu/phạm vi;
đặt biến không hợp lệ làm startup thất bại, không âm thầm bỏ giới hạn.

Login tính cả lần thử thành công và thất bại, áp dụng cho email tồn tại/không
tồn tại; không đánh dấu khóa vĩnh viễn tài khoản. Logout vẫn có đường kết thúc
phiên; đọc mẫu/ghi chú local không bị giới hạn ghi làm gián đoạn.

`429` trả mã `RATE_LIMITED` và `Retry-After` 1–900 giây, CORS cho phép App đọc
header này. Web/Electron chỉ chuyển tiếp thời gian đã kiểm tra, hiển thị chờ
nhưng không tự đăng nhập hoặc tự lặp request. Counter không reset khi API khởi
động lại nếu dùng PostgreSQL và giữ cùng secret/config giữa các instance.

Mặc định đọc IP socket, bỏ qua `X-Forwarded-For`. Sau reverse proxy, nhiều người
có thể chung một bucket IP. Chỉ đặt `TRUST_PROXY_HOPS` khi đã xác minh mọi đường
vào và proxy cuối loại bỏ/ghi lại header từ client; không tự đặt `trust proxy=true`.
Kiểm tra quota và giới hạn ghi vẫn theo user ID do server xác thực, không tin
user ID/IP trong body. IP + email không đủ chống mọi tấn công phân tán; chưa có
MFA hoặc WAF trong phần này.

## Quota và transaction

`GET /account/usage` trả `{used,limits,remaining}`; mỗi nhóm có `templates` và
`contentBytes`. Byte là cách hạch toán JSON UTF-8 của persistence, không phải
dung lượng ổ đĩa, ảnh chụp hoặc giới hạn của gói bán hàng. PostgreSQL dùng dạng
JSONB serialize; memory dùng JSON serialize, nên số byte có thể chênh do format.

Tạo, cập nhật, khôi phục và xóa của cùng tác giả được tuần tự hóa bằng khóa
transaction PostgreSQL theo author. Kiểm tra quota nằm trong transaction ghi;
nếu vượt, rollback cả nội dung/revision/history và trả `409`, mã
`TEMPLATE_QUOTA_EXCEEDED`. Admin sửa mẫu của người khác vẫn dùng hạn mức của
chính tác giả đó. Không đổi ownership để né quota.

Soft delete giải phóng hạn mức **đang hoạt động**; restore phải kiểm tra lại.
Tài khoản cũ vượt hạn mức sau khi operator giảm cấu hình vẫn có thể đọc, giảm
nội dung, xóa hoặc sửa metadata không làm tăng phần đang vượt. Không tự xóa mẫu.
Quota này **chưa đo toàn bộ lịch sử/thùng rác**; ngân sách dữ liệu lưu giữ và
retention thuộc đợt pilot tiếp theo, cần hoàn thiện trước khi mở nhận nội dung
đại trà. Không coi giới hạn active content là bảo đảm tổng kích thước DB.

## Schema, hiệu năng và rollback

Migration `10_service_controls.sql` là bắt buộc: thêm counter HMAC/expiry và
`templates.content_bytes` được PostgreSQL tự tính, có index phục vụ quota. Đọc
usage không tải toàn bộ HTML hoặc tính lại JSON của mọi mẫu. Seed SQL được tin
cậy cũng có byte đúng; client không thể gửi `content_bytes` qua DTO.

Baseline project sau đợt này có 7 entry; local bật Mailpit có thêm migration 09
thành 8. Đây là cập nhật sau C4-A2 (baseline cũ 6/7). Không sửa checksum các file
migration đã có. Binary cũ kiểm tra journal nghiêm ngặt có thể từ chối DB đã nâng;
giữ code mới và cấu hình tương thích hoặc thử restore DB riêng trước khi rollback.

Rate key là HMAC có namespace, không lưu IP/email rõ hoặc token. Counter hết
hạn không có hiệu lực; dọn theo lô giới hạn khi có traffic. Memory có số bucket
tối đa và chỉ dọn định kỳ; không quét mọi bucket sau từng request. PostgreSQL
được kiểm tra schema ngay startup; kho rate lỗi trả `503`, không fallback mở
quyền. Cleanup không phải cam kết xóa đúng ngay giây hết hạn khi dịch vụ không
có traffic; công cụ vận hành sẽ xử lý phần tồn đọng.

Diễn tập 07/11/2026: backup local và Neon được giữ ngoài Git, thư mục 0700/file
0600. Bản local đã có journal 8; giữ đúng checksum SQL đã áp dụng, restore giữ
7 tài khoản/21 mẫu và toàn bộ business row được đối chiếu. Bản sao Neon trên
PG18 nâng journal 6 → 7, giữ 4 tài khoản/17 mẫu, profile/session/history khớp
fingerprint và API usage hoạt động. **Nguồn Neon không bị sửa trong diễn tập**;
đây chưa phải bằng chứng đã deploy API mới trên Render.

## Kiểm tra lại

```bash
pnpm typecheck
pnpm test
pnpm test:hosted
pnpm test:account-email
```

Suite hosted dùng PostgreSQL TLS riêng, kiểm tra cả quota/rate-limit memory và
PostgreSQL: tạo/tăng nội dung đồng thời, không rò usage tài khoản khác, từ chối
không đổi revision/history, delete/restore, hai API chia sẻ bucket, restart và
kho counter lỗi. Không dùng Neon hoặc DB người dùng cho các test này.

Các ca App/ảnh và Electron nội bộ được ghi trong tài liệu C4-B của repo App riêng
tư. Chỉ đưa nội dung trung tính và API lên repo server công khai. Tham chiếu thiết
kế: [OWASP Authentication](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html),
[Express behind proxies](https://expressjs.com/en/guide/behind-proxies/).
