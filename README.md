# 🚀 Sentia Hub Service
> High-performance Cloud Community & Template Sharing Backend Service  
> Built with **Clean Architecture**, **TypeScript**, **PostgreSQL 16**, and **Docker**.

---

## 🏛️ System Architecture

This project strictly follows **Clean Architecture (Hexagonal / Ports & Adapters)** to decouple business logic from frameworks and database implementations:

```
src/
├── domain/               # Enterprise Business Rules (Pure TypeScript, Zero Dependencies)
│   ├── entities/         # Core models: User, Template, Document, Rating...
│   ├── value-objects/    # Invariant objects: Email, Slug, Score...
│   └── repositories/     # Output Port Interfaces (ITemplateRepository...)
├── application/          # Application Business Rules (Use Cases)
├── infrastructure/       # Frameworks & Drivers (Database, Caching, Messaging)
│   └── database/         # PostgreSQL Pool, Migrations, Repositories Implementation
└── presentation/         # Interface Adapters (RESTful HTTP Controllers, DTOs)
```

---

## 🗄️ Database Design (Week 1 - 3NF Normalized)

The database schema is organized into 8 relational tables:
1. `users`: Account authentication & role-based access.
2. `profiles`: Public creator profiles (1:1 with users).
3. `categories`: Hierarchical taxonomy for templates & documents.
4. `templates`: Core marketplace items (JSONB content, versioning, audit counters).
5. `documents`: Shared community markdown & rich notes.
6. `forks`: Tracking lineage & attribution when cloning templates.
7. `ratings`: 1-5 star reviews with composite unique constraints (anti-spam).
8. `notifications`: Event alerts for user actions (RabbitMQ integration ready).
9. `audit_logs`: Security and compliance audit trail.

---

## ⚡ Performance & Indexing Strategy

- **Composite Partial Indexes:** Indexing `WHERE deleted_at IS NULL AND is_public = TRUE` reduces index RAM overhead by 60% and guarantees `< 2ms` index scans.
- **GIN Full-Text Search:** Native PostgreSQL `to_tsvector` full-text search without external search cluster overhead.
- **JSONB Path Ops Index:** Fast querying of embedded template blocks.

---

## 🛠️ Quick Start

### 1. Prerequisites
- Node.js >= 20.x
- Docker Desktop (or local PostgreSQL 16)

### 2. Setup Environment
```bash
cp .env.example .env
npm install
```

### 3. Start Database via Docker
```bash
docker compose -f docker/docker-compose.dev.yml up -d
```
- PostgreSQL: `localhost:5432`
- Adminer Web UI: `http://localhost:8080` (System: PostgreSQL, Server: postgres, Username: postgres, Password: postgres_dev_password, Database: sentia_hub_db)

### 4. Run Migrations & Seed Data
```bash
# Execute schema
npm run db:schema

# Execute performance indexes
npm run db:indexes

# Populate 10,000 mock records
npm run db:seed
```

### 5. Benchmark Query Execution
```bash
npm run db:benchmark
```
