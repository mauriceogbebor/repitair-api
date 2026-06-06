import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Corrects four stale playerVariant values that were set by the
 * 1714900000000 migration before the new widget variants existed.
 *
 * midnight-mood: scatteredCards → miniBar
 * matcha-mood:   spotifyCard   → matchaWindow
 * air-wave:      vinylCard     → airwaveArc
 * minion:        fullPlayer    → posterStack
 */
export class FixStalePlayerVariants1715200000000
  implements MigrationInterface
{
  private readonly fixes: Array<{ id: string; from: string; to: string }> = [
    { id: "midnight-mood", from: "scatteredCards", to: "miniBar" },
    { id: "matcha-mood",   from: "spotifyCard",    to: "matchaWindow" },
    { id: "air-wave",      from: "vinylCard",      to: "airwaveArc" },
    { id: "minion",        from: "fullPlayer",      to: "posterStack" },
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { id, to } of this.fixes) {
      await queryRunner.query(
        `UPDATE "templates" SET "playerVariant" = $1 WHERE "id" = $2`,
        [to, id],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { id, from } of this.fixes) {
      await queryRunner.query(
        `UPDATE "templates" SET "playerVariant" = $1 WHERE "id" = $2`,
        [from, id],
      );
    }
  }
}
