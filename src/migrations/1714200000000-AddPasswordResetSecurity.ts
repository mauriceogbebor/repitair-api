import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPasswordResetSecurity1714200000000
  implements MigrationInterface
{
  name = "AddPasswordResetSecurity1714200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD COLUMN IF NOT EXISTS "resetToken" character varying,
        ADD COLUMN IF NOT EXISTS "resetTokenExpiresAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "resetCodeAttempts" integer NOT NULL DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP COLUMN IF EXISTS "resetCodeAttempts",
        DROP COLUMN IF EXISTS "resetTokenExpiresAt",
        DROP COLUMN IF EXISTS "resetToken"
    `);
  }
}
