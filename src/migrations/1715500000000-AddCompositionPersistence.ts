import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCompositionPersistence1715500000000 implements MigrationInterface {
  name = "AddCompositionPersistence1715500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "repits"
        ADD COLUMN IF NOT EXISTS "templateVersion" integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "canvasMeta" jsonb,
        ADD COLUMN IF NOT EXISTS "composition" jsonb
    `);

    await queryRunner.query(`
      ALTER TABLE "templates"
        ADD COLUMN IF NOT EXISTS "templateVersion" integer NOT NULL DEFAULT 1,
        ADD COLUMN IF NOT EXISTS "canvasMeta" jsonb,
        ADD COLUMN IF NOT EXISTS "composition" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "templates"
        DROP COLUMN IF EXISTS "composition",
        DROP COLUMN IF EXISTS "canvasMeta",
        DROP COLUMN IF EXISTS "templateVersion"
    `);

    await queryRunner.query(`
      ALTER TABLE "repits"
        DROP COLUMN IF EXISTS "composition",
        DROP COLUMN IF EXISTS "canvasMeta",
        DROP COLUMN IF EXISTS "templateVersion"
    `);
  }
}
