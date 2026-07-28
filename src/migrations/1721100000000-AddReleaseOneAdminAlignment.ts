import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Release 1 Targeted Admin Alignment — new operational tables:
 *  - feature_flags            (WS2/WS3: platform + moderation gating)
 *  - platform_settings        (WS2: min versions, maintenance, incident banner)
 *  - account_deletion_requests(WS4: deletion queue)
 *  - privacy_requests         (WS4: export/deletion requests)
 *  - analytics_events         (WS5: honest event log)
 *
 * Additive only. No existing table is altered (notification_campaigns.status is
 * a varchar that simply accepts the new honest state values).
 */
export class AddReleaseOneAdminAlignment1721100000000 implements MigrationInterface {
  name = "AddReleaseOneAdminAlignment1721100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "feature_flags" (
        "key" character varying NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "description" character varying,
        "updatedByAdminEmail" character varying,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_feature_flags" PRIMARY KEY ("key")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_settings" (
        "id" character varying NOT NULL DEFAULT 'singleton',
        "minIosVersion" character varying,
        "minAndroidVersion" character varying,
        "updatePolicy" character varying NOT NULL DEFAULT 'optional',
        "maintenance" jsonb,
        "incidentBanner" jsonb,
        "updatedByAdminEmail" character varying,
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_platform_settings" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "account_deletion_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "userEmail" character varying,
        "status" character varying NOT NULL DEFAULT 'pending',
        "reason" character varying,
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "handledByAdminEmail" character varying,
        "notes" text,
        "auditHistory" jsonb,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_account_deletion_requests" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_account_deletion_status_created" ON "account_deletion_requests" ("status", "createdAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "privacy_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "userEmail" character varying,
        "type" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'pending',
        "completedAt" TIMESTAMP WITH TIME ZONE,
        "operatorEmail" character varying,
        "notes" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_privacy_requests" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_privacy_requests_status_type_created" ON "privacy_requests" ("status", "type", "createdAt")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "analytics_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "userId" uuid,
        "properties" jsonb,
        "source" character varying NOT NULL DEFAULT 'backend',
        "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_analytics_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_analytics_events_name_occurred" ON "analytics_events" ("name", "occurredAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_analytics_events_occurred" ON "analytics_events" ("occurredAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "analytics_events"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "privacy_requests"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "account_deletion_requests"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "platform_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "feature_flags"`);
  }
}
