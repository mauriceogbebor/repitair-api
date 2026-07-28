import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Privacy remediation — database-level integrity.
 *  - FKs from privacy_jobs / privacy_events → privacy_requests (ON DELETE CASCADE),
 *    so jobs/events cannot orphan and are cleaned up with their request.
 *  - Partial UNIQUE index enforcing at most one ACTIVE request per (user, type),
 *    backing application-level duplicate detection at the database.
 * Fully reversible. Apply only to a reviewed local/staging database.
 */
export class PrivacyIntegrityConstraints1721400000000 implements MigrationInterface {
  name = "PrivacyIntegrityConstraints1721400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "privacy_jobs"
      ADD COLUMN "downloadTokenHash" char(64),
      ADD COLUMN "downloadExpiresAt" timestamptz,
      ADD COLUMN "downloadedAt" timestamptz
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_privacy_jobs_download_token_hash"
      ON "privacy_jobs" ("downloadTokenHash")
      WHERE "downloadTokenHash" IS NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "privacy_jobs"
      ADD CONSTRAINT "FK_privacy_jobs_request"
      FOREIGN KEY ("requestId") REFERENCES "privacy_requests"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "privacy_events"
      ADD CONSTRAINT "FK_privacy_events_request"
      FOREIGN KEY ("requestId") REFERENCES "privacy_requests"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_privacy_requests_active_per_user_type"
      ON "privacy_requests" ("userId", "type")
      WHERE "status" IN ('pending','assigned','in_review','approved','processing','fulfilled','retry_required')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_privacy_requests_active_per_user_type"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_privacy_jobs_download_token_hash"`);
    await queryRunner.query(`ALTER TABLE "privacy_events" DROP CONSTRAINT IF EXISTS "FK_privacy_events_request"`);
    await queryRunner.query(`ALTER TABLE "privacy_jobs" DROP CONSTRAINT IF EXISTS "FK_privacy_jobs_request"`);
    await queryRunner.query(`
      ALTER TABLE "privacy_jobs"
      DROP COLUMN IF EXISTS "downloadedAt",
      DROP COLUMN IF EXISTS "downloadExpiresAt",
      DROP COLUMN IF EXISTS "downloadTokenHash"
    `);
  }
}
