import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRepitEditorState1715100000000 implements MigrationInterface {
  name = "AddRepitEditorState1715100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "repits"
        ADD COLUMN IF NOT EXISTS "editorState" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "repits"
        DROP COLUMN IF EXISTS "editorState"
    `);
  }
}
