/**
 * WEEK 1 - DI & IoC Demo
 * Từ Tight Coupling → DI → Manual Container → NestJS pattern
 */

// =============================================================================
// PROBLEM: Tight Coupling
// =============================================================================
console.log('='.repeat(60));
console.log('DI & IoC Demo — EruSentia');
console.log('='.repeat(60));

class PostgresUserRepository_BAD {
  async findById(id: string) {
    // Hard-coded dependency — không thể test mà không cần DB
    return { id, email: 'from_postgres@db.com', role: 'user' };
  }
}

class UserService_BAD {
  // ❌ Tự tạo dependency → TIGHT COUPLING
  private repo = new PostgresUserRepository_BAD();

  async getUser(id: string) {
    return this.repo.findById(id);
  }
}

// =============================================================================
// SOLUTION: Dependency Injection
// =============================================================================

// Step 1: Interface (abstraction)
interface IUserRepository {
  findById(id: string): Promise<{ id: string; email: string; role: string } | null>;
  save(user: { id: string; email: string; role: string }): Promise<void>;
  findByEmail(email: string): Promise<{ id: string; email: string } | null>;
}

// Step 2a: Production implementation
class PostgresUserRepository implements IUserRepository {
  async findById(id: string) {
    console.log(`    [Postgres] findById(${id})`);
    return { id, email: `${id}@db.com`, role: 'user' };
  }
  async save(user: any) {
    console.log(`    [Postgres] save(${user.email})`);
  }
  async findByEmail(email: string) {
    console.log(`    [Postgres] findByEmail(${email})`);
    return null;
  }
}

// Step 2b: In-Memory implementation (testing)
class InMemoryUserRepository implements IUserRepository {
  private store = new Map<string, any>();

  async findById(id: string) {
    const user = this.store.get(id) || null;
    console.log(`    [InMemory] findById(${id}) → ${user ? user.email : 'null'}`);
    return user;
  }
  async save(user: any) {
    this.store.set(user.id, user);
    console.log(`    [InMemory] save(${user.email})`);
  }
  async findByEmail(email: string) {
    for (const u of this.store.values()) {
      if (u.email === email) return u;
    }
    return null;
  }
}

// Step 3: Service nhận dependency qua Constructor Injection
class UserService {
  // ✅ Phụ thuộc vào INTERFACE, không phải implementation cụ thể
  constructor(private readonly userRepo: IUserRepository) {}

  async getUser(id: string) {
    const user = await this.userRepo.findById(id);
    if (!user) throw new Error(`User ${id} not found`);
    return user;
  }

  async registerUser(email: string): Promise<{ id: string; email: string; role: string }> {
    const existing = await this.userRepo.findByEmail(email);
    if (existing) throw new Error('Email already registered');
    const newUser = { id: `u-${Date.now()}`, email, role: 'user' };
    await this.userRepo.save(newUser);
    return newUser;
  }
}

// =============================================================================
// Simple DIContainer
// =============================================================================
class SimpleContainer {
  private registry = new Map<string, () => any>();
  private singletons = new Map<string, any>();

  registerSingleton<T>(token: string, factory: () => T): void {
    this.registry.set(token, () => {
      if (!this.singletons.has(token)) {
        this.singletons.set(token, factory());
      }
      return this.singletons.get(token);
    });
  }

  resolve<T>(token: string): T {
    const factory = this.registry.get(token);
    if (!factory) throw new Error(`No provider for: ${token}`);
    return factory();
  }
}

// =============================================================================
// MAIN
// =============================================================================
async function main() {
  // --- Demo 1: Production (Postgres) ---
  console.log('\n🔌 1. Production DI (PostgresRepository injected)');
  const prodService = new UserService(new PostgresUserRepository());
  const user1 = await prodService.getUser('u-001');
  console.log(`  Result: ${JSON.stringify(user1)}`);

  // --- Demo 2: Testing (InMemory — không cần DB!) ---
  console.log('\n🧪 2. Testing DI (InMemoryRepository injected — no DB needed!)');
  const memRepo = new InMemoryUserRepository();
  await memRepo.save({ id: 'test-1', email: 'tientuan@test.com', role: 'creator' });

  const testService = new UserService(memRepo);
  const user2 = await testService.getUser('test-1');
  console.log(`  Result: ${JSON.stringify(user2)}`);

  // --- Demo 3: Error handling ---
  console.log('\n❌ 3. Error case: user not found');
  try {
    await testService.getUser('non-existent');
  } catch (e: any) {
    console.log(`  Expected error: ${e.message}`);
  }

  // --- Demo 4: DI Container ---
  console.log('\n📦 4. DI Container (auto wiring)');
  const container = new SimpleContainer();
  container.registerSingleton('UserRepository', () => new InMemoryUserRepository());
  container.registerSingleton('UserService', () =>
    new UserService(container.resolve<IUserRepository>('UserRepository'))
  );

  const service = container.resolve<UserService>('UserService');
  const newUser = await service.registerUser('alex@erusentia.com');
  console.log(`  Registered via container: ${JSON.stringify(newUser)}`);

  // Verify singleton — same instance
  const service2 = container.resolve<UserService>('UserService');
  console.log(`  Singleton check: same instance = ${service === service2}`);

  console.log('\n' + '='.repeat(60));
  console.log('✅ DI & IoC demos completed!');
  console.log('\nNestJS áp dụng pattern tương tự tự động qua @Injectable()');
  console.log('và @Module({ providers: [...] }) — không cần wiring thủ công.');
}

main().catch(console.error);
