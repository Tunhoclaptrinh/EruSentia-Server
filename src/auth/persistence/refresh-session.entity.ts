import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";
import { AuthorEntity } from "../../templates/persistence/entities";

@Entity("auth_refresh_sessions")
export class RefreshSessionEntity {
  @PrimaryColumn("uuid") id!: string;
  @Column({ name: "user_id", type: "uuid" }) userId!: string;
  @Index() @Column({ name: "family_id", type: "uuid" }) familyId!: string;
  @Column({ name: "token_hash", type: "varchar", length: 64, unique: true })
  tokenHash!: string;
  @Column({ name: "expires_at", type: "timestamptz" }) expiresAt!: Date;
  @Column({ name: "used_at", type: "timestamptz", nullable: true })
  usedAt!: Date | null;
  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt!: Date | null;
  @Column({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @ManyToOne(() => AuthorEntity, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: AuthorEntity;
}
