import { ReportStore } from "../moderation/report-store";
import { ReportsController } from "../moderation/reports.controller";
import { DynamicModule, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AppConfig } from "../config";
import { entities } from "./persistence/entities";
import { MemoryTemplateStore } from "./persistence/memory-template.store";
import { PostgresTemplateStore } from "./persistence/postgres-template.store";
import { TEMPLATE_STORE } from "./template-store";
import { TemplatesController } from "./templates.controller";
import { TemplateCache, CACHE_SETTINGS } from "../cache/template-cache";
import { TemplateUsageController } from "./template-usage.controller";
import { TemplatesService } from "./templates.service";

@Module({})
export class TemplatesModule {
  static register(settings: AppConfig): DynamicModule {
    const store = settings.store;
    return {
      module: TemplatesModule,
      imports: store === "postgres" ? [TypeOrmModule.forFeature(entities)] : [],
      controllers: [
        TemplatesController,
        TemplateUsageController,
        ReportsController,
      ],
      providers: [
        TemplatesService,
        ReportStore,
        TemplateCache,
        { provide: CACHE_SETTINGS, useValue: settings.cache },
        {
          provide: TEMPLATE_STORE,
          useClass:
            store === "postgres" ? PostgresTemplateStore : MemoryTemplateStore,
        },
      ],
    };
  }
}
