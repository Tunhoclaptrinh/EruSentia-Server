# C3 — Quản lý mẫu, conditional writes và lịch sử

06/11/2026. Đợt C3 gộp nền tảng lịch sử, giao diện quản lý bản nháp và xuất bản có
xác nhận. Nhánh làm việc hiện tại: `feat/integration-c3-creator`; chưa đưa migration
lên Neon trong lượt kiểm thử local. App dùng cùng contract trên browser và broker Electron.

## Contract

`revision` là số nguyên do hệ thống tăng sau mỗi thay đổi, độc lập với chuỗi
`version` do tác giả nhập. GET detail, POST create, PATCH và restore thành công trả
strong ETag dạng `"template:<uuid>:<revision>"`. DELETE 204 trả ETag trạng thái đã xóa.

| Thao tác | Điều kiện và kết quả |
|---|---|
| `GET /templates/:id` | JWT và quyền đọc hiện có; trả body + ETag |
| `POST /templates` | Tạo revision 1 và một history entry `create` cùng transaction |
| `GET /templates?projection=summary&authorId=UUID&deleted=true` | Danh sách đã xóa, chỉ chủ tài khoản tương ứng hoặc Admin; không trả HTML |
| `PATCH /templates/:id` | `If-Match` đúng ETag đã đọc; một UPDATE có điều kiện, tạo revision mới |
| `DELETE /templates/:id` | `If-Match`; soft-delete và giữ lịch sử, slug vẫn được giữ |
| `GET /templates/:id/revisions?page=1&size=20` | Owner/Admin; metadata, không HTML; `size` tối đa 50 |
| `GET /templates/:id/revisions/:revision` | Owner/Admin; snapshot nội dung tại revision đó |
| `POST /templates/:id/restore` | Owner/Admin + `If-Match`, JSON `{"revision":1}`; tạo revision mới **private**, có thể khôi phục mẫu soft-delete |

Thiếu If-Match trả **428 PRECONDITION_REQUIRED**; đúng định dạng nhưng cũ hoặc
thuộc resource khác trả **412 PRECONDITION_FAILED**. Wildcard `*`, weak tag `W/…`,
danh sách tag hoặc header không đúng định dạng trả 400. Chỉ hỗ trợ một exact strong
template ETag để không bỏ qua kiểm tra revision. Slug conflict vẫn là 409.
Body validation/authorization được đánh giá trước; resource không có quyền đọc
vẫn 404, người không được sửa mẫu public vẫn 403, không dùng 428 để lộ tài nguyên.

### Nháp private và xác nhận xuất bản

API C3 tạo mẫu **private khi thiếu `isPublic`**; App vẫn gửi `isPublic: false`
tường minh. Đây là thay đổi so với mặc định public ở contract tuần 2 cũ; permalink
trong báo cáo học giữ đúng phiên bản tại thời điểm đó. Các row và SQL lịch sử không
bị sửa lại chỉ để thay mặc định API.

POST public và PATCH có kết quả public cần `contentJson.sharing`:

```json
{
  "license": "MIT",
  "attribution": "Tên tác giả do người xuất bản chọn",
  "permissionConfirmed": true,
  "sourceUrl": "https://example.com/nguon-goc"
}
```

`sourceUrl` là tùy chọn. Giấy phép nhận `MIT` hoặc `CC-BY-4.0`; xem điều khoản
[MIT](https://opensource.org/license/mit) và [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
Không tự gán giấy phép cho mẫu cũ, mẫu hệ thống hoặc mã App. Đây là xác nhận của
người xuất bản, không phải bằng chứng API đã xác minh bản quyền. Mẫu public cũ
vẫn đọc được; khi sửa public phải cung cấp metadata này hoặc chuyển private trước.

HTML private giữ giới hạn 1.000.000 ký tự; public tối đa 980.000 để dành chỗ cho
ghi nguồn trong bản sao offline. Request vẫn chịu giới hạn JSON 2 MB. Bộ lọc
public chặn một số dạng credential phổ biến mà không trả lại giá trị khớp; không
thay thế việc tác giả kiểm tra nội dung. App còn yêu cầu preview sẵn sàng và đóng
gói tài nguyên mạng trước khi bật chia sẻ mẫu tự chứa. Việc xóa/chuyển private
không thu hồi bản người khác đã tải.

Danh sách `deleted=true` cần `authorId` tường minh và đúng tài khoản (trừ Admin).
Mặc định list vẫn loại row đã xóa. Không mở API xóa vĩnh viễn hoặc xóa lịch sử.

History chỉ Owner/Admin đọc được, kể cả khi bản hiện tại public. Điều này ngăn
người đọc public xem các bản private cũ. History list còn trả `currentEtag` và
`deleted`; dùng **giá trị currentEtag trong body** khi restore mẫu đã xóa, không
dùng ETag tự động của response history. Lịch sử không phải feed cộng đồng public.

Theo [If-Match của HTTP](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-match)
và [428 Precondition Required](https://www.rfc-editor.org/rfc/rfc6585.html#section-3).

## Thao tác bằng Swagger

1. Đăng nhập, dán accessToken vào Authorize như trước.
2. POST tạo mẫu thử riêng; gửi `isPublic: false` tường minh. Ghi lại ID và ETag từ
   response headers, ví dụ `"template:UUID_THAT:1"`.
3. GET theo ID để lấy bản mới nhất. Copy toàn bộ ETag, **kể cả hai dấu ngoặc kép**.
4. PATCH theo ID: điền header **If-Match**, ví dụ body `{"title":"Bản sửa lần một"}`.
   Kết quả 200, revision 2, ETag mới. Body `contentJson` vẫn thay toàn bộ envelope,
   không phải merge riêng HTML; cần gửi đủ metadata muốn giữ.
5. Dùng lại ETag revision 1 để PATCH một nội dung khác: nhận 412; GET xác nhận bản
   sửa lần một còn nguyên. Client phải giữ nháp, cho so sánh/tải lại; không tự retry.
6. GET revisions: metadata mới nhất trước. GET revision 1: xem bản nội dung ban đầu.
7. POST restore, body `{"revision":1}`, If-Match là ETag hiện tại: revision tiếp
   theo được tạo; nội dung về bản 1 nhưng counter/history không quay ngược.
   Mẫu sau restore là private để người dùng xem lại trước khi chia sẻ.
8. DELETE với ETag mới, sau đó GET detail trả 404. Owner/Admin vẫn đọc được history;
   dùng `currentEtag` của history để restore có chủ đích.

Swagger chỉ mô tả và gửi request; không tự xử lý conflict. REST clients hiện có
gọi PATCH/DELETE phải được cập nhật If-Match trước khi chuyển sang C3. App C2
hiện chỉ đọc Template API. Báo cáo tuần học có permalink tới commit cũ giữ nguyên
contract tại mốc đó; không sửa tài nguyên/đề bài gốc để giả như đã dùng C3 từ đầu.

## Transaction, migration và cache

- Thêm `sql/08_template_revisions.sql` sau năm migration đã có. Không đổi checksum
  hoặc nội dung file migration cũ. Khi nâng từ C0–C2, journal tăng từ 5 lên 6 entry.
- Cột `revision`, bảng `template_revisions` và trigger là additive. Các row đã có
  được ghi **baseline** tại revision 1, giữ nguyên HTML, visibility, counter và ID.
  Không dựng lại lịch sử trước thời điểm bật tính năng.
- Create/update/delete/restore qua API đặt actor ID bằng transaction-local config.
  UPDATE kiểm tra revision và ownership ngay trong câu ghi. Trigger tăng revision
  và chụp snapshot trong cùng transaction; lỗi history/unique/FK rollback toàn bộ.
- SQL maintenance trực tiếp cũng tăng revision/history; actor có thể `null` vì
  không có phiên API. Không gọi history là chữ ký số hoặc hệ audit chống sửa bởi DBA.
- Restore giữ author, createdAt và các counter hiện tại; chỉ khôi phục các trường
  nội dung/metadata cho phép. Trùng slug cũ đang được mẫu khác dùng trả 409 và giữ
  nguyên bản hiện tại. Không tự phát lại POST/restore khi mất response.
- `cache_revision` vẫn là khóa invalidation Redis, khác business `revision`.
  Decoder loại cache cũ thiếu revision và nạp lại; quyền đọc kiểm tra trước HIT.
  Trigger cache và history cùng chạy trong transaction; private/delete không lộ cache cũ.

## Chạy và nghiệm thu local

Trong server:

```bash
pnpm typecheck
pnpm test
pnpm test:hosted
```

Hosted harness tạo PostgreSQL TLS tạm, database `project_test_*` riêng và tự dọn.
Nó kiểm tra nâng journal cũ, baseline, writes đồng thời, history rollback, private
history, delete/restore và startup/restart. Không dùng Neon hoặc database đang chạy.

Project stack sau khi chủ động chạy lại launcher sẽ migrate trước khi mở API. Với
database thực hành cũ chưa có journal, đối chiếu đúng DB_* rồi dùng `pnpm db:revisions`
trước khi mở server C3; lệnh này không thay thế bootstrap/journal của project.
Không dùng `db:fresh` trên dữ liệu cần giữ. `pnpm db:fresh` vẫn là lệnh reset có chủ
đích cho database thực hành, đã thêm schema revision ở cuối.

Kết quả 06/11/2026: typecheck đạt; suite mặc định **61 pass, 9 opt-in skip**;
hosted TLS/foundation/C3 **38 pass**, community seed **2 pass** và
PostgreSQL + Redis cache **13 pass** trên container riêng. Count gồm parent/subtest,
không cộng thành số tình huống nghiệp vụ độc lập. RabbitMQ/worker không thay đổi
trong C3-A; chưa chạy lại toàn bộ luồng email ở lượt này.

## Trước khi đưa lên hosted

Chưa chạy migration trên Neon của người dùng. Trước merge/deploy cần backup và
kiểm tra restore DB khác, cập nhật các client ghi If-Match, xem dung lượng baseline
và thống nhất cửa sổ chuyển đổi. Không để client/API cũ tiếp tục ghi vô điều kiện
trong thời gian hai phiên bản cùng chạy. Rollback code không tự rollback history/schema.

History dùng full snapshot: dữ liệu lớn tăng dung lượng theo số lần sửa. C4 cần
chốt quota, retention và moderation trước khi mở đóng góp rộng; không tự xóa lịch
sử để giữ Free tier. Luồng quản lý/xuất bản C3 không thay thế vận hành pilot C4.
