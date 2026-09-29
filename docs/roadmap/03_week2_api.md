# 📅 TUẦN 2: FRAMEWORK, RESTful API & ORM
**Thời gian:** 05/10/2026 – 09/10/2026  
**Ref TYP:** Tuần 2 — Framework, RESTful API & ORM  
**Module EruSentia:** Template Marketplace API + Document Hub API (30+ endpoints)

---

## 🎯 MỤC TIÊU TUẦN NÀY

Theo yêu cầu TYP: *"Backend project chạy được với DB thật, tối thiểu 5 API CRUD, Pagination, Error Response và Postman test"*

Áp dụng vào EruSentia: Xây dựng toàn bộ REST API cho **Template Marketplace** và **Document Hub** — 2 tính năng cốt lõi của EruSentia Cloud (xem `ecosystem_and_hub_architecture.md`).

---

## 📅 LỊCH BIỂU TỪNG NGÀY

### 🗓️ Thứ 2 — 05/10: Khởi tạo NestJS + Module đầu tiên

**Buổi sáng: Setup dự án (2 tiếng)**

```bash
# Tạo repo mới (song song với repo EruSentia frontend)
npx @nestjs/cli@latest new erusentia-api
cd erusentia-api

# Cài dependencies tuần 2
npm install @nestjs/typeorm typeorm pg
npm install @nestjs/config class-validator class-transformer
npm install -D @types/pg

# Cài dependencies chuẩn bị tuần sau
npm install @nestjs/passport passport passport-jwt @nestjs/jwt bcryptjs
npm install -D @types/passport-jwt @types/bcryptjs
```

**Tìm hiểu cấu trúc NestJS:**
```
src/
├── app.module.ts     ← Root module: import tất cả module khác
├── main.ts           ← Bootstrap: khởi tạo app, global pipe, prefix
└── [feature]/
    ├── [feature].module.ts      ← Khai báo module
    ├── [feature].controller.ts  ← HTTP layer: nhận request, gọi service
    ├── [feature].service.ts     ← Business logic
    └── entities/[feature].entity.ts  ← TypeORM entity
```

**Câu hỏi tự hỏi: Framework là gì? Tại sao chọn NestJS không phải Express?**
> Express là thư viện tối giản, tự quyết định mọi thứ. NestJS là framework opinionated (có quy ước sẵn), dùng DI giống Spring Boot, TypeScript native, và dùng chung TypeScript với EruSentia frontend → chia sẻ types giữa frontend và backend.

**Buổi chiều: main.ts + AppModule + DatabaseModule**

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core'
import { ValidationPipe, VersioningType } from '@nestjs/common'
import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  // Global prefix: tất cả route có /api/v1/...
  app.setGlobalPrefix('api')

  // API Versioning (header-based)
  app.enableVersioning({
    type: VersioningType.URI,  // /api/v1/templates
  })

  // Global validation pipe: tự động validate DTO
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,           // Xóa field không khai báo trong DTO
    forbidNonWhitelisted: true,// Báo lỗi nếu có field lạ
    transform: true,           // Tự convert string → number, string → Date
  }))

  // CORS cho frontend EruSentia
  app.enableCors({
    origin: ['http://localhost:5173', 'https://erusentia.com'],
    credentials: true,
  })

  await app.listen(process.env.PORT ?? 3001)
  console.log(`🚀 EruSentia API running on: http://localhost:3001/api/v1`)
}
bootstrap()
```

```typescript
// src/common/interceptors/transform.interceptor.ts
// Wrap response thành format chuẩn
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map(data => ({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      }))
    )
  }
}

// src/common/filters/http-exception.filter.ts
// Chuẩn hóa error response
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const status = exception.getStatus()
    const exceptionResponse = exception.getResponse() as any

    response.status(status).json({
      success: false,
      statusCode: status,
      error: exceptionResponse.error || HttpStatus[status],
      message: exceptionResponse.message || exception.message,
      timestamp: new Date().toISOString(),
    })
  }
}
```

**Commit:**
```bash
git commit -m "feat: init NestJS project with global prefix, validation, transform interceptor"
```

---

### 🗓️ Thứ 3 — 06/10: TypeORM Entities + Repository

**Buổi sáng: TypeORM Entities — Map từ SQL schema tuần 1**

```typescript
// src/users/entities/user.entity.ts
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column({ unique: true })
  email: string

  @Column({ unique: true })
  username: string

  @Column({ name: 'display_name', nullable: true })
  displayName: string

  @Column({ name: 'avatar_url', nullable: true })
  avatarUrl: string

  @Column({ default: 'user' })
  role: string  // 'user' | 'creator' | 'admin'

  @Column({ name: 'password_hash', nullable: true, select: false })
  passwordHash: string  // select: false = không trả về khi query bình thường

  @Column({ name: 'is_verified', default: false })
  isVerified: boolean

  @Column({ name: 'is_banned', default: false })
  isBanned: boolean

  @OneToMany(() => TemplateEntity, template => template.author)
  templates: TemplateEntity[]

  @OneToMany(() => DocumentEntity, doc => doc.author)
  documents: DocumentEntity[]

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}
```

```typescript
// src/templates/entities/template.entity.ts
@Entity('templates')
export class TemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column()
  title: string

  @Column({ unique: true })
  slug: string

  @Column({ nullable: true })
  description: string

  @Column({ name: 'short_desc', nullable: true })
  shortDesc: string

  @Column()
  category: string

  @Column({ type: 'text', array: true, default: [] })
  tags: string[]

  @Column({ name: 'thumbnail_url', nullable: true })
  thumbnailUrl: string

  @Column({ name: 'html_content', type: 'text' })
  htmlContent: string

  @Column({ name: 'schema_json', type: 'jsonb', nullable: true })
  schemaJson: object

  @Column({ name: 'template_type', default: 'full' })
  templateType: string

  @Column({ name: 'download_count', default: 0 })
  downloadCount: number

  @Column({ name: 'view_count', default: 0 })
  viewCount: number

  @Column({ name: 'is_public', default: true })
  isPublic: boolean

  @Column({ name: 'price_vnd', default: 0 })
  priceVnd: number

  @Column({ default: 'published' })
  status: string

  @Column({ name: 'shadow_markdown', type: 'text', nullable: true })
  shadowMarkdown: string

  // Relations
  @ManyToOne(() => UserEntity, user => user.templates, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'author_id' })
  author: UserEntity

  @Column({ name: 'author_id' })
  authorId: string

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date
}
```

**Buổi chiều: Repository Pattern + Service**

```typescript
// src/templates/templates.service.ts

@Injectable()
export class TemplatesService {
  constructor(
    @InjectRepository(TemplateEntity)
    private readonly templateRepo: Repository<TemplateEntity>,
  ) {}

  async findAll(query: QueryTemplateDto) {
    const { page = 1, limit = 20, category, tags, search, sort = 'created_at', order = 'desc' } = query

    const qb = this.templateRepo.createQueryBuilder('t')
      .leftJoinAndSelect('t.author', 'author')  // Join user để lấy tên tác giả
      .where('t.status = :status', { status: 'published' })
      .andWhere('t.is_public = true')

    // Lọc theo category
    if (category) {
      qb.andWhere('t.category = :category', { category })
    }

    // Lọc theo tags (GIN index)
    if (tags && tags.length > 0) {
      qb.andWhere('t.tags @> :tags', { tags })  // Array contains
    }

    // Tìm kiếm full-text đơn giản
    if (search) {
      qb.andWhere(
        '(t.title ILIKE :search OR t.description ILIKE :search)',
        { search: `%${search}%` }
      )
    }

    // Sort
    const validSorts = ['created_at', 'download_count', 'view_count']
    const sortField = validSorts.includes(sort) ? `t.${sort}` : 't.created_at'
    qb.orderBy(sortField, order.toUpperCase() as 'ASC' | 'DESC')

    // Pagination
    const skip = (page - 1) * limit
    qb.skip(skip).take(limit)

    const [data, total] = await qb.getManyAndCount()

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      }
    }
  }
}
```

**N+1 Problem — QUAN TRỌNG:**
```typescript
// ❌ N+1 Query: Mỗi template gọi 1 query riêng để lấy author
const templates = await this.templateRepo.find()
for (const t of templates) {
  const author = await this.userRepo.findOne(t.authorId)  // N queries!
}

// ✅ Cách đúng: Dùng relations hoặc JOIN
const templates = await this.templateRepo.find({
  relations: ['author'],  // 1 JOIN query duy nhất
})

// ✅ Hoặc dùng QueryBuilder với leftJoinAndSelect
const templates = await this.templateRepo
  .createQueryBuilder('t')
  .leftJoinAndSelect('t.author', 'author')
  .getMany()
```

**Commit:**
```bash
git commit -m "feat(db): add TypeORM entities and repository pattern for templates/documents"
```

---

### 🗓️ Thứ 4 — 07/10: CRUD API + HTTP Status Codes

**Buổi sáng: DTO + Validation**

```typescript
// src/templates/dto/create-template.dto.ts
export class CreateTemplateDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  title: string

  @IsString()
  @IsOptional()
  @MaxLength(300)
  shortDesc?: string

  @IsIn(['education', 'work', 'presentation', 'thinking', 'personal'])
  category: string

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  @IsOptional()
  tags?: string[]

  @IsString()
  @MinLength(1)
  htmlContent: string

  @IsBoolean()
  @IsOptional()
  isPublic?: boolean

  @IsNumber()
  @Min(0)
  @IsOptional()
  priceVnd?: number
}

// src/templates/dto/query-template.dto.ts
export class QueryTemplateDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => parseInt(value))
  page?: number = 1

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value))
  limit?: number = 20

  @IsOptional()
  @IsIn(['education', 'work', 'presentation', 'thinking', 'personal'])
  category?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => typeof value === 'string' ? [value] : value)
  tags?: string[]

  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @IsIn(['created_at', 'download_count', 'view_count'])
  sort?: string = 'created_at'

  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: string = 'desc'
}
```

**Buổi chiều: Controller với đầy đủ HTTP Status codes**

```typescript
// src/templates/templates.controller.ts
@Controller({ path: 'templates', version: '1' })
@UseInterceptors(TransformInterceptor)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  // GET /api/v1/templates
  @Get()
  @HttpCode(HttpStatus.OK)           // 200
  findAll(@Query() query: QueryTemplateDto) {
    return this.templatesService.findAll(query)
  }

  // GET /api/v1/templates/trending
  @Get('trending')
  @HttpCode(HttpStatus.OK)
  getTrending() {
    return this.templatesService.getTrending()
  }

  // GET /api/v1/templates/:id
  @Get(':id')
  @HttpCode(HttpStatus.OK)           // 200
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.templatesService.findOne(id)
    // Service throw NotFoundException nếu không tìm thấy → 404
  }

  // POST /api/v1/templates
  @Post()
  @HttpCode(HttpStatus.CREATED)      // 201
  // @UseGuards(JwtAuthGuard, RolesGuard)  ← Thêm tuần 3
  // @Roles('creator', 'admin')
  create(@Body() dto: CreateTemplateDto) {
    return this.templatesService.create(dto)
  }

  // PATCH /api/v1/templates/:id
  @Patch(':id')
  @HttpCode(HttpStatus.OK)           // 200
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTemplateDto,
  ) {
    return this.templatesService.update(id, dto)
    // Service throw ForbiddenException nếu không phải owner → 403
  }

  // DELETE /api/v1/templates/:id
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)   // 204 (không có body)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.templatesService.remove(id)
  }

  // POST /api/v1/templates/:id/fork
  @Post(':id/fork')
  @HttpCode(HttpStatus.CREATED)      // 201
  fork(@Param('id', ParseUUIDPipe) id: string) {
    return this.templatesService.fork(id)
  }

  // GET /api/v1/templates/:id/download
  @Get(':id/download')
  @HttpCode(HttpStatus.OK)           // 200
  download(@Param('id', ParseUUIDPipe) id: string) {
    return this.templatesService.download(id)
    // Trả về html_content để frontend tạo file
  }
}
```

**HTTP Status Code cần thuộc:**
```
200 OK             → GET thành công, PATCH thành công
201 Created        → POST tạo resource mới thành công
204 No Content     → DELETE thành công (không có body)
400 Bad Request    → Input không hợp lệ (validation fail)
401 Unauthorized   → Chưa đăng nhập (không có hoặc hết hạn JWT)
403 Forbidden      → Đã đăng nhập nhưng không có quyền
404 Not Found      → Resource không tồn tại
409 Conflict       → Duplicate (email đã tồn tại, slug đã dùng)
422 Unprocessable  → Dữ liệu hiểu được nhưng không xử lý được
429 Too Many       → Rate limit
500 Internal       → Lỗi server (không bao giờ để lộ detail)
```

**Commit:**
```bash
git commit -m "feat(templates): add CRUD endpoints with proper HTTP status codes and DTOs"
```

---

### 🗓️ Thứ 5 — 08/10: Document Hub API + Relations

**Buổi sáng: OneToMany / ManyToOne Relations**

```typescript
// src/documents/entities/document.entity.ts
@Entity('documents')
export class DocumentEntity {
  // ... các cột khác

  // Một Document có nhiều DocumentNotes
  @OneToMany(() => DocumentNoteEntity, note => note.document, {
    cascade: ['insert', 'update'],  // Khi save document → auto save notes
    eager: false,                   // Không tự load, phải chỉ định relations
  })
  notes: DocumentNoteEntity[]

  // Nhiều Forks thuộc về Document này
  @OneToMany(() => ForkEntity, fork => fork.document)
  forks: ForkEntity[]
}

// src/documents/entities/document-note.entity.ts
@Entity('document_notes')
export class DocumentNoteEntity {
  // Một DocumentNote thuộc về một Document
  @ManyToOne(() => DocumentEntity, doc => doc.notes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: DocumentEntity

  @Column({ name: 'document_id' })
  documentId: string
}
```

**Buổi chiều: Document Hub API**

```typescript
// Các endpoint cần implement hôm nay:
// GET  /documents               - Danh sách + filter university/subject
// GET  /documents/universities  - Danh sách university unique (cho filter UI)
// GET  /documents/:id           - Chi tiết + danh sách notes
// GET  /documents/:id/notes/:noteId - Nội dung HTML của 1 note
// POST /documents               - Tạo bộ tài liệu
// POST /documents/:id/notes     - Thêm note vào bộ
// POST /documents/:id/fork      - Fork bộ tài liệu
// PATCH /documents/:id          - Sửa metadata
// DELETE /documents/:id         - Xóa

// Chú ý: fork document cần SELECT FOR UPDATE (Pessimistic Locking từ tuần 1)
async fork(documentId: string, userId: string) {
  return this.dataSource.transaction(async (manager) => {
    // Lock document để tránh race condition khi nhiều người fork đồng thời
    const doc = await manager
      .createQueryBuilder(DocumentEntity, 'd')
      .where('d.id = :id', { id: documentId })
      .setLock('pessimistic_write')   // FOR UPDATE
      .getOne()

    if (!doc) throw new NotFoundException('Document not found')

    // Tăng fork_count
    await manager.increment(DocumentEntity, { id: documentId }, 'forkCount', 1)

    // Ghi lịch sử fork
    const fork = manager.create(ForkEntity, {
      userId,
      sourceType: 'document',
      sourceId: documentId,
      sourceTitle: doc.title,
      sourceAuthorId: doc.authorId,
    })
    await manager.save(fork)

    return fork
  })
}
```

**Commit:**
```bash
git commit -m "feat(documents): add Document Hub API with fork pessimistic locking"
```

---

### 🗓️ Thứ 6 — 09/10: Postman Collection + Chuẩn hóa + Nộp bài

**Buổi sáng: Viết Postman Collection**

Postman collection phải test đủ:
```
Templates:
  ✅ GET /api/v1/templates (happy path)
  ✅ GET /api/v1/templates?category=education&page=2&limit=10
  ✅ GET /api/v1/templates?search=cornell&sort=download_count&order=desc
  ✅ GET /api/v1/templates/trending
  ✅ GET /api/v1/templates/:id (valid uuid)
  ❌ GET /api/v1/templates/invalid-uuid → 400 Bad Request
  ❌ GET /api/v1/templates/not-exist-uuid → 404 Not Found
  ✅ POST /api/v1/templates (valid body) → 201 Created
  ❌ POST /api/v1/templates (missing title) → 400 Bad Request
  ❌ POST /api/v1/templates (invalid category) → 400 Bad Request
  ✅ PATCH /api/v1/templates/:id
  ✅ DELETE /api/v1/templates/:id → 204 No Content

Documents:
  ✅ GET /api/v1/documents
  ✅ GET /api/v1/documents?university=Bách Khoa&subject=Lập trình
  ✅ GET /api/v1/documents/universities (unique list)
  ✅ GET /api/v1/documents/:id (kèm notes array)
  ✅ POST /api/v1/documents
  ✅ POST /api/v1/documents/:id/notes
  ✅ POST /api/v1/documents/:id/fork
```

**Buổi chiều: Review + Nộp bài**
- [ ] Check không có N+1 query (bật TypeORM logging: `logging: true` trong config)
- [ ] Check tất cả error response đều theo format chuẩn
- [ ] Export Postman collection thành JSON, commit lên GitHub
- [ ] Push và tag: `git tag week2-complete`

**Commit cuối tuần:**
```bash
git add .
git commit -m "docs: add Postman collection + week2 completion"
git tag week2-complete
git push origin main --tags
```

---

## ❓ 5 CÂU HỎI PHỎNG VẤN TUẦN 2

1. **DTO là gì? Tại sao không trả thẳng Entity ra response API?**
   > DTO (Data Transfer Object) là object chứa dữ liệu muốn truyền qua API. Không trả Entity vì: (1) Entity có thể có field nhạy cảm (password_hash), (2) Thay đổi DB schema không nên ảnh hưởng API response, (3) DTO là contract giữa client và server.

2. **N+1 query là gì? Cách phát hiện và fix?**
   > N+1: load 20 templates thì gọi thêm 20 query riêng để load author của mỗi template = 21 queries. Fix: dùng JOIN (leftJoinAndSelect) hoặc `relations` option. Phát hiện: bật TypeORM logging và đếm số queries.

3. **Phân biệt 401 và 403?**
   > 401 = Chưa xác thực (không có JWT hoặc JWT hết hạn). 403 = Đã xác thực nhưng không có quyền (user thường cố xóa template của người khác).

4. **Path Variable và Query Param dùng khi nào?**
   > Path Variable (`/templates/:id`): định danh resource cụ thể. Query Param (`?category=education&page=2`): lọc, sắp xếp, phân trang — optional, không thay đổi resource được truy cập.

5. **Tại sao `DELETE` trả về 204 No Content thay vì 200?**
   > 204 nghĩa là thành công nhưng không có gì để trả về. Sau khi xóa resource không còn tồn tại → không có gì để serialize thành response body. 200 yêu cầu có body.

---

## 📋 CHECKLIST TUẦN 2

- [ ] NestJS chạy ở port 3001: `curl http://localhost:3001/api/v1/templates`
- [ ] 30+ endpoints đều trả response đúng format (success/error)
- [ ] Phân trang hoạt động: `?page=2&limit=10` trả meta đúng
- [ ] Validation hoạt động: POST thiếu field → 400 với message rõ ràng
- [ ] Không có N+1 query (kiểm tra bằng TypeORM logging)
- [ ] Fork document dùng Pessimistic Locking (transaction)
- [ ] Postman collection đủ happy path + sad path cho mọi endpoint
- [ ] Commit push GitHub với tag `week2-complete`
- [ ] Viết 5 Q&A phỏng vấn

---

> ⬅️ [Tuần 1: Database & OOP](./02_week1_database.md) | ⬆️ [Kế hoạch tổng thể](./01_master_plan.md) | ➡️ Tuần 3: Auth *(coming soon)*
