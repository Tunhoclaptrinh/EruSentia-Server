# Redis cache cho Template public — tuần 5

## Phạm vi và kết nối

GET /templates/:id dùng cache-aside khi CACHE_ENABLED=true. PostgreSQL là nguồn sự
thật; chỉ cache projection public có HTML/JSON. Không cache private, user/session/
JWT/refresh token, list hoặc errors. Body API giữ nguyên; thêm header X-Cache.
App chưa tích hợp API. Redis client 5.12.1 được chọn để phù hợp TypeORM 0.3.31.

Compose cache riêng chạy Redis 8.10.3, localhost:6379, 128 MB/allkeys-lru, tắt RDB/AOF.
Chỉ dành dev local; chưa ACL/TLS/cluster. API không dùng Redis để thay PostgreSQL auth.
CACHE_ENABLED=false mặc định; bật cache yêu cầu postgres + migration 07.

## Đọc và quyền

1. Global guard xác thực JWT, user/session hiện tại.
2. Đọc metadata nhẹ (author/isPublic/revision) từ PostgreSQL. Thiếu/deleted/private
   của người khác trả 404 trước Redis.
3. Private được phép đọc thì full query, BYPASS_PRIVATE, không lưu Redis.
4. Public: GET key namespace:template:v1:id:revision. HIT trả projection đã kiểm tra
   shape; MISS đọc DB, kiểm tra lại revision rồi SET EX với TTL.
5. Redis lỗi/không ready/timeout: full DB query, BYPASS_REDIS. DB lỗi không phục vụ
   dữ liệu bằng quyền đã cache. Cache-Control:no-store của HTTP vẫn giữ nguyên.

HIT bỏ full projection query, không bỏ truy vấn quyền/revision và guard. Trade-off
này giữ privacy khi public/private đổi hoặc cache chưa invalidated. Không cache kết
quả 404; penetration vẫn có thể gây metadata DB lookups, cần rate limiting/thiết kế
khác trước production. UUID pipe loại input sai trước service.

## Invalidation và race

Migration 07 thêm UUID cache_revision, default gen_random_uuid và BEFORE UPDATE
trigger đổi revision. Trigger áp cho PATCH, soft-delete và SQL writes trực tiếp;
không phụ thuộc timestamp độ phân giải milliseconds hoặc Redis INCR lúc broker lỗi.
Cột không xuất hiện trong DTO. Không bật synchronize/auto migration.

PATCH/DELETE lấy stamp trước mutation, ghi DB rồi DEL key cũ. DEL thất bại không
làm rollback business write: lần đọc sau dùng revision mới từ DB nên không chọn key
cũ. Entry cũ tự hết TTL/evict. Miss kiểm tra lại revision trước SET để giảm stale fill;
write sau bước kiểm tra vẫn chỉ fill vào key revision cũ, không đầu độc revision mới.

GET đã đọc quyền trước một mutation có thể hoàn tất với snapshot trước mutation;
không hủy request đang chạy hoặc cam kết linearizable toàn bộ HTTP. Category name/
slug không có API update trong bài; thay category qua SQL ngoài luồng cache có thể
còn projection cũ tới TTL nếu không đổi template revision.

## TTL, miss và outage

TTL mặc định base 60 + jitter nguyên 0–11 giây; SET EX atomic, không dùng SET rồi
EXPIRE tách riêng. Nhiều expiry lệch nhau giảm avalanche, không triệt tiêu stampede.
Single-flight gộp full load cùng key trong một process (COALESCED); mỗi request vẫn
check quyền. Chưa có distributed lock, giới hạn số unique keys đang load hoặc
protection toàn hệ thống khi Redis outage. DB cần đủ tải fallback.

Client disableOfflineQueue, giới hạn queue 100 commands, connect timeout 250 ms,
command abort 200 ms, reconnect backoff tới 1 giây. Startup chờ tối đa khoảng 300 ms
rồi phục vụ degraded; connection retries chạy nền. Shutdown destroy client để không
để reconnect giữ process. Error handler không log Redis URL/credential.

Corrupt JSON/schema bị bỏ và rebuild; cache không mang credential. Redis server là
thành phần tin cậy của backend, không public endpoint. Không coi validation payload
là thay thế ACL/TLS hoặc chống một Redis server bị kiểm soát hoàn toàn.

## Demo data types và Sorted Set

pnpm cache:types đọc top 5 public templates theo views_count trong DB đã chọn:
String title, Hash metadata, List IDs, Set category IDs, Sorted Set score=views_count.
Dùng MULTI/EXEC để đặt cấu trúc + TTL, rồi đọc bằng GET/HGETALL/LRANGE/SMEMBERS và
ZRANGE REV WITHSCORES. Scratch namespace UUID riêng, DEL sau demo. Không FLUSHDB.

Sorted Set demo thể hiện ranking từ dữ liệu EruSentia thật; chưa có endpoint ranking
hoặc cơ chế đồng bộ leaderboard thành một tính năng App. GET Template không tự tăng
views_count. List trong demo không thay RabbitMQ của tuần 4.

## Kiểm thử và đo

pnpm test:cache cần RUN_CACHE_TESTS=1, DB mới/rỗng week5_test_* và Redis đang chạy.
Suite tự nạp 01/02/03/05/07 và áp 07 hai lần; test privacy, version/DEL, SQL update,
TTL, corruption, single-flight, startup outage, client disconnect và delete. Namespace
riêng được dọn, DB do người chạy tạo/drop. Các test race có gate/delay có kiểm soát,
không phải số đo latency sản phẩm.

pnpm cache:benchmark chỉ chấp nhận DB week5_test_* đã nạp các SQL trên. Script tạo
user/template demo, chạy hai API cùng PostgreSQL/key JWT: cache bật và tắt. 5 warmup,
40 samples mỗi mode disabled/hit xen kẽ, 20 cold misses bằng DEL đúng key. Đo HTTP
bằng performance.now, gồm guard, Redis/DB, serialize và đọc hết body; concurrency=1.
Không thêm delay DB để làm cache có vẻ nhanh hơn. Không in token/password hoặc raw
HTML. Mean/median/p95 chỉ mô tả lượt local này, không phải load test/production SLO.
Script dọn cache keys và đóng hai API; dữ liệu benchmark nằm trong DB test để drop.

Nguồn: [Redis cache-aside](https://redis.io/docs/latest/develop/use-cases/cache-aside/),
[node-redis](https://redis.io/docs/latest/develop/clients/nodejs/connect/),
[SET](https://redis.io/docs/latest/commands/set/),
[data types](https://redis.io/docs/latest/develop/data-types/),
[sorted sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/).
