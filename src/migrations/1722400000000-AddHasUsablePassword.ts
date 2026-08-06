import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHasUsablePassword1722400000000 implements MigrationInterface {
  name = "AddHasUsablePassword1722400000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "hasUsablePassword" boolean NOT NULL DEFAULT false`,
    );
    // Existing email/legacy accounts already have a real password they set — keep
    // them able to log in. Social-origin accounts stay false so email/password
    // login is refused with a "use your provider" message.
    await queryRunner.query(
      `UPDATE "users" SET "hasUsablePassword" = true WHERE "signupSource" = 'email' OR "signupSource" IS NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "hasUsablePassword"`);
  }
}
