# 🚀 KẾ HOẠCH TỔNG THỂ — BACKEND ERUSENTIA
## *Ánh xạ Lộ Trình Training TYP 2026 → EruSentia Cloud Layer*

> **Nguyên tắc cốt lõi:** Mỗi tuần học = một module thật của EruSentia.  
> Không làm project giả — project chính là EruSentia.  
> **Stack:** NestJS (TypeScript) · PostgreSQL 16 · RabbitMQ 3 · Redis 7 · Docker

---

## 🗺️ TỔNG QUAN: ĐÂU LÀ VỊ TRÍ CỦA BACKEND TRONG ERUSENTIA?

EruSentia hiện tại là **Local-first** (toàn bộ chạy trên máy người dùng).  
Sau 6 tuần, sẽ thêm tầng **Cloud/Backend** biến EruSentia thành **Hybrid**:

```
TRƯỚC (Local-only)                    SAU (Hybrid)
──────────────────────               ──────────────────────────────────
EruSentia App                        EruSentia App
(React + TipTap + Zustand)           (React + TipTap + Zustand)
        │                                     │
        ▼                                     │─── cloudService.ts (MỚI)
OPFS / Local Disk                             │
(ghi chú chỉ ở máy mình)                     ▼
                                    EruSentia-API (NestJS)
                                             │
                          ┌──────────────────┼──────────────────┐
                          ▼                  ▼                  ▼
                     PostgreSQL         RabbitMQ            Redis
                   (Template Hub,       (Notifications,    (Cache,
                    Doc Hub, Users)      Background jobs)   Leaderboard)
```

---

## 🔗 ÁNH XẠ: TRAINING TYP → MODULE ERUSENTIA

| Tuần TYP | Chủ đề Training | Module EruSentia Xây Được | Chi tiết |
|---|---|---|---|
| **W1** | Database & OOP | **Schema thiết kế** cho toàn bộ Cloud layer | 8 bảng: users, templates, documents, forks, ratings, notifications... |
| **W2** | REST API & ORM | **Template Marketplace API** + **Document Hub API** | 30+ endpoints, phân trang, error chuẩn |
| **W3** | Auth & Authorization | **Hệ thống tài khoản** Creator/User/Admin | JWT, RBAC, refresh token, session |
| **W4** | Message Queue | **Notification system** + **Background jobs** | Fork notify, download counter, shadow markdown processor |
| **W5** | Cache & Redis | **Trending Leaderboard** + **Cache danh sách** | Sorted Set, Cache-Aside, rate limiting |
| **W6** | Project tổng hợp | **Kết nối frontend + Deploy** | cloudService.ts, Docker Compose, VPS |

---

## 📁 CẤU TRÚC REPO MỚI

```
EruSentia-API/               ← Repo backend (mới, tạo riêng)
├── src/
│   ├── domain/              # Business rules (không phụ thuộc framework)
│   ├── application/         # Use cases (1 file = 1 hành động)
│   ├── infrastructure/      # DB, Cache, Queue implementations
│   │   └── database/
│   │       └── migrations/  # Mọi thay đổi schema đều qua đây
│   └── presentation/        # HTTP Controllers, API v1/v2
│       └── http/v1/
├── sql/
│   ├── 01_schema.sql        # Schema ban đầu (tạo tuần 1)
│   ├── 02_indexes.sql       # Index strategy
│   └── 03_seed.sql          # Dữ liệu giả 10k rows
├── scripts/
│   └── backup/
│       ├── pg_backup.sh     # Backup PostgreSQL tự động
│       └── pg_restore.sh    # Restore khi cần
├── .env.example             # Template env (commit được)
├── docker-compose.dev.yml   # Dev: DB + Redis + RabbitMQ
└── docker-compose.prod.yml  # Production

EruSentia/                   ← Repo frontend (đã có - không phá vỡ)
└── src/
    └── services/
        └── cloudService.ts  ← File MỚI thêm vào tuần 6
```

---

## 📑 DANH SÁCH TÀI LIỆU CHI TIẾT

| File | Nội dung | Tham chiếu TYP |
|---|---|---|
| [LEARNING_ROADMAP_AND_RESOURCES.md](./LEARNING_ROADMAP_AND_RESOURCES.md) | 📚 Lộ trình 6 tuần & Kho tài liệu tham khảo chính thức | Toàn bộ lộ trình |
| [00_training_schedule.md](./00_training_schedule.md) | Lộ trình gốc chuyển đổi từ Excel | TYP 2026 |
| [00_production_engineering_blueprint.md](./00_production_engineering_blueprint.md) | ⚡ Chuẩn Go-To-Market & Kỹ thuật tối ưu hóa đến cùng cực | Chuẩn sản xuất |
| **[01_master_plan.md](./01_master_plan.md)** | ← File này | Tổng quan |
| [02_week1_database.md](./02_week1_database.md) | Kế hoạch chi tiết Tuần 1 | W1: DB & OOP |
| [03_week2_api.md](./03_week2_api.md) | Kế hoạch chi tiết Tuần 2 | W2: REST & ORM |
| [04_week3_auth.md](./04_week3_auth.md) | Kế hoạch chi tiết Tuần 3 | W3: Auth |
| [05_week4_queue.md](./05_week4_queue.md) | Kế hoạch chi tiết Tuần 4 | W4: MQ |
| [06_week5_cache.md](./06_week5_cache.md) | Kế hoạch chi tiết Tuần 5 | W5: Redis |
| [07_week6_deploy.md](./07_week6_deploy.md) | Kế hoạch chi tiết Tuần 6 | W6: Project |

---

## 🏗️ KIẾN TRÚC DỄ MỞ RỘNG

### Clean Architecture 4 tầng

```
domain/        ← Business rules thuần TypeScript, không import NestJS/TypeORM
application/   ← Use cases: 1 file = 1 hành động
infrastructure/← Implement interfaces: đổi TypeORM→Prisma chỉ sửa tầng này
presentation/  ← HTTP Controllers, dễ thêm GraphQL/WebSocket sau
```

### API Versioning từ đầu

```
/api/v1/templates    ← Client cũ dùng mãi, không bao giờ break
/api/v2/templates    ← Mở rộng sau khi không break v1
```

### Feature Flags

```bash
FF_TEMPLATE_MARKETPLACE=true
FF_DOCUMENT_HUB=false        # Tắt khi chưa xong, bật khi ready
FF_CREATOR_ECONOMY=false     # Phase 2
```

### Database Migration — Không bao giờ sửa schema.sql trực tiếp

```bash
# Mọi thay đổi schema đều qua migration:
npm run migration:generate -- --name AddNewColumn
npm run migration:run
```

---

## 💾 KẾ HOẠCH BACKUP (3-2-1)

```
Bản 1: PostgreSQL trên VPS (production, realtime)
Bản 2: pg_dump file trên cùng VPS (/backups/) — hàng ngày 3AM
Bản 3: Cloudflare R2 offsite — upload sau mỗi dump

Chi phí: R2 10GB miễn phí → gần như $0/tháng
Test restore: Tự động hàng tuần (Chủ nhật 2AM)
```

---

## 📊 SỐ LIỆU CẦN GHI LẠI (cho báo cáo tuần 6)

| Chỉ số | Đo ở đâu | Trước | Sau |
|---|---|---|---|
| Query không INDEX | Tuần 1: EXPLAIN ANALYZE | ___ms | — |
| Query có INDEX | Tuần 1: EXPLAIN ANALYZE | — | ___ms |
| API no cache | Tuần 5: curl timer | ___ms | — |
| API cache hit | Tuần 5: curl timer | — | ___ms |
| Leaderboard DB | Tuần 5: ORDER BY | ___ms | — |
| Leaderboard Redis | Tuần 5: ZREVRANGE | — | ___ms |

---

## 🚀 ROADMAP SAU 6 TUẦN

| Phase | Tính năng | Ghi chú |
|---|---|---|
| Phase 2 | OAuth Google/GitHub | Thêm Passport strategy |
| Phase 2 | Email notifications | Consumer mới lắng nghe event hiện có |
| Phase 3 | WebSocket real-time | Module mới, use cases tái dùng |
| Phase 3 | Payment VNPay/Stripe | Creator Economy tier |
| Phase 4 | Multi-tenant B2B | Trường học (EduSentia strategy) |
| Phase 4 | AI API Gateway | Proxy BYOK cho frontend |
