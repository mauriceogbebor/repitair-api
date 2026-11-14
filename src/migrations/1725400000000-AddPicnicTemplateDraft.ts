import { MigrationInterface, QueryRunner } from "typeorm";
import { picnicComposition } from "./picnic-composition";

/** Keep the new template private until its preview and certification are approved. */
export class AddPicnicTemplateDraft1725400000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "templates" (
        "id", "name", "style", "category", "premium", "animated", "sortOrder",
        "status", "isActive", "layoutVariant", "playerVariant", "overlayOpacity",
        "composition", "canvasMeta", "capabilities", "designTokens", "constraints", "designerNotes"
      ) VALUES ($1, $2, $3, $4, false, false, 18, 'draft', true, 'story', 'picnic', 0.08,
        $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
      ON CONFLICT ("id") DO NOTHING`,
      [
        "picnic", "Picnic", "Minimal", "Minimal",
        JSON.stringify(picnicComposition),
        JSON.stringify(picnicComposition.canvasMeta),
        JSON.stringify(picnicComposition.capabilities),
        JSON.stringify(picnicComposition.designTokens),
        JSON.stringify(picnicComposition.constraints),
        JSON.stringify(picnicComposition.designerNotes),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "templates" WHERE "id" = $1 AND "status" = 'draft'`,
      ["picnic"],
    );
  }
}
