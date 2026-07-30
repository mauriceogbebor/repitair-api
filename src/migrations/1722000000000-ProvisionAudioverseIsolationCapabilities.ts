import { MigrationInterface, QueryRunner } from "typeorm";

export const AUDIOVERSE_TEMPLATE_ID = "audioverse";

const CAPABILITY_MARKER = "Provisioned Audioverse isolation capabilities";

/**
 * Audioverse was published before its isolation capabilities were persisted.
 * The public API therefore returned a valid template whose null capabilities
 * made mobile correctly choose the standard-photo bypass.
 */
export class ProvisionAudioverseIsolationCapabilities1722000000000 implements MigrationInterface {
  name = "ProvisionAudioverseIsolationCapabilities1722000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    const authoritativeRows = await queryRunner.query(
      `
        SELECT "id"
        FROM "templates"
        WHERE "id" = $1
          AND "status" = 'published'
          AND "isActive" = true
      `,
      [AUDIOVERSE_TEMPLATE_ID],
    ) as Array<{ id: string }>;
    if (authoritativeRows.length !== 1) {
      throw new Error(
        `Cannot provision Audioverse isolation: published active template "${AUDIOVERSE_TEMPLATE_ID}" was not found`,
      );
    }

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
          true,
          'updated',
          $2::varchar,
          to_jsonb(template)
        FROM "templates" template
        WHERE template."id" = $1
          AND template."status" = 'published'
          AND template."isActive" = true
          AND (
            COALESCE((template."capabilities" ->> 'supportsIsolatedSubject')::boolean, false) = false
            OR COALESCE((template."capabilities" ->> 'requiresBackgroundRemoval')::boolean, false) = false
          )
          AND NOT EXISTS (
            SELECT 1
            FROM "template_versions" version
            WHERE version."templateId" = template."id"
              AND version."summary" = $2::varchar
          )
      `,
      [AUDIOVERSE_TEMPLATE_ID, CAPABILITY_MARKER],
    );

    await queryRunner.query(
      `
        UPDATE "templates"
        SET
          "capabilities" = CASE
              WHEN "capabilities" IS NULL OR jsonb_typeof("capabilities") <> 'object'
                THEN '{}'::jsonb
              ELSE "capabilities"
            END
            || '{"supportsIsolatedSubject": true, "requiresBackgroundRemoval": true}'::jsonb,
          "updatedAt" = now()
        WHERE "id" = $1
          AND "status" = 'published'
          AND "isActive" = true
          AND (
            COALESCE(("capabilities" ->> 'supportsIsolatedSubject')::boolean, false) = false
            OR COALESCE(("capabilities" ->> 'requiresBackgroundRemoval')::boolean, false) = false
          )
      `,
      [AUDIOVERSE_TEMPLATE_ID],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        UPDATE "templates" template
        SET
          "capabilities" = CASE
            WHEN snapshot."snapshot" -> 'capabilities' = 'null'::jsonb THEN NULL
            ELSE snapshot."snapshot" -> 'capabilities'
          END,
          "updatedAt" = now()
        FROM (
          SELECT DISTINCT ON ("templateId") "templateId", "snapshot"
          FROM "template_versions"
          WHERE "templateId" = $1
            AND "summary" = $2::varchar
          ORDER BY "templateId", "createdAt" DESC
        ) snapshot
        WHERE template."id" = snapshot."templateId"
      `,
      [AUDIOVERSE_TEMPLATE_ID, CAPABILITY_MARKER],
    );

    await queryRunner.query(
      `
        DELETE FROM "template_versions"
        WHERE "templateId" = $1
          AND "summary" = $2::varchar
      `,
      [AUDIOVERSE_TEMPLATE_ID, CAPABILITY_MARKER],
    );
  }
}
