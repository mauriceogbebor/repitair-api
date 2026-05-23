import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAppleMusicUserToken1714100000002 implements MigrationInterface {
  name = "AddAppleMusicUserToken1714100000002";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "appleMusicUserToken" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "appleMusicUserToken"
    `);
  }
}
