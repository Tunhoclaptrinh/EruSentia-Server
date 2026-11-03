import { DynamicModule, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AppConfig } from "../config";
import { entities } from "./persistence/entities";
import { MemoryTemplateStore } from "./persistence/memory-template.store";
import { PostgresTemplateStore } from "./persistence/postgres-template.store";
import { TEMPLATE_STORE } from "./template-store";
import { TemplatesController } from "./templates.controller";
import { TemplatesService } from "./templates.service";

@Module({})
export class TemplatesModule {
  static register(store: AppConfig["store"]): DynamicModule {
    return {
      module: TemplatesModule,
      imports: store === "postgres" ? [TypeOrmModule.forFeature(entities)] : [],
      controllers: [TemplatesController],
      providers: [
        TemplatesService,
        {
          provide: TEMPLATE_STORE,
          useClass:
            store === "postgres" ? PostgresTemplateStore : MemoryTemplateStore,
        },
      ],
    };
  }
}
