import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPastelTemplate1714000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "templates" ("id", "name", "style", "category", "premium", "animated", "sortOrder")
      VALUES ('pastel', 'Pastel', 'Soft', 'Pastel', false, false, 10)
      ON CONFLICT ("id") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "templates" WHERE "id" = 'pastel'`);
  }
}
