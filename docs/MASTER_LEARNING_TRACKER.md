# 🎓 BẢNG TỔNG HỢP TIẾN ĐỘ HỌC TẬP & BÁO CÁO (MASTER LEARNING TRACKER)
> Dự án: **Sentia Hub — Cloud Community Service**  
> Khóa đào tạo: **TYP 2026 — Web Backend Roadmap**  
> Định vị: **Xây dựng Nền tảng Cloud Backend Chuẩn Go-To-Market cho EruSentia**

---

## 📊 1. MA TRẬN TIẾN ĐỘ 6 TUẦN (WEEKLY SCOREBOARD)

| Tuần | Chủ đề đào tạo TYP | Module Backend EruSentia | Trạng thái | File Báo Cáo Chi Tiết |
|:---:|---|---|:---:|:---:|
| **W1** | **Cơ sở dữ liệu & Lập trình hướng đối tượng (OOP)** | **Schema 8 bảng 3NF + Partial Indexes + Domain Models** | 🟢 **Hoàn thành** | [week_01_report.md](./reports/week_01_report.md) |
| **W2** | **Framework, RESTful API & ORM** | **Template Marketplace API + Document Hub API (30+ endpoints)** | 🟡 *Sắp tới* | `docs/reports/week_02_report.md` |
| **W3** | **Xác thực & Phân quyền (Auth & RBAC)** | **Hệ thống Creator/User/Admin (JWT, Refresh Token Rotation)** | ⚪ *Kế hoạch* | `docs/reports/week_03_report.md` |
| **W4** | **Hàng đợi thông điệp (Message Queue)** | **RabbitMQ: Notification Engine & View Counter Batching** | ⚪ *Kế hoạch* | `docs/reports/week_04_report.md` |
| **W5** | **Bộ nhớ đệm & Tối ưu (Redis & Caching)** | **Redis Caching SWR + Leaderboard Sorted Set + Rate Limiting** | ⚪ *Kế hoạch* | `docs/reports/week_05_report.md` |
| **W6** | **Dự án tổng hợp & Triển khai (DevOps)** | **Docker Multi-stage, VPS Deployment, CI/CD, k6 Benchmark** | ⚪ *Kế hoạch* | `docs/reports/week_06_report.md` |

---

## 🧭 2. SƠ ĐỒ ĐIỀU HƯỚNG TÀI LIỆU HỆ THỐNG (DOCUMENTATION DIRECTORY)

```
erusentia-server/docs/
│
├── 📖 MASTER_LEARNING_TRACKER.md        ← [FILE NÀY] Trung tâm quản lý toàn bộ tiến độ & tri thức
├── 🛠️ COMMANDS_AND_CHEATSHEET.md         ← Cẩm nang lệnh Docker, psql, EXPLAIN ANALYZE, Git, NPM
├── 🗺️ DATABASE_DESIGN.md                 ← Sơ đồ ERD, thiết kế 8 bảng quan hệ 3NF & chiến lược Indexing
├── 📜 TEMPLATE_CONTRACT.md               ← Đặc tả JSON Schema chuẩn giao tiếp giữa Server và App
│
├── 📂 reports/                           ← Thư mục lưu trữ báo cáo tiến độ nộp Mentor hàng tuần
│   ├── WEEKLY_REPORT_TEMPLATE.md         ← Mẫu báo cáo chuẩn chung
│   └── week_01_report.md                 ← Báo cáo chi tiết Tuần 1: Database & OOP
│
└── 📂 roadmap/                           ← Các tài liệu kiến trúc & kế hoạch gốc
    ├── 00_training_schedule.md           # Lộ trình từ file Excel gốc
    ├── 00_production_engineering_...     # Bản thiết kế kỹ thuật tối ưu cùng cực (GTM)
    ├── 01_master_plan.md                 # Kế hoạch tổng thể 6 tuần
    ├── 02_week1_database.md              # Đề cương chi tiết Tuần 1
    └── 03_week2_api.md                   # Đề cương chi tiết Tuần 2
```

---

## 🏆 3. BẢNG TÍCH LŨY KỸ NĂNG THỰC CHIẾN (SKILLS MASTERY MATRIX)

### 🗄️ Database & Storage:
- [x] Thiết kế lược đồ chuẩn hóa 3NF không dư thừa dữ liệu.
- [x] Sử dụng kiểu dữ liệu hiện đại `JSONB` cho semi-structured payload trong PostgreSQL.
- [x] Kỹ thuật Composite Partial Indexing (`WHERE deleted_at IS NULL AND is_public = TRUE`).
- [x] GIN Indexing kết hợp `to_tsvector` cho Full-text Search bản địa tốc độ cao.
- [x] Đo lường chi phí câu lệnh qua `EXPLAIN ANALYZE` (`Seq Scan` vs `Index Scan`).

### 🏛️ Architecture & Clean Code:
- [x] Clean Architecture 4 tầng (Domain, Application, Infrastructure, Presentation).
- [x] Domain Purity: Tầng Domain thuần TypeScript, 0 dependency vào framework.
- [x] Đóng gói (Encapsulation) & Bảo toàn tính bất biến (Invariant Validation).
- [x] Repository Pattern: Phân tách rõ ràng giữa Interface Port và Database Adapter.

### 🐳 DevOps & Environment:
- [x] Khởi tạo Git repository độc lập với Git commit chuẩn Conventional Commits.
- [x] Thiết lập cấu hình Docker Compose cho PostgreSQL 16 và Adminer GUI.
- [x] Quản trị biến môi trường bảo mật qua `.env` và `.env.example`.
