import { MigrationInterface, QueryRunner } from "typeorm";
import { stillHereComposition } from "./still-here-composition";

/** Keep the new template private until its preview and certification are approved. */
export class AddStillHereTemplateDraft1725600000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "templates" (
        "id", "name", "style", "category", "premium", "animated", "sortOrder",
        "status", "isActive", "layoutVariant", "playerVariant", "overlayOpacity",
        "composition", "canvasMeta", "capabilities", "designTokens", "constraints", "designerNotes"
      ) VALUES ($1, $2, $3, $4, false, false, 20, 'draft', true, 'story', 'stillHere', 0.12,
        $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
      ON CONFLICT ("id") DO NOTHING`,
      [
        "still-here", "Still Here", "Minimal", "Minimal",
        JSON.stringify(stillHereComposition),
        JSON.stringify(stillHereComposition.canvasMeta),
        JSON.stringify(stillHereComposition.capabilities),
        JSON.stringify(stillHereComposition.designTokens),
        JSON.stringify(stillHereComposition.constraints),
        JSON.stringify(stillHereComposition.designerNotes),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "templates" WHERE "id" = $1 AND "status" = 'draft'`,
      ["still-here"],
    );
  }
}
