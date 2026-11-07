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

## Phạm vi C4-D

Đã có budget mẫu/lịch sử, purge một mẫu có xác nhận và retention kỹ thuật với
dry-run. Các phần này được kiểm thử riêng; chưa xác nhận hoàn tất nghiệm thu
pilot. Export/xóa toàn bộ tài khoản và chính sách audit/backup còn lại; email
hosted vẫn chờ provider/domain, Mailpit chỉ dùng local.

## Retention kỹ thuật có dry-run

Lệnh dưới chỉ xử lý tối đa 5.000 row mỗi bảng/lần: counter rate limit hết hạn hơn
1 ngày; refresh session hết hạn hơn 30 ngày; email action hết hạn hơn 7 ngày (nếu
module email tồn tại). Family refresh giữ expiry tuyệt đối khi rotation; lệnh
không xóa family còn hiệu lực. Không xóa user, profile, template, history, report,
audit, queue/outbox hoặc file backup.

Dùng kết nối `DB_*` đúng như lệnh `project:migrate`, vào database có prefix project.
Không đưa DSN/mật khẩu vào câu lệnh hoặc log. Với cấu hình environment đã có:

```bash
pnpm data:retention --help
pnpm data:retention
```

Kết quả dry-run chỉ có database, thời điểm `asOf`, cutoff, số row và `digest`.
Không có ID người dùng, token/hash, email hoặc nội dung. Kiểm tra đúng database,
thời gian và số lượng trước khi thực hiện. Chỉ sau khi operator đã duyệt kết quả,
dùng đúng hai giá trị vừa nhận (thay phần trong dấu `< >`):

```bash
pnpm data:retention --apply --as-of '<asOf từ dry-run>' --confirm '<digest từ dry-run>'
```

Apply khóa các candidate kỹ thuật trong transaction và đối chiếu đúng fingerprint;
khác kết quả đã duyệt thì rollback `RETENTION_PLAN_CHANGED`, cần dry-run mới.
Không dùng timestamp tương lai. Chạy lại dry-run để xem batch tiếp theo. Script
không tự lập lịch hoặc tự apply trên Neon. Backup/restore rehearsal vẫn là bước
riêng; không tự xóa các dump đang bảo vệ trong `.local/backups`.

Budget mẫu/lịch sử và xóa vĩnh viễn của tác giả ở [RETAINED_DATA](RETAINED_DATA.md).
Đường export/xóa toàn bộ tài khoản, retention business/audit/backup và provider
email hosted còn phải hoàn tất trước khi coi pilot/public launch đã nghiệm thu.
