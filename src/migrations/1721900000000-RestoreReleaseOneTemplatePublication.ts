import { MigrationInterface, QueryRunner } from "typeorm";

export const RELEASE_ONE_TEMPLATE_IDS = [
  "audioverse",
  "echo-room",
  "matcha-mood",
  "midnight-mood",
  "sonic-orbit",
  "soundscape",
  "air-wave",
  "ice-girl",
  "minion",
  "pink-replay",
] as const;

const RESTORE_MARKER = "Restored Release 1 template publication after discovery regression";

/**
 * AddAdminTemplateAndSpotlightManagement introduced `status` with a `draft`
 * default. Existing shipped templates inherited that value, so the later
 * public published/active filter hid the entire Release 1 catalog.
 *
 * Keep the public boundary strict and repair only the known shipped records.
 */
export class RestoreReleaseOneTemplatePublication1721900000000 implements MigrationInterface {
  name = "RestoreReleaseOneTemplatePublication1721900000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        INSERT INTO "template_versions" (
          "templateId",
          "versionNumber",
          "published",
          "action",
          "summary",
          "snapshot"
        )
        SELECT
          template."id",
          template."templateVersion",
          false,
          'published',
          $2::varchar,
          to_jsonb(template)
        FROM "templates" template
        WHERE template."id" = ANY($1::varchar[])
          AND template."status" = 'draft'
          AND template."isActive" = true
          AND template."publishedAt" IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM "template_versions" version
            WHERE version."templateId" = template."id"
              AND version."summary" = $2::varchar
          )
      `,
      [RELEASE_ONE_TEMPLATE_IDS, RESTORE_MARKER],
    );

    await queryRunner.query(
      `
        UPDATE "templates"
        SET
          "status" = 'published',
          "publishedAt" = COALESCE("publishedAt", now()),
          "updatedAt" = now()
        WHERE "id" = ANY($1::varchar[])
          AND "status" = 'draft'
          AND "isActive" = true
          AND "publishedAt" IS NULL
      `,
      [RELEASE_ONE_TEMPLATE_IDS],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE "templates" template
        SET
          "status" = COALESCE(snapshot."snapshot" ->> 'status', 'draft'),
          "isActive" = COALESCE((snapshot."snapshot" ->> 'isActive')::boolean, true),
          "publishedAt" = NULLIF(snapshot."snapshot" ->> 'publishedAt', '')::timestamptz,
          "updatedAt" = now()
        FROM (
          SELECT DISTINCT ON ("templateId") "templateId", "snapshot"
          FROM "template_versions"
          WHERE "summary" = $2::varchar
          ORDER BY "templateId", "createdAt" DESC
        ) snapshot
        WHERE template."id" = snapshot."templateId"
          AND template."id" = ANY($1::varchar[])
      `,
      [RELEASE_ONE_TEMPLATE_IDS, RESTORE_MARKER],
    );

    await queryRunner.query(
      `
        DELETE FROM "template_versions"
        WHERE "templateId" = ANY($1::varchar[])
          AND "summary" = $2::varchar
      `,
      [RELEASE_ONE_TEMPLATE_IDS, RESTORE_MARKER],
    );
  }
}
