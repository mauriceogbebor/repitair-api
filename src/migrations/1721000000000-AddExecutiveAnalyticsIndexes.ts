import { MigrationInterface, QueryRunner } from "typeorm";

export class AddExecutiveAnalyticsIndexes1721000000000 implements MigrationInterface {
  name = "AddExecutiveAnalyticsIndexes1721000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_users_createdAt" ON "users" ("createdAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_users_lastLoginAt" ON "users" ("lastLoginAt") WHERE "lastLoginAt" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_repits_createdAt_status" ON "repits" ("createdAt", "status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_repits_createdAt_platform" ON "repits" ("createdAt", "platform")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_repits_createdAt_template" ON "repits" ("createdAt", "templateId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_support_createdAt_status" ON "contact_submissions" ("createdAt", "status")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_support_resolution_analytics" ON "contact_submissions" ("createdAt", "resolvedAt") WHERE "resolvedAt" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_moderation_decisions_createdAt_action" ON "repit_moderation_decisions" ("createdAt", "action")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_moderation_decisions_createdAt_action"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_resolution_analytics"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_support_createdAt_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_repits_createdAt_template"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_repits_createdAt_platform"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_repits_createdAt_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_lastLoginAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_createdAt"`);
  }
}
