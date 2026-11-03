# Template API — hợp đồng tuần 3

NestJS + TypeORM trên PostgreSQL tuần 1. Dùng cùng 5 route với `TEMPLATE_STORE=memory`
và `TEMPLATE_STORE=postgres` trên cùng hợp đồng HTTP.
Bootstrap/test xem [README](../README.md).

Mọi route dưới cần `Authorization: Bearer <accessToken>`. Register/login tại
[Auth API](AUTHENTICATION.md). Author lấy từ JWT; private chỉ hiện cho chủ sở hữu
hoặc admin. Hướng dẫn tuần 2 được giữ theo [commit b9017f7](https://github.com/Tunhoclaptrinh/EruSentia-Server/tree/b9017f77f6b97a4935fd72d22f2e149f32c4b649).

Swagger UI cơ bản tại `/docs`, đặc tả OpenAPI JSON tại `/docs-json`, cùng host/port
với API. Có thể xem schema và gửi request bằng Try it out; cấu hình bật/tắt nằm trong README.

## Request/response

| Route | Kết quả |
|-------|---------|
| `GET /templates` | `{data, page, size, totalPages, totalElements}` |
| `GET /templates/:id` | Một Template + `author: {id}`, `category: {id,name,slug}` |
| `POST /templates` | 201 + Template mới |
| `PATCH /templates/:id` | 200 + Template sau cập nhật |
| `DELETE /templates/:id` | 204; set deleted_at, không xóa row khỏi PostgreSQL |

List hỗ trợ `page` 1..10000, `size` 1..100; `authorId`, `categoryId`, `tag`, `search`,
`isPublic=true|false`, `sort=createdAt|title`, `order=asc|desc`. Giá trị ngoài whitelist
bị từ chối. Sắp xếp thêm ID làm tiebreaker; mặc định `(createdAt DESC, id DESC)`.
`search` là substring không phân biệt hoa thường, `%`/`_` là ký tự literal; chưa dùng
GIN full-text index. Sort title theo collation PostgreSQL, memory theo thứ tự chuỗi JS;
không cam kết thứ tự Unicode giống nhau giữa hai adapter.

`totalPages=0` nếu không có row; trang vượt cuối có `data=[]` nhưng vẫn giữ total.
Data và count có thể khác snapshot khi có ghi đồng thời; OFFSET không tạo snapshot
ổn định giữa các request. Đây là phân trang offset của bài tuần 2.

### Tạo template

```bash
curl -i http://127.0.0.1:3001/templates \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "categoryId":"c0000000-0000-0000-0000-000000000001",
    "title":"Study planner",
    "slug":"study-planner-demo",
    "description":"A template for weekly learning",
    "contentJson":{"format":"erusentia-template-html","schemaVersion":1,"html":"<section><h2>Study planner</h2></section>","subjectCategory":"study","level":"semi","fitMode":"fit-page","allowHeightResize":false},
    "tags":["study"],
    "isPublic":false
  }'
```

Slug do client cung cấp, lowercase/digit với dấu gạch giữa, tối đa 280 ký tự. `title`
3..255 sau trim, `description` 1..10000. `contentJson` phải là HTML envelope có
format/schemaVersion/html và metadata hợp lệ theo [hợp đồng App](APP_TEMPLATE_CONTRACT.md).
Giới hạn DTO là hợp đồng API; một số giới hạn chặt hơn kiểu dữ liệu DB.
UUID nhận dạng hex `8-4-4-4-12` có dấu gạch nối, không bắt buộc version/variant
UUIDv4 để hỗ trợ seed tuần 1 (`a000...`, `c000...`). Những cách viết UUID khác mà
PostgreSQL chấp nhận, như bỏ dấu gạch nối hoặc thêm ngoặc nhọn, không thuộc input API.

Category cần tồn tại; tác giả lấy từ tài khoản JWT đang active/chưa soft-delete.
Memory có hai category mẫu; tài khoản tạo qua register. Gửi authorId trong body trả
400. User/creator chỉ sửa/xóa của mình; admin được quản lý mọi template.

### Đọc, sửa, xóa

Lấy ID từ response POST rồi thay vào lệnh:

```bash
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'http://127.0.0.1:3001/templates?page=1&size=5&isPublic=false'
curl -H "Authorization: Bearer $ACCESS_TOKEN" 'http://127.0.0.1:3001/templates/<id>'
curl -X PATCH 'http://127.0.0.1:3001/templates/<id>' \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"title":"Updated study planner"}'
curl -i -X DELETE -H "Authorization: Bearer $ACCESS_TOKEN" 'http://127.0.0.1:3001/templates/<id>'
```

PATCH partial; field vắng giữ nguyên. `contentJson` thay **toàn bộ document**, không
merge metadata lồng nhau. `thumbnailUrl:null` xóa thumbnail; các field khác không nhận
null. Body rỗng bị từ chối. `authorId`, ID, rating/view/fork metrics, featured và timestamp
không được sửa từ API. GET/PATCH/DELETE không tăng view. PUT chưa có; không mô tả PATCH
như full replacement.

Slug trùng trả 409 cả khi row cũ đã soft-delete, theo UNIQUE(slug) schema tuần 1.
Pre-check không thay unique constraint; test đồng thời xác nhận một POST 201, một 409.
Xóa/sửa/đọc ID không tồn tại hoặc đã xóa trả 404; DELETE lần hai cũng trả 404.
Private của người khác trả 404 và không vào data/count; sửa/xóa public của người
khác trả 403. Thiếu/sai/hết hạn token hoặc phiên bị thu hồi trả 401.

## Error response

```json
{
  "statusCode": 400,
  "code": "BAD_REQUEST",
  "message": "Request validation failed",
  "details": ["size must not be greater than 100"],
  "path": "/templates",
  "timestamp": "2026-11-03T00:00:00.000Z"
}
```

Ví dụ thời điểm minh họa. Validation 400, missing row 404, duplicate slug 409; lỗi
không biết trả 500 với message chung. Không gửi SQL, constraint detail, password hash
hoặc request body trong lỗi. `INVALID_REFERENCE` dùng khi PostgreSQL báo FK violation;
reference pre-check trả `BAD_REQUEST`. Malformed JSON cũng trả 400 cùng envelope.
JSON body vượt 2 MiB trả 413. Nội dung HTML không được thực thi bởi API.

## ORM và schema

`TemplateEntity` map `category_id`, `content_json`, `rating_avg`, `views_count`,
`forks_count`, `deleted_at` đúng SQL hiện có; không có `price`, `status`, `html_content`.
`version` VARCHAR là phiên bản nội dung, không phải optimistic counter.
ManyToOne tới author/category, OneToMany chiều ngược; `onDelete: RESTRICT` đúng FK.
API join category để lấy tên trong query trang; author chỉ trả ID, không load credentials.
`AuthorEntity` map bảng users cho auth, với password_hash đặt select:false. Adapter
Template vẫn chỉ trả author ID; dữ liệu tài khoản có projection riêng trong Auth API.

`synchronize:false`, `migrationsRun:false`. Không sinh migration từ mapping user/category
chưa đầy đủ; bootstrap bằng SQL đã có và áp dụng `05_auth_sessions.sql` tường minh.
Migration auth bổ sung không được tự chạy khi khởi động API.
