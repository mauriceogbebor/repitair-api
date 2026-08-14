import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  AdminAuditLog,
  AdminAccessReview,
  AdminBreakGlassGrant,
  AdminInvitation,
  AdminPermission,
  AdminRole,
  AdminUser,
  AdminSession,
  ContactSubmission,
  NotificationCampaign,
  PushToken,
  Repit,
  RepitModerationDecision,
  RepitModerationNote,
  RepitModerationReport,
  Spotlight,
  SupportTicketNote,
  SupportTicketResponse,
  SupportTicketEscalation,
  SupportTicketResolution,
  Template,
  TemplateVersion,
  User,
  UserOperationalNote,
  UserRecoveryOperation,
  UserRestriction,
  MediaAsset,
  MediaDerivative,
  AnalyticsEvent,
  MusicCollection,
  MusicConnection,
  MusicPlaylistImport,
} from "../../entities";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { PlatformModule } from "../platform/platform.module";
import { PrivacyModule } from "../privacy/privacy.module";
import { AdminAuditLogsController } from "./audit-logs/admin-audit-logs.controller";
import { AdminPlatformController } from "./platform/admin-platform.controller";
import { AdminPrivacyController } from "./privacy/admin-privacy.controller";
import { AdminJobsController } from "./jobs/admin-jobs.controller";
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
import { AdminRepitModerationService } from "./repits/admin-repit-moderation.service";
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
import { AdminIamController } from "./iam/admin-iam.controller";
import { AdminInvitationAcceptanceController } from "./iam/admin-invitation-acceptance.controller";
import { AdminIamService } from "./iam/admin-iam.service";
import { AdminSessionRegistryService } from "./iam/admin-session-registry.service";
import { AdminMediaController } from "./media/admin-media.controller";
import { AdminMediaService } from "./media/admin-media.service";
import { MediaProcessingModule } from "../media/media-processing.module";
import { MusicConnectionsModule } from "../music/music-connections.module";
import { AdminMusicController } from "./music/admin-music.controller";
import { AdminMusicService } from "./music/admin-music.service";

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    PlatformModule,
    PrivacyModule,
    MediaProcessingModule,
    MusicConnectionsModule,
    TypeOrmModule.forFeature([
      AdminUser,
      AdminRole,
      AdminPermission,
      AdminAuditLog,
      AdminSession,
      AdminInvitation,
      AdminAccessReview,
      AdminBreakGlassGrant,
      User,
      Repit,
      RepitModerationDecision,
      RepitModerationNote,
      RepitModerationReport,
      PushToken,
      Template,
      TemplateVersion,
      Spotlight,
      ContactSubmission,
      SupportTicketNote,
      SupportTicketResponse,
      SupportTicketEscalation,
      SupportTicketResolution,
      NotificationCampaign,
      UserOperationalNote,
      UserRecoveryOperation,
      UserRestriction,
      MediaAsset,
      MediaDerivative,
      AnalyticsEvent,
      MusicConnection,
      MusicPlaylistImport,
      MusicCollection,
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
    AdminIamController,
    AdminInvitationAcceptanceController,
    AdminPlatformController,
    AdminPrivacyController,
    AdminJobsController,
    AdminMediaController,
    AdminMusicController,
  ],
  providers: [
    AdminAuthService,
    AdminSessionService,
    AdminTokenService,
    AdminAuditLogsService,
    AdminDashboardService,
    AdminUsersService,
    AdminRepitsService,
    AdminRepitModerationService,
    AdminSearchService,
    AdminTemplatesService,
    AdminSpotlightService,
    AdminSupportService,
    AdminNotificationsService,
    AdminIamService,
    AdminSessionRegistryService,
    AdminJwtAuthGuard,
    AdminRbacGuard,
    AdminCsrfMiddleware,
    AdminBootstrapService,
    AdminMediaService,
    AdminMusicService,
  ],
  exports: [
    AdminAuthService,
    AdminSessionService,
    AdminTokenService,
    AdminAuditLogsService,
    AdminJwtAuthGuard,
    AdminRbacGuard,
    AdminSessionRegistryService,
  ],
})
export class AdminModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(AdminRequestContextMiddleware, AdminCsrfMiddleware)
      .forRoutes({ path: "admin/(.*)", method: RequestMethod.ALL });
  }
}
