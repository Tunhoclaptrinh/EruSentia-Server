# 🧱 PHẦN 7 — OOP (Lý thuyết đầy đủ + TypeScript EruSentia)

---

## 7.1 OOP là gì?

**Object-Oriented Programming (Lập trình hướng đối tượng)** là **paradigm lập trình**
(cách tiếp cận/tư duy lập trình) trong đó chương trình được tổ chức xung quanh
**objects** (đối tượng) thay vì functions và procedures.

### Object là gì?

**Object** = thực thể có:
- **State (Trạng thái):** dữ liệu, thuộc tính → stored trong **fields/attributes**
- **Behavior (Hành vi):** những gì object có thể làm → defined bằng **methods**
- **Identity (Định danh):** mỗi object là duy nhất, có địa chỉ riêng trong memory

```typescript
// Object "user" có:
// State: id, email, role, isActive
// Behavior: changeEmail(), promoteToCreator(), deactivate()
// Identity: đây là user cụ thể, khác với user khác dù có cùng email
const user = new User('uuid-1', 'tientuan@erusentia.com', 'creator');
```

### Tại sao OOP?

**Lập trình thủ tục (Procedural):**
```typescript
// Data và logic tách biệt, rải rác
const user = { email: 'a@b.com', role: 'user' };
function validateEmail(email: string) { ... }
function promoteUser(user: any) { user.role = 'creator'; }
function getUserReputation(userId: string) { ... }
// 3 tháng sau: không biết function nào liên quan đến "user"
// Ai cũng có thể sửa user.role trực tiếp
```

**OOP:**
```typescript
// Data và logic đóng gói cùng nhau
class User {
  private role = 'user';
  promoteToCreator() { /* validate + change role */ }
}
// Rõ ràng: mọi behavior liên quan đến User nằm trong class User
// Chỉ User tự thay đổi state của mình (qua methods)
```

---

## 7.2 Class là gì?

**Class** là **blueprint (bản vẽ kỹ thuật)** để tạo ra objects.
Class định nghĩa structure (fields) và behavior (methods) mà các objects sẽ có.

**Object** là **instance** (thực thể) được tạo ra từ class.

```typescript
// Class = khuôn (blueprint)
class User {
  id: string;
  email: string;
  constructor(id: string, email: string) {
    this.id = id;
    this.email = email;
  }
}

// Objects = sản phẩm được đúc từ khuôn
const user1 = new User('1', 'a@a.com');  // instance 1
const user2 = new User('2', 'b@b.com');  // instance 2 — khác biệt
```

---

## 7.3 Encapsulation (Đóng gói)

### Định nghĩa

**Encapsulation** là nguyên tắc **ẩn internal state và implementation details** bên trong object,
chỉ expose **public interface** (methods) để tương tác.

Hai khía cạnh:
1. **Data hiding:** ẩn fields (private/protected)
2. **Bundling:** đóng gói data + behavior cùng nhau trong class

### Tại sao quan trọng?

Không có encapsulation:
```typescript
const user = { email: 'a@b.com', role: 'user' };
// Ai cũng có thể:
user.role = 'admin';           // bypass mọi business rule!
user.email = 'không hợp lệ';  // không validation
```

Với encapsulation:
```typescript
class User {
  private role: string = 'user';

  promoteToCreator() {
    if (this.role !== 'user') throw new Error('Cannot promote');
    this.role = 'creator';  // chỉ method này mới set được role
  }
}
// user.role = 'admin'; → TypeScript compile error
// user.promoteToCreator(); → chạy qua validation
```

### Access Modifiers

| Modifier | Truy cập từ | TypeScript | Java |
|----------|-----------|-----------|------|
| `public` | Mọi nơi | Mặc định | Phải khai báo |
| `private` | Chỉ trong class này | `private` | `private` |
| `protected` | Class này + subclass | `protected` | `protected` |
| `readonly` | Chỉ đọc, không set sau init | `readonly` | `final` |

### Thực hành

Tạo `src/week01-practice/oop/01_encapsulation.ts`:

```typescript
class User {
  private readonly id: string;
  private email: string;
  private passwordHash: string;
  private role: 'user' | 'creator' | 'admin';
  private isActive: boolean;
  private readonly createdAt: Date;

  constructor(id: string, email: string, passwordHash: string) {
    this.id = id;
    this.email = this.normalizeEmail(email);
    this.passwordHash = passwordHash;
    this.role = 'user';
    this.isActive = true;
    this.createdAt = new Date();
  }

  // Public getters: đọc được, không set trực tiếp
  getId(): string { return this.id; }
  getEmail(): string { return this.email; }
  getRole(): string { return this.role; }
  isUserActive(): boolean { return this.isActive; }
  getCreatedAt(): Date { return this.createdAt; }

  // Business methods: validation nằm trong class, không rải ra ngoài
  changeEmail(newEmail: string): void {
    const normalized = this.normalizeEmail(newEmail);
    if (!normalized.includes('@')) throw new Error('Invalid email format');
    this.email = normalized;
  }

  promoteToCreator(): void {
    if (!this.isActive) throw new Error('Cannot promote inactive user');
    if (this.role !== 'user') throw new Error(`Already ${this.role}`);
    this.role = 'creator';
  }

  deactivate(): void {
    this.isActive = false;
  }

  // Không expose password hash ra ngoài
  verifyPassword(inputHash: string): boolean {
    return this.passwordHash === inputHash;
  }

  // Private helper — implementation detail
  private normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }
}

// Test
const user = new User('uuid-1', ' TienTuan@Email.COM ', 'hash123');
console.log(user.getEmail());     // tientuan@email.com (normalized)
user.changeEmail('invalid');      // throws: Invalid email format
user.promoteToCreator();          // OK
user.promoteToCreator();          // throws: Already creator
// user.role = 'admin';           // TypeScript ERROR: property 'role' is private
```

---

## 7.4 Inheritance (Kế thừa)

### Định nghĩa

**Inheritance** là cơ chế cho phép **class con (subclass/child) kế thừa properties và methods
của class cha (superclass/parent)**, đồng thời có thể mở rộng hoặc override behavior.

**Quan hệ IS-A:** Inheritance thể hiện quan hệ "IS-A" (là một).
- `Template IS-A BaseEntity` ✅ (Template là một loại Entity)
- `Profile IS-A User` ❌ (Profile không phải là User, chỉ liên quan đến User)

### Từ khóa

| Từ khóa | Ý nghĩa |
|--------|---------|
| `extends` | Class con kế thừa class cha |
| `super()` | Gọi constructor của class cha |
| `super.method()` | Gọi method của class cha |
| `override` | TypeScript 4.3+: explicit khai báo override method cha |
| `abstract` | Method/class phải được subclass implement |

### Thực hành

Tạo `src/week01-practice/oop/02_inheritance.ts`:

```typescript
// Abstract base class: chứa behavior chung cho mọi domain entity
abstract class BaseEntity {
  protected readonly id: string;
  protected readonly createdAt: Date;
  protected updatedAt: Date;

  constructor(id: string) {
    this.id = id;
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }

  getId(): string { return this.id; }
  getCreatedAt(): Date { return this.createdAt; }
  getUpdatedAt(): Date { return this.updatedAt; }

  // Protected: chỉ class này và subclass dùng
  protected touch(): void {
    this.updatedAt = new Date();
  }

  // Abstract: bắt buộc subclass implement — không có body ở đây
  abstract validate(): void;

  // Concrete method: subclass kế thừa, có thể override nếu muốn
  toString(): string {
    return `${this.constructor.name}(id=${this.id})`;
  }
}

// Template kế thừa BaseEntity
class Template extends BaseEntity {
  private title: string;
  private price: number;
  private status: 'draft' | 'published' | 'archived';
  private readonly authorId: string;
  private categoryId: string;

  constructor(id: string, authorId: string, categoryId: string, title: string, price: number) {
    super(id);  // PHẢI gọi super() đầu tiên
    this.authorId = authorId;
    this.categoryId = categoryId;
    this.title = title;
    this.price = price;
    this.status = 'draft';
  }

  // Implement abstract method từ BaseEntity
  validate(): void {
    if (!this.title || this.title.trim().length < 3) {
      throw new Error('Title must be at least 3 characters');
    }
    if (this.price < 0) {
      throw new Error('Price cannot be negative');
    }
    if (!this.authorId) {
      throw new Error('Author is required');
    }
  }

  // Business methods
  publish(): void {
    this.validate();  // validate trước khi publish
    if (this.status !== 'draft') {
      throw new Error(`Cannot publish template in status: ${this.status}`);
    }
    this.status = 'published';
    this.touch();  // method từ class cha
  }

  archive(): void {
    if (this.status === 'archived') return;
    this.status = 'archived';
    this.touch();
  }

  updateTitle(newTitle: string): void {
    if (this.status === 'published') {
      throw new Error('Cannot change title of published template');
    }
    this.title = newTitle.trim();
    this.touch();
  }

  // Getters
  getTitle(): string { return this.title; }
  getPrice(): number { return this.price; }
  getStatus(): string { return this.status; }
  getAuthorId(): string { return this.authorId; }

  // Override parent method
  override toString(): string {
    return `Template(id=${this.getId()}, title="${this.title}", status=${this.status})`;
  }
}

// Profile kế thừa BaseEntity
class Profile extends BaseEntity {
  private username: string;
  private displayName: string;
  private reputationScore: number;
  private readonly userId: string;

  constructor(id: string, userId: string, username: string, displayName: string) {
    super(id);
    this.userId = userId;
    this.username = username;
    this.displayName = displayName;
    this.reputationScore = 0;
  }

  validate(): void {
    if (this.username.length < 3) throw new Error('Username too short (min 3)');
    if (!/^[a-z0-9_]+$/.test(this.username)) {
      throw new Error('Username: only lowercase letters, numbers, underscores');
    }
  }

  addReputation(points: number): void {
    if (points <= 0) throw new Error('Points must be positive');
    this.reputationScore += points;
    this.touch();
  }

  getReputation(): number { return this.reputationScore; }
  getUserId(): string { return this.userId; }
}

// Test
const template = new Template('t-1', 'u-1', 'cat-1', 'React Dashboard Kit', 99000);
console.log(template.toString());  // Template(id=t-1, title="React Dashboard Kit", status=draft)
template.publish();
console.log(template.getStatus()); // published
try { template.publish(); } catch (e) { console.log(e.message); }  // Cannot publish...

const profile = new Profile('p-1', 'u-1', 'tientuan', 'Tien Tuan');
profile.addReputation(10);
console.log(profile.getReputation()); // 10
```

### Khi nào KHÔNG nên dùng Inheritance?

Chỉ dùng inheritance khi có quan hệ **IS-A thực sự**, không phải để tái sử dụng code:

```typescript
// ❌ KHÔNG dùng inheritance để tái dùng code
class EmailSender { send(to: string) { ... } }
class UserService extends EmailSender { ... }
// UserService không phải là EmailSender!

// ✅ Dùng Composition thay thế
class UserService {
  constructor(private emailSender: EmailSender) {}
  // "HAS-A" relationship
}
```

---

## 7.5 Polymorphism (Đa hình)

### Định nghĩa

**Polymorphism** (từ Greek: "nhiều hình dạng") là khả năng **các objects khác nhau
có thể được xử lý thông qua cùng một interface**, mỗi object có thể có behavior khác nhau.

Có 2 loại:
- **Compile-time (Static) Polymorphism:** Method Overloading (cùng tên, khác params)
- **Runtime (Dynamic) Polymorphism:** Method Overriding (subclass override method cha)

### Ví dụ thực tế

Tạo `src/week01-practice/oop/03_polymorphism.ts`:

```typescript
// Interface = contract (tôi hứa sẽ có method này)
interface Publishable {
  publish(): void;
  unpublish(): void;
  getStatus(): string;
  isPublic(): boolean;
}

interface Priceable {
  getPrice(): number;
  applyDiscount(percentOff: number): void;
  getOriginalPrice(): number;
}

// Paid template — implement cả 2 interfaces
class PaidTemplate implements Publishable, Priceable {
  private status: 'draft' | 'published' = 'draft';
  private originalPrice: number;
  private currentPrice: number;

  constructor(private readonly title: string, price: number) {
    this.originalPrice = price;
    this.currentPrice = price;
  }

  // Publishable
  publish(): void {
    if (this.currentPrice <= 0) throw new Error('Paid template must have price > 0');
    this.status = 'published';
  }
  unpublish(): void { this.status = 'draft'; }
  getStatus(): string { return this.status; }
  isPublic(): boolean { return this.status === 'published'; }

  // Priceable
  getPrice(): number { return this.currentPrice; }
  getOriginalPrice(): number { return this.originalPrice; }
  applyDiscount(percentOff: number): void {
    if (percentOff < 0 || percentOff > 100) throw new Error('Invalid discount');
    this.currentPrice = this.originalPrice * (1 - percentOff / 100);
  }
}

// Free template — chỉ Publishable (không Priceable)
class FreeTemplate implements Publishable {
  private status: 'draft' | 'published' = 'draft';

  constructor(private readonly title: string) {}

  publish(): void { this.status = 'published'; }
  unpublish(): void { this.status = 'draft'; }
  getStatus(): string { return this.status; }
  isPublic(): boolean { return this.status === 'published'; }
}

// --- Polymorphism in action ---

// Function nhận INTERFACE, không quan tâm class cụ thể
function publishAll(items: Publishable[]): void {
  items.forEach(item => {
    try {
      item.publish();
      console.log(`Published: ${item.getStatus()}`);
    } catch (e) {
      console.log(`Failed to publish: ${e.message}`);
    }
  });
}

function applyBulkDiscount(items: Priceable[], discount: number): void {
  items.forEach(item => {
    const before = item.getPrice();
    item.applyDiscount(discount);
    console.log(`Price: ${before} → ${item.getPrice()}`);
  });
}

const paid1 = new PaidTemplate('React UI Kit', 99000);
const paid2 = new PaidTemplate('Figma Design System', 199000);
const free1 = new FreeTemplate('Basic HTML Template');

// Cùng gọi publish() dù khác class
publishAll([paid1, paid2, free1]);

// Chỉ paid templates implement Priceable
applyBulkDiscount([paid1, paid2], 20);  // giảm 20%
```

**Lợi ích của Polymorphism:**
- Thêm kiểu template mới (vd: `SubscriptionTemplate`) → implement interface → `publishAll` tự động xử lý được, không cần sửa code
- Giảm if-else: thay vì `if (type === 'paid') {...} else if (type === 'free') {...}`, chỉ cần `item.publish()`

---

## 7.6 Abstraction (Trừu tượng hóa)

### Định nghĩa

**Abstraction** là nguyên tắc **ẩn đi complexity**, chỉ expose những gì user cần biết.

Abstraction giúp:
- Làm việc với concepts ở **mức cao hơn** mà không cần biết implementation
- Giảm cognitive load: chỉ cần biết "làm gì", không cần biết "làm thế nào"

### Abstract Class vs Interface

**Abstract Class:**
- Có thể có **concrete methods** (đã implement) + **abstract methods** (chưa implement)
- Không thể instantiate trực tiếp
- Hỗ trợ **single inheritance** (1 class chỉ extend 1 abstract class)
- Có thể có constructor, fields, access modifiers

**Interface:**
- Chỉ **contract** (khai báo methods, không implement)
- **Multiple implementation** (1 class implement nhiều interface)
- Không có constructor
- Tất cả members mặc định là public

### Khi nào dùng Abstract Class?

Dùng abstract class khi:
1. Có **shared behavior** (code chung) giữa các subclasses
2. Muốn **template method pattern** (định nghĩa skeleton của algorithm)
3. Có **protected fields** cần subclass access

```typescript
// Tạo src/week01-practice/oop/04_abstraction.ts

abstract class NotificationSender {
  // Shared state
  protected readonly senderName = 'EruSentia';

  // Template Method Pattern: định nghĩa skeleton
  async notify(userId: string, message: string): Promise<void> {
    // Framework code (không thay đổi giữa các subclass)
    const user = await this.fetchRecipient(userId);
    const formatted = this.format(message, user);
    await this.deliver(user, formatted);
    this.logDelivery(userId, message);
  }

  // Shared concrete method
  private logDelivery(userId: string, message: string): void {
    console.log(`[${new Date().toISOString()}] Notified user ${userId}`);
  }

  // Abstract: subclass phải implement theo cách riêng của mình
  protected abstract fetchRecipient(userId: string): Promise<{ name: string; address: string }>;
  protected abstract format(message: string, recipient: any): string;
  protected abstract deliver(recipient: any, message: string): Promise<void>;
}

// Email implementation
class EmailNotification extends NotificationSender {
  protected async fetchRecipient(userId: string) {
    // Trong thực tế: query DB
    return { name: 'Tien Tuan', address: 'tientuan@erusentia.com' };
  }

  protected format(message: string, recipient: { name: string }): string {
    return `Dear ${recipient.name},\n\n${message}\n\nBest,\n${this.senderName}`;
  }

  protected async deliver(recipient: { address: string }, message: string): Promise<void> {
    console.log(`📧 Sending email to ${recipient.address}`);
    // await smtpClient.sendMail({ to: recipient.address, body: message });
  }
}

// In-App notification
class InAppNotification extends NotificationSender {
  protected async fetchRecipient(userId: string) {
    return { name: 'Tuan Anh', address: userId };  // address = userId cho websocket
  }

  protected format(message: string, _: any): string {
    return message.substring(0, 140);  // giới hạn 140 ký tự
  }

  protected async deliver(recipient: { address: string }, message: string): Promise<void> {
    console.log(`🔔 Push to socket ${recipient.address}: ${message}`);
    // webSocketServer.emit(recipient.address, 'notification', message);
  }
}

// Sử dụng — caller chỉ biết abstract contract
async function notifyUserPublished(notifiers: NotificationSender[], userId: string, templateTitle: string) {
  const message = `Your template "${templateTitle}" has been published!`;
  await Promise.all(notifiers.map(n => n.notify(userId, message)));
}

const notifiers: NotificationSender[] = [
  new EmailNotification(),
  new InAppNotification(),
];
notifyUserPublished(notifiers, 'user-1', 'React Dashboard Kit');
```

### Khi nào dùng Interface?

Dùng interface khi:
1. Chỉ cần **contract** mà không cần shared implementation
2. Cần **multiple implementations** từ các class không liên quan nhau
3. **DI** — inject implementation tùy môi trường

```typescript
// IUserRepository là interface (đã học ở phần DI)
interface IUserRepository {
  findById(id: string): Promise<User | null>;
  save(user: User): Promise<void>;
}
// PostgresUserRepository, InMemoryUserRepository đều implement
// Không có shared code giữa chúng → dùng interface, không dùng abstract class
```

---

## 7.7 Tóm tắt 4 tính chất OOP

| Tính chất | Định nghĩa ngắn | Lợi ích |
|-----------|----------------|---------|
| **Encapsulation** | Ẩn data, expose methods | Bảo vệ data, validation tập trung |
| **Inheritance** | Class con kế thừa class cha | Tái sử dụng code, IS-A relationship |
| **Polymorphism** | Cùng interface, behavior khác nhau | Extensible, giảm if-else |
| **Abstraction** | Ẩn complexity, expose interface | Đơn giản hóa, giảm coupling |
