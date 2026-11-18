import { MigrationInterface, QueryRunner } from "typeorm";
import { laundryRhythmComposition } from "./laundry-rhythm-composition";

/** Keep the new template private until its preview and certification are approved. */
export class AddLaundryRhythmTemplateDraft1725700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "templates" (
        "id", "name", "style", "category", "premium", "animated", "sortOrder",
        "status", "isActive", "layoutVariant", "playerVariant", "overlayOpacity",
        "composition", "canvasMeta", "capabilities", "designTokens", "constraints", "designerNotes"
      ) VALUES ($1, $2, $3, $4, false, false, 21, 'draft', true, 'story', 'laundryRhythm', 0.2,
        $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
      ON CONFLICT ("id") DO NOTHING`,
      [
        "laundry-rhythm", "Laundry Rhythm", "Minimal", "Minimal",
        JSON.stringify(laundryRhythmComposition),
        JSON.stringify(laundryRhythmComposition.canvasMeta),
        JSON.stringify(laundryRhythmComposition.capabilities),
        JSON.stringify(laundryRhythmComposition.designTokens),
        JSON.stringify(laundryRhythmComposition.constraints),
        JSON.stringify(laundryRhythmComposition.designerNotes),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "templates" WHERE "id" = $1 AND "status" = 'draft'`,
      ["laundry-rhythm"],
    );
  }
}
