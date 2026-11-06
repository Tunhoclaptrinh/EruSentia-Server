# Bộ mẫu thực hành cộng đồng

Bộ **v2** gồm 14 tài liệu HTML/CSS/JavaScript tự chứa, biên soạn độc lập cho các
hoạt động học tập và làm việc. Chúng là dữ liệu minh họa, không phải bài đăng của
người dùng thật. Ba hồ sơ tác giả minh họa đều inactive; seed không tạo tài khoản
đăng nhập hoặc số view/rating giả. Giấy phép MIT và ghi công được khai báo rõ cho
nội dung mẫu; không áp dụng giấy phép này cho mã nguồn App.

## Nội dung có thể dùng

| Mẫu | Thao tác |
|---|---|
| Một tuần có chủ đích | Chỉnh trọng tâm, đánh dấu công việc, nhìn lại kết quả |
| Đọc sâu và ghi nhớ | Ghi câu hỏi, ý chính và tóm tắt theo Cornell |
| Ngân sách workshop | Sửa khoản chi, số lượng/đơn giá, thêm/xóa dòng, tính tổng |
| Thẻ ôn tập Web | Tự trả lời, lật và chuyển ba thẻ HTML/CSS/JavaScript |
| Nhịp đọc trong tuần | Đổi số giờ thứ Sáu, xem biểu đồ và tổng |
| Chọn phương án có cơ sở | Đổi trọng số và điểm số để so sánh hai lựa chọn |
| Cuộc họp có bước tiếp theo | Ghi quyết định, người phụ trách và đầu việc |
| Bàn giao tài liệu rõ ràng | Kiểm tra nội dung, liên kết và tài nguyên offline |
| Mỗi ngày một bước nhỏ | Đánh dấu bảy ngày thực hành và ghi điều cần duy trì |
| Một phiên tập trung | Đặt 1–180 phút, bắt đầu/tạm dừng/đặt lại đồng hồ |
| Tự kiểm tra kiến thức Web | Trả lời một câu hỏi, xem đáp án và giải thích |
| Lộ trình workshop | Chọn mốc chuẩn bị, theo dõi bước đang thực hiện |
| Điểm cần chuẩn bị | Đổi khả năng/ảnh hưởng và ghi phương án phòng ngừa |
| Chia chi phí | Đổi tổng tiền/số người, tính phần đóng góp làm tròn lên |

Mỗi mẫu có phần ghi chú riêng, giao diện sáng, hiển thị được ở 390 px và không
phụ thuộc CDN/API/font bên ngoài. Đây là công cụ thực hành nhỏ; không thay cho
phần mềm kế toán, quản lý dự án hoặc ngân hàng câu hỏi đầy đủ.

## Sửa nguồn và tạo catalog

- [manifest.json](../tools/community/manifest.json): ID, metadata, giấy phép và đường dẫn HTML.
- [templates](../tools/community/templates): nguồn HTML/CSS/JS đọc và sửa được theo từng mẫu.
- [theme.css](../tools/community/theme.css): giao diện tài liệu dùng chung, được nhúng lúc build.
- [catalog.json](../tools/community/catalog.json): đầu ra tự chứa dùng cho seed; không sửa tay.
- [previous-v1.json](../tools/community/previous-v1.json): fingerprint bất biến của bản gốc, dùng kiểm tra điều kiện nâng cấp; không cập nhật để ép ghi đè nội dung đã sửa.

```bash
pnpm community:build
pnpm community:check
```

CI chạy `community:check` để phát hiện nguồn và catalog không đồng bộ. Mẫu mới
phải được kiểm tra DTO/publication và tương tác trong App/HTML offline.

## Seed mặc định: chỉ thêm phần còn thiếu

Với Docker project đang chạy và có `docker/.env.project.local`:

```bash
pnpm project:seed:community --local-project
```

Neon dùng file `.env.neon.local` đã được Git bỏ qua, quyền 600, chứa `DB_*` của
dự án với `DB_SSL=true`, endpoint trực tiếp, xác minh chứng chỉ:

```bash
pnpm project:seed:community .env.neon.local
```

Lần đầu thêm 14 mẫu. Chạy lại giữ nguyên các dòng đã có, kể cả nội dung đã sửa,
private hoặc soft-delete. Lệnh không reset DB, không chạy migration, không đổi
mật khẩu hay cập nhật bản sao trong vault người dùng. Bootstrap cũng chỉ thêm
mẫu thiếu khi `PROJECT_COMMUNITY_DEMO` không phải `false`; không tự nâng v1 lên v2.
Không bật tài khoản demo local trên Render.

## Nâng bộ v1 đã có lên v2

Chỉ dùng sau khi API/schema C3 đã hoạt động (`08_template_revisions.sql`).
Chạy dry-run trước, thay `--local-project` bằng `.env.neon.local` nếu dùng Neon:

```bash
pnpm project:seed:community --local-project --upgrade-curated --curated-only --dry-run
pnpm project:seed:community --local-project --upgrade-curated --curated-only --backup-dir ../.local/backups/community
```

`--upgrade-curated` chỉ thay 14 dòng v1 còn đúng fingerprint gốc và chưa xóa.
Dòng đã sửa riêng hoặc lên phiên bản khác được giữ. `--curated-only` chuyển hai
fixture kỹ thuật cũ sang private nếu nội dung và chủ sở hữu inactive còn khớp;
không xóa dòng. Có thể bỏ cờ này nếu vẫn muốn giữ fixture trong catalog.

Lệnh yêu cầu backup ngoài repository trước khi ghi: thư mục mới quyền **0700**,
`before-upgrade.json` quyền **0600**, chỉ gồm các dòng mẫu đủ điều kiện; không gồm
tài khoản, hash mật khẩu hay phiên đăng nhập. Backup lỗi thì transaction rollback.
Advisory lock cùng row lock bảo vệ seed đồng thời; cập nhật qua trigger C3 tạo
revision/history mới và đổi cache revision. Giữ chủ sở hữu, counters và dữ liệu
ngoài bộ mẫu. Không import lại nguyên backup bằng SQL ghi đè lịch sử; khi cần
khôi phục, dùng quy trình revision C3 và kiểm tra ETag/quyền phù hợp.

## Dùng trong App

1. Mở **Thư viện mẫu → Cộng đồng**, đăng nhập rồi tìm mẫu hoặc lọc thẻ `community-demo`.
2. Chọn **Xem thử**. Thay số lượng Tài liệu từ 24 thành 30 trong ngân sách:
   tổng đổi từ **1.658.000 ₫** thành **1.730.000 ₫**.
3. Muốn dùng dữ liệu vừa nhập, chọn **Giữ dữ liệu đã nhập trong bản xem thử**,
   rồi **Lưu bản đã tùy chỉnh** hoặc **Chèn vào ghi chú**. Không chọn thì dùng bản gốc.
4. Lưu ghi chú, mở lại và xuất HTML. Bản sao giữ tương tác, nguồn/revision và
   giấy phép; mẫu trên server vẫn giữ nguyên. Đồng hồ mở lại ở trạng thái tạm dừng.

Tác giả có luồng nháp/lịch sử/chia sẻ của C3. Seed này không bổ sung quy trình
kiểm duyệt Admin, xác minh email hoặc kho bài viết cộng đồng.

## Kiểm chứng ngày 07/11/2026

`pnpm test:hosted` kiểm tra PostgreSQL TLS, seed lặp/đồng thời, rollback, dry-run,
backup CLI thật, giữ nội dung sửa/xóa và chỉ ẩn fixture gốc. App có
`pnpm test:template-quality`: đọc catalog từ PostgreSQL tạm, thử cả 14 mẫu qua
runner cô lập và mở sản phẩm HTML thật bằng `file://` khi chặn mạng.

Local và Neon đã được dry-run, backup các dòng gốc rồi nâng 14 mẫu lên v2 và
chuyển 2 fixture gốc sang private. Biên bản fingerprint và backup nằm tại
`.local/backups/template-quality-2026-11-07` ở thư mục chứa App/server, không đưa
vào Git. Kết quả bảo toàn dữ liệu và ảnh giao diện được ghi trong báo cáo chất
lượng ở repo App; thay đổi nội dung không yêu cầu migration mới hay sửa engine HTML.
