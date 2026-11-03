import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("users")
export class AuthorEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "is_active", type: "boolean" }) isActive!: boolean;
  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;
  @OneToMany(() => TemplateEntity, (template) => template.author)
  templates!: TemplateEntity[];
}

@Entity("categories")
export class CategoryEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ type: "varchar", length: 64 }) name!: string;
  @Column({ type: "varchar", length: 64, unique: true }) slug!: string;
  @OneToMany(() => TemplateEntity, (template) => template.category)
  templates!: TemplateEntity[];
}

@Entity("templates")
export class TemplateEntity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "author_id", type: "uuid" }) authorId!: string;
  @Column({ name: "category_id", type: "uuid" }) categoryId!: string;
  @Column({ type: "varchar", length: 255 }) title!: string;
  @Column({ type: "varchar", length: 280, unique: true }) slug!: string;
  @Column({ type: "text" }) description!: string;
  @Column({ name: "content_json", type: "jsonb" }) contentJson!: Record<
    string,
    unknown
  >;
  @Column({
    name: "thumbnail_url",
    type: "varchar",
    length: 512,
    nullable: true,
  })
  thumbnailUrl!: string | null;
  @Column({ type: "varchar", length: 32, default: "1.0.0" }) version!: string;
  @Column({ name: "is_public", type: "boolean", default: true })
  isPublic!: boolean;
  @Column({ name: "is_featured", type: "boolean", default: false })
  isFeatured!: boolean;
  @Column({ name: "forks_count", type: "integer", default: 0 })
  forksCount!: number;
  @Column({ name: "views_count", type: "integer", default: 0 })
  viewsCount!: number;
  @Column({
    name: "rating_avg",
    type: "numeric",
    precision: 3,
    scale: 2,
    default: 0,
    transformer: { to: (v: number) => v, from: (v: string) => Number(v) },
  })
  ratingAvg!: number;
  @Column({ name: "ratings_count", type: "integer", default: 0 })
  ratingsCount!: number;
  @Column({ type: "text", array: true, default: () => "'{}'" }) tags!: string[];
  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;
  @ManyToOne(() => AuthorEntity, (author) => author.templates, {
    onDelete: "RESTRICT",
    nullable: false,
  })
  @JoinColumn({ name: "author_id" })
  author!: AuthorEntity;
  @ManyToOne(() => CategoryEntity, (category) => category.templates, {
    onDelete: "RESTRICT",
    nullable: false,
  })
  @JoinColumn({ name: "category_id" })
  category!: CategoryEntity;
}

export const entities = [TemplateEntity, AuthorEntity, CategoryEntity];
