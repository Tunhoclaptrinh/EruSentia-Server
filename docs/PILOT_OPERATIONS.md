# Vận hành pilot C4-D

## Request ID và dữ liệu chẩn đoán

API tạo UUID mới cho mỗi request, trả `X-Request-Id`; lỗi JSON có `requestId`.
Không nhận ID từ header client. Header được expose qua CORS để App có thể đọc.
Khi báo lỗi, dùng mã lỗi/thời điểm/request ID; không sao chép JWT, mật khẩu,
connection string hoặc nội dung ghi chú vào issue/log.

Log 5xx chỉ ghi sự kiện, mã lỗi, HTTP status và request ID. Không ghi message/stack
của lỗi SQL/upstream, request body, query string hoặc nội dung HTML. Response 5xx
cũng dùng thông báo cố định. Chính sách này áp dụng cho API exception filter;
không phải chứng nhận mọi hệ thống proxy, hosting hoặc dependency đã được rà soát.

`GET /admin/operations` chỉ dành cho Admin, trả thống kê **của process hiện tại**:
route pattern, số request, lỗi server, kết nối bị ngắt, latency trung bình/cực đại,
thời điểm bắt đầu và uptime. Không có ID/email/nguyên văn URL người dùng.
Tối đa 65 bucket, gồm bucket overflow, không tạo time series trong DB.
Process restart làm mất số liệu; nhiều instance cần xem từng instance hoặc tích
hợp hệ thống metrics phù hợp sau này. Không coi đây là phân vị latency hay SLO.

Endpoint kiểm tra DB theo yêu cầu Admin và chỉ trả `ready`, `unavailable` hoặc
`not-configured`, không trả host/password/SQL. `/health` tiếp tục chỉ kiểm tra
liveness, không query DB định kỳ để giữ Neon thức. Thống kê bỏ qua probe health.

## Kiểm tra qua Swagger local

1. Chạy `pnpm start` ở thư mục cha; mở `http://127.0.0.1:3001/docs`.
2. Đăng nhập tài khoản Admin local theo `LOCAL_DEVELOPMENT.md`, lấy access token
   qua `/auth/login`; dùng **Authorize** trong Swagger, không đưa token vào URL.
3. Gọi `/admin/operations`. Sau vài thao tác API, gọi lại để thấy route pattern
   và số liệu. User/creator nhận 403; chưa đăng nhập nhận 401.
4. Một lỗi request có `X-Request-Id` tương ứng `requestId` trong JSON. ID do client
   gửi vào sẽ không được sử dụng. Không tự tạo lỗi phá dữ liệu trên production.

## Trạng thái tiếp theo

Budget dữ liệu/lịch sử lưu giữ, dry-run retention và luồng quyền riêng tư đang
được triển khai riêng trong C4-D. Tài liệu này chưa xác nhận hoàn tất nghiệm thu
pilot. Email hosted vẫn chờ provider/domain; Mailpit chỉ dùng local.
