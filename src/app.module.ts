import { Module, NestModule, MiddlewareConsumer, RequestMethod } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuthModule } from "./modules/auth/auth.module";
import { ContactModule } from "./modules/contact/contact.module";
import { HealthModule } from "./modules/health/health.module";
import { MusicModule } from "./modules/music/music.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { RepitsModule } from "./modules/repits/repits.module";
import { TemplatesModule } from "./modules/templates/templates.module";
import { UploadsModule } from "./modules/uploads/uploads.module";
import { UsersModule } from "./modules/users/users.module";
import { SecurityHeadersMiddleware } from "./common/middleware/security-headers.middleware";
import { RateLimitMiddleware } from "./common/middleware/rate-limit.middleware";
import { AuthRateLimitMiddleware } from "./common/middleware/auth-rate-limit.middleware";
import { VerifyCodeRateLimitMiddleware } from "./common/middleware/verify-code-rate-limit.middleware";
import { ContactRateLimitMiddleware } from "./common/middleware/contact-rate-limit.middleware";
import { MailModule } from "./common/services/mail.module";
import { TokenBlacklistModule } from "./common/services/token-blacklist.module";
import { JwtAuthModule } from "./common/modules/jwt-auth.module";
import { User, Repit, PushToken } from "./entities";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get<string>("NODE_ENV") === "production";
        // In dev, `synchronize: true` is convenient for rapid iteration.
        // In production, we never synchronize — migrations are the source of
        // truth. Run them explicitly with `npm run migration:run` (or let the
        // container entrypoint run them; see Dockerfile).
        return {
          type: "postgres" as const,
          url: config.get<string>("DATABASE_URL") || "postgresql://repitair:repitair@localhost:5432/repitair",
          entities: [User, Repit, PushToken],
          migrations: isProduction ? ["dist/migrations/*.js"] : ["src/migrations/*.ts"],
          synchronize: !isProduction,
          migrationsRun: false,
          logging: !isProduction,
        };
      },
    }),
    JwtAuthModule,
    TokenBlacklistModule,
    MailModule,
    HealthModule,
    AuthModule,
    UsersModule,
    UploadsModule,
    MusicModule,
    TemplatesModule,
    RepitsModule,
    NotificationsModule,
    ContactModule,
  ]
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply security headers to all routes
    consumer
      .apply(SecurityHeadersMiddleware)
      .forRoutes("*");

    // Apply general rate limiting to all routes
    consumer
      .apply(RateLimitMiddleware)
      .forRoutes("*");

    // Apply stricter auth rate limiting to auth routes
    consumer
      .apply(AuthRateLimitMiddleware)
      .forRoutes({ path: "auth/*", method: RequestMethod.ALL });

    // Per-email brute-force protection for password reset code verification.
    consumer
      .apply(VerifyCodeRateLimitMiddleware)
      .forRoutes({ path: "auth/verify-code", method: RequestMethod.POST });

    // Anti-spam limit on the public contact form.
    consumer
      .apply(ContactRateLimitMiddleware)
      .forRoutes({ path: "contact", method: RequestMethod.POST });
  }
}
