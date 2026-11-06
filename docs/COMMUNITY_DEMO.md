# Bộ nội dung cộng đồng để demo App

Bộ `erusentia-community-demo-v1` có **14 mẫu HTML/CSS/JS tự chứa**, được biên soạn
riêng cho demo. Đây không phải nội dung của người dùng thật hoặc bản chép catalog
template hệ thống của App. Các tác giả và dữ liệu đều là nhân vật/số liệu minh họa.

| Nội dung | Thao tác có thể thử |
|---|---|
| Một tuần có chủ đích | Nhập trọng tâm, tích việc, xem tiến độ |
| Đọc sâu và ghi nhớ | Ghi câu hỏi, tóm tắt và mở phần tự kiểm tra |
| Ngân sách workshop | Đổi số lượng/đơn giá, xem từng dòng và tổng VND |
| Thẻ ôn tập Web | Lật thẻ và chuyển câu hỏi HTML/CSS/JS |
| Nhịp đọc trong tuần | Đổi số giờ thứ Sáu, xem biểu đồ và tổng |
| Chọn phương án có cơ sở | Đổi trọng số, so sánh điểm của hai lựa chọn |
| Cuộc họp có bước tiếp theo | Ghi quyết định và đánh dấu việc cần làm |
| Bàn giao tài liệu rõ ràng | Kiểm tra nội dung, liên kết, offline và riêng tư |
| Mỗi ngày một bước nhỏ | Đánh dấu bảy ngày và đếm số buổi |
| Một phiên tập trung | Bắt đầu, tạm dừng và đặt lại đồng hồ |
| Tự kiểm tra kiến thức Web | Chọn đáp án và nhận giải thích |
| Lộ trình workshop | Chọn mốc và theo dõi bước đang thực hiện |
| Điểm cần chuẩn bị | Đổi khả năng/ảnh hưởng và xem điểm ưu tiên |
| Chia chi phí | Đổi tổng tiền/số người, kiểm tra dữ liệu không hợp lệ |

Nguồn: [catalog.json](../tools/community/catalog.json). Mẫu dùng envelope
`erusentia-template-html`, schema 1, tương thích catalog C2 hiện tại. Không có
CDN, API ngoài, token, thông tin App, đường dẫn máy cá nhân, số view/rating giả
hoặc tài khoản đăng nhập dùng chung trong bộ nội dung này.

## Seed local

Với Docker project đã chạy và có `docker/.env.project.local`:

```bash
pnpm project:seed:community --local-project
```

Kết quả lần đầu: `inserted: 14`, `preserved: 0`, `loginAccountsCreated: 0`.
Chạy lại: `inserted: 0`, `preserved: 14`. Lệnh chỉ thêm nội dung, không chạy
migration hay reset. Nó dùng database `eru_project_docker`, không dùng database
thực hành tuần 1/3/4/5.

Project bootstrap cũng chạy seed này khi `PROJECT_COMMUNITY_DEMO` không phải
`false`. Docker project bật rõ `PROJECT_COMMUNITY_DEMO=true`, nên database mới
cũng có nội dung sau khởi động. Không đổi mật khẩu các tài khoản demo local.

## Neon qua Render

Đối chiếu trực tiếp ngày **06/11/2026**: Neon có đủ **14 mẫu public, chưa xóa**,
4 danh mục và 3 tác giả minh họa inactive. Nội dung JSONB của 14 mẫu khớp catalog.
Chạy seed lại trả `inserted: 0`, `preserved: 14`, `loginAccountsCreated: 0`;
5 migration và fingerprint dữ liệu ngoài bộ seed giữ nguyên. Kết nối client dùng
TLS 1.3, xác minh chứng chỉ thành công. Với proxy của dịch vụ hosted, kiểm tra
TLS tại client; không suy ra tình trạng mã hóa toàn tuyến chỉ từ `pg_stat_ssl`
phía PostgreSQL. Không đưa thông tin kết nối hoặc credential vào báo cáo.

Render đã giữ kết nối Neon trong các biến môi trường. Sau khi mã này được deploy,
bước `project-db bootstrap` thêm những mẫu còn thiếu qua chính kết nối đó:

1. CI kiểm tra server và PostgreSQL TLS đạt rồi Render build image mới.
2. Bootstrap giữ nguyên năm migration đang triển khai, thêm bộ nội dung và tiếp
   tục mở API. Không lấy migration C3 từ nhánh history.
3. Log seed chỉ có dataset và số lượng thêm/giữ, không có mật khẩu/DSN.
4. Tài khoản cá nhân vẫn đăng ký/đăng nhập bình thường. Không bật
   `PROJECT_DEMO_ACCOUNTS` hoặc đưa mật khẩu demo local lên Render.

Có thể đặt `PROJECT_COMMUNITY_DEMO=false` để bỏ seed nội dung ở các lần boot tiếp
theo. Điều đó không xóa những mẫu đã thêm. Không xóa mẫu người dùng đã chỉnh,
khôi phục mẫu đã soft-delete hoặc đặt lại public khi chạy lại seed.

Nếu đối chiếu trực tiếp Neon, cấu hình các biến `DB_*` của dự án trong file
**được Git bỏ qua** `.env.neon.local`, quyền file 600, rồi chạy:

```bash
pnpm project:seed:community .env.neon.local
```

Dùng endpoint trực tiếp, `DB_SSL=true` với kiểm tra chứng chỉ. Lệnh từ chối
pooler endpoint vì dùng advisory lock theo session, từ chối database không có
prefix project và từ chối hosted không TLS. Không gửi credential qua chat.

## Thử trong App

1. Khởi chạy App local. Mở **Thư viện mẫu → Cộng đồng** và đăng nhập.
2. Lọc thẻ `community-demo`: có 14 mẫu, trang đầu 12 và trang sau 2 mẫu.
3. Thử tìm `Ngân sách workshop`, lọc danh mục **Cộng đồng · Chi phí** và xem mẫu.
4. Đổi số lượng Tài liệu từ 24 thành 30: tổng tăng từ **1.658.000 ₫** lên
   **1.730.000 ₫**. Bản xem thử không sửa dữ liệu template trên server.
5. Lưu vào thư viện và chèn vào một ghi chú. Bản chèn bắt đầu từ mẫu gốc; đổi số
   lượng trong ghi chú rồi lưu. Mở lại ghi chú và xuất HTML để kiểm tra offline.
6. Mẫu đã lưu/chèn là bản sao của người dùng; seed không thay nội dung bản sao.

Local có các tài khoản user/creator/admin trong tài liệu phát triển. Bộ nội dung
này chỉ tạo ba tác giả **inactive**, với mật khẩu ngẫu nhiên không được xuất ra.
Các vai trò Creator/Admin UI, xuất bản, kiểm duyệt và kho bài viết đầy đủ chưa
thuộc lát cắt C2; không giả lập rằng seed đã triển khai các tính năng đó.

## An toàn và kiểm thử

Seed dùng advisory lock, transaction và ID/slug riêng. Trùng danh tính/profile,
danh mục hoặc slug của dữ liệu khác sẽ rollback toàn bộ, không nhận làm dữ liệu
của seed. Chạy đồng thời không nhân đôi; chạy lại không UPDATE nên giữ nguyên
nội dung, timestamps, counters, quyền hiển thị, trạng thái xóa và mật khẩu.
Không thay migration SQL, không xóa database/volume và không seed thông tin riêng.

`pnpm test:hosted` đã kiểm tra PostgreSQL TLS thật: DTO của cả 14 mẫu, seed lặp
và đồng thời, không tạo tài khoản có thể đăng nhập, bảo toàn dữ liệu, API list/
detail, phân trang, quyền truy cập và rollback khi trùng slug. Lượt startup thật
của Render entrypoint kiểm tra cả restart và từ chối chứng chỉ không tin cậy.
App có `scripts/check-community-demo.mjs` để thử 14 tương tác offline cùng luồng
App/PostgreSQL local; profile/vault của lượt kiểm thử tách khỏi dữ liệu người dùng.
