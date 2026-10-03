# 📋 LỘ TRÌNH TRAINING TYP 2026 — WEB BACKEND
> Nguồn gốc: `Danh sách trainning TYP - Web.xlsx`  
> Chuyển đổi sang Markdown: 28/09/2026

---

## 📅 NỘI DUNG TRAINING (6 TUẦN + PHỎNG VẤN)

---

### 📌 TUẦN 1: Cơ Sở Dữ Liệu & Lập Trình Hướng Đối Tượng
**Thời gian:** 28/09/2026 – 02/10/2026

#### Nội dung học:
- **Database:** Cài đặt MySQL/PostgreSQL, SQL cơ bản, DDL/DML, JOIN, GROUP BY, HAVING, ORDER BY, Aggregate Functions
- **Index:** Khái niệm, cách sử dụng, khi nào nên/không nên đánh index, demo hiệu năng trước/sau index
- **Pagination:** Offset-based, Cursor-based, ưu nhược điểm và trường hợp sử dụng
- **Database Locking:** Optimistic Locking, Pessimistic Locking, so sánh và demo 2 transaction đồng thời
- **Transaction:** ACID, COMMIT, ROLLBACK, xử lý transaction trong các bài toán thực tế
- **OOP Java:** Encapsulation, Inheritance, Polymorphism, Abstraction; Class, Abstract Class, Interface
- **DI & IoC:** Khái niệm, Java thuần, lợi ích, cách Spring áp dụng DI/IoC

#### Output yêu cầu:
> Database có dữ liệu mẫu, thực hành SQL, demo Index/Locking và trình bày lý thuyết

---

### 📌 TUẦN 2: Framework, RESTful API & ORM
**Thời gian:** 05/10/2026 – 09/10/2026

#### Nội dung học:
- **Framework:** Lựa chọn Spring Boot / Express / NestJS / Django; cấu trúc project và configuration
- **RESTful API:** HTTP Methods, Routing, Request/Response, Path Variable, Query Param, Request Body
- **Error Handling:** HTTP Status Code, chuẩn hóa Error Response, phân biệt 4xx/5xx
- **Pagination API:** Offset/Cursor pagination, response format và triển khai API phân trang
- **CRUD API:** Xây dựng CRUD, test bằng Postman/cURL
- **ORM:** Khái niệm, lợi ích, JPA/Hibernate/Spring Data JPA hoặc ORM tương ứng
- **Database Integration:** Kết nối DB thật, Entity Mapping, Repository, Relationship OneToMany/ManyToOne

#### Output yêu cầu:
> Backend project chạy được với DB thật, tối thiểu 5 API CRUD, Pagination, Error Response và Postman test

---

### 📌 TUẦN 3: Authentication & Authorization
**Thời gian:** 12/10/2026 – 16/10/2026

#### Nội dung học:
- **Authentication & Authorization:** Khái niệm và phân biệt
- **Session vs Token:** Flow hoạt động, Cookie, Stateless/Stateful và trường hợp sử dụng
- **JWT:** Cấu trúc Header/Payload/Signature, ưu điểm, hạn chế và các rủi ro bảo mật
- **Password Security:** Hashing, Salt, Cost Factor, bcrypt/Argon2; hạn chế của MD5/SHA
- **Authentication API:** Register, Login, Password Hashing và JWT
- **Authorization:** JWT Middleware/Filter, Role-based Access Control (Admin/User)
- **Refresh Token:** Lý do sử dụng, flow và implementation

#### Output yêu cầu:
> Demo: Register → Login → JWT → Protected API → Role Authorization → Refresh Token

---

### 📌 TUẦN 4: Message Queue
**Thời gian:** 19/10/2026 – 23/10/2026

#### Nội dung học:
- **Message Queue:** Khái niệm, mục đích sử dụng, Sync vs Async Communication
- **MQ Models:** Point-to-Point và Publish/Subscribe
- **RabbitMQ/Kafka:** Kiến trúc, Producer, Consumer, Queue/Topic, Exchange/Partition
- **Implementation:** Docker + tích hợp MQ vào project hiện tại
- **Async Flow:** API → Business Logic → Message Queue → Consumer → xử lý → Response
- **Reliability:** Duplicate Message, Idempotency, Acknowledge, Retry, Dead Letter Queue
- **Message Ordering:** Khi nào cần đảm bảo thứ tự message

#### Output yêu cầu:
> Demo: API → Message Queue → Consumer → xử lý và giải thích vấn đề khi không dùng MQ

---

### 📌 TUẦN 5: Caching & Redis
**Thời gian:** 26/10/2026 – 30/10/2026

#### Nội dung học:
- **Caching:** Khái niệm, mục đích, Application-level vs Distributed Cache
- **Caching Strategy:** Cache-Aside, Write-Through và trường hợp sử dụng
- **Redis:** Kiến trúc, String, Hash, List, Set, Sorted Set; GET/SET/DEL/EXPIRE/TTL
- **Redis Integration:** Docker, Redis Client và kết nối với project
- **Cache Use Case:** Cache Product/User, Cache Hit/Miss, TTL và Cache Invalidation
- **Redis Sorted Set:** Xây dựng bảng xếp hạng với ZADD/ZREVRANGE
- **Cache Problems:** TTL, Cache Invalidation, Cache Avalanche, Cache Penetration

#### Output yêu cầu:
> Demo: Cache Miss → DB → Cache Set → Cache Hit và so sánh response time

---

### 📌 TUẦN 6: Project Thực Hành Tổng Hợp
**Thời gian:** 02/11/2026 – 06/11/2026

#### Yêu cầu:
- Thời lượng: 1 tuần
- Xây dựng một Backend Project hoàn chỉnh dựa trên kiến thức đã học
- Có thể lựa chọn project CRUD hoặc một bài toán thực tế
- Project cần có **1-2 chức năng có độ khó cao** để áp dụng kiến thức Backend
- Khuyến khích tích hợp các kiến thức: Database, ORM, Authentication, Message Queue, Redis, Pagination

#### Output yêu cầu:
> Source code + trình bày các chức năng chính và những vấn đề kỹ thuật đã xử lý dưới dạng 1 báo cáo

---

### 🎯 PHỎNG VẤN & ĐÁNH GIÁ
**Thời gian:** 08/11/2026

---

## ⏱️ TIMELINE TỔNG QUAN

```
Tháng 9          Tháng 10                      Tháng 11
─────────────────────────────────────────────────────
28/09  05/10  12/10  19/10  26/10  02/11  08/11
  │      │      │      │      │      │      │
  ▼      ▼      ▼      ▼      ▼      ▼      ▼
 W1:    W2:    W3:    W4:    W5:    W6:   PV
 DB&   REST   Auth   MQ    Redis  Project Interview
 OOP   API
```
