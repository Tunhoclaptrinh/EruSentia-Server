import { DynamicModule, Module } from "@nestjs/common";
import { AppConfig } from "../config";
import { CACHE_SETTINGS } from "../cache/template-cache";
import { TemplatesModule } from "../templates/templates.module";
import { NotificationsController } from "./notifications.controller";
import { TemplateFollowsController } from "./template-follows.controller";
import { NotificationsService } from "./notifications.service";
import { TemplateFollowsService } from "./template-follows.service";

@Module({})
export class NotificationsModule {
  static register(settings: AppConfig): DynamicModule {
    return {
      module: NotificationsModule,
      imports: [TemplatesModule.register(settings)],
      controllers: [NotificationsController, TemplateFollowsController],
      providers: [
        NotificationsService,
        TemplateFollowsService,
        { provide: CACHE_SETTINGS, useValue: settings.cache },
      ],
      exports: [NotificationsService, TemplateFollowsService],
    };
  }
}
