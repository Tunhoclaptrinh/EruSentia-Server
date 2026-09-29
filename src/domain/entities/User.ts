import { BaseEntity } from './BaseEntity';

export type UserRole = 'user' | 'creator' | 'admin';

export interface UserProps {
  id: string;
  email: string;
  passwordHash: string;
  role?: UserRole;
  isActive?: boolean;
  emailVerifiedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  deletedAt?: Date | null;
}

export class User extends BaseEntity {
  private _email: string;
  private _passwordHash: string;
  private _role: UserRole;
  private _isActive: boolean;
  private _emailVerifiedAt: Date | null;

  constructor(props: UserProps) {
    super(props.id, props.createdAt, props.updatedAt, props.deletedAt);
    this.validateEmail(props.email);
    this._email = props.email.toLowerCase().trim();
    this._passwordHash = props.passwordHash;
    this._role = props.role ?? 'user';
    this._isActive = props.isActive ?? true;
    this._emailVerifiedAt = props.emailVerifiedAt ?? null;
  }

  public get email(): string {
    return this._email;
  }

  public get role(): UserRole {
    return this._role;
  }

  public get isActive(): boolean {
    return this._isActive;
  }

  public isEmailVerified(): boolean {
    return this._emailVerifiedAt !== null;
  }

  public verifyEmail(): void {
    this._emailVerifiedAt = new Date();
    this.touch();
  }

  public promoteToCreator(): void {
    if (this._role === 'admin') return;
    this._role = 'creator';
    this.touch();
  }

  public deactivate(): void {
    this._isActive = false;
    this.touch();
  }

  public activate(): void {
    this._isActive = true;
    this.touch();
  }

  private validateEmail(email: string): void {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      throw new Error(`Invalid email address: ${email}`);
    }
  }
}
