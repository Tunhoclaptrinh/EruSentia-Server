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
import { Passwords } from "./passwords";
import { MemoryAuthStore } from "./persistence/memory-auth.store";
import { PostgresAuthStore } from "./persistence/postgres-auth.store";
import { RefreshSessionEntity } from "./persistence/refresh-session.entity";

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
      controllers: [AuthController, AdminUsersController],
      providers: [
        { provide: AUTH_SETTINGS, useValue: settings.auth },
        {
          provide: AUTH_STORE,
          useClass:
            settings.store === "postgres" ? PostgresAuthStore : MemoryAuthStore,
        },
        Passwords,
        AuthService,
        { provide: APP_GUARD, useClass: AccessTokenGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
      exports: [AUTH_STORE, AuthService, Passwords],
    };
  }
}
