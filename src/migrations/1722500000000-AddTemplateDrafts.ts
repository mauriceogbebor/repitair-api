import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTemplateDrafts1722500000000 implements MigrationInterface {
  name = "AddTemplateDrafts1722500000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "template_drafts" (
        "templateId" character varying NOT NULL,
        "basedOnVersion" integer NOT NULL,
        "revision" integer NOT NULL DEFAULT 1,
        "snapshot" jsonb NOT NULL,
        "authorAdminUserId" uuid,
        "authorEmail" character varying,
        "summary" text,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_template_drafts_template_id" PRIMARY KEY ("templateId"),
        CONSTRAINT "FK_template_drafts_template" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_template_drafts_updated_at" ON "template_drafts" ("updatedAt" DESC)`);

    // Existing unpublished templates become editable pending drafts without
    // changing their public visibility or published-template rows.
    await queryRunner.query(`
      INSERT INTO "template_drafts" (
        "templateId",
        "basedOnVersion",
        "revision",
        "snapshot",
        "authorAdminUserId",
        "authorEmail",
        "summary",
        "createdAt",
        "updatedAt"
      )
      SELECT
        template."id",
        template."templateVersion",
        1,
        jsonb_build_object(
          'name', template."name",
          'style', template."style",
          'category', template."category",
          'premium', template."premium",
          'animated', template."animated",
          'isActive', template."isActive",
          'sortOrder', template."sortOrder",
          'layoutVariant', template."layoutVariant",
          'playerVariant', template."playerVariant",
          'overlayOpacity', template."overlayOpacity",
          'previewImages', template."previewImages",
          'canvasMeta', template."canvasMeta",
          'composition', template."composition",
          'capabilities', template."capabilities",
          'designTokens', template."designTokens",
          'constraints', template."constraints",
          'designerNotes', template."designerNotes",
          'workflow', template."workflow",
          'certificationMeta', template."certificationMeta"
        ),
        -- templates.updatedByAdminUserId is varchar; the draft column is uuid.
        -- Cast explicitly (empty string → NULL) since Postgres won't do it implicitly.
        NULLIF(template."updatedByAdminUserId", '')::uuid,
        template."updatedByAdminEmail",
        COALESCE(template."lastChangeSummary", 'Existing draft migrated'),
        template."createdAt",
        template."updatedAt"
      FROM "templates" template
      WHERE template."status" = 'draft'
      ON CONFLICT ("templateId") DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_template_drafts_updated_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "template_drafts"`);
  }
}
