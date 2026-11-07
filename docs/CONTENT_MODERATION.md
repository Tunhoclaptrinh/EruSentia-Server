# Báo cáo và kiểm duyệt mẫu — C4-C

API bảo vệ nội dung công khai và ghi nhận quyết định có lý do. Đây là kiểm duyệt
thủ công, không phải chứng nhận an toàn cho HTML và không cấp thêm quyền chạy mã.

## Luồng và quyền

1. Thành viên đã đăng nhập báo cáo một mẫu đang công khai, chưa xóa/hạn chế.
   Chọn `unsafe`, `copyright`, `spam` hoặc `other`; mô tả 1–2.000 ký tự.
2. Một người/mẫu/revision chỉ có một biên nhận. Gửi lại trả biên nhận cũ, không
   đổi nội dung báo cáo đã gửi. Có giới hạn 10 lần gửi/15 phút/tài khoản, dùng
   counter chung PostgreSQL của C4-B; reads không bị giới hạn này.
3. Thành viên chỉ đọc biên nhận của mình: tên công khai tại lúc báo cáo, revision,
   mô tả, trạng thái và lý do xử lý. Không trả HTML hoặc tên riêng tư đã đổi sau đó.
4. Chỉ `admin` đọc hàng đợi/chi tiết và quyết định. List không nạp HTML. Chi tiết
   trả nội dung hiện tại cho Admin đối chiếu; đây không phải snapshot HTML thời
   điểm gửi báo cáo. Nếu revision khác, cần xem xét sự khác biệt.
5. `hide` chuyển mẫu sang **riêng tư và hạn chế xuất bản**, giải quyết báo cáo.
   `dismiss` kết thúc báo cáo không có vi phạm, không đổi template revision.
   `release` bỏ hạn chế nhưng **giữ riêng tư**, không tự xuất bản lại.

Lý do quyết định 1–2.000 ký tự có thể được người báo cáo/tác giả đọc, không dùng
để ghi thông tin điều tra bí mật. Tác giả vẫn sửa nội dung riêng tư, tải bản sao
và khôi phục lịch sử. Mọi đường PATCH, kể cả Admin, không được xuất bản mẫu đang
hạn chế; chỉ luồng quyết định mới bỏ hạn chế. Khôi phục lịch sử không bỏ policy.
Các bản local đã tải không bị xóa từ xa.

## Endpoint

| Method và đường dẫn | Quyền / kết quả |
|---|---|
| `POST /templates/:id/reports` | Thành viên; `{reasonCode,description}` → 202 biên nhận |
| `GET /account/reports` | Chỉ các báo cáo của phiên hiện tại |
| `GET /admin/reports` | Admin; phân trang metadata |
| `GET /admin/reports/:id` | Admin; report, resource hiện tại, ETag và audit |
| `POST /admin/reports/:id/decision` | Admin; `{action,reason,reportVersion}`, header `If-Match` của resource |

Query list: `state=open|resolved|dismissed|all` (mặc định `open`), `page=1..10000`,
`size=1..50` (mặc định 20). Request thừa field bị từ chối. Mất quyền 401/403;
nguồn không khả dụng 404; thiếu ETag 428; version cũ 412; trạng thái không còn phù
hợp 409. Không tự gửi lại quyết định khi mất phản hồi hoặc hết phiên.

## Tính nguyên tử và cache

Schema `11_content_moderation.sql` là migration cộng thêm, không sửa schema đã
công bố. Policy nằm ngoài content snapshot. Ràng buộc DB bảo đảm mẫu hidden luôn
private. Owner lock dùng chung với quota/ghi nội dung; quyết định kiểm tra cả
report version và template ETag trong transaction. Policy, report, revision/history
và audit cùng commit hoặc rollback. `dismiss` chỉ đổi report/audit.

Cache detail đọc visibility/revision mới từ DB trước khi dùng Redis. Policy change
chuyển private, tăng revision/cache revision bằng trigger hiện có và vô hiệu hóa
entry cũ sau commit. Không sử dụng nhãn reviewed/Official để bỏ kiểm tra quyền.
Khởi động thiếu schema kiểm duyệt sẽ thất bại với mã cố định.

## Triển khai và kiểm tra

```bash
pnpm project:migrate
pnpm test
pnpm test:hosted
```

Backup, restore rehearsal và kiểm tra bản sao có dữ liệu trước khi nâng DB thật.
Không chạy reset trên DB có dữ liệu cần giữ. Sau khi schema mới có trong journal,
bản cũ không nhận migration sẽ từ chối khởi động; rollback cần bản tương thích
schema hoặc restore từ backup đã kiểm tra. Không xóa journal/cột để ép chạy.

`test/moderation.test.cjs` kiểm tra quyền user/creator/admin, biên nhận idempotent,
riêng tư, hai quyết định đồng thời, report/template CAS, hạn chế qua PATCH/restore,
release giữ private và lỗi ghi audit rollback toàn bộ. Bộ hosted dùng PostgreSQL
TLS riêng; không kết nối Neon hoặc DB phát triển của người dùng.

Còn cần chính sách vận hành/retention C4-D; không coi audit là kho lưu trữ vô hạn.
Chưa có quy trình khiếu nại tự động, lưu bằng chứng HTML báo cáo hoặc thông báo email.
