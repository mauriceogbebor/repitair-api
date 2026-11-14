import { MigrationInterface, QueryRunner } from "typeorm";
import { momentsComposition } from "./moments-composition";

/** Keep the new template private until its preview and certification are approved. */
export class AddMomentsTemplateDraft1725100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "templates" (
        "id", "name", "style", "category", "premium", "animated", "sortOrder",
        "status", "isActive", "layoutVariant", "playerVariant", "overlayOpacity",
        "composition", "canvasMeta", "capabilities", "designTokens", "constraints", "designerNotes"
      ) VALUES ($1, $2, $3, $4, false, false, 15, 'draft', true, 'story', 'moments', 0.12,
        $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
      ON CONFLICT ("id") DO NOTHING`,
      [
        "moments", "Moments", "Lifestyle", "Lifestyle",
        JSON.stringify(momentsComposition),
        JSON.stringify(momentsComposition.canvasMeta),
        JSON.stringify(momentsComposition.capabilities),
        JSON.stringify(momentsComposition.designTokens),
        JSON.stringify(momentsComposition.constraints),
        JSON.stringify(momentsComposition.designerNotes),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "templates" WHERE "id" = $1 AND "status" = 'draft'`,
      ["moments"],
    );
  }
}
