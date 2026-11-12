import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEmailVerifyAttempts1724500000000 implements MigrationInterface {
  name = "AddEmailVerifyAttempts1724500000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "emailVerifyCodeAttempts" integer NOT NULL DEFAULT 0`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "emailVerifyCodeAttempts"`);
  }
}
