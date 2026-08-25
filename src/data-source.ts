import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config as dotenvConfig } from 'dotenv';

import {
  User,
  SocialIdentity,
  Repit,
  RepitModerationDecision,
  RepitModerationNote,
  RepitModerationReport,
  PushToken,
  Template,
  TemplateDraft,
  TemplateVersion,
  ContactSubmission,
  Spotlight,
  AdminPermission,
  AdminRole,
  AdminUser,
  AdminAuditLog,
  AdminSession,
  AdminInvitation,
  AdminAccessReview,
  AdminBreakGlassGrant,
  SupportTicketNote,
  SupportTicketResponse,
  SupportTicketEscalation,
  SupportTicketResolution,
  NotificationCampaign,
  FeatureFlag,
  PlatformSetting,
  AccountDeletionRequest,
  PrivacyRequest,
  PrivacyJob,
  PrivacyEvent,
  PlatformJob,
  PlatformWorkerHeartbeat,
  AnalyticsEvent,
  UserOperationalNote,
  UserRecoveryOperation,
  UserRestriction,
  MediaAsset,
  MediaDerivative,
  MusicCollection,
  MusicConnection,
  MusicOAuthState,
  MusicPlaylistImport,
} from './entities';

dotenvConfig();

/**
 * Standalone DataSource used ONLY by the TypeORM CLI for generating
 * running migrations. The runtime app config lives in app.module.ts.
 *
 * Keep these two in sync when you add entities or change connection options.
 *
 * - In development (ts-node), migrations are loaded from src as .ts files.
 * - In production (compiled), migrations are loaded from dist as .js files.
 */
const isCompiled = __filename.endsWith('.js');

export default new DataSource({
  type: 'postgres',
  url:
    process.env.DATABASE_URL ||
    'postgresql://repitair:repitair@localhost:5432/repitair',
  entities: [
    User,
    SocialIdentity,
    Repit,
    RepitModerationDecision,
    RepitModerationNote,
    RepitModerationReport,
    PushToken,
    Template,
    TemplateDraft,
    TemplateVersion,
    ContactSubmission,
    Spotlight,
    AdminPermission,
    AdminRole,
    AdminUser,
    AdminAuditLog,
    AdminSession,
    AdminInvitation,
    AdminAccessReview,
    AdminBreakGlassGrant,
    SupportTicketNote,
    SupportTicketResponse,
    SupportTicketEscalation,
    SupportTicketResolution,
    NotificationCampaign,
    FeatureFlag,
    PlatformSetting,
    AccountDeletionRequest,
    PrivacyRequest,
    PrivacyJob,
    PrivacyEvent,
    PlatformJob,
    PlatformWorkerHeartbeat,
    AnalyticsEvent,
    UserOperationalNote,
    UserRecoveryOperation,
    UserRestriction,
    MediaAsset,
    MediaDerivative,
    MusicCollection,
    MusicConnection,
    MusicOAuthState,
    MusicPlaylistImport,
  ],
  // Only timestamp-prefixed migration files are executable. Specs live beside
  // migrations for reviewability but must never be imported by the TypeORM CLI.
  migrations: [
    isCompiled ? 'dist/migrations/[0-9]*.js' : 'src/migrations/[0-9]*.ts',
  ],
  synchronize: false,
  logging: true,
});
