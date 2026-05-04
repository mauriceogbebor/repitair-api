import { MigrationInterface, QueryRunner } from "typeorm";

export class RemovePulseAndAlignStyles1713900000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Remove the Pulse template (not in Figma design)
    await queryRunner.query(`
      DELETE FROM "templates" WHERE "id" = 'pulse-video'
    `);

    // Align style and category columns with the Figma design.
    // style = generic label (Minimal, Bold, Retro, Soft, Aesthetic)
    // category = template name (used as LAYOUT_MAP key on the frontend)
    await queryRunner.query(`
      UPDATE "templates" SET "style" = 'Minimal', "category" = 'Sunrise'  WHERE "id" = 'sunrise'
    `);
    await queryRunner.query(`
      UPDATE "templates" SET "style" = 'Bold',    "category" = 'Cyber'    WHERE "id" = 'cyber'
    `);
    await queryRunner.query(`
      UPDATE "templates" SET "style" = 'Minimal', "category" = 'Mono'     WHERE "id" = 'mono'
    `);
    await queryRunner.query(`
      UPDATE "templates" SET "style" = 'Bold',    "category" = 'Neon Pulse' WHERE "id" = 'neon-pulse'
    `);
    await queryRunner.query(`
      UPDATE "templates" SET "style" = 'Retro',   "category" = 'Vinyl'    WHERE "id" = 'vinyl'
    `);
    await queryRunner.query(`
      UPDATE "templates" SET "style" = 'Minimal', "category" = 'Midnight' WHERE "id" = 'midnight'
    `);
    await queryRunner.query(`
      UPDATE "templates" SET "style" = 'Soft',    "category" = 'Blush'    WHERE "id" = 'blush'
    `);
    await queryRunner.query(`
      UPDATE "templates" SET "style" = 'Bold',    "category" = 'Anime'    WHERE "id" = 'anime'
    `);
    await queryRunner.query(`
      UPDATE "templates" SET "style" = 'Aesthetic', "category" = 'Ocean'  WHERE "id" = 'ocean'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-insert pulse-video
    await queryRunner.query(`
      INSERT INTO "templates" ("id", "name", "style", "category", "premium", "animated", "sortOrder")
      VALUES ('pulse-video', 'Pulse', 'Pulse', 'Animated', false, true, 10)
      ON CONFLICT ("id") DO NOTHING
    `);

    // Revert styles/categories to what FixTemplateStyles left them as
    await queryRunner.query(`UPDATE "templates" SET "style" = 'Sunrise',    "category" = 'Aesthetic' WHERE "id" = 'sunrise'`);
    await queryRunner.query(`UPDATE "templates" SET "style" = 'Cyber',      "category" = 'Bold'      WHERE "id" = 'cyber'`);
    await queryRunner.query(`UPDATE "templates" SET "style" = 'Mono',       "category" = 'Minimal'   WHERE "id" = 'mono'`);
    await queryRunner.query(`UPDATE "templates" SET "style" = 'Neon Pulse', "category" = 'Bold'      WHERE "id" = 'neon-pulse'`);
    await queryRunner.query(`UPDATE "templates" SET "style" = 'Vinyl',      "category" = 'Retro'     WHERE "id" = 'vinyl'`);
    await queryRunner.query(`UPDATE "templates" SET "style" = 'Midnight',   "category" = 'Minimal'   WHERE "id" = 'midnight'`);
    await queryRunner.query(`UPDATE "templates" SET "style" = 'Blush',      "category" = 'Soft'      WHERE "id" = 'blush'`);
    await queryRunner.query(`UPDATE "templates" SET "style" = 'Anime',      "category" = 'Bold'      WHERE "id" = 'anime'`);
    await queryRunner.query(`UPDATE "templates" SET "style" = 'Ocean',      "category" = 'Aesthetic'  WHERE "id" = 'ocean'`);
  }
}
