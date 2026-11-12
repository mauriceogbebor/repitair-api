import { MigrationInterface, QueryRunner } from "typeorm";
import { airplaneModeComposition } from "./airplane-mode-composition";

/** Keep the new template private until its preview and certification are approved. */
export class AddAirplaneModeTemplateDraft1724700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "templates" (
        "id", "name", "style", "category", "premium", "animated", "sortOrder",
        "status", "isActive", "layoutVariant", "playerVariant", "overlayOpacity",
        "composition", "canvasMeta", "capabilities", "designTokens", "constraints", "designerNotes"
      ) VALUES ($1, $2, $3, $4, false, false, 11, 'draft', true, 'story', 'airplaneMode', 0.12,
        $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
      ON CONFLICT ("id") DO NOTHING`,
      [
        "airplane-mode", "Airplane-Mode", "Travel", "Travel",
        JSON.stringify(airplaneModeComposition),
        JSON.stringify(airplaneModeComposition.canvasMeta),
        JSON.stringify(airplaneModeComposition.capabilities),
        JSON.stringify(airplaneModeComposition.designTokens),
        JSON.stringify(airplaneModeComposition.constraints),
        JSON.stringify(airplaneModeComposition.designerNotes),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "templates" WHERE "id" = $1 AND "status" = 'draft'`,
      ["airplane-mode"],
    );
  }
}
