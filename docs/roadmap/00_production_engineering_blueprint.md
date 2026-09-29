# ⚡ KIẾN TRÚC TỐI ƯU CÙNG CỰC & CHUẨN GO-TO-MARKET (GTM)
## *Triết lý TikTok: Giao diện tối giản bề ngoài — Cỗ máy tối ưu hóa đến cùng cực bên trong*

> **Định vị:** Dự án không dừng lại ở bài tập nộp khóa học TYP 2026. Đây là nền tảng Backend thương mại hóa (Production-Ready) của EruSentia:  
> - Bề ngoài là các API lưu trữ, chia sẻ template/document cực kỳ đơn giản, trực quan.  
> - Bên dưới là một hệ thống được thiết kế chịu tải cao, độ trễ sub-millisecond, có khả năng mở rộng (scalable) và chịu lỗi (resilient) như một cỗ máy công nghiệp.

---

## 🏛️ 1. KIM TỰ THÁP KIẾN TRÚC "TIKTOK-STYLE" CHO ERUSENTIA

```
┌────────────────────────────────────────────────────────────────────────┐
│ 📱 BỀ NGOÀI: TỐI GIẢN & TRỰC QUAN (Minimalist Public Interface)        │
│    - RESTful API Level 3 / OpenAPI 3.1 sạch sẽ                         │
│    - Định dạng response đồng nhất: { success, data, meta, timestamp }   │
│    - Client SDK (cloudService.ts) chỉ cần gọi 1 hàm là xong            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ ⚙️ BÊN TRONG: CỖ MÁY KỸ THUẬT TỐI ƯU ĐẾN CÙNG CỰC (Extreme Backend Engine)│
├────────────────────────────────────────────────────────────────────────┤
│ 1. LAYER GIAO TIẾP & BẢO VỆ (Edge & Gateway)                           │
│    • Rate Limiting: Sliding window log trên Redis (Chống DDoS/Spam)     │
│    • Request ID Correlation: X-Request-ID xuyên suốt Log và Message Q  │
│    • Circuit Breaker & Timeout: Chống nghẽn dây chuyền (Cascading Fail)│
├────────────────────────────────────────────────────────────────────────┤
│ 2. LAYER BỘ NHỚ ĐỆM ĐA TẦNG (Multi-Tier Caching)                       │
│    • L1 In-Memory Cache (Process level): 0.05ms cho hot-configs        │
│    • L2 Redis Cache Cluster: 1-2ms với chiến lược Stale-While-Revalidate│
│    • Redis Lua Scripting: Tăng counter view/fork nguyên tử (Atomic)    │
├────────────────────────────────────────────────────────────────────────┤
│ 3. LAYER XỬ LÝ SỰ KIỆN BẤT ĐỒNG BỘ (Event-Driven & Messaging)          │
│    • RabbitMQ Pipeline: Tách biệt I/O nặng ra khỏi luồng request chính  │
│    • Idempotent Consumer: Chống duplicate message 100% bằng Redis Lock │
│    • Dead Letter Exchange (DLX) + Exponential Backoff: Tự phục hồi lỗi  │
│    • Batching Worker: Gom 500 lượt view/rating rồi Bulk Insert DB 1 lần │
├────────────────────────────────────────────────────────────────────────┤
│ 4. LAYER DỮ LIỆU & TRUY VẤN TỐC ĐỘ CAO (PostgreSQL Engine)             │
│    • Connection Pooling qua PgBouncer: Chịu 10,000+ client kết nối     │
│    • Composite Partial Indexing: Query thời gian thực < 2ms             │
│    • Full-text Search với GIN Index + tsvector (Không cần Elasticsearch)│
│    • Table Partitioning: Phân vùng bảng audit_logs & notifications theo │
│      tháng, tránh phình to DB theo năm                                 │
├────────────────────────────────────────────────────────────────────────┤
│ 5. LAYER LÕI BẢO TOÀN (Domain Purity - Clean Architecture / Hexagonal)  │
│    • Domain Entity thuần TypeScript: Zero framework dependency         │
│    • Đổi ORM từ TypeORM sang Prisma hoặc Kysely chỉ trong 1 nốt nhạc    │
│    • 100% Unit test chạy trong < 2 giây                                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 2. CHI TIẾT 6 TRỤ CỘT TỐI ƯU CÙNG CỰC

### TRỤ CỘT 1: DATABASE POSTGRESQL TỐI ƯU ĐẾN TỪNG BYTE

1. **Composite Partial Indexes (Chỉ mục kết hợp có điều kiện):**
   - Thay vì index toàn bộ bảng, chỉ index các bản ghi `deleted_at IS NULL` và `is_public = TRUE`.
   - **Hiệu quả:** Giảm 60% dung lượng RAM của Index, tốc độ index traversal tăng gấp 4 lần.
   ```sql
   -- Index tối ưu tối đa cho màn hình Explore Template hot nhất
   CREATE INDEX idx_templates_hot_active 
   ON templates (category_id, rating_avg DESC, forks_count DESC)
   WHERE deleted_at IS NULL AND is_public = TRUE;
   ```

2. **Full-Text Search bản địa bằng GIN Index:**
   - Sử dụng `to_tsvector('simple', title || ' ' || description)` với GIN Index.
   - Không cần dựng cluster Elasticsearch tốn RAM trong giai đoạn đầu nhưng vẫn đạt tốc độ tìm kiếm < 5ms trên 100,000 bản ghi.

3. **PgBouncer & Connection Pooling:**
   - Mặc định NestJS mở kết nối trực tiếp đến PostgreSQL rất dễ nghẽn (Connection Exhaustion).
   - Thiết lập Transaction-level pooling: Phục vụ hàng nghìn request đồng thời với chỉ 20-50 backend connection vào PostgreSQL.

4. **Table Partitioning (Phân vùng sẵn sàng cho hàng chục triệu bản ghi):**
   - Bảng `audit_logs` và `notifications` được phân vùng theo tháng (`PARTITION BY RANGE (created_at)`).
   - Khi cần dọn dẹp data cũ (sau 1 năm), chỉ cần `DROP TABLE audit_logs_2025_01` (tốn 1 mili-giây) thay vì chạy lệnh `DELETE FROM ...` gây khóa bảng và làm chậm hệ thống.

---

### TRỤ CỘT 2: REDIS ĐA NHIỆM & CƠ CHẾ ATOMIC NON-BLOCKING

1. **Atomic Counter qua Redis Pipelining & Lua Script:**
   - Vấn đề kinh điển: 10,000 người cùng bấm "Xem" hoặc "Fork" template cùng một giây. Nếu ghi trực tiếp vào DB `UPDATE templates SET view_count = view_count + 1`, DB sẽ bị lock hàng loạt (Row-level lock contention).
   - **Giải pháp tối ưu:** Tăng counter trên Redis bằng lệnh `HINCRBY` (mất 0.1ms). Định kỳ mỗi 10 giây, một background worker gom số liệu và ghi đồng loạt vào DB một lần (Batch update).

2. **Chiến lược Caching "Stale-While-Revalidate" (SWR):**
   - Khi cache hết hạn, thay vì bắt người dùng tiếp theo phải chờ gọi DB (gây hiện tượng Cache Stampede / Thundering Herd):
   - Hệ thống trả ngay dữ liệu cũ (stale data trong 1ms) cho user đó, đồng thời kích hoạt 1 background task lấy dữ liệu mới từ DB nạp vào cache. User không bao giờ phải chịu độ trễ của DB!

3. **Leaderboard với Redis Sorted Set (`ZSET`):**
   - Bảng xếp hạng Top Templates được lưu trong `ZSET` với score là chỉ số `(forks * 3) + (ratings_count * 2) + views`.
   - Lấy Top 10: `ZREVRANGE top_templates 0 9 WITHSCORES` chạy trong **O(log(N) + M) ≈ 0.3ms**, bất kể hệ thống có 100,000 template.

---

### TRỤ CỘT 3: HÀNG ĐỢI RABBITMQ KHÔNG ĐÁNH RƠI DỮ LIỆU (ZERO-DATA-LOSS)

1. **Idempotent Consumers (Chống xử lý trùng lặp):**
   - Mọi message đều có `message_id` hoặc `idempotency_key`.
   - Consumer trước khi xử lý sẽ ghi key vào Redis (`SET key 1 EX 86400 NX`). Nếu key đã tồn tại -> bỏ qua ngay. Không bao giờ gửi 2 email hoặc cộng điểm rating 2 lần.

2. **Dead Letter Exchange (DLX) & Exponential Backoff Retry:**
   - Nếu worker bị lỗi (ví dụ dịch vụ email bên thứ 3 down): Message không bị vứt bỏ, mà tự động bay vào Retry Queue với thời gian chờ tăng dần: 2s -> 10s -> 60s.
   - Thử lại 3 lần thất bại -> chuyển vào `dead_letter_queue` để kỹ sư kiểm tra, không gây tắc nghẽn luồng xử lý chính.

---

### TRỤ CỘT 4: CLEAN ARCHITECTURE & TÍNH TIỆN HÓA (EXTENSIBILITY)

Kiến trúc được tổ chức theo triết lý **Hexagonal / Ports & Adapters**:

```
[ HTTP Controller / CLI / WebSocket ]  (Driving Adapters)
                  │
                  ▼
         [ Use Case / Service ]         (Application Core)
                  │
                  ▼
      ┌───────────────────────┐
      │  Pure Domain Entity   │        (Không dính NestJS, TypeORM)
      │  & Business Rules     │
      └───────────────────────┘
                  │
                  ▼
         [ Repository Interface ]       (Output Ports)
                  │
                  ▼
[ TypeORM / Prisma / Redis / RabbitMQ ] (Driven Adapters)
```

- **Lợi ích tối cao:**
  - Nếu sau này muốn đổi từ TypeORM sang **Prisma** hoặc **Kysely (chạy SQL thuần siêu tốc)**: Bạn **chỉ cần viết lại 1 file adapter**, không phải sửa lại bất kỳ dòng code nghiệp vụ nào trong Domain hay Use Case.
  - Tách từ Modular Monolith sang Microservices: Chỉ cần biến Use Case thành gRPC / RabbitMQ RPC, logic vẫn nguyên vẹn 100%.

---

### TRỤ CỘT 5: OBSERVABILITY & SYSTEM DEFENSE (CHUẨN GTM)

1. **Correlation ID (`X-Request-ID`):**
   - Mọi request vào hệ thống đều được cấp 1 mã UUID duy nhất.
   - Mã này được in vào toàn bộ Log (JSON format), truyền qua RabbitMQ message header, và trả về cho Client.
   - Khi có lỗi ở bất kỳ khâu nào, chỉ cần gõ mã này vào hệ thống log là tìm thấy toàn bộ hành trình của request trong 1 giây.

2. **Graceful Shutdown (Không bao giờ ngắt ngang request của khách):**
   - Khi deploy bản mới trên production: Container nhận tín hiệu `SIGTERM`.
   - Hệ thống tự động:
     1. Ngừng nhận request mới từ Load Balancer.
     2. Đợi tất cả request đang chạy dở hoàn thành (tối đa 15s).
     3. Đợi RabbitMQ consumer xử lý xong message hiện tại rồi đóng kết nối DB sạch sẽ.
     4. Tắt an toàn (Zero dropped connections).

3. **Health Check Probes chuẩn Kubernetes / Docker Swarm:**
   - `/health/liveness`: Container còn sống không?
   - `/health/readiness`: Đã kết nối được PostgreSQL và Redis chưa? Nếu chưa -> Load balancer không điều hướng user vào.

---

## 📈 3. BẢNG SO SÁNH: CODE HỌC VIÊN BÌNH THƯỜNG vs HỆ THỐNG GTM ERUSENTIA

| Hạng mục | Làm cho xong bài tập (Amateur) | Chuẩn Go-To-Market của EruSentia (Elite) |
|---|---|---|
| **Query Data** | `SELECT * FROM templates` không index | Composite Partial Index, EXPLAIN ANALYZE < 2ms |
| **Tìm kiếm** | `LIKE '%keyword%'` gây Full Table Scan | GIN Index tsvector tiếng Việt/Anh cực nhanh |
| **Ghi nhận View** | Mỗi click chạy 1 lệnh `UPDATE ... SET views = views + 1` | Redis In-memory Buffering + Batch Worker ghi đồng loạt |
| **Bảng xếp hạng** | `ORDER BY forks DESC` quét toàn bộ bảng | Redis Sorted Set (`ZSET`) lấy O(1) ~0.3ms |
| **Lỗi ngoài ý muốn** | Nuốt lỗi hoặc trả về 500 kèm stacktrace lộ code | RFC 7807 Problem Details, Filter chuẩn, ẩn bí mật |
| **Mất kết nối DB** | Server sập, request treo vô tận | Connection Pool PgBouncer + Circuit Breaker tự ngắt |
| **Mở rộng tương lai** | Phải đập đi viết lại toàn bộ | Clean Architecture: swap DB/Queue trong vài giờ |

---

## 🧭 4. CÁCH ỨNG DỤNG VÀO TỪNG TUẦN HỌC TYP

Bạn không cần phải làm tất cả những thứ trên ngay trong ngày đầu tiên, mà sẽ tích lũy theo từng tuần đúng với lộ trình TYP:
- **Tuần 1:** Thiết kế bảng chuẩn, phân vùng partition, composite index, partial index (Đạt chuẩn DB tối ưu).
- **Tuần 2:** Clean Architecture 4 tầng, DTO validation chặt chẽ, Response envelope chuẩn production.
- **Tuần 3:** JWT kèm Blacklist Token trên Redis, Refresh Token Rotation an toàn chống đánh cắp.
- **Tuần 4:** RabbitMQ Dead Letter Exchange, Batching view counter worker.
- **Tuần 5:** Redis Caching SWR, Leaderboard ZSET, Pipelining.
- **Tuần 6:** Dockerfile multi-stage build siêu nhẹ (dưới 150MB), PgBouncer, Health check probes.

👉 **Kết luận:** Bên ngoài bạn chỉ nộp một module backend Template Marketplace & Document Hub cho mentor. Nhưng bên trong là **bộ khung hạ tầng vững chắc như bàn thạch**, sẵn sàng phục vụ hàng triệu người dùng khi bạn chính thức thương mại hóa EruSentia!
