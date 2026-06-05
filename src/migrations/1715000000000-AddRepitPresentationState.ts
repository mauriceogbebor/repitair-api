import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRepitPresentationState1715000000000 implements MigrationInterface {
  name = "AddRepitPresentationState1715000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "repits"
        ADD COLUMN IF NOT EXISTS "selectedSongs" jsonb,
        ADD COLUMN IF NOT EXISTS "widgetTransforms" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "repits"
        DROP COLUMN IF EXISTS "widgetTransforms",
        DROP COLUMN IF EXISTS "selectedSongs"
    `);
  }
}
