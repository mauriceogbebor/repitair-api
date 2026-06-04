import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 1. Fix template categories — group by style mood instead of category=name.
 * 2. Add layoutVariant and playerVariant columns so the API can serve
 *    rendering hints, removing the need for a client release to add templates.
 */
export class FixTemplateCategoriesAndAddLayoutHints1714900000000
  implements MigrationInterface
{
  private readonly categoryMapping: Array<{ id: string; category: string }> = [
    { id: "audioverse",    category: "Bold" },
    { id: "echo-room",     category: "Cinematic" },
    { id: "matcha-mood",   category: "Minimal" },
    { id: "midnight-mood", category: "Minimal" },
    { id: "sonic-orbit",   category: "Bold" },
    { id: "soundscape",    category: "Cinematic" },
    { id: "air-wave",      category: "Minimal" },
    { id: "ice-girl",      category: "Cinematic" },
    { id: "minion",        category: "Dynamic" },
    { id: "motion-2",      category: "Dynamic" },
  ];

  private readonly layoutMapping: Array<{
    id: string;
    layoutVariant: string;
    playerVariant: string;
    overlayOpacity: number;
  }> = [
    { id: "audioverse",    layoutVariant: "neon",     playerVariant: "scatteredCards", overlayOpacity: 0.45 },
    { id: "echo-room",     layoutVariant: "classic",  playerVariant: "playlist",       overlayOpacity: 0.4 },
    { id: "matcha-mood",   layoutVariant: "minimal",  playerVariant: "spotifyCard",    overlayOpacity: 0.3 },
    { id: "midnight-mood", layoutVariant: "classic",  playerVariant: "scatteredCards", overlayOpacity: 0.35 },
    { id: "sonic-orbit",   layoutVariant: "bold",     playerVariant: "collage",        overlayOpacity: 0.45 },
    { id: "soundscape",    layoutVariant: "classic",  playerVariant: "albumGrid",      overlayOpacity: 0.45 },
    { id: "air-wave",      layoutVariant: "minimal",  playerVariant: "vinylCard",      overlayOpacity: 0.3 },
    { id: "ice-girl",      layoutVariant: "gradient", playerVariant: "nowPlaying",     overlayOpacity: 0.4 },
    { id: "minion",        layoutVariant: "classic",  playerVariant: "fullPlayer",     overlayOpacity: 0.35 },
    { id: "motion-2",      layoutVariant: "gradient", playerVariant: "scatteredCards", overlayOpacity: 0.4 },
  ];

  /** Old categories to restore on down() — they were category=name */
  private readonly oldCategories: Array<{ id: string; category: string }> = [
    { id: "audioverse",    category: "Audioverse" },
    { id: "echo-room",     category: "Echo Room" },
    { id: "matcha-mood",   category: "Matcha Mood" },
    { id: "midnight-mood", category: "Midnight Mood" },
    { id: "sonic-orbit",   category: "Sonic Orbit" },
    { id: "soundscape",    category: "Soundscape" },
    { id: "air-wave",      category: "Air Wave" },
    { id: "ice-girl",      category: "Ice Girl" },
    { id: "minion",        category: "Minion" },
    { id: "motion-2",      category: "Motion" },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns
    await queryRunner.query(
      `ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "layoutVariant" varchar NOT NULL DEFAULT 'classic'`,
    );
    await queryRunner.query(
      `ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "playerVariant" varchar NOT NULL DEFAULT 'default'`,
    );
    await queryRunner.query(
      `ALTER TABLE "templates" ADD COLUMN IF NOT EXISTS "overlayOpacity" real NOT NULL DEFAULT 0.3`,
    );

    // Update categories
    for (const { id, category } of this.categoryMapping) {
      await queryRunner.query(
        `UPDATE "templates" SET "category" = $1 WHERE "id" = $2`,
        [category, id],
      );
    }

    // Update layout hints
    for (const { id, layoutVariant, playerVariant, overlayOpacity } of this.layoutMapping) {
      await queryRunner.query(
        `UPDATE "templates" SET "layoutVariant" = $1, "playerVariant" = $2, "overlayOpacity" = $3 WHERE "id" = $4`,
        [layoutVariant, playerVariant, overlayOpacity, id],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore old categories
    for (const { id, category } of this.oldCategories) {
      await queryRunner.query(
        `UPDATE "templates" SET "category" = $1 WHERE "id" = $2`,
        [category, id],
      );
    }

    // Drop new columns
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "overlayOpacity"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "playerVariant"`);
    await queryRunner.query(`ALTER TABLE "templates" DROP COLUMN IF EXISTS "layoutVariant"`);
  }
}
