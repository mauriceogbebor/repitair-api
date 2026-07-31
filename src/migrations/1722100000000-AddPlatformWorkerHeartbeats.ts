import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPlatformWorkerHeartbeats1722100000000 implements MigrationInterface {
  name = "AddPlatformWorkerHeartbeats1722100000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "platform_worker_heartbeats" (
        "id" character varying(80) NOT NULL,
        "state" character varying(20) NOT NULL DEFAULT 'running',
        "queues" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "environment" character varying,
        "revision" character varying,
        "provider" character varying,
        "storageProvider" character varying,
        "currentJobId" uuid,
        "lastClaimedJobId" uuid,
        "lastClaimedAt" TIMESTAMP WITH TIME ZONE,
        "lastCompletedJobId" uuid,
        "lastCompletedAt" TIMESTAMP WITH TIME ZONE,
        "lastFailedJobId" uuid,
        "lastFailedAt" TIMESTAMP WITH TIME ZONE,
        "lastErrorCode" character varying,
        "startedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "heartbeatAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_worker_heartbeats" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_platform_worker_heartbeats_heartbeat"
      ON "platform_worker_heartbeats" ("heartbeatAt")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_platform_worker_heartbeats_heartbeat"`);
    await queryRunner.query(`DROP TABLE "platform_worker_heartbeats"`);
  }
}
