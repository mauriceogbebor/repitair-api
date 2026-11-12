import { MigrationInterface, QueryRunner } from "typeorm";
import { nightDriveComposition } from "./night-drive-composition";

/** Keep the new template private until its preview and certification are approved. */
export class AddNightDriveTemplateDraft1724800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "templates" (
        "id", "name", "style", "category", "premium", "animated", "sortOrder",
        "status", "isActive", "layoutVariant", "playerVariant", "overlayOpacity",
        "composition", "canvasMeta", "capabilities", "designTokens", "constraints", "designerNotes"
      ) VALUES ($1, $2, $3, $4, false, false, 12, 'draft', true, 'story', 'nightDrive', 0.32,
        $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
      ON CONFLICT ("id") DO NOTHING`,
      [
        "night-drive", "Night Drive", "Travel", "Travel",
        JSON.stringify(nightDriveComposition),
        JSON.stringify(nightDriveComposition.canvasMeta),
        JSON.stringify(nightDriveComposition.capabilities),
        JSON.stringify(nightDriveComposition.designTokens),
        JSON.stringify(nightDriveComposition.constraints),
        JSON.stringify(nightDriveComposition.designerNotes),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "templates" WHERE "id" = $1 AND "status" = 'draft'`,
      ["night-drive"],
    );
  }
}
