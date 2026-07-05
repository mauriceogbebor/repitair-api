import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAdminFoundation1720000000000 implements MigrationInterface {
  name = "AddAdminFoundation1720000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_permissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key" character varying NOT NULL,
        "module" character varying NOT NULL,
        "description" character varying NOT NULL,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_permissions_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_admin_permissions_key" UNIQUE ("key")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_roles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "key" character varying NOT NULL,
        "name" character varying NOT NULL,
        "description" text,
        "isSystem" boolean NOT NULL DEFAULT true,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_roles_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_admin_roles_key" UNIQUE ("key")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "fullName" character varying NOT NULL,
        "email" character varying NOT NULL,
        "passwordHash" character varying NOT NULL,
        "status" character varying NOT NULL DEFAULT 'active',
        "mfaEnabled" boolean NOT NULL DEFAULT false,
        "mfaSecret" character varying,
        "failedLoginAttempts" integer NOT NULL DEFAULT 0,
        "lockedUntil" TIMESTAMPTZ,
        "lastLoginAt" TIMESTAMPTZ,
        "lastLoginIp" character varying,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_admin_users_email" UNIQUE ("email")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "actorAdminUserId" character varying,
        "actorEmail" character varying,
        "action" character varying NOT NULL,
        "targetType" character varying,
        "targetId" character varying,
        "requestId" character varying,
        "method" character varying,
        "path" character varying,
        "ipAddress" character varying,
        "userAgent" character varying,
        "beforeState" jsonb,
        "afterState" jsonb,
        "metadata" jsonb,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_admin_audit_logs_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_role_permissions" (
        "roleId" uuid NOT NULL,
        "permissionId" uuid NOT NULL,
        CONSTRAINT "PK_admin_role_permissions" PRIMARY KEY ("roleId", "permissionId"),
        CONSTRAINT "FK_admin_role_permissions_role" FOREIGN KEY ("roleId") REFERENCES "admin_roles"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_admin_role_permissions_permission" FOREIGN KEY ("permissionId") REFERENCES "admin_permissions"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_role_permissions_role" ON "admin_role_permissions" ("roleId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_role_permissions_permission" ON "admin_role_permissions" ("permissionId")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "admin_user_roles" (
        "adminUserId" uuid NOT NULL,
        "roleId" uuid NOT NULL,
        CONSTRAINT "PK_admin_user_roles" PRIMARY KEY ("adminUserId", "roleId"),
        CONSTRAINT "FK_admin_user_roles_user" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_admin_user_roles_role" FOREIGN KEY ("roleId") REFERENCES "admin_roles"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_user_roles_user" ON "admin_user_roles" ("adminUserId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_user_roles_role" ON "admin_user_roles" ("roleId")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_audit_logs_createdAt" ON "admin_audit_logs" ("createdAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_audit_logs_action" ON "admin_audit_logs" ("action")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_users_status" ON "admin_users" ("status")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admin_users_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admin_audit_logs_action"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admin_audit_logs_createdAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admin_user_roles_role"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admin_user_roles_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_user_roles"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admin_role_permissions_permission"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_admin_role_permissions_role"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_role_permissions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_audit_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_users"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_roles"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_permissions"`);
  }
}
