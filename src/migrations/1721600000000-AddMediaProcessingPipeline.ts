import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * AI Media Processing Pipeline (background removal V1) storage.
 *  - media_assets: one row per uploaded source image; the original is immutable
 *    and its processing lifecycle is tracked separately from the upload.
 *  - media_derivatives: processed outputs (transparent PNG today; enhancement /
 *    thumbnails tomorrow), one row per (asset, kind, providerVersion) so a
 *    provider-version bump can regenerate without destroying prior output.
 * Reversible. Apply only to a confirmed local/staging database after review.
 */
export class AddMediaProcessingPipeline1721600000000 implements MigrationInterface {
  name = "AddMediaProcessingPipeline1721600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "media_assets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "ownerUserId" uuid NULL,
        "originalKey" varchar NOT NULL,
        "originalUrl" varchar NOT NULL,
        "mimeType" varchar NOT NULL,
        "width" integer NULL,
        "height" integer NULL,
        "bytes" bigint NULL,
        "checksum" varchar NOT NULL,
        "processingStatus" varchar NOT NULL DEFAULT 'uploaded',
        "retryCount" integer NOT NULL DEFAULT 0,
        "lastError" varchar NULL,
        "processingStartedAt" timestamptz NULL,
        "processingCompletedAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_media_assets" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_media_assets_owner_created" ON "media_assets" ("ownerUserId", "createdAt")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_media_assets_checksum" ON "media_assets" ("checksum")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_media_assets_status" ON "media_assets" ("processingStatus")`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "media_derivatives" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "assetId" uuid NOT NULL,
        "kind" varchar NOT NULL,
        "key" varchar NOT NULL,
        "url" varchar NOT NULL,
        "mimeType" varchar NOT NULL DEFAULT 'image/png',
        "width" integer NULL,
        "height" integer NULL,
        "bytes" bigint NULL,
        "checksum" varchar NULL,
        "provider" varchar NOT NULL,
        "providerVersion" varchar NOT NULL,
        "processorVersion" integer NOT NULL DEFAULT 1,
        "processingDurationMs" integer NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_media_derivatives" PRIMARY KEY ("id"),
        CONSTRAINT "FK_media_derivatives_asset" FOREIGN KEY ("assetId") REFERENCES "media_assets" ("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_media_derivatives_asset_kind" ON "media_derivatives" ("assetId", "kind")`);
    await queryRunner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_media_derivatives_asset_kind_version" ON "media_derivatives" ("assetId", "kind", "providerVersion")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "media_derivatives"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "media_assets"`);
  }
}
