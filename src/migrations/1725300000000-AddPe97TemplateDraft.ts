import { MigrationInterface, QueryRunner } from "typeorm";
import { pe97Composition } from "./pe97-composition";

/** Keep the new template private until its preview and certification are approved. */
export class AddPe97TemplateDraft1725300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "templates" (
        "id", "name", "style", "category", "premium", "animated", "sortOrder",
        "status", "isActive", "layoutVariant", "playerVariant", "overlayOpacity",
        "composition", "canvasMeta", "capabilities", "designTokens", "constraints", "designerNotes"
      ) VALUES ($1, $2, $3, $4, false, false, 17, 'draft', true, 'story', 'pe97', 0.28,
        $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb)
      ON CONFLICT ("id") DO NOTHING`,
      [
        "pe97", "PE97", "Playlist", "Playlist",
        JSON.stringify(pe97Composition),
        JSON.stringify(pe97Composition.canvasMeta),
        JSON.stringify(pe97Composition.capabilities),
        JSON.stringify(pe97Composition.designTokens),
        JSON.stringify(pe97Composition.constraints),
        JSON.stringify(pe97Composition.designerNotes),
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "templates" WHERE "id" = $1 AND "status" = 'draft'`,
      ["pe97"],
    );
  }
}
