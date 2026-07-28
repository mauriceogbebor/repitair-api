import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Platform Job Processing System — the shared durable queue table.
 * Postgres-backed (atomic claiming via FOR UPDATE SKIP LOCKED). Additive.
 */
export class AddPlatformJobs1721300000000 implements MigrationInterface {
  name = "AddPlatformJobs1721300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "queue" character varying NOT NULL,
        "type" character varying NOT NULL,
        "domain" character varying NOT NULL,
        "payload" jsonb,
        "payloadVersion" integer NOT NULL DEFAULT 1,
        "status" character varying NOT NULL DEFAULT 'queued',
        "priority" character varying NOT NULL DEFAULT 'normal',
        "idempotencyKey" character varying,
        "correlationId" character varying,
        "parentJobId" uuid,
        "createdBy" character varying,
        "scheduledFor" TIMESTAMP WITH TIME ZONE,
        "queuedAt" TIMESTAMP WITH TIME ZONE,
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "failedAt" TIMESTAMP WITH TIME ZONE,
        "cancelledAt" TIMESTAMP WITH TIME ZONE,
        "attempts" integer NOT NULL DEFAULT 0,
        "maxAttempts" integer NOT NULL DEFAULT 5,
        "nextRetryAt" TIMESTAMP WITH TIME ZONE,
        "lastErrorCode" character varying,
        "lastErrorMessage" text,
        "lastErrorStack" text,
        "result" jsonb,
        "progress" integer,
        "workerId" character varying,
        "lockedAt" TIMESTAMP WITH TIME ZONE,
        "heartbeatAt" TIMESTAMP WITH TIME ZONE,
        "durationMs" integer,
        "metadata" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_jobs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_platform_jobs_claim" ON "platform_jobs" ("status", "queue", "scheduledFor")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_platform_jobs_type_status" ON "platform_jobs" ("type", "status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_platform_jobs_correlation" ON "platform_jobs" ("correlationId")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_platform_jobs_idempotency" ON "platform_jobs" ("idempotencyKey") WHERE "idempotencyKey" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_jobs"`);
  }
}
