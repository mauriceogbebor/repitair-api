import { MigrationInterface, QueryRunner } from "typeorm";
import { dayComposition } from "./day-composition";

/** Keep the new template private until its preview and certification are approved. */
export class AddDayTemplateDraft1725800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "templates" (
        "id", "name", "style", "category", "premium", "animated", "sortOrder",
        "status", "isActive", "layoutVariant", "playerVariant", "overlayOpacity",
        "composition", "canvasMeta", "capabilities", "designTokens", "constraints", "designerNotes"
      ) VALUES ($1, $2, $3, $4, false, false, 22, 'draft', true, 'story', 'day', 0.18,
        $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
      ON CONFLICT ("id") DO NOTHING`,
      [
        "day", "Day", "Weather", "Weather",
        JSON.stringify(dayComposition),
        JSON.stringify(dayComposition.canvasMeta),
        JSON.stringify(dayComposition.capabilities),
        JSON.stringify(dayComposition.designTokens),
        JSON.stringify(dayComposition.constraints),
        JSON.stringify(dayComposition.designerNotes),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "templates" WHERE "id" = $1 AND "status" = 'draft'`,
      ["day"],
    );
  }
}
