import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Extends media_derivatives with versioning + provenance needed for production
 * background removal:
 *  - pipelineVersion: lets a future edge/alpha/shadow improvement invalidate ONLY
 *    outdated derivatives (per asset) instead of regenerating the whole library.
 *  - providerRequestId: the upstream provider's request id, retained for support
 *    correlation and audit.
 * Reversible. Apply only to a confirmed local/staging database after review.
 */
export class AddMediaDerivativeProvenance1721700000000 implements MigrationInterface {
  name = "AddMediaDerivativeProvenance1721700000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "media_derivatives" ADD COLUMN IF NOT EXISTS "pipelineVersion" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "media_derivatives" ADD COLUMN IF NOT EXISTS "providerRequestId" varchar NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "media_derivatives" DROP COLUMN IF EXISTS "providerRequestId"`);
    await queryRunner.query(`ALTER TABLE "media_derivatives" DROP COLUMN IF EXISTS "pipelineVersion"`);
  }
}
