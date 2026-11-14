import { MigrationInterface, QueryRunner } from "typeorm";
import { coffeeComposition } from "./coffee-composition";

/** Keep the new template private until its preview and certification are approved. */
export class AddCoffeeTemplateDraft1724900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "templates" (
        "id", "name", "style", "category", "premium", "animated", "sortOrder",
        "status", "isActive", "layoutVariant", "playerVariant", "overlayOpacity",
        "composition", "canvasMeta", "capabilities", "designTokens", "constraints", "designerNotes"
      ) VALUES ($1, $2, $3, $4, false, false, 13, 'draft', true, 'story', 'coffee', 0.08,
        $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
      ON CONFLICT ("id") DO NOTHING`,
      [
        "coffee", "Coffee", "Lifestyle", "Lifestyle",
        JSON.stringify(coffeeComposition),
        JSON.stringify(coffeeComposition.canvasMeta),
        JSON.stringify(coffeeComposition.capabilities),
        JSON.stringify(coffeeComposition.designTokens),
        JSON.stringify(coffeeComposition.constraints),
        JSON.stringify(coffeeComposition.designerNotes),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "templates" WHERE "id" = $1 AND "status" = 'draft'`,
      ["coffee"],
    );
  }
}
