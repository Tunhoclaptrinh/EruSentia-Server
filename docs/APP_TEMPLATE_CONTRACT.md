# Hợp đồng Template với App hiện tại

Đối chiếu model App ngày 03/11/2026; bổ sung auth/category/CORS ngày 04/11/2026 và
trạng thái C2 ngày 05/11/2026. App đã gọi catalog/detail API, xem thử HTML/CSS/JS
trong runner cô lập, lưu bản sao vào thư viện IndexedDB và chèn vào ghi chú.
Server kiểm chứng HTTP/DB; kiểm thử render, bản sao và HTML offline nằm ở repo
App riêng tư. Chưa có xuất bản/kiểm duyệt hoặc Cloud Sync.

## Phân biệt mô hình lưu trữ và mô hình giao diện

Server dùng bảng `templates` tuần 1: UUID, FK author/category, title, slug,
description, content_json JSONB, tags, metrics và soft delete. HTML/metadata được
lưu trong content_json, không cần thêm cột mới cho bài thực hành tuần 2.

App có ID local dạng chuỗi và template HTML tự chứa; vì vậy không ép ID local thành
UUID của bản ghi server. Không sao chép mã HTML của App riêng tư sang ví dụ công khai.
[Payload mẫu độc lập](../tools/examples/create-template.json) dùng đúng các trường
hiện có, với nội dung HTML minh họa mới.

| Trường ở App | Trường server / quy tắc chuyển đổi trong lần tích hợp sau |
|---|---|
| `id` local | Server sinh UUID `id`; bản sao local giữ remote reference riêng, không thay ID local bằng UUID server |
| `originId` | Có thể giữ trong `contentJson.originId` theo nghĩa lineage nguồn; không mặc định đó là ID bản ghi remote |
| `title` | `title` |
| `desc` | `description` |
| `html` | `contentJson.html`, giữ nguyên chuỗi, không đổi sang block JSON |
| `guide`, `iconName` | Các trường cùng tên trong `contentJson` |
| `subjectCategory` | `contentJson.subjectCategory`: study/productivity/math/interactive/visual/finance |
| `level` | `contentJson.level`: full/semi/basic; basic hiện được type UI chấp nhận |
| `defaultWidth`, `defaultHeight` | Các trường cùng tên trong `contentJson` |
| `fitMode` | fit-template/fit-page/fixed trong `contentJson` |
| `aspectRatio`, `allowHeightResize` | Giữ nguyên trong `contentJson`, kể cả boolean false |
| `tags` | `tags` trên Template server |
| `category: official/custom` | Tab/nguồn local của App; không tương đương FK taxonomy hoặc quyền xuất bản |
| Chưa có trên model UI | `categoryId`, `slug`, `isPublic`, version/metrics server; authorId do server lấy từ JWT |

`categoryId` hiện tham chiếu taxonomy SQL tuần 1 (Software Engineering, Project
Management...), **khác** nhóm chủ đề của App. Giữ cả hai, không tự map `study` thành
một UUID hoặc tự gán template là official. Quy tắc xuất bản/định danh người gọi cần
được chốt khi tích hợp App. Auth server đã có JWT/ownership ở tuần 3; frontend chưa
gửi request hoặc quản lý token. Không bổ sung field giá/bán template vì App
hiện tại không có hợp đồng mua bán đó.

`GET /categories` có JWT đã bổ sung để client lấy taxonomy thật. Nguồn community cần
phân biệt với nguồn local; thao tác save/delete local không tự biến thành publish/
delete remote. Client xuất bản phải gửi `isPublic` tường minh vì server mặc định true.

## Envelope lưu trong JSONB

```json
{
  "format": "erusentia-template-html",
  "schemaVersion": 1,
  "html": "<section><h2>Kế hoạch học tập</h2></section>",
  "subjectCategory": "study",
  "level": "semi",
  "defaultWidth": "100%",
  "defaultHeight": "auto",
  "fitMode": "fit-page",
  "allowHeightResize": false
}
```

Ba trường format/schemaVersion/html bắt buộc khi POST hoặc khi PATCH contentJson.
Metadata còn lại tùy chọn; null, field lạ, enum sai hoặc chuỗi `"false"` ở trường
boolean bị từ chối. HTML tối đa 1.000.000 ký tự, guide tối đa 100.000; giới hạn body
JSON 2 MiB. Kích thước/aspectRatio là chuỗi có giới hạn độ dài, chưa phải CSS parser.
PATCH contentJson thay cả envelope: client cần gửi đủ metadata muốn giữ lại.

JSONB không áp schema nội dung lên các row seed tuần 1 cũ: GET vẫn có thể trả payload
legacy `blocks`. Client tương lai phải kiểm tra format/schemaVersion; chuyển đổi
seed cũ là công việc riêng, không âm thầm rewrite dữ liệu ở tuần 2. `version` bên
ngoài envelope là phiên bản nội dung, không phải schemaVersion hay optimistic lock.

Server chỉ lưu/trả HTML dưới dạng JSON, không thực thi hoặc chứng nhận HTML an toàn
để chèn DOM. Luồng preview/sandbox của App chưa được kiểm chứng qua API. Các tests
tuần 2 xác nhận chuỗi Unicode, HTML lớn và metadata được bảo toàn qua HTTP/DB/restart.

Trước tích hợp cần runner cô lập cho HTML không tin cậy, auth client, summary list/
filter format và điều kiện chống ghi đè. Không tự cập nhật nội dung đã chèn vào note
khi bản remote thay đổi. Xem [kết nối client](../README.md#chuẩn-bị-project--kết-nối-client); chi tiết
triển khai App và ranh giới thực thi giữ trong tài liệu nội bộ của App.

## Nguồn đối chiếu local

Các path sau thuộc App riêng tư trong workspace, chỉ dùng để kiểm tra hợp đồng;
không tạo link công khai hoặc sao chép source App sang TYP:

- `src/config/defaultTemplates/types.ts`: DefaultTemplate, nhóm chủ đề và layout.
- `src/components/Sidebar/panels/TemplateStorePanel/types.ts`: model UI hiện tại.
- `src/components/Sidebar/panels/TemplateStorePanel/hooks/useTemplateStore.ts`:
  dựng template, localStorage, import/export và luồng chèn.

[API và cURL](TEMPLATE_API.md) · [Postman collection](../tools/postman/templates.postman_collection.json)
