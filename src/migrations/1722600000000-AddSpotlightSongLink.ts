import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddSpotlightSongLink1722600000000 implements MigrationInterface {
  name = "AddSpotlightSongLink1722600000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "spotlights" ADD COLUMN IF NOT EXISTS "songLink" character varying',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "spotlights" DROP COLUMN IF EXISTS "songLink"',
    );
  }
}
