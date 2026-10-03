# 🔌 PHẦN 8 — DEPENDENCY INJECTION & IoC (Lý thuyết + TypeScript + NestJS)

---

## 8.1 Dependency là gì?

Khi class A cần class B để hoạt động → A **phụ thuộc vào (depends on)** B → B là **dependency của A**.

```typescript
class UserService {
  // UserService phụ thuộc vào UserRepository để query DB
  // UserRepository là dependency của UserService
}
```

**Vấn đề cốt lõi:** AI cũng quan trọng không chỉ là class A cần B, mà là **"AI quyết định tạo B"**.

---

## 8.2 Vấn đề: Tight Coupling (Khớp nối chặt)

### Định nghĩa

**Tight Coupling (Khớp nối chặt)** = class tự tạo (instantiate) dependency của mình.
Kết quả: hai class gắn chặt với nhau, không thể thay thế một bên mà không ảnh hưởng bên kia.

```typescript
// src/week01-practice/di/00_problem.ts

class PostgresUserRepository {
  async findById(id: string) {
    // Hard-coded kết nối PostgreSQL
    return { id, email: 'from_postgres@db.com', role: 'user' };
  }

  async save(user: any) {
    console.log('[Postgres] Saving user:', user.email);
  }
}

class UserService {
  // ❌ TIGHT COUPLING: UserService tự tạo dependency
  private repo = new PostgresUserRepository();
  //                  ↑ gắn cứng với PostgresUserRepository

  async getUser(id: string) {
    return this.repo.findById(id);
  }
}
```

### Hệ quả của Tight Coupling

**1. Khó test (Hardest problem):**
```typescript
// Muốn test UserService.getUser() phải:
// - Có PostgreSQL đang chạy
// - Có data trong DB
// - Network kết nối được
// → Unit test không còn là "unit" nữa — chạy chậm, phụ thuộc môi trường
const service = new UserService();
await service.getUser('1');  // phải có DB thật!
```

**2. Khó thay đổi implementation:**
```typescript
// Muốn đổi từ Postgres sang MongoDB:
// Phải sửa trong UserService → vi phạm Open/Closed Principle
private repo = new MongoUserRepository();  // sửa trong service!
```

**3. Khó tái sử dụng:**
```typescript
// UserService chỉ hoạt động được với PostgresUserRepository
// Không thể dùng lại trong context khác (in-memory cache, test mock, v.v.)
```

---

## 8.3 Dependency Injection (DI)

### Định nghĩa

**Dependency Injection (Tiêm phụ thuộc)** = pattern thiết kế trong đó
**dependencies được cung cấp từ bên ngoài** thay vì class tự tạo.

"Injection" = "tiêm" dependency vào, giống kim tiêm thuốc vào cơ thể thay vì cơ thể tự tạo thuốc.

### Ba kiểu DI

**Constructor Injection (phổ biến nhất):**
```typescript
class UserService {
  constructor(private readonly repo: IUserRepository) {}
  // dependency được inject qua constructor
}
```

**Property Injection:**
```typescript
class UserService {
  repo!: IUserRepository;  // set từ bên ngoài
}
const service = new UserService();
service.repo = new PostgresUserRepository();
```

**Method Injection:**
```typescript
class UserService {
  async getUser(id: string, repo: IUserRepository) {
    // dependency được inject vào method
  }
}
```

> NestJS và hầu hết frameworks dùng **Constructor Injection**.

### DI + Interface = Dependency Inversion

**Bước 1: Định nghĩa interface (abstraction)**

```typescript
// src/week01-practice/di/01_basic_di.ts

// Interface = contract: "ai implement tôi phải có các methods này"
interface IUserRepository {
  findById(id: string): Promise<{ id: string; email: string; role: string } | null>;
  findByEmail(email: string): Promise<{ id: string; email: string } | null>;
  save(user: { id: string; email: string; role: string }): Promise<void>;
}
```

**Bước 2: Các implementations**

```typescript
// Postgres implementation (production)
class PostgresUserRepository implements IUserRepository {
  async findById(id: string) {
    console.log('[Postgres] findById:', id);
    // Thực tế: client.query('SELECT * FROM users WHERE id = $1', [id])
    return { id, email: 'from_postgres@db.com', role: 'user' };
  }

  async findByEmail(email: string) {
    console.log('[Postgres] findByEmail:', email);
    return null;
  }

  async save(user: any) {
    console.log('[Postgres] save:', user.email);
  }
}

// In-Memory implementation (testing)
class InMemoryUserRepository implements IUserRepository {
  private store = new Map<string, any>();

  async findById(id: string) {
    return this.store.get(id) || null;
  }

  async findByEmail(email: string) {
    for (const user of this.store.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  async save(user: any) {
    this.store.set(user.id, user);
    console.log('[InMemory] saved:', user.email);
  }
}
```

**Bước 3: UserService nhận dependency qua constructor**

```typescript
class UserService {
  // ✅ Phụ thuộc vào INTERFACE, không phải implementation cụ thể
  constructor(private readonly userRepo: IUserRepository) {}

  async getUser(id: string) {
    const user = await this.userRepo.findById(id);
    if (!user) throw new Error(`User ${id} not found`);
    return user;
  }

  async registerUser(email: string) {
    const existing = await this.userRepo.findByEmail(email);
    if (existing) throw new Error('Email already registered');

    const newUser = { id: crypto.randomUUID(), email, role: 'user' };
    await this.userRepo.save(newUser);
    return newUser;
  }
}
```

**Bước 4: Wiring — caller quyết định implementation**

```typescript
// === Production ===
const productionService = new UserService(
  new PostgresUserRepository()  // inject Postgres
);

// === Testing (không cần DB!) ===
const memRepo = new InMemoryUserRepository();
await memRepo.save({ id: 'test-1', email: 'test@test.com', role: 'user' });

const testService = new UserService(memRepo);  // inject InMemory
const user = await testService.getUser('test-1');
console.log(user.email);  // test@test.com — không cần DB!
```

---

## 8.4 Inversion of Control (IoC)

### Định nghĩa

**Inversion of Control (Đảo ngược điều khiển)** là nguyên tắc thiết kế:
**luồng điều khiển được đảo ngược** — thay vì code của bạn gọi framework,
**framework gọi code của bạn**.

### Không có IoC (Traditional)

```
Code của bạn → quyết định mọi thứ → gọi Library
```

```typescript
// Code của bạn control toàn bộ flow
const repo = new PostgresUserRepository();  // bạn tạo
const service = new UserService(repo);      // bạn tạo
const result = service.getUser('1');        // bạn gọi
```

### Có IoC (Framework)

```
Framework → quyết định khi nào → gọi Code của bạn
```

```typescript
// Express: bạn đăng ký handler, Express quyết định khi nào gọi
app.get('/users/:id', async (req, res) => {
  // Framework gọi function này khi có HTTP request đến /users/:id
  // Bạn không biết khi nào → Framework quyết định
});

// NestJS: bạn khai báo @Injectable, framework tự wire và inject
@Injectable()
class UserService {
  constructor(private userRepo: UserRepository) {}
  // Framework (NestJS DI container) tự tạo UserRepository và inject vào đây
}
```

### Hollywood Principle

IoC còn được gọi là **"Hollywood Principle"**:
> "Don't call us, we'll call you"
> (Đừng gọi chúng tôi, chúng tôi sẽ gọi bạn)

---

## 8.5 DI Container

### Định nghĩa

**DI Container** (còn gọi là IoC Container) là một **object/framework** chịu trách nhiệm:
1. **Đăng ký (Register):** biết class nào cần inject cho class nào
2. **Resolve:** tự động tạo instances và inject dependencies
3. **Lifecycle management:** singleton, transient, scoped

### Implement DI Container đơn giản

```typescript
// src/week01-practice/di/02_di_container.ts

class DIContainer {
  private registry = new Map<string, () => any>();
  private singletons = new Map<string, any>();

  // Đăng ký factory function
  register<T>(token: string, factory: () => T): void {
    this.registry.set(token, factory);
  }

  // Đăng ký singleton (chỉ tạo 1 lần)
  registerSingleton<T>(token: string, factory: () => T): void {
    this.registry.set(token, () => {
      if (!this.singletons.has(token)) {
        this.singletons.set(token, factory());
      }
      return this.singletons.get(token);
    });
  }

  // Lấy instance
  resolve<T>(token: string): T {
    const factory = this.registry.get(token);
    if (!factory) throw new Error(`No provider registered for: ${token}`);
    return factory();
  }
}

// === Setup container (1 lần khi app khởi động) ===
const container = new DIContainer();

// Đăng ký repositories (singleton — dùng chung 1 instance)
container.registerSingleton('UserRepository', () => new PostgresUserRepository());

// Đăng ký services (transient — tạo mới mỗi lần)
container.register('UserService', () =>
  new UserService(container.resolve('UserRepository'))
);

// Sử dụng
const userService = container.resolve<UserService>('UserService');
const user = await userService.getUser('1');
```

---

## 8.6 NestJS — DI/IoC Tự Động

NestJS implement DI/IoC thông qua **TypeScript Decorators** và **Reflection Metadata**.

### Cách NestJS hoạt động

```typescript
// 1. Đánh dấu class là injectable
@Injectable()
export class UserRepository {
  constructor(private readonly db: DatabaseService) {}

  async findById(id: string) {
    return this.db.query('SELECT * FROM users WHERE id = $1', [id]);
  }
}

// 2. Service nhận dependency qua constructor (NestJS tự inject)
@Injectable()
export class UserService {
  // NestJS đọc TypeScript type → biết cần inject UserRepository
  constructor(private readonly userRepository: UserRepository) {}

  async getUser(id: string) {
    return this.userRepository.findById(id);
  }
}

// 3. Module đăng ký providers vào DI container
@Module({
  providers: [
    UserService,
    UserRepository,
    DatabaseService,
  ],
  controllers: [UserController],
  exports: [UserService],  // expose cho modules khác
})
export class UserModule {}
```

### NestJS làm gì phía sau?

```
1. NestJS đọc @Module({ providers: [UserService, UserRepository] })
2. Dùng Reflect.getMetadata để đọc constructor signature của UserService
   → Thấy: constructor(userRepository: UserRepository)
3. Tự tạo UserRepository instance (singleton trong scope module)
4. Inject vào UserService constructor
5. Tạo UserService instance với UserRepository đã inject
→ Bạn không cần new ở bất kỳ đâu!
```

### Liên hệ với EruSentia Clean Architecture

```
src/
├── domain/                    ← Pure TypeScript, KHÔNG phụ thuộc gì
│   └── entities/
│       └── User.ts            ← class User thuần OOP
│
├── application/               ← Business logic, phụ thuộc vào interfaces
│   ├── ports/                 ← Interface definitions
│   │   └── IUserRepository.ts ← interface IUserRepository
│   └── usecases/
│       └── GetUserUseCase.ts  ← inject IUserRepository
│
└── infrastructure/            ← Implementation cụ thể, phụ thuộc ngoài
    └── database/
        └── UserPgRepository.ts ← implements IUserRepository, dùng pg library
```

```typescript
// application/ports/IUserRepository.ts
export interface IUserRepository {
  findById(id: string): Promise<User | null>;
  save(user: User): Promise<void>;
}

// application/usecases/GetUserUseCase.ts
export class GetUserUseCase {
  constructor(
    private readonly userRepo: IUserRepository  // ← nhận interface, không biết impl
  ) {}

  async execute(userId: string): Promise<User> {
    const user = await this.userRepo.findById(userId);
    if (!user) throw new Error(`User ${userId} not found`);
    return user;
  }
}
// GetUserUseCase không import bất kỳ gì từ infrastructure/
// → Có thể test với InMemoryUserRepository mà không cần DB

// infrastructure/database/UserPgRepository.ts
import { IUserRepository } from '../../application/ports/IUserRepository';

export class UserPgRepository implements IUserRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<User | null> {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
      [id]
    );
    return result.rows[0] ? this.mapToEntity(result.rows[0]) : null;
  }

  private mapToEntity(row: any): User {
    return new User(row.id, row.email, row.password_hash);
  }
}
```

---

## 8.7 Tại sao DI + Clean Architecture quan trọng?

### Testability (Khả năng test)

```typescript
// Unit test GetUserUseCase — không cần DB
describe('GetUserUseCase', () => {
  it('should return user when found', async () => {
    // Mock repository
    const mockRepo: IUserRepository = {
      findById: jest.fn().mockResolvedValue(
        new User('1', 'test@test.com', 'hash')
      ),
      save: jest.fn(),
    };

    const useCase = new GetUserUseCase(mockRepo);  // inject mock
    const user = await useCase.execute('1');

    expect(user.getEmail()).toBe('test@test.com');
    expect(mockRepo.findById).toHaveBeenCalledWith('1');
    // Test hoàn toàn không cần PostgreSQL, chạy trong ms
  });
});
```

### Flexibility (Linh hoạt)

```typescript
// Đổi DB từ Postgres sang Redis cache cho read-heavy operations
// Chỉ cần thêm implementation, không sửa UseCase
class CachedUserRepository implements IUserRepository {
  constructor(
    private readonly redis: RedisClient,
    private readonly postgres: UserPgRepository
  ) {}

  async findById(id: string) {
    const cached = await this.redis.get(`user:${id}`);
    if (cached) return JSON.parse(cached);

    const user = await this.postgres.findById(id);
    if (user) await this.redis.set(`user:${id}`, JSON.stringify(user), 'EX', 3600);
    return user;
  }
}
// GetUserUseCase không cần sửa dòng nào!
```

---

## 8.8 SOLID Principles (Mở rộng)

DI và IoC là cách thực hiện **Dependency Inversion Principle (D trong SOLID)**:

| Chữ | Principle | Ý nghĩa |
|-----|-----------|---------|
| **S** | Single Responsibility | Mỗi class chỉ có 1 lý do để thay đổi |
| **O** | Open/Closed | Open for extension, Closed for modification |
| **L** | Liskov Substitution | Subclass có thể thay thế parent class |
| **I** | Interface Segregation | Interface nhỏ, chuyên biệt hơn interface lớn |
| **D** | Dependency Inversion | Depend on abstractions, not concretions |

**DI thực hiện Dependency Inversion:**
```
High-level modules (UserService) không phụ thuộc vào Low-level modules (PostgresRepo)
Cả hai phụ thuộc vào Abstractions (IUserRepository)
```
