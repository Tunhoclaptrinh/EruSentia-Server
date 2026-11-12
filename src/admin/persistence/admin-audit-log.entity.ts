import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("admin_audit_logs")
export class AdminAuditLogEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "actor_id", type: "uuid" }) actorId!: string;
  @Column({ type: "varchar", length: 64 }) action!: string;
  @Column({ name: "target_type", type: "varchar", length: 32 })
  targetType!: string;
  @Column({ name: "target_id", type: "varchar", length: 128, nullable: true })
  targetId!: string | null;
  @Column({ name: "ip_address", type: "varchar", length: 45, nullable: true })
  ipAddress!: string | null;
  @Column({ name: "user_agent", type: "text", nullable: true })
  userAgent!: string | null;
  @Column({ type: "text", nullable: true }) reason!: string | null;
  @Column({ type: "jsonb", default: () => "'{}'" })
  metadata!: Record<string, unknown>;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
}

