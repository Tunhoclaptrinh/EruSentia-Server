/**
 * Abstract BaseEntity - Cốt lõi của mọi Domain Entity trong Clean Architecture
 * Đóng gói các thuộc tính cơ bản và hành vi chung (Encapsulation)
 */
export abstract class BaseEntity {
  protected readonly _id: string;
  protected readonly _createdAt: Date;
  protected _updatedAt: Date;
  protected _deletedAt: Date | null;

  constructor(id: string, createdAt?: Date, updatedAt?: Date, deletedAt?: Date | null) {
    this._id = id;
    this._createdAt = createdAt ?? new Date();
    this._updatedAt = updatedAt ?? new Date();
    this._deletedAt = deletedAt ?? null;
  }

  public get id(): string {
    return this._id;
  }

  public get createdAt(): Date {
    return this._createdAt;
  }

  public get updatedAt(): Date {
    return this._updatedAt;
  }

  public get deletedAt(): Date | null {
    return this._deletedAt;
  }

  public isDeleted(): boolean {
    return this._deletedAt !== null;
  }

  public softDelete(): void {
    if (this._deletedAt !== null) {
      throw new Error(`Entity with ID ${this._id} is already deleted.`);
    }
    this._deletedAt = new Date();
    this._updatedAt = new Date();
  }

  public restore(): void {
    this._deletedAt = null;
    this._updatedAt = new Date();
  }

  protected touch(): void {
    this._updatedAt = new Date();
  }
}
