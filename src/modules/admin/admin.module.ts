import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
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
} from "../../entities";
import { AdminAuditLogsController } from "./audit-logs/admin-audit-logs.controller";
import { AdminAuditLogsService } from "./audit-logs/admin-audit-logs.service";
import { AdminAuthController } from "./auth/admin-auth.controller";
import { AdminAuthService } from "./auth/admin-auth.service";
import { AdminSessionService } from "./auth/admin-session.service";
import { AdminTokenService } from "./auth/admin-token.service";
import { AdminBootstrapService } from "./bootstrap/admin-bootstrap.service";
import { AdminDashboardController } from "./dashboard/admin-dashboard.controller";
import { AdminDashboardService } from "./dashboard/admin-dashboard.service";
import { AdminJwtAuthGuard } from "./guards/admin-jwt-auth.guard";
import { AdminRbacGuard } from "./guards/admin-rbac.guard";
import { AdminRequestContextMiddleware } from "./middleware/admin-request-context.middleware";
import { AdminCsrfMiddleware } from "./middleware/admin-csrf.middleware";
import { AdminNotificationsController } from "./notifications/admin-notifications.controller";
import { AdminNotificationsService } from "./notifications/admin-notifications.service";
import { AdminRepitsController } from "./repits/admin-repits.controller";
import { AdminRepitsService } from "./repits/admin-repits.service";
import { AdminSearchController } from "./search/admin-search.controller";
import { AdminSearchService } from "./search/admin-search.service";
import { AdminSpotlightController } from "./spotlight/admin-spotlight.controller";
import { AdminSpotlightService } from "./spotlight/admin-spotlight.service";
import { AdminSupportController } from "./support/admin-support.controller";
import { AdminSupportService } from "./support/admin-support.service";
import { AdminTemplatesController } from "./templates/admin-templates.controller";
import { AdminTemplatesService } from "./templates/admin-templates.service";
import { AdminUsersController } from "./users/admin-users.controller";
import { AdminUsersService } from "./users/admin-users.service";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdminUser,
      AdminRole,
      AdminPermission,
      AdminAuditLog,
      User,
      Repit,
      PushToken,
      Template,
      TemplateVersion,
      Spotlight,
      ContactSubmission,
      SupportTicketNote,
      NotificationCampaign,
    ]),
  ],
  controllers: [
    AdminAuthController,
    AdminDashboardController,
    AdminAuditLogsController,
    AdminUsersController,
    AdminRepitsController,
    AdminSearchController,
    AdminTemplatesController,
    AdminSpotlightController,
    AdminSupportController,
    AdminNotificationsController,
  ],
  providers: [
    AdminAuthService,
    AdminSessionService,
    AdminTokenService,
    AdminAuditLogsService,
    AdminDashboardService,
    AdminUsersService,
    AdminRepitsService,
    AdminSearchService,
    AdminTemplatesService,
    AdminSpotlightService,
    AdminSupportService,
    AdminNotificationsService,
    AdminJwtAuthGuard,
    AdminRbacGuard,
    AdminCsrfMiddleware,
    AdminBootstrapService,
  ],
  exports: [
    AdminAuthService,
    AdminSessionService,
    AdminTokenService,
    AdminAuditLogsService,
    AdminJwtAuthGuard,
    AdminRbacGuard,
  ],
})
export class AdminModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AdminRequestContextMiddleware, AdminCsrfMiddleware)
      .forRoutes({ path: "admin/(.*)", method: RequestMethod.ALL });
  }
}
