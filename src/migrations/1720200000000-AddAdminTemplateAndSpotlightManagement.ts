import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAdminTemplateAndSpotlightManagement1720200000000 implements MigrationInterface {
  name = "AddAdminTemplateAndSpotlightManagement1720200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "status" character varying NOT NULL DEFAULT 'draft'`);
    await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "isActive" boolean NOT NULL DEFAULT true`);
    await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "previewImages" jsonb`);
    await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "createdByAdminUserId" character varying`);
    await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "createdByAdminEmail" character varying`);
    await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "updatedByAdminUserId" character varying`);
    await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "updatedByAdminEmail" character varying`);
    await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "lastChangeSummary" character varying`);
    await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()`);
    await queryRunner.query(`ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "template_versions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "templateId" character varying NOT NULL,
        "versionNumber" integer NOT NULL,
        "published" boolean NOT NULL DEFAULT false,
        "action" character varying NOT NULL DEFAULT 'updated',
        "summary" character varying,
        "snapshot" jsonb NOT NULL,
        "authorAdminUserId" character varying,
        "authorEmail" character varying,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_template_versions_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_template_versions_template_id" ON "template_versions" ("templateId")`);

    await queryRunner.query(`ALTER TABLE "spotlights" ADD COLUMN IF NOT EXISTS "subtitle" character varying`);
    await queryRunner.query(`ALTER TABLE "spotlights" ADD COLUMN IF NOT EXISTS "song" character varying`);
    await queryRunner.query(`ALTER TABLE "spotlights" ADD COLUMN IF NOT EXISTS "backgroundImage" character varying`);
    await queryRunner.query(`ALTER TABLE "spotlights" ADD COLUMN IF NOT EXISTS "campaignType" character varying NOT NULL DEFAULT 'editorial'`);
    await queryRunner.query(`ALTER TABLE "spotlights" ADD COLUMN IF NOT EXISTS "buttonLabel" character varying`);
    await queryRunner.query(`ALTER TABLE "spotlights" ADD COLUMN IF NOT EXISTS "tapCount" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "spotlights" ADD COLUMN IF NOT EXISTS "scheduledAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "spotlights" ADD COLUMN IF NOT EXISTS "publishedAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "spotlights" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "spotlights" ADD COLUMN IF NOT EXISTS "createdByAdminUserId" character varying`);
    await queryRunner.query(`ALTER TABLE "spotlights" ADD COLUMN IF NOT EXISTS "createdByAdminEmail" character varying`);
    await queryRunner.query(`ALTER TABLE "spotlights" ADD COLUMN IF NOT EXISTS "updatedByAdminUserId" character varying`);
    await queryRunner.query(`ALTER TABLE "spotlights" ADD COLUMN IF NOT EXISTS "updatedByAdminEmail" character varying`);
    await queryRunner.query(`ALTER TABLE "spotlights" ADD COLUMN IF NOT EXISTS "duplicateOfSpotlightId" character varying`);
    await queryRunner.query(`ALTER TABLE "spotlights" ALTER COLUMN "status" SET DEFAULT 'draft'`);
    await queryRunner.query(`UPDATE "spotlights" SET "status" = 'draft' WHERE "status" = 'pending'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_template_versions_template_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "template_versions"`);

    await queryRunner.query(`ALTER TABLE "spotlights" DROP COLUMN IF EXISTS "duplicateOfSpotlightId"`);
    await queryRunner.query(`ALTER TABLE "spotlights" DROP COLUMN IF EXISTS "updatedByAdminEmail"`);
    await queryRunner.query(`ALTER TABLE "spotlights" DROP COLUMN IF EXISTS "updatedByAdminUserId"`);
    await queryRunner.query(`ALTER TABLE "spotlights" DROP COLUMN IF EXISTS "createdByAdminEmail"`);
    await queryRunner.query(`ALTER TABLE "spotlights" DROP COLUMN IF EXISTS "createdByAdminUserId"`);
    await queryRunner.query(`ALTER TABLE "spotlights" DROP COLUMN IF EXISTS "archivedAt"`);
    await queryRunner.query(`ALTER TABLE "spotlights" DROP COLUMN IF EXISTS "publishedAt"`);
    await queryRunner.query(`ALTER TABLE "spotlights" DROP COLUMN IF EXISTS "scheduledAt"`);
    await queryRunner.query(`ALTER TABLE "spotlights" DROP COLUMN IF EXISTS "tapCount"`);
    await queryRunner.query(`ALTER TABLE "spotlights" DROP COLUMN IF EXISTS "buttonLabel"`);
    await queryRunner.query(`ALTER TABLE "spotlights" DROP COLUMN IF EXISTS "campaignType"`);
    await queryRunner.query(`ALTER TABLE "spotlights" DROP COLUMN IF EXISTS "backgroundImage"`);
    await queryRunner.query(`ALTER TABLE "spotlights" DROP COLUMN IF EXISTS "song"`);
    await queryRunner.query(`ALTER TABLE "spotlights" DROP COLUMN IF EXISTS "subtitle"`);

    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "updatedAt"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "createdAt"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "archivedAt"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "publishedAt"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "lastChangeSummary"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "updatedByAdminEmail"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "updatedByAdminUserId"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "createdByAdminEmail"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "createdByAdminUserId"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "previewImages"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "isActive"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "status"`);
  }
}
