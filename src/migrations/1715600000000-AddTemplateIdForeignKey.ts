import { MigrationInterface, QueryRunner } from "typeorm";

export class AddTemplateIdForeignKey1715600000000 implements MigrationInterface {
  name = "AddTemplateIdForeignKey1715600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // First, clean up any orphaned repits whose templateId no longer exists.
    // This should be rare (the service validates on create/update), but legacy
    // data could have stale references that would block the FK constraint.
    await queryRunner.query(`
      DELETE FROM "repits"
      WHERE "templateId" NOT IN (SELECT "id" FROM "templates")
    `);

    // Add index on templateId for efficient FK lookups and joins
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_repits_templateId" ON "repits" ("templateId")
    `);

    // Add the foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "repits"
      ADD CONSTRAINT "FK_repits_templateId"
      FOREIGN KEY ("templateId") REFERENCES "templates"("id")
      ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "repits" DROP CONSTRAINT IF EXISTS "FK_repits_templateId"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_repits_templateId"
    `);
  }
}
