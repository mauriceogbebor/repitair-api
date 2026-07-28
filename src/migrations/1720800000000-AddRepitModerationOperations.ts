import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRepitModerationOperations1720800000000 implements MigrationInterface {
  name = "AddRepitModerationOperations1720800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "repit_moderation_reports" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "repitId" uuid NOT NULL,
      "reporterUserId" uuid, "reporterType" varchar NOT NULL, "reportType" varchar NOT NULL,
      "priority" varchar NOT NULL DEFAULT 'medium', "status" varchar NOT NULL DEFAULT 'open',
      "reason" text NOT NULL, "reporterComment" text, "evidence" jsonb,
      "assignedAdminUserId" uuid, "assignedAdminEmail" varchar, "escalationTarget" varchar,
      "claimedAt" TIMESTAMPTZ, "resolvedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "PK_repit_moderation_reports_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_repit_moderation_reports_reporter" FOREIGN KEY ("reporterUserId") REFERENCES "users"("id") ON DELETE SET NULL,
      CONSTRAINT "FK_repit_moderation_reports_assignee" FOREIGN KEY ("assignedAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_repit_moderation_reports_queue" ON "repit_moderation_reports" ("status", "priority", "createdAt")`);
    await queryRunner.query(`CREATE INDEX "IDX_repit_moderation_reports_repit_status" ON "repit_moderation_reports" ("repitId", "status")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_repit_moderation_reports_active" ON "repit_moderation_reports" ("repitId") WHERE "status" IN ('open', 'under_review', 'escalated')`);

    await queryRunner.query(`CREATE TABLE "repit_moderation_notes" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "repitId" uuid NOT NULL, "reportId" uuid,
      "authorAdminUserId" uuid, "authorAdminEmail" varchar, "body" text NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "PK_repit_moderation_notes_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_repit_moderation_notes_report" FOREIGN KEY ("reportId") REFERENCES "repit_moderation_reports"("id") ON DELETE SET NULL,
      CONSTRAINT "FK_repit_moderation_notes_author" FOREIGN KEY ("authorAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_repit_moderation_notes_repit_created" ON "repit_moderation_notes" ("repitId", "createdAt")`);

    await queryRunner.query(`CREATE TABLE "repit_moderation_decisions" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "repitId" uuid NOT NULL, "reportId" uuid,
      "action" varchar NOT NULL, "reason" text NOT NULL, "policyKey" varchar NOT NULL,
      "policyVersion" integer NOT NULL, "policyCategory" varchar NOT NULL, "severity" varchar NOT NULL,
      "previousStatus" varchar NOT NULL, "resultingStatus" varchar NOT NULL,
      "idempotencyKey" varchar,
      "actorAdminUserId" uuid, "actorAdminEmail" varchar,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "PK_repit_moderation_decisions_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_repit_moderation_decisions_report" FOREIGN KEY ("reportId") REFERENCES "repit_moderation_reports"("id") ON DELETE SET NULL,
      CONSTRAINT "FK_repit_moderation_decisions_actor" FOREIGN KEY ("actorAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_repit_moderation_decisions_repit_created" ON "repit_moderation_decisions" ("repitId", "createdAt")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "IDX_repit_moderation_decisions_idempotency" ON "repit_moderation_decisions" ("idempotencyKey")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "repit_moderation_decisions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "repit_moderation_notes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "repit_moderation_reports"`);
  }
}
