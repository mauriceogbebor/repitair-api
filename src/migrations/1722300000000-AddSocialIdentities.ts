import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSocialIdentities1722300000000 implements MigrationInterface {
  name = "AddSocialIdentities1722300000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "social_identities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "provider" character varying NOT NULL,
        "providerSubject" character varying NOT NULL,
        "providerEmail" character varying,
        "providerEmailIsPrivateRelay" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "lastAuthenticatedAt" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_social_identities" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_social_identities_provider_subject" UNIQUE ("provider", "providerSubject"),
        CONSTRAINT "FK_social_identities_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_social_identities_user" ON "social_identities" ("userId")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_social_identities_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "social_identities"`);
  }
}
