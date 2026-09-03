import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds media_derivatives.visibleBounds (jsonb, nullable) — the visible-content
 * bounding box of a transparent derivative, used by opt-in templates (Ice Girl)
 * to fit the VISIBLE subject to an authored target rather than the whole PNG
 * frame. Purely additive: existing derivatives keep NULL and consumers fall back
 * to whole-frame behaviour, so no existing output changes. Reversible.
 */
export class AddMediaDerivativeVisibleBounds1722100000000 implements MigrationInterface {
  name = "AddMediaDerivativeVisibleBounds1722100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "media_derivatives" ADD COLUMN IF NOT EXISTS "visibleBounds" jsonb NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "media_derivatives" DROP COLUMN IF EXISTS "visibleBounds"`);
  }
}
