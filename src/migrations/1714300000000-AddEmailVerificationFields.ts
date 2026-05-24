import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEmailVerificationFields1714300000000 implements MigrationInterface {
  name = "AddEmailVerificationFields1714300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "emailVerified" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "emailVerifyCode" character varying,
        ADD COLUMN IF NOT EXISTS "emailVerifyCodeExpiresAt" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "emailVerifyCodeExpiresAt",
        DROP COLUMN IF EXISTS "emailVerifyCode",
        DROP COLUMN IF EXISTS "emailVerified"
    `);
  }
}
