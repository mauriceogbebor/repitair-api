import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAdminIdentityAccess1720600000000 implements MigrationInterface {
  name = "AddAdminIdentityAccess1720600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "mfaEnrolledAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "mfaResetRequired" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "suspensionReason" text`);
    await queryRunner.query(`ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "inactiveAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "accessReviewDueAt" TIMESTAMPTZ`);
    await queryRunner.query(`ALTER TABLE "admin_users" ADD COLUMN IF NOT EXISTS "lastAccessReviewedAt" TIMESTAMPTZ`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "admin_sessions" (
      "id" uuid NOT NULL, "adminUserId" uuid NOT NULL, "ipAddress" varchar, "userAgent" text,
      "browser" varchar, "operatingSystem" varchar, "approximateLocation" varchar,
      "expiresAt" TIMESTAMPTZ NOT NULL, "lastActivityAt" TIMESTAMPTZ, "revokedAt" TIMESTAMPTZ,
      "revokedByAdminUserId" uuid, "revocationReason" text,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "PK_admin_sessions_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_admin_sessions_user" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_sessions_user_active" ON "admin_sessions" ("adminUserId", "revokedAt", "expiresAt")`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "admin_invitations" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "adminUserId" uuid NOT NULL, "tokenHash" varchar NOT NULL,
      "status" varchar NOT NULL DEFAULT 'pending', "invitedByAdminUserId" uuid NOT NULL,
      "expiresAt" TIMESTAMPTZ NOT NULL, "acceptedAt" TIMESTAMPTZ, "revokedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "PK_admin_invitations_id" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_admin_invitations_token" UNIQUE ("tokenHash"),
      CONSTRAINT "FK_admin_invitations_user" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_invitations_user_status" ON "admin_invitations" ("adminUserId", "status")`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "admin_access_reviews" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "adminUserId" uuid NOT NULL,
      "reviewerAdminUserId" uuid NOT NULL, "outcome" varchar NOT NULL, "rationale" text NOT NULL,
      "dueAt" TIMESTAMPTZ NOT NULL, "nextReviewAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "PK_admin_access_reviews_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_admin_access_reviews_user" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_access_reviews_user_created" ON "admin_access_reviews" ("adminUserId", "createdAt")`);

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "admin_break_glass_grants" (
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "adminUserId" uuid NOT NULL,
      "activatedByAdminUserId" uuid NOT NULL, "approvedByAdminUserId" uuid, "reason" text NOT NULL,
      "status" varchar NOT NULL DEFAULT 'active', "expiresAt" TIMESTAMPTZ NOT NULL, "revokedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "PK_admin_break_glass_grants_id" PRIMARY KEY ("id"),
      CONSTRAINT "FK_admin_break_glass_user" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_break_glass_user_active" ON "admin_break_glass_grants" ("adminUserId", "status", "expiresAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_users_review_due" ON "admin_users" ("accessReviewDueAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_admin_users_last_activity" ON "admin_users" ("lastActivityAt")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_break_glass_grants"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_access_reviews"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_invitations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "admin_sessions"`);
    for (const column of ["lastAccessReviewedAt", "accessReviewDueAt", "inactiveAt", "suspensionReason", "suspendedAt", "mfaResetRequired", "mfaEnrolledAt", "lastActivityAt"]) {
      await queryRunner.query(`ALTER TABLE "admin_users" DROP COLUMN IF EXISTS "${column}"`);
    }
  }
}
