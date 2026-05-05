import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserAvatarUrl1714100000000 implements MigrationInterface {
  name = "AddUserAvatarUrl1714100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatarUrl" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" DROP COLUMN IF EXISTS "avatarUrl"
    `);
  }
}
