import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSpotifyRefreshToken1712700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "spotifyRefreshToken" varchar
    `);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "spotifyRefreshToken"`);
  }
}
