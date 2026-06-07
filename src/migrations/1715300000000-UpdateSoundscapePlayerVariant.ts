import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Updates the soundscape template's playerVariant from "albumGrid" to
 * "scatteredCards" and adjusts overlayOpacity from 0.45 to 0.4 to match
 * the redesigned frontend multi-widget layout.
 */
export class UpdateSoundscapePlayerVariant1715300000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "templates" SET "playerVariant" = $1, "overlayOpacity" = $2 WHERE "id" = $3`,
      ["scatteredCards", 0.4, "soundscape"],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "templates" SET "playerVariant" = $1, "overlayOpacity" = $2 WHERE "id" = $3`,
      ["albumGrid", 0.45, "soundscape"],
    );
  }
}
