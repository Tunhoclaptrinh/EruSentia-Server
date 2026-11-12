# Đánh giá mức hoàn thiện tuần 6

Ngày đánh giá: 10/11/2026. Nhánh: `feat/typ-week6-advanced-features` ở app và server.

Kết luận: có triển khai backend và UI thực, nhưng chưa đủ bằng chứng để gọi là sản phẩm hoàn thiện hay nghiệm thu 100%. Trước rà soát, nhiều phần UI tuần 6 không khớp hợp đồng API và chưa được nối vào Electron. Báo cáo cũ mô tả mức hoàn thiện cao hơn phần tích hợp thực tế.

## Các lỗi đã sửa

| Phần | Lỗi trước rà soát | Kết quả điều chỉnh |
| --- | --- | --- |
| Chiều rộng editor | Ghi chú mới mặc định `standard`, giới hạn 794 px | Mặc định `wide`, tối đa 1200 px; vẫn giữ lựa chọn rõ ràng của ghi chú cũ |
| Standalone | Tắt trang giấy vẫn bị giới hạn theo A4 | Chiếm toàn chiều rộng; đệm ngang 20–48 px trên desktop, 18 px trên màn hình nhỏ; giữ hình học khi bật trang giấy và khi in |
| Theo dõi template | GET `/follow`, đọc `following` | GET `/follow-status`, đọc `isFollowing` |
| Thông báo | Sai phương thức đánh dấu đã đọc, sai trường số chưa đọc và con trỏ | PATCH `/read`, đọc `count`, phân trang bằng `cursor` do server trả về; đọc đúng `title` và `revision` |
| Electron | Chưa dispatch thao tác thông báo/workspace | Thêm hai nhóm vào bridge có kiểm tra sender và session |
| Workspace | Thiếu slug; sai email, vai trò và ngày tham gia | Form slug; payload email; `currentUserRole`, `joinedAt`; chỉ owner thấy form mời |
| Trạng thái UI | Hiển thị rỗng trong lúc tải, lỗi bị lẫn với rỗng, mã mời cũ còn lưu khi đổi workspace | Thêm tải/thử lại, dọn dữ liệu khi đổi tài khoản/workspace; token xuống dòng và form co giãn trên mobile |
| Lời mời server | Không ràng buộc email; nhận lại lời mời có thể hạ quyền owner | Kiểm tra email, loại workspace đã xóa; thành viên cũ giữ nguyên vai trò |
| Cache thông báo | Tăng Redis trước COMMIT; đọc sai kết quả UPDATE của TypeORM | Invalidate sau COMMIT; UPDATE trong CTE trả danh sách ID và invalidate khi đánh dấu đọc |
| Báo cáo | Copy runtime từ note cục bộ cũ; nhãn 100% và log tĩnh | Tạo bằng runtime app hiện tại; phân biệt kiểm chứng mới, bản ghi cũ và dữ liệu demo |

## Bằng chứng kiểm chứng

- App: `pnpm typecheck`; `pnpm test:session`: 86/86 qua.
- HTML product: 19/19 qua, gồm widget offline, bảo toàn HTML/CSS/JS, ZIP, trình chiếu và PDF 55 dòng ở cả khổ dọc/ngang.
- Kiểm thử chiều rộng: 1920/1440/390 px; chuyển off → continuous → separated → off; báo cáo đọc được trên 1440/390 px.
- Kiểm thử tương tác UI tuần 6: thông báo, đánh dấu đọc, tạo workspace và mời thành viên với API mô phỏng đúng DTO; không phải kiểm thử toàn hệ thống đang deploy.
- Server: `pnpm test:week6`: 35/35 qua trong PostgreSQL tạm. Bao gồm outbox dispatch/fanout/idempotency, cursor, API follow, RBAC và hai hồi quy email/owner. Các kiểm thử cache dùng Redis giả lập.
- Database mặc định cục bộ chưa đủ migration (`revision`, service controls). Runner tạo database riêng, migrate/seed, chạy test và xóa đúng database tạm; không migrate/reset database hiện có.

## Các phần còn thiếu trước khi nghiệm thu đầy đủ

1. Chạy trọn chuỗi publish → RabbitMQ → worker → Redis → chuông thông báo bằng dịch vụ thật, có retry/DLQ, restart và hai worker đồng thời. Các bài test hiện tại chưa chứng minh đầy đủ chuỗi này.
2. Workspace mới có quản lý thành viên và liên kết tài nguyên. Chưa có UI quản lý tài nguyên hoàn chỉnh; quyền `read_only/read_write` chưa được nối xuyên suốt vào các API đọc/sửa template riêng tư. Chưa thể gọi đây là đồng biên tập hoặc chia sẻ tài nguyên hoàn chỉnh.
3. Cần kiểm thử tải đồng thời cho thay đổi owner, thu hồi quyền/cache và workspace đã xóa. Test mang tên concurrency hiện chủ yếu gọi tuần tự, chưa thay thế kiểm thử tranh chấp thực.
4. API Explorer và feed đã được tích hợp vào thư viện và dùng API thật; xem phần cập nhật bên dưới. OAuth và multipart chưa được hỗ trợ. Ảnh cũ trong `docs/assets` không phải bằng chứng tái kiểm chứng hiện tại; ảnh mới ở repo app `docs/evidence/2026-11-10-api-tools`.
5. Nhánh tuần 6 vẫn tách khỏi các cập nhật `main` mới hơn; cần tích hợp và chạy lại regression trước khi merge/release. Các thay đổi đợt này chưa được deploy.

Không gán tỷ lệ hoàn thiện phần trăm vì chưa có tiêu chí nghiệm thu và bằng chứng bao phủ toàn bộ các luồng trên.

## Cập nhật công cụ dùng được trong tài liệu

Đã thay khối demo riêng lẻ bằng hai template đăng ký trong thư viện app: `tpl-api-console-1` (API Explorer) và `tpl-notification-feed-1` (Thông báo trực tiếp). Cả hai dùng chung runtime, có guide và có thể chèn vào ghi chú. Báo cáo được tạo từ chính runtime này, không còn hàm tạo thêm thông báo giả.

- API Explorer nạp OpenAPI 3 JSON từ `/docs-json` hoặc file, tìm endpoint, giải local `$ref`, tạo form path/query/header và body JSON. Hỗ trợ gửi, hủy, xem HTTP status/thời gian/headers, sao chép và tải phản hồi.
- Xác thực bằng tài khoản EruSentia hoặc Bearer token trong phiên riêng. Đổi máy chủ xóa phiên. Vùng UI được đánh dấu transient để bridge không lưu mật khẩu, token, body và phản hồi vào HTML ghi chú.
- Tab thông báo dùng feed/cursor và API đánh dấu đã đọc thật. Không tạo dữ liệu giả khi bấm tải thêm.
- Server phục vụ `/docs/week-6`, `/docs/tools/api-explorer`, `/docs/tools/notifications` khi bật Swagger. Dùng cùng origin để hoạt động với chính sách CORS hiện có; không mở origin `null` hay wildcard. Docker đóng gói đúng ba tài liệu này.
- Kiểm thử trình duyệt chạy với API hiện tại và database PostgreSQL tạm: nạp 49 endpoint, đăng nhập, POST/DELETE workspace thật, phân trang 18 thông báo seed, đánh dấu đã đọc, HTTP 404, hủy, lỗi kết nối, nhập schema, chèn editor/lưu/xuất lại và kiểm tra không lưu credentials. Dữ liệu seed chỉ dùng cho phiên kiểm thử.
- Chưa hỗ trợ OAuth hoặc upload multipart. Template do cộng đồng xuất bản vẫn dùng runner cô lập không có mạng; khả năng gọi API này dành cho template hệ thống và HTML cá nhân được người dùng chọn chạy.

Chạy từ repo app: `pnpm docs:week6` để tạo tài liệu; `pnpm test:api-tools` để kiểm thử; `pnpm api-tools:preview` để mở phiên review trên `http://127.0.0.1:3196/docs/week-6`. Phiên preview có database tạm riêng, tự dọn khi dừng. Tài khoản review: `api-reader@example.test` / `ApiReviewOnly!2026`, không được tạo trong database của người dùng.


## Cập nhật: Resource Gateway và hai Full Template độc lập

Hai template không còn dùng cùng UI với tab mặc định khác nhau. API Explorer dùng `api-console` version 2, có CRUD endpoint/tham số/body mẫu, nhập/xuất OpenAPI, hoàn tác, Visual Inspector và bộ sưu tập được giữ trong cấu hình. Hộp thông báo dùng `notification-feed` version 2, có runtime riêng, chỉ đọc/lọc/phân trang/đánh dấu thông báo. Chỉ chia sẻ transport, phần kết nối và style nền.

Resource Gateway ở repo app xử lý API từ file HTML và CORS, với allowlist origin, khóa phiên trong bộ nhớ, ghim DNS, giới hạn request/response/timeout và chặn redirect. Có thể phục vụ thư mục HTML cùng assets tương đối. Không nới CORS của server hoặc runner cộng đồng. Thiết kế và giới hạn: repo app `docs/RESOURCE_RUNTIME.md`.

Đã kiểm chứng HTTP gateway, đích bị từ chối/redirect/khóa sai, binary response, chặn symlink ra ngoài thư mục và browser mở `file://` gọi API thật qua gateway. Bộ sưu tập endpoint được thêm/sửa/xóa/hoàn tác rồi sinh lại HTML và mở lại thành công; khóa gateway không nằm trong cấu hình đã lưu.
