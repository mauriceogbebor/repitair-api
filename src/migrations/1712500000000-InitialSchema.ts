import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Baseline schema — captures the initial state of users, repits, and push_tokens.
 * Generated to match the entity classes in src/entities/.
 *
 * Run:    npm run migration:run
 * Revert: npm run migration:revert
 */
export class InitialSchema1712500000000 implements MigrationInterface {
  name = "InitialSchema1712500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "fullName" character varying NOT NULL,
        "email" character varying NOT NULL,
        "country" character varying NOT NULL DEFAULT '',
        "passwordHash" character varying NOT NULL,
        "connectedPlatforms" text array NOT NULL DEFAULT '{}',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "resetCode" character varying,
        "resetCodeExpiresAt" TIMESTAMP,
        CONSTRAINT "UQ_users_email" UNIQUE ("email"),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "repits" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "title" character varying NOT NULL DEFAULT 'Untitled Repitair',
        "artist" character varying,
        "status" character varying NOT NULL DEFAULT 'draft',
        "platform" character varying NOT NULL DEFAULT 'spotify',
        "templateId" character varying NOT NULL,
        "songLink" character varying NOT NULL DEFAULT '',
        "backgroundPhotoUrl" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_repits" PRIMARY KEY ("id"),
        CONSTRAINT "FK_repits_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_repits_userId_createdAt" ON "repits" ("userId", "createdAt" DESC)`);

    await queryRunner.query(`
      CREATE TABLE "push_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" uuid NOT NULL,
        "pushToken" character varying NOT NULL,
        "platform" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_push_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "FK_push_tokens_user"
          FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "IDX_push_tokens_userId" ON "push_tokens" ("userId")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_push_tokens_userId"`);
    await queryRunner.query(`DROP TABLE "push_tokens"`);
    await queryRunner.query(`DROP INDEX "IDX_repits_userId_createdAt"`);
    await queryRunner.query(`DROP TABLE "repits"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
