# Hoàn thiện quản trị — trạng thái thực tế

Yêu cầu: hoàn thiện các thiếu sót trong báo cáo bao phủ, giữ core và dữ liệu dev; không sửa training, commit/push hoặc seed/reset. Từng mục chỉ đánh dấu khi UI/API đã nối và có kiểm chứng.

## Đã triển khai

- [x] Vòng đời template: metadata/chuyên mục, gỡ hạn chế, trash/restore, revision restore, purge có reauthentication; kiểm tra revision và audit.
- [x] Tài nguyên: danh sách toàn hệ thống, detail/preview, ACL, access events phân trang, gói/quota/usage; lý do/revision/audit; trash/restore/purge.
- [x] Dung lượng và retained quota tài nguyên; dọn trash ≥30 ngày có preview/confirm/password, giới hạn batch và audit atomic.
- [x] Chuyên mục: chuyển mẫu/tài liệu có fingerprint chính xác, kiểm tra revision/version và batch audit.
- [x] Tài liệu HTML: snapshot/revision, đối chiếu và khôi phục thành draft; báo cáo từ App, Admin xử lý kiểm tra hai version.
- [x] Người dùng: xem hồ sơ soft-delete, khôi phục có đối chiếu, trở về user/suspended và thu hồi phiên cũ.
- [x] PostgreSQL Admin 25/25; backend mặc định 134 pass/19 skip; App TypeScript, session/shared contracts 111/111 và Chromium workflow.
- [x] Migration bổ sung 17/18 áp dụng local có backup, giữ checksum cũ/số hàng; API và worker healthy, cùng image, bootstrap tắt; không seed/reset.
- [x] Lượt capture tổng cuối: **64/64 UI**, **120 ảnh/62 matrix**; đủ 10 route, hai theme, desktop/mobile. SHA ảnh, bộ lọc gallery và fingerprint source hiện tại đều đã kiểm tra.

## Các phần chưa triển khai

- [ ] Chính sách/hàng chờ phê duyệt **template** trước xuất bản, nối cả flow gửi/chỉnh mẫu của tác giả. Hiện giữ chính sách chia sẻ của App; curation không thay thế approval. Tài liệu cộng đồng đã có hàng chờ duyệt riêng.
- [ ] Upload/quản trị PDF, DOCX và asset nhị phân với storage/lifecycle riêng. Mô hình server hiện quản trị HTML; không coi vault local là dữ liệu server.
- [ ] Mời nhân sự quản trị, permission scopes, Keycloak/OIDC/MFA và cấu hình nhà cung cấp OAuth. Chưa bật SSO chỉ bằng tài liệu cấu hình; provider ngoài cần credentials của chủ tài khoản.
- [ ] Portal vận hành workspace/thành viên, telemetry Redis/RabbitMQ, job/DLQ controls thực, retention lịch sử/audit, xuất bất đồng bộ.

[Ma trận chi tiết](../../erusentia-admin/docs/ADMIN_COVERAGE_REVIEW.md) · [Hướng dẫn thao tác](../../erusentia-admin/docs/ADMIN_LIFECYCLE_GUIDE.md) · [Kiểm chứng](../../erusentia-admin/docs/VERIFICATION.md).
