import { MigrationInterface, QueryRunner } from "typeorm";
import { midnightTrainComposition } from "./midnight-train-composition";

/** Keep the new template private until its preview and certification are approved. */
export class AddMidnightTrainTemplateDraft1725200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "templates" (
        "id", "name", "style", "category", "premium", "animated", "sortOrder",
        "status", "isActive", "layoutVariant", "playerVariant", "overlayOpacity",
        "composition", "canvasMeta", "capabilities", "designTokens", "constraints", "designerNotes"
      ) VALUES ($1, $2, $3, $4, false, false, 16, 'draft', true, 'story', 'midnightTrain', 0.15,
        $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
      ON CONFLICT ("id") DO NOTHING`,
      [
        "midnight-train", "Midnight Train", "Minimal", "Minimal",
        JSON.stringify(midnightTrainComposition),
        JSON.stringify(midnightTrainComposition.canvasMeta),
        JSON.stringify(midnightTrainComposition.capabilities),
        JSON.stringify(midnightTrainComposition.designTokens),
        JSON.stringify(midnightTrainComposition.constraints),
        JSON.stringify(midnightTrainComposition.designerNotes),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "templates" WHERE "id" = $1 AND "status" = 'draft'`,
      ["midnight-train"],
    );
  }
}
