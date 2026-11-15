# Core backend và tích hợp Admin — 14/11/2026

## Bổ sung vòng đời quản trị — 14/11/2026

- `AdminTemplateLifecycleService` ghép `PostgresTemplateStore.adminWrite` vào transaction Admin để dùng lại quota/history/ETag, đồng thời ghi audit nguyên tử. Metadata, release, trash, restore/revision restore và purge dùng revision đã đối chiếu. Force-hide từ web cũng gửi revision; legacy API giữ tương thích.
- `AdminResourcesService` dùng `ResourcesService` cho grant/revoke/trash và gói, cung cấp đọc toàn hệ thống theo snapshot. Quyền actor/owner được khóa theo thứ tự ID; ACL được gỡ khi đổi access hoặc restore; quota retained bổ sung cho quota active. Batch retention chỉ chọn trash ≥30 ngày, đối chiếu SHA256 của actor/owner/cutoff/danh sách revision, xác thực mật khẩu lại và ghi audit từng bản ghi.
- `DocumentAdministrationService` tái sử dụng `BaseService.paginate/snapshot/transaction`. Snapshot HTML theo version, restore về draft, báo cáo và quyết định hai version là luồng riêng với curation mẫu. `lockDocumentQuota` giữ budget lịch sử 5.000 version/64 MiB mỗi tác giả.
- `recordAdminAction` và `recordAdminActions` là writer SQL chung, nhận chính EntityManager của transaction. Không gọi audit sau commit; batch ghi tập trung nhưng vẫn có một audit cho mỗi đối tượng. Không lưu password, HTML hay credential trong metadata.
- Chuyển chuyên mục khóa quota tác giả trước row nội dung, khóa chuyên mục `FOR NO KEY UPDATE` để tương thích FK key-share, sau đó đối chiếu fingerprint trên ID/version đã khóa. Chỉ update các ID trong scope, không quét một WHERE category sau bước xác nhận.
- Khôi phục hồ sơ đã xóa dùng `lockAdminTarget(..., includeDeletedTarget=true)`, đối chiếu `deleted_at`, gỡ mọi phiên cũ và đưa về user/suspended; không khôi phục quyền cũ.

Migration bổ sung: `17_admin_resource_lifecycle.sql`, `18_community_document_versions.sql`. Không chỉnh checksum migration cũ, không seed/reset. [Bằng chứng schema local](evidence/admin-schema-completion.json), [runtime local](evidence/core-runtime-hardening.json) và [contract live chỉ đọc](evidence/admin-completion-live-contracts.json).

Kiểm thử: PostgreSQL Admin 25/25 trên database dùng một lần; backend mặc định 134 đạt/19 bỏ qua theo cấu hình. Core guard hiện kiểm tra 60 route Admin, 9 consumer BaseService, 9 consumer BaseController. [Luồng thao tác UI và contract](../../erusentia-admin/docs/ADMIN_LIFECYCLE_GUIDE.md), [phạm vi thực tế](../../erusentia-admin/docs/ADMIN_COVERAGE_REVIEW.md).


Đã rà lại các phần nền tảng phục vụ web quản trị, đọc UniFlow gốc và triển khai lớp dùng chung phù hợp NestJS + TypeORM + PostgreSQL. [core-reference.json](core-reference.json) ghi commit, SHA của ba file nguồn và ánh xạ đích. Các file tham chiếu khớp commit `dfa1e963f025e00a44d97c5ca7621e8ebbb61aed`; repo nguồn được giữ nguyên.

UniFlow dùng Mongoose/MongoDB. EruSentia tiếp tục dùng PostgreSQL, SQL parameterized, contract hiện tại và các điều kiện nghiệp vụ của tài khoản, kiểm duyệt, version/ETag và audit.

## Các phần dùng chung đã áp dụng

| Phần                                    | Trách nhiệm và nơi dùng                                                                                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `common/services/base.service.ts`       | `BaseService`: transaction ghi, snapshot đọc, phân trang. `readPage` hỗ trợ composition; `ReportStore` dùng hàm này cho PostgreSQL và giữ chế độ memory.                                          |
| `pageWindow`                            | Mặc định và giới hạn phân trang ở service; từ chối số không nguyên, số không an toàn, kích thước ngoài 1–100 và offset vượt độ chính xác số nguyên.                                               |
| `queryRows` / `BaseService.rows`        | Chuẩn hóa `SELECT/INSERT` và tuple `[rows, affectedCount]` của TypeORM PostgreSQL cho `UPDATE/DELETE`. Chuyên mục dùng helper này.                                                                |
| `common/controllers/base.controller.ts` | `BaseController`: lấy actor từ identity đã xác thực và metadata request. Sáu controller áp dụng; route, DTO và quyền vẫn khai báo cụ thể.                                                         |
| `admin/admin-controller.decorator.ts`   | `@AdminController`: gom tiền tố route, quyền admin và Swagger bearer/tags cho năm controller thuần Admin.                                                                                         |
| `common/dto/pagination.dto.ts`          | DTO page/search và phép chuyển đổi tường minh. Bốn DTO danh sách Admin kế thừa trực tiếp; tài liệu/báo cáo kế thừa và giữ giới hạn riêng 50 dòng, 10.000 trang.                                   |
| `common/request-context.ts`             | Một implementation metadata; dùng IP đã qua chính sách Express trust-proxy, giới hạn user-agent 1.024 ký tự. `admin/request-meta.ts` chỉ re-export tương thích.                                   |
| `scripts/check-admin-core.mjs`          | Build kiểm tra 32 route Admin: quyền chỉ dành cho admin, không public, DTO Body/Query cụ thể và UUID pipe cho resource ID. Method policy được xét theo cách override class policy của RolesGuard. |

Sáu service kế thừa BaseService: tài khoản, mẫu, audit, chuyên mục, hệ thống và tài liệu cộng đồng. Sáu danh sách dùng một snapshot cho count/rows, bao gồm báo cáo qua `readPage`. Overview và các chi tiết nhiều truy vấn cũng dùng snapshot. Các truy vấn giữ thứ tự ổn định có ID làm tiêu chí phụ.

Các luồng ghi tiếp tục là thao tác nghiệp vụ cụ thể. Service ghi dữ liệu và audit bằng cùng EntityManager trong transaction; lỗi ghi audit làm rollback dữ liệu. Các resource API của App, workspace/tenant, notification cursor và auth session vẫn có contract riêng phù hợp nhiệm vụ của chúng.

## Lỗi thực đã sửa

1. **Response và audit chuyên mục:** code cũ đọc kết quả `UPDATE/DELETE ... RETURNING` như mảng record thuần, trong khi TypeORM trả thêm affected-count. Sửa lại response update, target ID/metadata audit và trường hợp xóa bản ghi không tồn tại trả 404. Có test PostgreSQL kiểm tra giá trị trả về và audit sau update.
2. **Hai admin thay đổi tài khoản lẫn nhau:** các thao tác cấp/hạ quyền, khóa/mở khóa và thu hồi phiên kiểm tra lại actor trong transaction. Actor và target được khóa theo thứ tự ID cố định. Hai yêu cầu hạ quyền hoặc khóa chéo không cùng thành công dựa trên kết quả guard cũ; test cạnh tranh xác nhận còn một admin có quyền hoạt động.
3. **Count và dữ liệu khác thời điểm:** danh sách tài khoản/mẫu/audit/báo cáo trước đây có thể trả count và rows từ hai snapshot. Đã đưa vào `REPEATABLE READ`. Test thật chèn dữ liệu từ kết nối khác giữa count và SELECT để xác nhận snapshot nhất quán.
4. **Validation phân trang bị lặp và thiếu giới hạn độ chính xác:** đã tập trung DTO/conversion; thêm giới hạn search, từ chối query lạ và kiểm tra offset ở service. Bộ lọc UUID dùng cùng cú pháp PostgreSQL với UuidPipe và dữ liệu seed.
5. **Thông báo lỗi SQL dùng sai loại tài nguyên:** exception filter chung trả thông báo conflict/reference trung tính; giữ mã HTTP và correlation ID, không đưa SQL/driver details vào response.
6. **Web chọn kích thước trang bị backend từ chối:** tài liệu/báo cáo chỉ hiển thị lựa chọn 10/20/50, đúng API; các danh sách khác giữ lựa chọn tới 100.

## Nhập và thao tác hàng loạt

Bốn route POST mới dùng DTO riêng, quyền admin, giới hạn rate write và audit cùng transaction:

- `/admin/categories/import/preview`: kiểm tra 1–100 dòng; chỉ trả dữ liệu chuẩn hóa và lỗi từng dòng, không ghi dữ liệu/audit.
- `/admin/categories/import`: kiểm tra lại và tạo mới cả nhóm. Chỉ nhận name/slug/description/displayOrder; trim, giới hạn field, phát hiện trùng trong tệp và trong DB. Unique constraint tiếp tục bảo vệ khi hai request cạnh tranh. Không upsert hoặc ghi đè.
- `/admin/categories/batch-delete`: khóa ID theo thứ tự, kiểm tra tham chiếu từ templates (gồm thùng rác) và community_documents, rồi xóa cả nhóm. Thiếu một ID trả 404; có tham chiếu trả 409, không xóa một phần.
- `/admin/templates/batch-curation`: lấy quota lock theo thứ tự tác giả rồi row lock theo ID; cập nhật tuyển chọn/gỡ tuyển chọn cho cả nhóm. Mẫu đã cùng trạng thái không tạo thêm revision/audit. Bản ghi không còn khả dụng làm rollback nhóm.

`AdminSelectionDto` và `selectedIds` yêu cầu 1–100 UUID duy nhất, chuẩn hóa chữ thường. Lý do bắt buộc 1–1000 ký tự. `lockAdminActor` khóa/kiểm tra admin đang hoạt động trong transaction, giữ quyền hợp lệ tới lúc commit. Helper này cũng áp dụng cho các write chuyên mục và curation/force-hide đơn lẻ có liên quan. Audit mỗi bản ghi có batchId để đối chiếu cùng thao tác. Khi audit của dòng thứ hai thất bại, cả các dòng và audit đã xử lý trước đó đều rollback.

Web giới hạn tệp nhập chuyên mục 256 KiB; API nhận JSON với giới hạn body chung 2 MB, tối đa 100 dòng và validation từng field. Các luồng ghi không tự phát lại khi mất kết nối. [Hướng dẫn và contract dùng chung với Admin](../../erusentia-admin/docs/DATA_ACTIONS_STATUS.md).

## Phía web quản trị

[BaseApiService của Admin](../../erusentia-admin/src/api/baseService.ts) được thích nghi từ service web của UniFlow. Sáu trang danh sách và năm consumer chi tiết dùng lớp này; bộ chọn chuyên mục dùng cùng list contract. Lớp nhận transport xác thực hiện có, giữ AbortSignal, kiểm tra envelope phân trang và UUID trước khi đọc chi tiết. Filter được feature ánh xạ tường minh; các write nghiệp vụ vẫn giữ lý do, xác nhận và version/ETag cần thiết.

Các phần UI/async/resource/form tiếp tục nằm trong core. Cài đặt cột là một icon bánh răng ngoài cùng bên phải sau tổng số; popover giữ ẩn/hiện cột, mật độ và reset. Lựa chọn này theo yêu cầu trực tiếp của người dùng, được ghi riêng trong tài liệu đối chiếu UniFlow của Admin.

## Thêm một resource Admin

- Khai báo controller với `@AdminController` và kế thừa BaseController; giữ DTO và UuidPipe trên từng handler.
- DTO danh sách kế thừa SearchPageQueryDto hoặc PaginationQueryDto; thêm bộ lọc được hỗ trợ cùng validation cụ thể. Khai báo giới hạn riêng nếu nghiệp vụ cần.
- Service kế thừa BaseService; dùng `paginate` cho count/rows, `snapshot` cho chi tiết nhiều truy vấn và `transaction` cho ghi dữ liệu/audit. Giá trị từ người dùng luôn đi qua SQL parameter binding.
- Dùng `rows` khi cần record từ `RETURNING`. Giữ kiểm tra quyền, ownership, trạng thái và revision tại nơi xử lý nghiệp vụ.
- Trên web, dùng BaseApiService cho đọc; feature truyền cột/filter/callback vào core. Đồng bộ page-size options với giới hạn server.

## Kiểm chứng và runtime

- `pnpm check:core`: 32 route Admin, sáu BaseService consumer và sáu BaseController consumer đạt.
- `pnpm test`: **134 ca đạt, 19 ca bỏ qua theo cấu hình hạ tầng**, tổng 153 ca. Bao gồm auth, session, ownership, DTO, public API, cache/config, OpenAPI và các regression của nền tảng.
- `pnpm test:admin`: **19/19 đạt** trên PostgreSQL dùng database ngẫu nhiên `project_test_admin_*`, tự xóa khi xong. Có RBAC, cross-admin concurrency, snapshot concurrency, validation cả sáu danh sách, audit rollback, luồng duyệt tài liệu và năm ca nghiệp vụ import/batch: preview không ghi, kiểm tra lại khi commit, nhóm atomic, tuyển chọn idempotent, thứ tự khóa giữa tác giả và rollback lỗi audit ở dòng thứ hai.
- 19 ca bỏ qua trong bộ mặc định không được tính là đã kiểm thử thành công. Bộ PostgreSQL Admin được chạy riêng để kiểm chứng phần thay đổi có liên quan.
- API/worker local được build lại, cùng image và healthy. Khi khởi động đặt `PROJECT_BOOTSTRAP=false`; số bản ghi và 15 mục migration giữ nguyên. PostgreSQL/Redis/RabbitMQ/Mailpit giữ container hiện có. [Báo cáo runtime](evidence/core-runtime-hardening.json).

Không commit/push/deploy ra dịch vụ bên ngoài. Không chạy lệnh stage/reset/commit/push hoặc khôi phục index có sẵn. Lượt này không sửa repo training.

## Rà bao phủ nghiệp vụ và tính nhất quán bổ sung

Đã dùng chung `admin/admin-authorization.ts` cho actor/target: khóa theo thứ tự ID, kiểm tra admin DB hiện tại và trạng thái hoạt động. Duyệt tài liệu và quyết định báo cáo cũng khóa/kiểm tra actor trong transaction; các ghi tài nguyên bảo vệ kiểm tra lại ownership/admin trước khi dùng quyền vượt qua chủ sở hữu.

`admin/admin-audit-record.ts` là SQL writer dùng chung cho AdminAuditService, quyết định báo cáo, đổi gói và ghi tài nguyên của admin. Ghi audit bằng EntityManager của transaction hiện tại. Quyết định báo cáo tiếp tục có moderation_audit; đổi gói và tài nguyên tiếp tục có access audit, đồng thời thêm nhật ký quản trị trung tâm khi phù hợp. Lỗi ghi một loại audit rollback cả dữ liệu và loại audit còn lại.

Đổi gói khóa actor/target theo cùng thứ tự với cập nhật tài khoản, serialize các thay đổi và ghi đúng previous/current. Tạo tài nguyên kiểm tra lại plan/quota dưới khóa tài khoản; tạo/cấp quyền/thu hồi/soft-delete tài nguyên PostgreSQL và audit nằm cùng transaction. Memory adapter không đại diện cho bảo đảm ACID của PostgreSQL.

PostgreSQL Admin mới nhất: **19/19 đạt**. Bốn ca bổ sung bao phủ quyền DB thay đổi sau snapshot identity, central audit/rollback, cạnh tranh đổi gói, rollback bốn kiểu ghi tài nguyên và stale admin bypass. Backend mặc định **134 đạt/19 bỏ qua**, tổng 153. [Ma trận bao phủ và phần chưa hoàn tất](../../erusentia-admin/docs/ADMIN_COVERAGE_REVIEW.md).
