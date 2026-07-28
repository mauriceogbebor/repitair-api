import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Support-response reliability hardening:
 *  1. `lastAttemptAt` — a persisted latest-claim timestamp so staleness is
 *     measured from the most recent provider-call claim (create OR retry),
 *     never from the immutable createdAt (Finding 2).
 *  2. A partial UNIQUE index guaranteeing at most one UNRESOLVED ("queued")
 *     response attempt per support case, as a database-level backstop to the
 *     transactional case-lock guard against multi-tab / multi-key duplicate
 *     sends (Finding 1). Reversible.
 *
 * Apply only to a confirmed local/staging database after review — never
 * directly to production.
 */
export class AddSupportResponseInflightGuards1721500000000 implements MigrationInterface {
  name = "AddSupportResponseInflightGuards1721500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "support_ticket_responses" ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMPTZ NULL`);
    // Backfill existing rows so historical staleness math is sensible.
    await queryRunner.query(`UPDATE "support_ticket_responses" SET "lastAttemptAt" = COALESCE("sentAt", "createdAt") WHERE "lastAttemptAt" IS NULL`);
    // The defect fixed by this migration could already have produced multiple
    // queued rows for one case. Preserve the newest row as the blocking attempt
    // and truthfully quarantine older rows as unknown rather than claiming that
    // they failed or were delivered. This makes the unique-index rollout safe
    // without permitting a new send while an outcome may still be unresolved.
    await queryRunner.query(`
      WITH ranked_queued AS (
        SELECT "id",
               ROW_NUMBER() OVER (
                 PARTITION BY "ticketId"
                 ORDER BY COALESCE("lastAttemptAt", "createdAt") DESC, "createdAt" DESC, "id" DESC
               ) AS queue_rank
        FROM "support_ticket_responses"
        WHERE "status" = 'queued'
      )
      UPDATE "support_ticket_responses" AS response
      SET "status" = 'delivery_unknown',
          "failureCategory" = 'migration_duplicate_uncertain'
      FROM ranked_queued
      WHERE response."id" = ranked_queued."id"
        AND ranked_queued.queue_rank > 1
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_support_response_single_inflight_per_case" ON "support_ticket_responses" ("ticketId") WHERE "status" = 'queued'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_support_response_single_inflight_per_case"`);
    await queryRunner.query(`UPDATE "support_ticket_responses" SET "status" = 'queued', "failureCategory" = NULL WHERE "status" = 'delivery_unknown' AND "failureCategory" = 'migration_duplicate_uncertain'`);
    await queryRunner.query(`ALTER TABLE "support_ticket_responses" DROP COLUMN IF EXISTS "lastAttemptAt"`);
  }
}
