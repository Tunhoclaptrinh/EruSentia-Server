import { AccountEmailController } from "./account-email.controller";
import { AccountEmailService } from "./account-email.service";
import {
  ACCOUNT_EMAIL_CONFIG,
  AccountEmailMailer,
} from "./account-email.mailer";
import { DynamicModule, Global, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AppConfig } from "../config";
import { AuthorEntity } from "../templates/persistence/entities";
import { AUTH_STORE } from "./auth-store";
import { AdminUsersController, AuthController } from "./auth.controller";
import { AccessTokenGuard, RolesGuard } from "./auth.guards";
import { AuthService, AUTH_SETTINGS } from "./auth.service";
import { REGISTRATION_EVENTS_ENABLED } from "../messaging/registration-event";
import { Passwords } from "./passwords";
import { MemoryAuthStore } from "./persistence/memory-auth.store";
import { PostgresAuthStore } from "./persistence/postgres-auth.store";
import { RefreshSessionEntity } from "./persistence/refresh-session.entity";
import { ServiceRateGuard } from "../service-controls/service-controls";

@Global()
@Module({})
export class AuthModule {
  static register(settings: AppConfig): DynamicModule {
    return {
      module: AuthModule,
      imports: [
        JwtModule.register({
          secret: settings.auth.secret,
          signOptions: {
            algorithm: "HS256",
            issuer: "erusentia-server",
            audience: "erusentia-api",
            expiresIn: settings.auth.accessTtlSeconds,
          },
        }),
        ...(settings.store === "postgres"
          ? [TypeOrmModule.forFeature([AuthorEntity, RefreshSessionEntity])]
          : []),
      ],
      controllers: [
        AuthController,
        AdminUsersController,
        AccountEmailController,
      ],
      providers: [
        { provide: AUTH_SETTINGS, useValue: settings.auth },
        {
          provide: REGISTRATION_EVENTS_ENABLED,
          useValue: settings.queue.enabled,
        },
        {
          provide: AUTH_STORE,
          useClass:
            settings.store === "postgres" ? PostgresAuthStore : MemoryAuthStore,
        },
        {
          provide: ACCOUNT_EMAIL_CONFIG,
          useValue: {
            ...settings.accountEmail,
            smtpHost: settings.queue.smtpHost,
            smtpPort: settings.queue.smtpPort,
          },
        },
        AccountEmailMailer,
        AccountEmailService,
        Passwords,
        AuthService,
        { provide: APP_GUARD, useClass: AccessTokenGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: APP_GUARD, useClass: ServiceRateGuard },
      ],
      exports: [AUTH_STORE, AuthService, Passwords],
    };
  }
}
