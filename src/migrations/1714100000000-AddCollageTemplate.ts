import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCollageTemplate1714100000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Collage template removed from MVP scope — no-op
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "templates" WHERE "id" = 'collage'`);
  }
}
