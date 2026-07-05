import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAdminSupportAndNotifications1720300000000 implements MigrationInterface {
  name = "AddAdminSupportAndNotifications1720300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "status" character varying NOT NULL DEFAULT 'new'`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "priority" character varying NOT NULL DEFAULT 'medium'`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "category" character varying`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "tags" text[] NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "assignedAdminUserId" character varying`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "assignedAdminEmail" character varying`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "relatedUserId" character varying`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "relatedRepitIds" text[] NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "relatedNotificationIds" text[] NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "firstResponseDueAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "resolutionDueAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "resolvedAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "lastCustomerReplyAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "lastAdminReplyAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "source" character varying NOT NULL DEFAULT 'contact_form'`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "support_ticket_notes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ticketId" uuid NOT NULL,
        "authorAdminUserId" character varying,
        "authorAdminEmail" character varying,
        "body" text NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_support_ticket_notes_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_support_ticket_notes_ticket_id" ON "support_ticket_notes" ("ticketId")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "notification_campaigns" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying NOT NULL,
        "message" text NOT NULL,
        "audience" character varying NOT NULL DEFAULT 'all_users',
        "audienceFilters" jsonb,
        "type" character varying NOT NULL DEFAULT 'push',
        "imageUrl" character varying,
        "deepLink" character varying,
        "ctaLabel" character varying,
        "status" character varying NOT NULL DEFAULT 'draft',
        "scheduledAt" TIMESTAMPTZ,
        "sentAt" TIMESTAMPTZ,
        "cancelledAt" TIMESTAMPTZ,
        "failedAt" TIMESTAMPTZ,
        "createdByAdminUserId" character varying,
        "createdByAdminEmail" character varying,
        "updatedByAdminUserId" character varying,
        "updatedByAdminEmail" character varying,
        "duplicateOfNotificationId" character varying,
        "recipientCount" integer NOT NULL DEFAULT 0,
        "deliveredCount" integer NOT NULL DEFAULT 0,
        "failedCount" integer NOT NULL DEFAULT 0,
        "clickCount" integer NOT NULL DEFAULT 0,
        "deliverySummary" jsonb,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_notification_campaigns_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_notification_campaigns_status" ON "notification_campaigns" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_notification_campaigns_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "notification_campaigns"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_ticket_notes_ticket_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "support_ticket_notes"`);

    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "updatedAt"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "source"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "lastAdminReplyAt"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "lastCustomerReplyAt"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "closedAt"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "resolvedAt"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "resolutionDueAt"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "firstResponseDueAt"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "relatedNotificationIds"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "relatedRepitIds"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "relatedUserId"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "assignedAdminEmail"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "assignedAdminUserId"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "tags"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "category"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "priority"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN IF EXISTS "status"`);
  }
}
