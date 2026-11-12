# EruSentia: 0 đồng, không billing và UX khi dịch vụ ngủ

Ngày kiểm tra: **10/11/2026**. Đây là cập nhật ràng buộc cho [phương án Keycloak](KEYCLOAK_INTEGRATION_PLAN.md), sau khi chủ dự án xác nhận chỉ muốn dùng các gói free, không cấu hình thanh toán và có thể không quản trị dự án trong thời gian dài. Chưa đổi deployment, bật dịch vụ hoặc đăng ký tài khoản mới trong lượt nghiên cứu này.

## 1. Kết luận áp dụng cho dự án

Có thể vận hành demo/hobby ở mức **0 đồng trong quota**, dùng URL do nhà cung cấp cấp sẵn và chấp nhận một số tính năng mạng phải chờ. Không thể cam kết đồng thời: miễn phí mãi, không bao giờ ngủ/gián đoạn, tài khoản/dữ liệu được giữ vĩnh viễn và không cần bảo trì.

Vì vậy **tạm hoãn đưa Keycloak tự host vào đăng nhập hosted chính**. Giữ tài liệu Keycloak làm kiến trúc tham khảo và PoC local. Chưa chốt nơi host Keycloak đáp ứng điều kiện free, không thẻ, UX chấp nhận được và chính sách bỏ không dài hạn.

## 2. Những nền tảng đang dùng

| Thành phần | Cách dùng phù hợp hiện tại | Giới hạn liên quan |
|---|---|---|
| Vercel Hobby | App web; dùng URL `.vercel.app` có sẵn | Có quota; phạm vi personal/non-commercial; vượt giới hạn có thể phải chờ reset |
| GitHub Pages | Landing, hướng dẫn, mẫu HTML tĩnh | Static hosting; không chạy NestJS/Keycloak; không dùng làm dịch vụ SaaS thương mại |
| Neon Free | PostgreSQL bền vững của App trong quota | Compute ngủ sau 5 phút và bật lại khi có kết nối; free không đồng nghĩa lưu giữ vô điều kiện vĩnh viễn |
| Render Free | API demo hiện tại | Ngủ sau 15 phút không có traffic, thức lại khoảng một phút; quota và khả năng suspend |

Nguồn: [Vercel Hobby](https://vercel.com/docs/plans/hobby), [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits), [Neon plans](https://neon.com/docs/introduction/plans), [Render Free](https://render.com/docs/free).

Render công bố 750 giờ free mỗi workspace/tháng, chia sẻ cho các service. Nếu không có phương thức thanh toán, vượt bandwidth có thể suspend dịch vụ; vượt build quota có thể ngừng build. Filesystem của API là ephemeral, nên không chứa DB hay dữ liệu người dùng cần giữ. Free Render Postgres hết hạn sau 30 ngày, có thêm 14 ngày để nâng cấp trước khi xóa; **DB hiện tại của dự án là Neon, không phải Render Postgres**. [Render Free](https://render.com/docs/free).

Neon công bố Free không cần thẻ và không có thời hạn dùng thử; vẫn phải tuân thủ quota và điều khoản. Scale-to-zero là tạm dừng compute, không phải thông báo đã xóa database. Không lấy chính sách xóa của Render Postgres hoặc Supabase gán sang Neon. [Neon pricing](https://neon.com/pricing), [Neon platform terms](https://neon.com/platform-terms).

Chưa đọc dashboard/billing tài khoản thật của chủ dự án trong đợt này. Không khẳng định tài khoản hiện đã ở đúng plan hoặc chưa liên kết phương thức thanh toán chỉ dựa trên file cấu hình repo.

## 3. Có phải mua domain, SMTP hoặc VPS ngay không?

**Domain:** chưa cần mua. Có thể dùng HTTPS subdomain hiện tại của Vercel/Render hoặc domain do dịch vụ auth cấp. Callback phải đăng ký đúng URL ổn định. Custom domain là lựa chọn để quản lý thương hiệu/routing, không phải điều kiện để mọi OAuth demo hoạt động.

**Máy chủ:** API đang ở Render, database ở Neon nên chưa cần thuê thêm VPS để dùng các chức năng hiện tại. Nhưng Keycloak là thêm một dịch vụ có trạng thái cần vận hành, không chạy được như tài nguyên tĩnh trên Pages. Không giả định thêm Keycloak lên Render Free sẽ có đủ tài nguyên hoặc tránh ngủ; phải PoC riêng nếu vẫn chọn hướng đó.

**SMTP:** social sign-in cơ bản không bắt buộc EruSentia tự gửi email ở mỗi lần đăng nhập. Luồng xác minh email do App/Keycloak quản lý, reset mật khẩu local, magic link, thông báo và lời mời là yêu cầu riêng. Nếu provider không có email đã xác minh thì cần onboarding phù hợp, không bỏ qua xác minh để né chi phí.

Render Free chặn outbound các cổng SMTP 25/465/587. Vì thế không mặc định cắm Gmail SMTP vào backend là dùng được. Nếu thêm email hosted, cần đánh giá dịch vụ gửi qua HTTPS API hoặc managed email có quota, chính sách sender/domain và điều kiện free cụ thể. Mailpit local không phải dịch vụ gửi email thật. [Giới hạn SMTP Render](https://render.com/docs/free).

## 4. UX với Render ngủ: tận dụng những gì source đã có

`erusentia-app/shared/hub-health.mjs` và `docs/SERVICE_CONNECTION.md` đã có cơ chế kiểm tra khi người dùng cần tài khoản/cộng đồng, dùng chung lượt probe, có timeout và cho tiếp tục làm việc local. Các thông số hiện tại gồm trạng thái checking sau 400 ms, waking sau 2 giây, deadline hosted 90 giây và readiness cache 30 giây. Không có cron giữ server thức.

Đó là nền tảng hợp lý cho free-tier UX, nhưng `GET /health` hiện chỉ kiểm tra liveness. Chưa có bằng chứng endpoint đó bảo đảm PostgreSQL đã thức và mọi request nghiệp vụ sẽ thành công.

Hướng hoàn thiện đề xuất:

1. App/editor mở độc lập với API; chỉ phần cần cloud mới chờ. Không khóa màn hình ghi chú để chờ login.
2. Dùng lời nhắn “Dịch vụ đang kết nối, bạn vẫn có thể làm việc trên máy”, không giả định mọi timeout là server ngủ.
3. Thêm readiness DB hữu hạn cho thao tác cần DB, hoặc xử lý rõ lỗi cold connection sau liveness; tránh polling DB nền liên tục làm tiêu quota Neon.
4. Giữ nội dung đang nhập, cho hủy/thử lại, phân biệt mất mạng, timeout và dịch vụ bị suspend. Không dùng thanh phần trăm giả.
5. Không tự phát lại POST đăng ký, xuất bản, đổi mật khẩu hoặc redeem authorization code. Đọc có thể retry hữu hạn; ghi cần idempotency/đối soát riêng.
6. Nếu dùng OAuth/BFF, phải đánh thức backend trước khi bắt đầu và kiểm thử callback khi cold start. Code một lần có hạn, nên cách này giảm rủi ro chứ không chứng minh callback trên Render Free luôn thành công.

Muốn loại bỏ việc chờ Render khỏi đường đăng nhập, cần đánh giá auth/BFF managed hoặc serverless độc lập. Request nghiệp vụ tới NestJS Render vẫn có thể chờ; đăng nhập provider thành công không có nghĩa provision tài khoản EruSentia và tải cộng đồng đã hoàn tất.

## 5. Lựa chọn auth dưới ràng buộc mới

| Lựa chọn | Vai trò đề xuất |
|---|---|
| Giữ auth hiện tại trên Render, hoàn thiện cold-start UX | Ít thay đổi nhất, phù hợp demo free; chấp nhận chờ khi dùng cloud |
| Keycloak local | Học, thử realm/client/role và chuẩn bị kiến trúc dài hạn; không coi là auth hosted khi máy dev tắt |
| Keycloak trên một Render Free thứ hai | Chỉ PoC nếu thật sự cần; thêm cold start, quota chung và gánh vận hành; không chốt làm đích UX |
| Managed auth/serverless auth | Đánh giá để giảm phụ thuộc Render lúc login; là thay đổi kiến trúc so với Keycloak, cần lựa chọn tường minh |

Neon hiện công bố Managed Better Auth trong danh mục free và hỗ trợ Google/GitHub/Microsoft, nên đáng làm một PoC vì dự án đã dùng Neon. Tuy nhiên đây **không phải Keycloak**; cần đánh giá token/session, mapping user cũ, Electron và quản trị role. Shared Google credentials chỉ cho development; production cần OAuth credential riêng. Production checklist còn yêu cầu thiết lập email provider phù hợp. Chưa kết luận đây là giải pháp “không cấu hình, không SMTP, miễn phí mãi”. [Neon pricing](https://neon.com/pricing), [OAuth](https://neon.com/docs/auth/guides/setup-oauth), [Production checklist](https://neon.com/docs/auth/production-checklist).

Không đổi sang một dịch vụ chỉ vì có chữ “free”: Supabase Free công bố pause sau một tuần inactivity; Auth0 công bố xóa tenant Free không hoạt động liên tục 150 ngày. Cloud-IAM có mục Freemium nhưng FAQ mô tả dùng một tháng; Phase Two ghi hạ tầng realm free/shared là mô hình trước đây. Những lựa chọn này không chứng minh điều kiện bỏ không vô hạn. [Supabase](https://supabase.com/pricing), [Auth0 inactivity](https://support.auth0.com/center/s/article/tenant-unban-request), [Cloud-IAM](https://documentation.cloud-iam.com/faq/billing.html), [Phase Two](https://phasetwo.io/docs/self-service/deployments/).

## 6. Nếu không bao giờ quản trị dự án nữa

Không thể hứa phần cloud giữ nguyên mãi, kể cả còn source trong Git. Hai ví dụ ngay trong luồng OAuth:

- Google công bố tự xóa OAuth client không hoạt động trong sáu tháng. Có người dùng đăng nhập thực tế khác với chủ dự án không mở dashboard; cần xét activity của client, không chỉ activity của maintainer. [Google OAuth best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices).
- Microsoft client secret có thời hạn tối đa hai năm hoặc ngắn hơn. Certificate/federated credential là hướng khác nhưng không làm cả hệ thống tự hết nghĩa vụ vận hành. [Microsoft credentials](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-credentials).

Khả năng pause/xóa, credential hết hạn, thay đổi quota/điều khoản và sự cố dịch vụ đều là lý do không có cam kết “bỏ mãi vẫn chạy”. Không suy ra một mốc xóa Neon cụ thể khi chưa có chính sách hiện hành xác nhận.

Mục tiêu sản phẩm nên là: **cloud có thể ngừng, dữ liệu người dùng vẫn có đường giữ và sử dụng**. Vault file trên máy, HTML export, bản cài đã tải và bản backup do người dùng giữ giúp giảm phụ thuộc cloud. OPFS/IndexedDB browser vẫn có thể mất khi xóa dữ liệu trình duyệt hoặc do chính sách storage; không coi đó là bản backup duy nhất.

Backup DB và realm phải có bản ngoài nhà cung cấp tương ứng. Automation giúp giảm thao tác, nhưng cũng dùng credential/quota và có thể ngừng, nên không biến thành bảo đảm lưu trữ vô thời hạn.

## 7. Quyết định triển khai hiện tại

Ưu tiên theo thứ tự: không kích hoạt thanh toán; giữ local-first; dùng domain nền tảng đang có; cải thiện chờ/lỗi của API; chỉ thêm auth mới sau khi chứng minh được cả quota, credential, UX và chính sách inactivity. Keycloak vẫn là mục tiêu nghiên cứu, chưa là điều kiện bắt buộc để App chạy hosted.

Microsoft cần thẩm định riêng: hướng dẫn App registration hiện yêu cầu Azure subscription hoạt động, tenant và quyền phù hợp. Không hứa tài khoản Outlook bất kỳ sẽ tạo đủ credential mà không qua thiết lập subscription/billing. [Microsoft App registration](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).

Những điểm cần kiểm tra trên tài khoản thật khi triển khai: plan hiện tại, billing linkage, quota còn lại, vùng triển khai, callback URL và hạn secret. Nếu dashboard đòi thêm thẻ hoặc nâng plan, dừng ở bước đó và đánh giá phương án khác; không tự bật gói trả phí.
