import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAdminAuditExplorerIndexes1720500000000 implements MigrationInterface {
  name = "AddAdminAuditExplorerIndexes1720500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_audit_actor" ON "admin_audit_logs" ("actorAdminUserId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_audit_target" ON "admin_audit_logs" ("targetType", "targetId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_audit_request" ON "admin_audit_logs" ("requestId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admin_audit_request"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admin_audit_target"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admin_audit_actor"`);
  }
}
