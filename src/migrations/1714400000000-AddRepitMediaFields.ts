import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRepitMediaFields1714400000000 implements MigrationInterface {
  name = "AddRepitMediaFields1714400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "repits"
        ADD COLUMN IF NOT EXISTS "albumArt" character varying,
        ADD COLUMN IF NOT EXISTS "durationMs" integer,
        ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "repits"
        DROP COLUMN IF EXISTS "updatedAt",
        DROP COLUMN IF EXISTS "durationMs",
        DROP COLUMN IF EXISTS "albumArt"
    `);
  }
}
