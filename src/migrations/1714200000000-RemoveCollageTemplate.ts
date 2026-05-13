import { MigrationInterface, QueryRunner } from "typeorm";

export class RemoveCollageTemplate1714200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "templates" WHERE "id" = 'collage'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "templates" ("id", "name", "style", "category", "premium", "animated", "sortOrder")
      VALUES ('collage', 'Collage', 'Bold', 'Collage', false, false, 11)
      ON CONFLICT ("id") DO NOTHING
    `);
  }
}
