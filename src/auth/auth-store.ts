export type Role = "user" | "creator" | "admin";

export interface UserAccount {
  id: string;
  email: string;
  passwordHash: string;
  role: Role;
  isActive: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type UserIdentity = Pick<
  UserAccount,
  "id" | "email" | "role" | "createdAt"
>;

export function userIdentity(user: UserAccount): UserIdentity {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

export function active(user: UserAccount | null): user is UserAccount {
  return !!user && user.isActive && !user.deletedAt;
}

export interface RefreshSession {
  id: string;
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

export const AUTH_STORE = Symbol("AUTH_STORE");
export interface AuthStore {
  createUser(input: {
    email: string;
    passwordHash: string;
    role: Role;
  }): Promise<UserAccount>;
  findByEmail(email: string): Promise<UserAccount | null>;
  findById(id: string): Promise<UserAccount | null>;
  listUsers(
    page: number,
    size: number,
  ): Promise<{
    data: UserIdentity[];
    page: number;
    size: number;
    totalPages: number;
    totalElements: number;
  }>;
  addSession(session: RefreshSession): Promise<void>;
  rotateSession(
    hash: string,
    nextHash: string,
    nextId: string,
    now: Date,
  ): Promise<{ session: RefreshSession; user: UserAccount } | null>;
  revokeSessionFamily(hash: string, now: Date): Promise<void>;
  isSessionActive(
    userId: string,
    familyId: string,
    now: Date,
  ): Promise<boolean>;
}
