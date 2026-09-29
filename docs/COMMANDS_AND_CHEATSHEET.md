# 🛠️ CẨM NANG LỆNH & SỔ TAY KIẾN THỨC BACKEND (CHEATSHEET)
> Tổng hợp các lệnh thực chiến thường dùng nhất: Docker, PostgreSQL, Node/TypeScript, Git và các nguyên lý Clean Architecture.

---

## 🐳 1. BỘ LỆNH DOCKER THỰC CHIẾN

| Lệnh | Ý nghĩa & Mục đích sử dụng |
|---|---|
| `docker compose -f docker/docker-compose.dev.yml up -d` | **Khởi động:** Tải image, tạo container và chạy ngầm PostgreSQL + Adminer |
| `docker compose -f docker/docker-compose.dev.yml down` | **Dừng:** Tắt toàn bộ container (dữ liệu DB vẫn an toàn trong volume) |
| `docker compose -f docker/docker-compose.dev.yml ps` | **Kiểm tra trạng thái:** Xem container nào đang chạy, port nào được mở |
| `docker compose -f docker/docker-compose.dev.yml logs -f postgres` | **Xem log trực tiếp:** Theo dõi câu lệnh SQL và lỗi kết nối của Postgres |
| `docker compose -f docker/docker-compose.dev.yml down -v` | ⚠️ **Reset hoàn toàn:** Xóa cả container lẫn dữ liệu trong volume (dùng khi muốn làm mới DB từ đầu) |

### 💻 Vào thẳng dòng lệnh PostgreSQL bên trong Container:
```bash
docker exec -it sentia_postgres_dev psql -U postgres -d sentia_hub_db
```

---

## 🐘 2. BỘ LỆNH POSTGRESQL CLI (`psql`) TIỆN DỤNG

Khi đã ở trong giao diện `psql` (có dấu nhắc lệnh `sentia_hub_db=#`):

| Lệnh tắt | Tác dụng |
|---|---|
| `\dt` | Liệt kê tất cả các bảng trong database hiện tại |
| `\d templates` | Xem cấu trúc chi tiết của bảng `templates` (cột, kiểu dữ liệu, khóa ngoại, chỉ mục) |
| `\di` | Liệt kê danh sách tất cả các Indexes |
| `\l` | Liệt kê tất cả cơ sở dữ liệu trên máy chủ |
| `\c sentia_hub_db` | Chuyển sang kết nối database `sentia_hub_db` |
| `\timing` | Bật/tắt chế độ hiển thị thời gian chạy query (ms) sau mỗi câu lệnh |
| `\q` | Thoát khỏi psql quay lại terminal |

---

## ⚡ 3. ĐỌC VÀ TỐI ƯU CÂU LỆNH SQL VỚI `EXPLAIN ANALYZE`

Để chứng minh với Mentor rằng query của bạn tối ưu:
```sql
EXPLAIN ANALYZE
SELECT id, title, rating_avg, forks_count
FROM templates
WHERE deleted_at IS NULL AND is_public = TRUE
ORDER BY rating_avg DESC, forks_count DESC
LIMIT 10;
```

### 🧠 Cách đọc kết quả trả về từ Postgres:
1. **`Seq Scan` (Sequential Scan):** Postgres phải quét từng dòng một từ đầu đến cuối bảng.  
   ➔ *Dấu hiệu:* Thiếu index hoặc bảng quá nhỏ (Postgres tự chọn quét tuần tự vì nhanh hơn nạp index).
2. **`Index Scan` / `Bitmap Index Scan`:** Postgres dùng cây chỉ mục B-Tree để nhảy thẳng tới dữ liệu.  
   ➔ *Dấu hiệu:* Tối ưu rất tốt, thời gian thực thi thường `< 2ms`.
3. **`Execution Time:`** Thời gian thực tế câu lệnh thực thi (Ví dụ: `Execution Time: 0.851 ms`). Đây là con số quan trọng nhất để đưa vào báo cáo tuần!

---

## 🚀 4. CÁC SCRIPTS CỦA DỰ ÁN (`npm run ...`)

| Lệnh | File thực thi | Chức năng |
|---|---|---|
| `npm run dev` | `src/main.ts` | Bật server phát triển (tự động reload khi sửa code qua `tsx`) |
| `npm run build` | `tsconfig.json` | Biên dịch TypeScript ra mã JavaScript thuần trong thư mục `dist/` |
| `npm run db:schema` | `sql/01_schema.sql` | Chạy kịch bản tạo 8 bảng quan hệ vào Database |
| `npm run db:indexes` | `sql/02_indexes.sql` | Đánh các chỉ mục Composite Partial & GIN Full-text Search |
| `npm run db:seed` | `sql/03_seed.sql` | Nạp dữ liệu giả lập sạch vào DB để test |
| `npm run db:benchmark`| `scripts/benchmark.ts` | Chạy lệnh đo lường hiệu năng query bằng `EXPLAIN ANALYZE` |

---

## 🏛️ 5. GHI NHỚ NGUYÊN TẮC CLEAN ARCHITECTURE & OOP

### 1. Tính Đóng Gói (Encapsulation):
- Mọi thuộc tính trong Domain Entity phải là `private` hoặc `protected` (Ví dụ: `private _ratingAvg: number`).
- Không cho phép gán trực tiếp: `template.ratingAvg = 10` (sai nghiệp vụ).
- Phải thông qua phương thức nghiệp vụ: `template.addRating(score)`. Phương thức này tự kiểm tra tính hợp lệ (`1 <= score <= 5`) và tính lại trung bình.

### 2. Bất Biến Nghiệp Vụ (Invariants):
- Một Entity khi sinh ra qua `new Template(...)` phải đảm bảo luôn ở trạng thái hợp lệ. Nếu tiêu đề dưới 3 ký tự ➔ ném ra lỗi ngay tại constructor.

### 3. Repository Pattern (Port & Adapter):
- **Tầng Domain:** Chỉ định nghĩa Interface `ITemplateRepository` (Nói rằng: "Tôi cần các hàm tìm kiếm, lưu trữ này").
- **Tầng Infrastructure:** Chịu trách nhiệm viết code kết nối với PostgreSQL/TypeORM để thực thi Interface đó.
- *Lợi ích:* Khi đổi từ PostgreSQL sang MongoDB hay Prisma, chỉ sửa tầng Infrastructure, 100% logic ở Domain không bị ảnh hưởng.
