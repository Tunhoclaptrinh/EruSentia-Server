import { DynamicModule, Global, Module } from "@nestjs/common";
import { AppConfig } from "../config";
import { MemoryRateStore, PostgresRateStore, RATE_STORE } from "./rate-store";
import { RATE_SECRET, ServiceControls } from "./service-controls";
import { SERVICE_CONTROL_SETTINGS } from "./settings";
@Global()
@Module({})
export class ServiceControlsModule {
  static register(settings: AppConfig): DynamicModule {
    return {
      module: ServiceControlsModule,
      providers: [
        {
          provide: SERVICE_CONTROL_SETTINGS,
          useValue: settings.serviceControls,
        },
        { provide: RATE_SECRET, useValue: settings.auth.secret },
        {
          provide: RATE_STORE,
          useClass:
            settings.store === "postgres" ? PostgresRateStore : MemoryRateStore,
        },
        ServiceControls,
      ],
      exports: [ServiceControls, SERVICE_CONTROL_SETTINGS],
    };
  }
}
