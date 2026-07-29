import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds media_derivatives.sourceChecksum so the cache becomes truly
 * content-addressed: identical source bytes processed at the same version key
 * reuse the stored output with no new provider call, even across assets/users.
 * Reversible. Apply only to a confirmed local/staging database after review.
 */
export class AddMediaDerivativeSourceChecksum1721800000000 implements MigrationInterface {
  name = "AddMediaDerivativeSourceChecksum1721800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "media_derivatives" ADD COLUMN IF NOT EXISTS "sourceChecksum" varchar NULL`);
    // Backfill from the owning asset so existing derivatives participate in the cache.
    await queryRunner.query(`
      UPDATE "media_derivatives" AS d
      SET "sourceChecksum" = a."checksum"
      FROM "media_assets" AS a
      WHERE d."assetId" = a."id" AND d."sourceChecksum" IS NULL
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_media_derivatives_sourceChecksum" ON "media_derivatives" ("sourceChecksum")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_media_derivatives_sourceChecksum"`);
    await queryRunner.query(`ALTER TABLE "media_derivatives" DROP COLUMN IF EXISTS "sourceChecksum"`);
  }
}
