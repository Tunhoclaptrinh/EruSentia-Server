/**
 * WEEK 1 - OOP Demo: 4 tính chất OOP bằng TypeScript
 * Domain: EruSentia - Marketplace Template Platform
 */

// =============================================================================
// 1. ENCAPSULATION — Đóng gói
// =============================================================================
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

  getId(): string { return this.id; }
  getEmail(): string { return this.email; }
  getRole(): string { return this.role; }
  isUserActive(): boolean { return this.isActive; }

  changeEmail(newEmail: string): void {
    const normalized = this.normalizeEmail(newEmail);
    if (!normalized.includes('@')) throw new Error('Invalid email format');
    this.email = normalized;
    console.log(`  ✅ Email changed to: ${this.email}`);
  }

  promoteToCreator(): void {
    if (!this.isActive) throw new Error('Cannot promote inactive user');
    if (this.role !== 'user') throw new Error(`Already ${this.role}`);
    this.role = 'creator';
    console.log(`  ✅ User promoted to creator`);
  }

  private normalizeEmail(email: string): string {
    return email.toLowerCase().trim();
  }
}

// =============================================================================
// 2. INHERITANCE — Kế thừa
// =============================================================================
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
  protected touch(): void { this.updatedAt = new Date(); }
  abstract validate(): void;
  toString(): string { return `${this.constructor.name}(id=${this.id})`; }
}

class Template extends BaseEntity {
  private title: string;
  private isPublic: boolean;
  private readonly authorId: string;

  constructor(id: string, authorId: string, title: string) {
    super(id);
    this.authorId = authorId;
    this.title = title;
    this.isPublic = false;
  }

  validate(): void {
    if (!this.title || this.title.trim().length < 3)
      throw new Error('Title must be at least 3 characters');
  }

  publish(): void {
    this.validate();
    if (this.isPublic) throw new Error('Already published');
    this.isPublic = true;
    this.touch();
    console.log(`  ✅ Template "${this.title}" published`);
  }

  getTitle(): string { return this.title; }
  getIsPublic(): boolean { return this.isPublic; }

  override toString(): string {
    return `Template(id=${this.getId()}, title="${this.title}", public=${this.isPublic})`;
  }
}

class Profile extends BaseEntity {
  private reputationScore: number;
  private username: string;

  constructor(id: string, username: string) {
    super(id);
    this.username = username;
    this.reputationScore = 0;
  }

  validate(): void {
    if (this.username.length < 3) throw new Error('Username too short');
  }

  addReputation(points: number): void {
    if (points <= 0) throw new Error('Points must be positive');
    this.reputationScore += points;
    this.touch();
    console.log(`  ✅ Reputation: +${points} → total: ${this.reputationScore}`);
  }

  getReputation(): number { return this.reputationScore; }
}

// =============================================================================
// 3. POLYMORPHISM — Đa hình
// =============================================================================
interface Notifiable {
  notify(userId: string, message: string): void;
  getChannelName(): string;
}

class EmailNotifier implements Notifiable {
  notify(userId: string, message: string): void {
    console.log(`  📧 [Email] → user:${userId}: ${message}`);
  }
  getChannelName(): string { return 'Email'; }
}

class InAppNotifier implements Notifiable {
  notify(userId: string, message: string): void {
    console.log(`  🔔 [In-App] → user:${userId}: ${message.substring(0, 60)}...`);
  }
  getChannelName(): string { return 'In-App'; }
}

// Polymorphic: không quan tâm class cụ thể
function notifyAll(notifiers: Notifiable[], userId: string, message: string): void {
  notifiers.forEach(n => n.notify(userId, message));
}

// =============================================================================
// 4. ABSTRACTION — Trừu tượng hóa
// =============================================================================
abstract class ContentValidator {
  // Template Method Pattern
  validateAndReport(content: string): boolean {
    const errors = this.getErrors(content);
    if (errors.length === 0) {
      console.log(`  ✅ Validation passed`);
      return true;
    }
    errors.forEach(e => console.log(`  ❌ Error: ${e}`));
    return false;
  }

  protected abstract getErrors(content: string): string[];
}

class TitleValidator extends ContentValidator {
  protected getErrors(title: string): string[] {
    const errors: string[] = [];
    if (title.length < 3) errors.push('Title too short (min 3 chars)');
    if (title.length > 255) errors.push('Title too long (max 255 chars)');
    if (title.trim() !== title) errors.push('Title has leading/trailing spaces');
    return errors;
  }
}

// =============================================================================
// MAIN — Chạy tất cả demo
// =============================================================================
console.log('='.repeat(60));
console.log('OOP Demo — EruSentia Domain Objects');
console.log('='.repeat(60));

// --- Encapsulation ---
console.log('\n📦 1. ENCAPSULATION');
const user = new User('u-001', ' TienTuan@Email.COM ', 'hash123');
console.log(`  Created user: ${user.getEmail()} (normalized from input)`);
user.changeEmail('tientuan.dev@erusentia.com');
user.promoteToCreator();
console.log(`  Role: ${user.getRole()}`);
try {
  user.promoteToCreator(); // đã là creator rồi
} catch (e: any) {
  console.log(`  🚫 Expected error: ${e.message}`);
}

// --- Inheritance ---
console.log('\n🧬 2. INHERITANCE');
const template = new Template('t-001', 'u-001', 'React Dashboard Starter Kit');
console.log(`  ${template.toString()}`);
template.publish();
console.log(`  ${template.toString()}`);

const profile = new Profile('p-001', 'tientuan');
profile.addReputation(10); // publish template
profile.addReputation(5);  // fork bonus

// --- Polymorphism ---
console.log('\n🔀 3. POLYMORPHISM');
const notifiers: Notifiable[] = [new EmailNotifier(), new InAppNotifier()];
notifyAll(notifiers, 'u-001', 'Your template "React Dashboard Starter Kit" has been published!');

// --- Abstraction ---
console.log('\n🎭 4. ABSTRACTION');
const validator = new TitleValidator();
console.log('  Validating "  bad title  " (with spaces):');
validator.validateAndReport('  bad title  ');
console.log('  Validating "React Dashboard Starter Kit":');
validator.validateAndReport('React Dashboard Starter Kit');

console.log('\n' + '='.repeat(60));
console.log('✅ All OOP demos completed successfully!');
