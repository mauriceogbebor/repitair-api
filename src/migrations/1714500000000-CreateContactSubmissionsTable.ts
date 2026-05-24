import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateContactSubmissionsTable1714500000000 implements MigrationInterface {
  name = "CreateContactSubmissionsTable1714500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contact_submissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "email" character varying NOT NULL,
        "subject" character varying NOT NULL,
        "message" text NOT NULL,
        "emailSent" boolean NOT NULL DEFAULT false,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_contact_submissions" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "contact_submissions"`);
  }
}
