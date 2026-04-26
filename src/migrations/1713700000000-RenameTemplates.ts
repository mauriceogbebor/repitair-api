import { MigrationInterface, QueryRunner } from "typeorm";

export class RenameTemplates1713700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Rename Polaroid → Blush
    await queryRunner.query(`
      UPDATE "templates"
      SET "id" = 'blush', "name" = 'Blush', "style" = 'Blush', "category" = 'Soft'
      WHERE "id" = 'polaroid'
    `);

    // Rename Magazine → Anime
    await queryRunner.query(`
      UPDATE "templates"
      SET "id" = 'anime', "name" = 'Anime', "style" = 'Anime', "category" = 'Bold'
      WHERE "id" = 'magazine'
    `);

    // Rename Dreamy → Ocean
    await queryRunner.query(`
      UPDATE "templates"
      SET "id" = 'ocean', "name" = 'Ocean', "style" = 'Ocean', "category" = 'Aesthetic'
      WHERE "id" = 'dreamy'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "templates"
      SET "id" = 'polaroid', "name" = 'Polaroid', "style" = 'Polaroid', "category" = 'Aesthetic'
      WHERE "id" = 'blush'
    `);

    await queryRunner.query(`
      UPDATE "templates"
      SET "id" = 'magazine', "name" = 'Magazine', "style" = 'Magazine', "category" = 'Bold'
      WHERE "id" = 'anime'
    `);

    await queryRunner.query(`
      UPDATE "templates"
      SET "id" = 'dreamy', "name" = 'Dreamy', "style" = 'Story', "category" = 'Soft'
      WHERE "id" = 'ocean'
    `);
  }
}
