# Dữ liệu lưu giữ và xóa vĩnh viễn — C4-D

Xóa mềm giải phóng hạn mức **active** nhưng vẫn giữ mẫu/lịch sử. Budget lưu giữ
bổ sung giới hạn riêng, không tự xóa dữ liệu để đạt quota. Không áp lên vault,
thư viện hoặc các file HTML trên máy.

| Biến | Mặc định | Tính theo tài khoản tác giả |
|---|---|---|
| `TEMPLATE_RETAINED_COUNT` | 500 | Mọi mẫu còn trong DB, gồm đã xóa mềm |
| `TEMPLATE_RETAINED_REVISIONS` | 10.000 | Mọi revision của các mẫu đó |
| `TEMPLATE_RETAINED_BYTES` | 209.715.200 (200 MiB) | Nội dung JSON hiện tại cộng snapshot JSON lịch sử |
| `REPORT_RETAINED_COUNT` | 1.000 | Biên nhận báo cáo của người gửi, mọi trạng thái |

Đây là byte logic được tính hạn mức; không phải kích thước vật lý của PostgreSQL,
TOAST/index hoặc backup. Memory và PostgreSQL có khác biệt khoảng trắng JSON khi
serialize, nên số byte có thể khác; mỗi store áp đúng phép đo đã công bố của mình.
Các số này là cấu hình vận hành, không phải gói trả phí hay cam kết dung lượng DB.

Create/update/restore kiểm tra budget trong cùng owner lock/transaction với ghi
nội dung và history. Vượt budget → 409 `TEMPLATE_RETAINED_QUOTA_EXCEEDED`; không
có revision dở dang. Không thể lách bằng vòng create → soft-delete → create.
Soft-delete vẫn được phép để rút nội dung khỏi catalog, dù tạo thêm một revision;
thao tác an toàn của Admin có thể thêm history khi tài khoản đã quá budget.
Các ngoại lệ này có tính dung lượng trong usage, không phải trần dung lượng ổ đĩa.

`GET /account/usage` thêm `retained.used/limits/remaining` với `templates`,
`revisions`, `contentBytes`. Các field active cũ giữ nguyên. Biên nhận report có
counter riêng dùng chung PG; duplicate cùng revision vẫn trả receipt đã có khi
đã chạm quota. Lỗi report mới là 409 `REPORT_QUOTA_EXCEEDED`.

## Xóa vĩnh viễn theo lựa chọn của tác giả

`POST /templates/:id/purge`, body `{password,confirmSlug}`, header `If-Match`:

- Chỉ đúng owner; role Admin không được dùng endpoint này để xóa thay người khác.
- Mẫu phải đã soft-delete; slug xác nhận phải khớp hoàn toàn.
- Kiểm tra mật khẩu bằng truy vấn credential riêng. Các truy vấn hồ sơ thường
  tiếp tục không chọn hash; hash không được trả ra HTTP hoặc log.
- PostgreSQL kiểm tra lại hash/active account và ETag trong transaction. Password
  reset hoặc thay đổi nội dung không bị bỏ qua bởi xác nhận cũ.
- Báo cáo open chặn purge với `RESOURCE_UNDER_REVIEW`; Admin có thể xem tài nguyên
  đã xóa mềm và kết thúc báo cáo trước. Không tự dismiss report để cho phép purge.
- Thành công 204: xóa row và toàn bộ revisions, xóa receipt liên quan, gỡ tham chiếu
  report/template trong audit. Audit lý do/actor vẫn theo chính sách audit riêng.
- Lặp sau mất phản hồi có thể là 404; client phải kiểm tra danh sách, không replay.

Thao tác có budget nhạy cảm 10 lần/15 phút/tài khoản. Mật khẩu sai có mã riêng
`PASSWORD_CONFIRMATION_FAILED` (403), không làm mất phiên Hub. Thiếu ETag 428,
ETag cũ 412; chưa soft-delete/slug không khớp 400.

Bản local, bản người khác đã tải và các backup của operator không bị xóa theo
endpoint này. Đây là xóa một tài nguyên; chưa thay thế luồng xóa toàn bộ tài khoản
hay yêu cầu xóa mọi dữ liệu cá nhân trong audit/backup.

## Schema và vận hành

Migration 12 thêm byte dẫn xuất/index và đổi FK history sang CASCADE để phục vụ
purge có xác nhận. Migration không xóa mẫu/history cũ. Không sửa migration đã
công bố; backup và diễn tập nâng/restore trước khi deploy. Bản cũ không biết
journal mới sẽ từ chối bootstrap; rollback cần binary tương thích hoặc restore.

Compose có biến tương ứng với prefix `PROJECT_`. Render khai báo cùng mặc định.
Giảm quota không tự prune dữ liệu; owner cần xuất bản sao hoặc xóa có chủ đích.
Đọc [vận hành](PILOT_OPERATIONS.md) trước khi thực hiện retention.

## Kiểm chứng trước triển khai

Lượt local 07/11/2026: kiểm thử mặc định 107 đạt, 15 ca opt-in bỏ qua; bộ hosted
PostgreSQL TLS đạt, trong đó retained memory/PG 17/17. Có kiểm tra quota qua hai
API đồng thời, report budget đồng thời, mật khẩu/owner/ETag/slug, mẫu còn active,
open report chặn xóa, lỗi AFTER DELETE rollback lịch sử/receipt/audit và dry-run
retention giữ session còn hiệu lực cùng dữ liệu nghiệp vụ.

Backup đầy đủ được giữ riêng trên máy, restore lên PostgreSQL tạm cùng major với
nguồn local/Neon, nâng schema rồi khởi động API trên bản sao. Các cột đã có trong
bảng nghiệp vụ, báo cáo/audit, phiên/email và outbox giữ fingerprint; journal cũ
giữ checksum. Neon chỉ thêm migration 12 trên bản sao; nguồn local thêm 11 và 12
trên bản sao. Không migrate/purge/apply retention DB nguồn ở lượt kiểm chứng này.
File dump và dữ liệu riêng tư không đưa vào repository.
