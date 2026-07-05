import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Sprint D: Template Authoring Studio
 *
 * Adds JSONB columns for template-first metadata that powers the
 * Template Authoring Studio in the admin and content-first experience
 * in the mobile app.
 *
 * All columns are nullable — existing templates continue working
 * without any metadata. The admin populates these progressively.
 */
export class AddTemplateAuthoringMetadata1720400000000 implements MigrationInterface {
  name = "AddTemplateAuthoringMetadata1720400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Template capabilities — what the template supports
    await queryRunner.query(`
      ALTER TABLE "templates"
      ADD COLUMN IF NOT EXISTS "capabilities" jsonb DEFAULT NULL
    `);

    // Design tokens — colour/spacing identity
    await queryRunner.query(`
      ALTER TABLE "templates"
      ADD COLUMN IF NOT EXISTS "designTokens" jsonb DEFAULT NULL
    `);

    // Constraints — creative boundaries and recommendations
    await queryRunner.query(`
      ALTER TABLE "templates"
      ADD COLUMN IF NOT EXISTS "constraints" jsonb DEFAULT NULL
    `);

    // Designer notes — internal creative intent (never exposed to users)
    await queryRunner.query(`
      ALTER TABLE "templates"
      ADD COLUMN IF NOT EXISTS "designerNotes" jsonb DEFAULT NULL
    `);

    // Workflow configuration — authored editing journey
    await queryRunner.query(`
      ALTER TABLE "templates"
      ADD COLUMN IF NOT EXISTS "workflow" jsonb DEFAULT NULL
    `);

    // Certification metadata — publishing pipeline status
    await queryRunner.query(`
      ALTER TABLE "templates"
      ADD COLUMN IF NOT EXISTS "certificationMeta" jsonb DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "certificationMeta"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "workflow"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "designerNotes"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "constraints"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "designTokens"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "capabilities"`);
  }
}
