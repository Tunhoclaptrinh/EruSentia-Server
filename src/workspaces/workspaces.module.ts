import { DynamicModule, Module } from "@nestjs/common";
import { AppConfig } from "../config";
import { CACHE_SETTINGS } from "../cache/template-cache";
import { WorkspacesController } from "./workspaces.controller";
import { WorkspacesService } from "./workspaces.service";

@Module({})
export class WorkspacesModule {
  static register(settings: AppConfig): DynamicModule {
    return {
      module: WorkspacesModule,
      controllers: [WorkspacesController],
      providers: [
        WorkspacesService,
        { provide: CACHE_SETTINGS, useValue: settings.cache },
      ],
      exports: [WorkspacesService],
    };
  }
}

