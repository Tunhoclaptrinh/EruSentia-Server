# Backend demo miễn phí và phát hành App

Cập nhật 05/11/2026. Hướng dẫn triển khai demo có kiểm soát; chưa phải nghiệm thu
production. Không cần đưa repo App riêng tư lên máy chủ backend.

## Chọn nơi chạy

**Đề xuất Oracle Cloud Always Free VM** cho stack hiện tại: API NestJS, PostgreSQL,
RabbitMQ, worker, Redis và Mailpit. Dùng Docker Compose cùng Caddy để giữ kiến trúc
đã học và có HTTPS. Đây là đề xuất theo nhu cầu tài nguyên; vẫn cần kiểm tra image
và chạy smoke test trên VM ARM thực tế.

| Lựa chọn | Phạm vi phù hợp | Giới hạn cần biết |
|---|---|---|
| Oracle Always Free A1 | Cả stack trên một VM, tự quản lý | Tài liệu hiện ghi tổng tương đương 2 OCPU/12 GB, block storage tổng 200 GB; phải đúng home region/quota, có thể hết capacity hoặc thu hồi máy ít hoạt động. |
| Koyeb Free + Neon Free | Demo API nhỏ, sau khi cấu hình TLS PostgreSQL và giảm phạm vi | Koyeb: 512 MB, 0.1 vCPU, không worker/volume, ngủ sau 1 giờ không có traffic. Neon: 100 CU-giờ và 1 GB/project/tháng. Chưa có cấu hình triển khai này trong repo. |
| Railway Free | Thử nghiệm ngắn, không khuyến nghị cho cả stack chạy liên tục | Sau trial, Free có $1 credit/tháng; không bảo đảm đủ stack này. |

Đối chiếu giới hạn trước khi tạo dịch vụ: [Oracle Always Free](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm),
[Koyeb Free](https://www.koyeb.com/docs/reference/instances), [Neon pricing](https://neon.com/pricing),
[Railway trial/Free](https://docs.railway.com/pricing/free-trial).
Chỉ chọn tài nguyên có nhãn Always Free và kiểm tra tổng dự toán; không nhầm credit
trial với miễn phí dài hạn. Nếu không có capacity miễn phí thì chờ hoặc chọn lại
phương án, không cần nâng gói trả phí để làm theo hướng dẫn này.

## 1. VM, tên miền và Docker

1. Tạo Ubuntu VM A1 trong **home region**, chọn cấu hình nằm trong quota Always Free
   đang hiển thị ở Console. Một VM 2 OCPU/12 GB là mức khởi đầu nếu quota cho phép.
   Giữ boot disk và mọi block volume trong tổng giới hạn miễn phí.
2. Dùng SSH key. Mở TCP 22 chỉ từ IP quản trị; TCP 80/443 cho web trong OCI
   security list/NSG và firewall của VM. Các cổng DB, Redis, AMQP, Mailpit và API
   3001 giữ loopback như Compose, không thêm ingress public cho chúng.
3. Trỏ DNS A của hostname API đến IPv4 public của VM. Có thể dùng hostname miễn phí
   từ [DuckDNS](https://www.duckdns.org/spec.jsp); giữ token DNS riêng tư. Nếu IP VM
   đổi, cập nhật DNS trước khi kiểm tra lại HTTPS.
4. Cài Docker Engine/Compose theo [hướng dẫn Ubuntu chính thức](https://docs.docker.com/engine/install/ubuntu/).
   Kiểm tra `docker info` và `docker compose version`. Các lệnh dưới giả sử tài khoản
   SSH đã được phép chạy Docker. Không cần cài pnpm trên VM: image cài pnpm đã ghim.

Caddy cần DNS đúng và cổng 80/443 truy cập được để tự cấp/gia hạn chứng chỉ;
xem [Automatic HTTPS](https://caddyserver.com/docs/automatic-https).

## 2. Checkout và cấu hình riêng

Chạy trên VM mới, trong repo server; không dùng database/volume dev để đưa lên public.

```bash
git clone https://github.com/Tunhoclaptrinh/EruSentia-Server.git erusentia-server
cd erusentia-server
git switch main
git rev-parse HEAD                 # ghi lại commit triển khai
cp docker/.env.hosted.example docker/.env.hosted.local
chmod 600 docker/.env.hosted.local
```

Sinh ba secret riêng bằng `openssl rand -hex 32` (chạy ba lần), điền vào
`PROJECT_DB_PASSWORD`, `PROJECT_RABBIT_PASSWORD`, `PROJECT_JWT_SECRET` trong file
local. Điền `HOSTED_API_DOMAIN`, ví dụ `eru-demo-cua-ban.duckdns.org`. Dùng hex để
mật khẩu queue không cần URL-encode. Không commit file local hoặc gửi secret vào báo cáo.

`PROJECT_CORS_ORIGINS` là origin web chính xác, ví dụ
`https://tunhoclaptrinh.github.io`, **không** gồm `/EruSentia/app/`. Nhiều origin
phân cách bằng dấu phẩy. Có thể đặt rỗng nếu chỉ dùng Electron qua bridge.
`HOSTED_SWAGGER_ENABLED=false` mặc định; bật `true` khi muốn công khai Swagger
demo tại `/docs`, sau đó recreate API. Swagger vẫn cần Bearer token cho API có bảo vệ.

Tạo hàm ở terminal, luôn đứng tại thư mục repo server khi dùng:

```bash
eru_host() {
  docker compose --project-directory "$PWD" \
    --env-file docker/.env.hosted.local --project-name erusentia-hosted \
    -f docker/compose.project.yml -f docker/compose.hosted.yml "$@"
}
eru_host config --quiet &&
eru_host build api &&
eru_host up -d --wait postgres &&
eru_host run --rm --no-deps setup &&
eru_host up -d --no-build --wait --wait-timeout 180 &&
eru_host ps
```

Overlay giữ queue/cache và worker, dùng `NODE_ENV=production`, tắt bootstrap tự động
trên API/worker và **không seed tài khoản mật khẩu mặc định**. `setup` chạy migrations
và seed trung tính: tác giả bị khóa đăng nhập, hai danh mục, ba mẫu public. Tạo tài
khoản cá nhân qua App hoặc `/auth/register`; tài khoản mới là role `user`.
Không có sẵn tài khoản admin/creator trên hosted demo; nếu cần quản trị, đọc luồng
`pnpm auth:admin` trong [AUTHENTICATION.md](AUTHENTICATION.md) và chỉ chạy với DB đã chọn rõ.

Mailpit chỉ nhận thư demo trong mạng Docker, không gửi email ra Internet. Không
coi đây là xác minh email hoặc SMTP production. Xem hộp thư qua SSH tunnel từ máy
cá nhân: `ssh -L 18026:127.0.0.1:8026 ubuntu@IP_VM`, rồi mở
`http://127.0.0.1:18026`. Cổng local 18026 tránh trùng Mailpit của stack dev ở
8026; giữ cửa sổ SSH đang chạy khi xem hộp thư. Không public giao diện Mailpit/RabbitMQ.

## 3. Kiểm tra và nối App

```bash
curl -i https://HOSTNAME_CUA_BAN/auth/me
# Mong đợi 401 JSON khi chưa đăng nhập, chứng chỉ HTTPS hợp lệ.
eru_host logs --tail 100 api worker proxy
```

Đăng ký/đăng nhập, tìm mẫu, xem thử, lưu thư viện, chèn vào ghi chú và mở lại offline.
Kiểm tra đăng ký đi qua outbox/worker/Mailpit và service đều chạy bình thường. Một
response 401 chỉ chứng minh API phản hồi, chưa thay thế các bước nghiệm thu này.

- **Electron đã đóng gói:** đóng hẳn App trước, mở lại với biến môi trường, ví dụ Linux:
  `ERU_API_BASE_URL=https://HOSTNAME_CUA_BAN ./EruSentia-1.1.0-beta.2.AppImage`.
  Chưa có form đổi URL API trong giao diện. Không truyền HTTP public.
- **Web/Pages:** trong repo App → Settings → Secrets and variables → Actions →
  Variables, tạo `ERU_API_BASE_URL=https://HOSTNAME_CUA_BAN`. Chạy lại workflow
  **Deploy GitHub Pages & Release Hub** trên `main`. Workflow truyền biến này thành
  `VITE_ERU_API_BASE_URL` lúc build. URL là cấu hình công khai, không phải secret.
  Nếu để trống, web release chỉ dùng các tính năng local cho đến khi có API được cấu hình.
- Kiểm tra CORS với origin web thực tế. App chưa Cloud Sync ghi chú; tài khoản/catalog
  hoạt động qua API, ghi chú/thư viện vẫn lưu tại thiết bị. Reload web cần đăng nhập lại.

## 4. Cập nhật, sao lưu và dừng

Trước khi đổi phiên bản, tạo backup PostgreSQL và sao chép ra ngoài VM:

```bash
mkdir -p backups
chmod 700 backups
umask 077
eru_host exec -T postgres pg_dump -U eru -d eru_project_docker -Fc > "backups/project-$(date +%Y%m%d-%H%M%S).dump"
```

Kiểm tra exit status, dung lượng backup và thử phục hồi trên database khác trước
khi cần dùng thật. `backups/` được ignore; không đưa dump lên Git. Dữ liệu Caddy
cũng nằm trong named volume để giữ chứng chỉ qua restart.

Đọc thay đổi migration trước, `git pull --ff-only`, rồi lặp lại build → setup → up
như bước 2. Bản demo một máy có thể gián đoạn khi recreate; chưa có zero-downtime
deployment hay rollback migration tự động. Không tự đổi mật khẩu DB/RabbitMQ trong
file với volume đã tồn tại: phải đổi credential của dịch vụ có chủ đích trước.

`eru_host stop` tạm dừng, `eru_host down` gỡ container/network nhưng giữ volume.
Không dùng `down -v` khi còn dữ liệu cần giữ. Không dùng launcher `pnpm stack:up`
dev trên VM này: launcher đó bật bộ tài khoản demo.

## Mốc nghiệm thu

Repo có overlay, template env và hướng dẫn; CI kiểm tra Compose hợp lệ, không
in secret. Chưa cấp VM/domain, chưa chạy build ARM hoặc cấp HTTPS trên OCI trong
đợt này. Chỉ đánh dấu hosted demo hoạt động sau khi thực hiện đầy đủ bước 3.
Rate limiting, giám sát, SMTP thật, chính sách đăng ký/kiểm duyệt và sao lưu định kỳ
cần hoàn thành trước khi mở dịch vụ production cho cộng đồng.
