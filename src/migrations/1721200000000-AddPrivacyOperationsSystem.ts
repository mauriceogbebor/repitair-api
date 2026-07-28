import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Privacy Operations & Fulfilment System.
 * Extends privacy_requests to the full lifecycle (assignment, SLA, fulfilment,
 * failure recovery) and adds privacy_jobs (execution) + privacy_events (timeline).
 * Additive; the legacy account_deletion_requests table is unchanged.
 */
export class AddPrivacyOperationsSystem1721200000000 implements MigrationInterface {
  name = "AddPrivacyOperationsSystem1721200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const cols: Array<[string, string]> = [
      ["priority", `character varying NOT NULL DEFAULT 'medium'`],
      ["assignedAdminEmail", `character varying`],
      ["assignedAt", `TIMESTAMP WITH TIME ZONE`],
      ["reassignedAt", `TIMESTAMP WITH TIME ZONE`],
      ["assignmentHistory", `jsonb`],
      ["dueAt", `TIMESTAMP WITH TIME ZONE`],
      ["escalationLevel", `integer NOT NULL DEFAULT 0`],
      ["fulfilledByAdminEmail", `character varying`],
      ["fulfilledAt", `TIMESTAMP WITH TIME ZONE`],
      ["fulfilmentMethod", `character varying`],
      ["fulfilmentResult", `character varying`],
      ["verificationStatus", `character varying NOT NULL DEFAULT 'unverified'`],
      ["internalNotes", `text`],
      ["retryCount", `integer NOT NULL DEFAULT 0`],
      ["lastRetryAt", `TIMESTAMP WITH TIME ZONE`],
      ["lastError", `text`],
      ["rejectedReason", `text`],
    ];
    for (const [name, type] of cols) {
      await queryRunner.query(`ALTER TABLE "privacy_requests" ADD COLUMN IF NOT EXISTS "${name}" ${type}`);
    }
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_privacy_requests_assignee_status" ON "privacy_requests" ("assignedAdminEmail", "status")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "privacy_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "requestId" uuid NOT NULL,
        "type" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        "durationMs" integer,
        "result" jsonb,
        "lastError" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_privacy_jobs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_privacy_jobs_request_type" ON "privacy_jobs" ("requestId", "type")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_privacy_jobs_status_created" ON "privacy_jobs" ("status", "createdAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "privacy_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "requestId" uuid NOT NULL,
        "type" character varying NOT NULL,
        "message" character varying,
        "actorEmail" character varying,
        "metadata" jsonb,
        "at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_privacy_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_privacy_events_request_at" ON "privacy_events" ("requestId", "at")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "privacy_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "privacy_jobs"`);
    const cols = ["priority", "assignedAdminEmail", "assignedAt", "reassignedAt", "assignmentHistory", "dueAt", "escalationLevel", "fulfilledByAdminEmail", "fulfilledAt", "fulfilmentMethod", "fulfilmentResult", "verificationStatus", "internalNotes", "retryCount", "lastRetryAt", "lastError", "rejectedReason"];
    for (const name of cols) {
      await queryRunner.query(`ALTER TABLE "privacy_requests" DROP COLUMN IF EXISTS "${name}"`);
    }
  }
}
