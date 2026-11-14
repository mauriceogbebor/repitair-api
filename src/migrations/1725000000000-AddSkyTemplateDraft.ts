import { MigrationInterface, QueryRunner } from "typeorm";
import { skyComposition } from "./sky-composition";

/** Keep the new template private until its preview and certification are approved. */
export class AddSkyTemplateDraft1725000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "templates" (
        "id", "name", "style", "category", "premium", "animated", "sortOrder",
        "status", "isActive", "layoutVariant", "playerVariant", "overlayOpacity",
        "composition", "canvasMeta", "capabilities", "designTokens", "constraints", "designerNotes"
      ) VALUES ($1, $2, $3, $4, false, false, 14, 'draft', true, 'story', 'sky', 0.18,
        $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
      ON CONFLICT ("id") DO NOTHING`,
      [
        "sky", "Sky", "Minimal", "Minimal",
        JSON.stringify(skyComposition),
        JSON.stringify(skyComposition.canvasMeta),
        JSON.stringify(skyComposition.capabilities),
        JSON.stringify(skyComposition.designTokens),
        JSON.stringify(skyComposition.constraints),
        JSON.stringify(skyComposition.designerNotes),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "templates" WHERE "id" = $1 AND "status" = 'draft'`,
      ["sky"],
    );
  }
}
