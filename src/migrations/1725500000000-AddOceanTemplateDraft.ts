import { MigrationInterface, QueryRunner } from "typeorm";
import { oceanComposition } from "./ocean-composition";

/** Keep the new template private until its preview and certification are approved. */
export class AddOceanTemplateDraft1725500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "templates" (
        "id", "name", "style", "category", "premium", "animated", "sortOrder",
        "status", "isActive", "layoutVariant", "playerVariant", "overlayOpacity",
        "composition", "canvasMeta", "capabilities", "designTokens", "constraints", "designerNotes"
      ) VALUES ($1, $2, $3, $4, false, false, 19, 'draft', true, 'story', 'ocean', 0.12,
        $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
      ON CONFLICT ("id") DO NOTHING`,
      [
        "ocean", "Ocean", "Minimal", "Minimal",
        JSON.stringify(oceanComposition),
        JSON.stringify(oceanComposition.canvasMeta),
        JSON.stringify(oceanComposition.capabilities),
        JSON.stringify(oceanComposition.designTokens),
        JSON.stringify(oceanComposition.constraints),
        JSON.stringify(oceanComposition.designerNotes),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "templates" WHERE "id" = $1 AND "status" = 'draft'`,
      ["ocean"],
    );
  }
}
