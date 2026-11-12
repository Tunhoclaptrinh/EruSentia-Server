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

@Module({})
export class AdminModule {
  static register(settings: AppConfig): DynamicModule {
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
      imports: [TypeOrmModule.forFeature([AdminAuditLogEntity])],
      controllers: [
        AdminAccountsController,
        AdminTemplatesController,
        AdminSystemController,
        AdminAuditController,
      ],
      providers: [
        AdminAuditService,
        AdminUsersService,
        AdminTemplatesService,
        AdminSystemService,
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
