import { MigrationInterface, QueryRunner } from "typeorm";
import { coldTownComposition } from "./cold-town-composition";

/** Keep the new template private until its preview and certification are approved. */
export class AddColdTownTemplateDraft1725900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "templates" (
        "id", "name", "style", "category", "premium", "animated", "sortOrder",
        "status", "isActive", "layoutVariant", "playerVariant", "overlayOpacity",
        "composition", "canvasMeta", "capabilities", "designTokens", "constraints", "designerNotes"
      ) VALUES ($1, $2, $3, $4, false, false, 23, 'draft', true, 'story', 'coldTown', 0.15,
        $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
      ON CONFLICT ("id") DO NOTHING`,
      [
        "cold-town", "Cold Town", "Weather", "Weather",
        JSON.stringify(coldTownComposition),
        JSON.stringify(coldTownComposition.canvasMeta),
        JSON.stringify(coldTownComposition.capabilities),
        JSON.stringify(coldTownComposition.designTokens),
        JSON.stringify(coldTownComposition.constraints),
        JSON.stringify(coldTownComposition.designerNotes),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "templates" WHERE "id" = $1 AND "status" = 'draft'`,
      ["cold-town"],
    );
  }
}
