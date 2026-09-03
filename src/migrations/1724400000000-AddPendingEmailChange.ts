import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Finding 2 — secure email-change workflow. Adds the pending-email columns used
 * to stage a new address until the user proves control of it via a single-use
 * code (only the code HASH is stored). The primary `email` is untouched here.
 */
export class AddPendingEmailChange1724400000000 implements MigrationInterface {
  name = "AddPendingEmailChange1724400000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pendingEmail" character varying`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pendingEmailCodeHash" character varying`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pendingEmailExpiresAt" TIMESTAMP`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pendingEmailAttempts" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "pendingEmailRequestedAt" TIMESTAMP`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "pendingEmailRequestedAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "pendingEmailAttempts"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "pendingEmailExpiresAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "pendingEmailCodeHash"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "pendingEmail"`);
  }
}
