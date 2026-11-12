import { ResourceConnectController } from "./resource-connect.controller";
import { DynamicModule, Module } from "@nestjs/common";
import type { AppConfig } from "../config";
import { RESOURCE_SETTINGS } from "./resource-settings";
import { ResourcesService } from "./resources.service";
import {
  ResourceDocumentsController,
  ResourceGatewayController,
  ResourcePlansController,
} from "./resources.controller";
@Module({})
export class ResourcesModule {
  static register(settings: AppConfig): DynamicModule {
    return {
      module: ResourcesModule,
      controllers: [
        ResourceConnectController,
        ResourceGatewayController,
        ResourceDocumentsController,
        ResourcePlansController,
      ],
      providers: [
        ResourcesService,
        { provide: RESOURCE_SETTINGS, useValue: settings.resources },
      ],
      exports: [ResourcesService],
    };
  }
}
