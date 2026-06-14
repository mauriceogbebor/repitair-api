import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Renames the "motion-2" template to "pink-replay" (Pink Replay).
 * Updates the template ID, name, style, category, and playerVariant
 * to match the new iPhone-style player design.
 *
 * Also updates any repits that reference the old template ID.
 */
export class RenameMotion2ToPinkReplay1715400000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Update repits first (foreign key references the old ID)
    await queryRunner.query(
      `UPDATE "repits" SET "templateId" = $1 WHERE "templateId" = $2`,
      ["pink-replay", "motion-2"],
    );

    // Rename the template
    await queryRunner.query(
      `UPDATE "templates"
       SET "id" = $1, "name" = $2, "style" = $3, "category" = $4,
           "playerVariant" = $5, "layoutVariant" = $6
       WHERE "id" = $7`,
      [
        "pink-replay",
        "Pink Replay",
        "iPhone Player",
        "Lifestyle",
        "pinkReplay",
        "gradient",
        "motion-2",
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert template rename
    await queryRunner.query(
      `UPDATE "templates"
       SET "id" = $1, "name" = $2, "style" = $3, "category" = $4,
           "playerVariant" = $5, "layoutVariant" = $6
       WHERE "id" = $7`,
      [
        "motion-2",
        "Motion",
        "Dynamic",
        "Motion",
        "scatteredCards",
        "gradient",
        "pink-replay",
      ],
    );

    // Revert repit references
    await queryRunner.query(
      `UPDATE "repits" SET "templateId" = $1 WHERE "templateId" = $2`,
      ["motion-2", "pink-replay"],
    );
  }
}
