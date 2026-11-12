import { MigrationInterface, QueryRunner } from "typeorm";

export class AddUploadOwnership1724600000000 implements MigrationInterface {
  name = "AddUploadOwnership1724600000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "upload_ownership" (
      "key" character varying(100) PRIMARY KEY,
      "userId" uuid NOT NULL,
      "createdAt" TIMESTAMP NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_upload_ownership_user" ON "upload_ownership" ("userId")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "upload_ownership"`);
  }
}
