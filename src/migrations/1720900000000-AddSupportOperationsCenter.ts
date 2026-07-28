import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSupportOperationsCenter1720900000000 implements MigrationInterface {
  name = "AddSupportOperationsCenter1720900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN "subcategory" varchar`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN "issueType" varchar`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN "productArea" varchar`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN "relatedModerationReportId" uuid`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD CONSTRAINT "FK_support_moderation_report" FOREIGN KEY ("relatedModerationReportId") REFERENCES "repit_moderation_reports"("id") ON DELETE SET NULL`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN "sourceReferenceType" varchar`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN "sourceReferenceId" varchar`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" ADD COLUMN "firstRespondedAt" TIMESTAMPTZ`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_support_source_active" ON "contact_submissions" ("sourceReferenceType", "sourceReferenceId") WHERE "sourceReferenceType" IS NOT NULL AND "sourceReferenceId" IS NOT NULL AND "status" NOT IN ('resolved', 'closed')`);
    await queryRunner.query(`CREATE INDEX "IDX_support_queue" ON "contact_submissions" ("status", "priority", "updatedAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_support_source" ON "contact_submissions" ("source", "createdAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_support_sla" ON "contact_submissions" ("firstResponseDueAt", "resolutionDueAt")`);

    await queryRunner.query(`CREATE TABLE "support_ticket_responses" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ticketId" uuid NOT NULL,
      "authorAdminUserId" uuid, "authorAdminEmail" varchar, "body" text NOT NULL,
      "status" varchar NOT NULL DEFAULT 'queued', "failureCategory" varchar,
      "idempotencyKey" varchar NOT NULL, "sentAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "PK_support_ticket_responses" PRIMARY KEY ("id"),
      CONSTRAINT "FK_support_ticket_responses_ticket" FOREIGN KEY ("ticketId") REFERENCES "contact_submissions"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_support_ticket_responses_author" FOREIGN KEY ("authorAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_support_responses_ticket_created" ON "support_ticket_responses" ("ticketId", "createdAt")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_support_responses_idempotency" ON "support_ticket_responses" ("idempotencyKey")`);

    await queryRunner.query(`CREATE TABLE "support_ticket_escalations" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ticketId" uuid NOT NULL,
      "destination" varchar NOT NULL, "severity" varchar NOT NULL, "reason" text NOT NULL,
      "requestedAction" text NOT NULL, "status" varchar NOT NULL DEFAULT 'open',
      "assignedAdminUserId" uuid, "assignedAdminEmail" varchar, "outcome" text,
      "createdByAdminUserId" uuid, "createdByAdminEmail" varchar,
      "acceptedAt" TIMESTAMPTZ, "resolvedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "PK_support_ticket_escalations" PRIMARY KEY ("id"),
      CONSTRAINT "FK_support_escalations_ticket" FOREIGN KEY ("ticketId") REFERENCES "contact_submissions"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_support_escalations_assignee" FOREIGN KEY ("assignedAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL,
      CONSTRAINT "FK_support_escalations_creator" FOREIGN KEY ("createdByAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_support_escalations_ticket_status" ON "support_ticket_escalations" ("ticketId", "status")`);
    await queryRunner.query(`CREATE INDEX "IDX_support_escalations_queue" ON "support_ticket_escalations" ("destination", "status", "createdAt")`);

    await queryRunner.query(`CREATE TABLE "support_ticket_resolutions" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "ticketId" uuid NOT NULL,
      "action" varchar NOT NULL, "category" varchar, "summary" text NOT NULL,
      "actorAdminUserId" uuid, "actorAdminEmail" varchar,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "PK_support_ticket_resolutions" PRIMARY KEY ("id"),
      CONSTRAINT "FK_support_resolutions_ticket" FOREIGN KEY ("ticketId") REFERENCES "contact_submissions"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_support_resolutions_actor" FOREIGN KEY ("actorAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_support_resolutions_ticket_created" ON "support_ticket_resolutions" ("ticketId", "createdAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "support_ticket_resolutions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "support_ticket_escalations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "support_ticket_responses"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_sla"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_source"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_queue"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_support_source_active"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN "firstRespondedAt"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN "sourceReferenceId"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN "sourceReferenceType"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN "relatedModerationReportId"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN "productArea"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN "issueType"`);
    await queryRunner.query(`ALTER TABLE "contact_submissions" DROP COLUMN "subcategory"`);
  }
}
