import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAdminOperationsFields1720100000000 implements MigrationInterface {
  name = "AddAdminOperationsFields1720100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "isSuspended" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspensionReason" character varying`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "signupSource" character varying`);

    await queryRunner.query(`ALTER TABLE "repits" ADD COLUMN IF NOT EXISTS "moderationStatus" character varying NOT NULL DEFAULT 'active'`);
    await queryRunner.query(`ALTER TABLE "repits" ADD COLUMN IF NOT EXISTS "flagReason" character varying`);
    await queryRunner.query(`ALTER TABLE "repits" ADD COLUMN IF NOT EXISTS "archivedAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "repits" ADD COLUMN IF NOT EXISTS "deletedByAdminAt" TIMESTAMPTZ`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "repits" DROP COLUMN IF EXISTS "deletedByAdminAt"`);
    await queryRunner.query(`ALTER TABLE "repits" DROP COLUMN IF EXISTS "archivedAt"`);
    await queryRunner.query(`ALTER TABLE "repits" DROP COLUMN IF EXISTS "flagReason"`);
    await queryRunner.query(`ALTER TABLE "repits" DROP COLUMN IF EXISTS "moderationStatus"`);

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "signupSource"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "lastLoginAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "suspendedAt"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "suspensionReason"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "isSuspended"`);
  }
}
