import {
  DocumentAdministrationService,
  DocumentHistoryController,
  DocumentPublicReportController,
  DocumentReportsController,
} from "../community-documents/document-administration";
import {
  AdminResourcesController,
  AdminResourcesService,
} from "./admin-resources";
import { AdminTemplateLifecycleService } from "./admin-template-lifecycle";
import { DynamicModule, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AppConfig } from "../config";
import { AdminAuditLogEntity } from "./persistence/admin-audit-log.entity";
import { AdminAuditService } from "./admin-audit.service";
import { AdminUsersService } from "./admin-users.service";
import { AdminTemplatesService } from "./admin-templates.service";
import { AdminSystemService } from "./admin-system.service";
import { AdminAccountsController } from "./admin-accounts.controller";
import { AdminTemplatesController } from "./admin-templates.controller";
import { AdminSystemController } from "./admin-system.controller";
import { AdminAuditController } from "./admin-audit.controller";
import { CommunityDocumentsController } from "../community-documents/documents.controller";
import { CommunityDocumentsService } from "../community-documents/documents.service";
import {
  AdminCategoriesController,
  AdminCategoriesService,
} from "./admin-categories";

@Module({})
export class AdminModule {
  static register(
    settings: AppConfig,
    dependencies: DynamicModule[] = [],
  ): DynamicModule {
    if (settings.store !== "postgres") {
      return {
        module: AdminModule,
        controllers: [],
        providers: [],
        exports: [],
      };
    }

    return {
      module: AdminModule,
      imports: [
        ...dependencies,
        TypeOrmModule.forFeature([AdminAuditLogEntity]),
      ],
      controllers: [
        AdminAccountsController,
        AdminTemplatesController,
        AdminSystemController,
        AdminAuditController,
        AdminCategoriesController,
        AdminResourcesController,
        CommunityDocumentsController,
        DocumentHistoryController,
        DocumentReportsController,
        DocumentPublicReportController,
      ],
      providers: [
        AdminAuditService,
        AdminUsersService,
        AdminTemplatesService,
        AdminTemplateLifecycleService,
        AdminSystemService,
        AdminCategoriesService,
        AdminResourcesService,
        CommunityDocumentsService,
        DocumentAdministrationService,
      ],
      exports: [
        AdminAuditService,
        AdminUsersService,
        AdminTemplatesService,
        AdminSystemService,
      ],
    };
  }
}
