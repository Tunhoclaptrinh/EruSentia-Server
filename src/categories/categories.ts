import {
  Controller,
  DynamicModule,
  Get,
  Inject,
  Injectable,
  Module,
  Optional,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProperty,
  ApiTags,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { DataSource } from "typeorm";
import type { AppConfig } from "../config";
import { ApiErrorDto } from "../templates/dto/template-response.dto";

export const MEMORY_CATEGORIES = [
  {
    id: "c0000000-0000-0000-0000-000000000001",
    name: "Software Engineering",
    slug: "software-engineering",
    icon: "folder",
    description: null,
    displayOrder: 1,
  },
  {
    id: "c0000000-0000-0000-0000-000000000002",
    name: "Project Management",
    slug: "project-management",
    icon: "folder",
    description: null,
    displayOrder: 2,
  },
];
const CATEGORY_STORE = Symbol("category-store");
export class CategoryDto {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() icon!: string;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: "integer" }) displayOrder!: number;
}
@Injectable()
export class CategoriesService {
  constructor(
    @Inject(CATEGORY_STORE) private readonly mode: AppConfig["store"],
    @Optional() private readonly database?: DataSource,
  ) {}
  list(): Promise<CategoryDto[]> {
    if (this.mode === "memory")
      return Promise.resolve(structuredClone(MEMORY_CATEGORIES));
    return this.database!.query(
      'SELECT id,name,slug,icon,description,display_order AS "displayOrder" FROM categories ORDER BY display_order,id',
    );
  }
}
@ApiTags("Categories")
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ApiErrorDto })
@Controller("categories")
export class CategoriesController {
  constructor(private readonly service: CategoriesService) {}
  @Get()
  @ApiOperation({
    summary: "List category IDs for template creation",
    description:
      "Server taxonomy; separate from the App subject category and official/custom source.",
  })
  @ApiOkResponse({ type: CategoryDto, isArray: true })
  list() {
    return this.service.list();
  }
}
@Module({})
export class CategoriesModule {
  static register(mode: AppConfig["store"]): DynamicModule {
    return {
      module: CategoriesModule,
      controllers: [CategoriesController],
      providers: [
        CategoriesService,
        { provide: CATEGORY_STORE, useValue: mode },
      ],
    };
  }
}
