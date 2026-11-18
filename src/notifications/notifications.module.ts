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
  /**
   * `templates` must be the application's own TemplatesModule registration. Registering it again here
   * would create a second store, cache and controller set: in memory mode follows would read an empty
   * store, and cache invalidations would only reach one of the two caches.
   */
  static register(
    settings: AppConfig,
    templates: DynamicModule,
  ): DynamicModule {
    if (templates.module !== TemplatesModule)
      throw new Error("NotificationsModule needs the TemplatesModule registration");
    return {
      module: NotificationsModule,
      imports: [templates],
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
