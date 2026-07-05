import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";

import { JwtAuthModule } from "./common/modules/jwt-auth.module";
import { RedisModule } from "./common/modules/redis.module";
import { AuthRateLimitMiddleware } from "./common/middleware/auth-rate-limit.middleware";
import { ContactRateLimitMiddleware } from "./common/middleware/contact-rate-limit.middleware";
import { MusicRateLimitMiddleware } from "./common/middleware/music-rate-limit.middleware";
import { RateLimitMiddleware } from "./common/middleware/rate-limit.middleware";
import { SecurityHeadersMiddleware } from "./common/middleware/security-headers.middleware";
import { UploadRateLimitMiddleware } from "./common/middleware/upload-rate-limit.middleware";
import { VerifyCodeRateLimitMiddleware } from "./common/middleware/verify-code-rate-limit.middleware";
import { MailModule } from "./common/services/mail.module";
import { TokenBlacklistModule } from "./common/services/token-blacklist.module";
import {
  AdminAuditLog,
  AdminPermission,
  AdminRole,
  AdminUser,
  ContactSubmission,
  NotificationCampaign,
  PushToken,
  Repit,
  Spotlight,
  SupportTicketNote,
  Template,
  TemplateVersion,
  User,
} from "./entities";
import { AdminModule } from "./modules/admin/admin.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ContactModule } from "./modules/contact/contact.module";
import { HealthModule } from "./modules/health/health.module";
import { ImagesModule } from "./modules/images/images.module";
import { MusicModule } from "./modules/music/music.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { RepitsModule } from "./modules/repits/repits.module";
import { SpotlightModule } from "./modules/spotlight/spotlight.module";
import { TemplatesModule } from "./modules/templates/templates.module";
import { UploadsModule } from "./modules/uploads/uploads.module";
import { UsersModule } from "./modules/users/users.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const isProduction = config.get<string>("NODE_ENV") === "production";
        return {
          type: "postgres" as const,
          url:
            config.get<string>("DATABASE_URL") ??
            "postgresql://repitair:repitair@localhost:5432/repitair",
          entities: [
            User,
            Repit,
            PushToken,
            Template,
            TemplateVersion,
            ContactSubmission,
            Spotlight,
            AdminPermission,
            AdminRole,
            AdminUser,
            AdminAuditLog,
            SupportTicketNote,
            NotificationCampaign,
          ],
          migrations: isProduction ? ["dist/migrations/*.js"] : ["src/migrations/*.ts"],
          synchronize: false,
          migrationsRun: false,
          logging: !isProduction,
        };
      },
    }),
    RedisModule,
    JwtAuthModule,
    TokenBlacklistModule,
    MailModule,
    HealthModule,
    AuthModule,
    UsersModule,
    UploadsModule,
    ImagesModule,
    MusicModule,
    TemplatesModule,
    RepitsModule,
    SpotlightModule,
    NotificationsModule,
    ContactModule,
    AdminModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SecurityHeadersMiddleware).forRoutes("*");
    consumer.apply(RateLimitMiddleware).forRoutes("*");

    consumer
      .apply(AuthRateLimitMiddleware)
      .forRoutes({ path: "auth/*", method: RequestMethod.ALL });

    consumer
      .apply(VerifyCodeRateLimitMiddleware)
      .forRoutes({ path: "auth/verify-code", method: RequestMethod.POST });

    consumer
      .apply(ContactRateLimitMiddleware)
      .forRoutes({ path: "contact", method: RequestMethod.POST });

    consumer
      .apply(MusicRateLimitMiddleware)
      .forRoutes({ path: "music/*", method: RequestMethod.ALL });

    consumer
      .apply(UploadRateLimitMiddleware)
      .forRoutes(
        { path: "uploads/*", method: RequestMethod.POST },
        { path: "images/*", method: RequestMethod.POST },
      );
  }
}
