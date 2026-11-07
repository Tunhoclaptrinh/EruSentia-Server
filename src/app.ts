import "reflect-metadata";
import { DynamicModule, Module, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { TypeOrmModule } from "@nestjs/typeorm";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppConfig } from "./config";
import { ApiExceptionFilter } from "./common/api-exception.filter";
import { TemplatesModule } from "./templates/templates.module";
import { entities } from "./templates/persistence/entities";
import { setupOpenApi } from "./openapi";
import { CategoriesModule } from "./categories/categories";
import { AuthModule } from "./auth/auth.module";
import { RefreshSessionEntity } from "./auth/persistence/refresh-session.entity";
import { HealthController } from "./common/health.controller";
import { ServiceControlsModule } from "./service-controls/service-controls.module";

@Module({})
class AppModule {
  static register(settings: AppConfig): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      imports: [
        ...(settings.store === "postgres"
          ? [
              TypeOrmModule.forRoot({
                type: "postgres",
                ...settings.database,
                entities: [...entities, RefreshSessionEntity],
                synchronize: false,
                migrationsRun: false,
                installExtensions: false,
                logging: false,
                retryAttempts: 1,
                extra: { connectionTimeoutMillis: 10000 },
              }),
            ]
          : []),
        ServiceControlsModule.register(settings),
        AuthModule.register(settings),
        CategoriesModule.register(settings.store),
        TemplatesModule.register(settings),
      ],
    };
  }
}

export async function createApplication(
  settings: AppConfig,
  logger: false | undefined = undefined,
) {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register(settings),
    {
      logger,
      abortOnError: false,
    },
  );
  app.enableCors({
    origin: (origin, done) =>
      done(null, !origin || settings.corsOrigins.includes(origin)),
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "If-Match"],
    exposedHeaders: ["X-Cache", "WWW-Authenticate", "ETag", "Retry-After"],
    credentials: false,
    maxAge: 600,
  });
  app.useBodyParser("json", { limit: "2mb" });
  if (settings.serviceControls.trustProxyHops)
    app.set("trust proxy", settings.serviceControls.trustProxyHops);
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  if (settings.swaggerEnabled) setupOpenApi(app);
  return app;
}
