import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUserOperationsLifecycle1720700000000 implements MigrationInterface {
  name = "AddUserOperationsLifecycle1720700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sessionVersion" integer NOT NULL DEFAULT 0`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "user_operational_notes" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL,
      "authorAdminUserId" uuid, "authorAdminEmail" varchar, "body" text NOT NULL,
      "visibility" varchar NOT NULL DEFAULT 'internal', "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "PK_user_operational_notes_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_user_operational_notes_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_user_operational_notes_admin" FOREIGN KEY ("authorAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_user_operational_notes_user_created" ON "user_operational_notes" ("userId", "createdAt")`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "user_restrictions" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL,
      "type" varchar NOT NULL, "status" varchar NOT NULL DEFAULT 'active', "policyCategory" varchar,
      "reason" text NOT NULL, "startsAt" TIMESTAMPTZ NOT NULL,
      "issuedByAdminUserId" uuid, "issuedByAdminEmail" varchar,
      "revokedAt" TIMESTAMPTZ, "revokedByAdminUserId" uuid, "revokedByAdminEmail" varchar,
      "revocationReason" text, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "PK_user_restrictions_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_user_restrictions_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_user_restrictions_issuer" FOREIGN KEY ("issuedByAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL,
      CONSTRAINT "FK_user_restrictions_revoker" FOREIGN KEY ("revokedByAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_user_restrictions_user_status" ON "user_restrictions" ("userId", "status", "createdAt")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_user_restrictions_active_suspension" ON "user_restrictions" ("userId", "type") WHERE "status" = 'active'`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "user_recovery_operations" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "userId" uuid NOT NULL,
      "type" varchar NOT NULL, "status" varchar NOT NULL, "reason" text NOT NULL,
      "initiatedByAdminUserId" uuid, "initiatedByAdminEmail" varchar, "deliveryStatus" varchar,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "PK_user_recovery_operations_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_user_recovery_operations_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
      CONSTRAINT "FK_user_recovery_operations_admin" FOREIGN KEY ("initiatedByAdminUserId") REFERENCES "admin_users"("id") ON DELETE SET NULL
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_user_recovery_operations_user_created" ON "user_recovery_operations" ("userId", "createdAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "user_recovery_operations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_restrictions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_operational_notes"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "sessionVersion"`);
  }
}
